use std::time::Duration;

use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::SinkExt;
use reqwest::{Client, Method};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream,
    tungstenite::{Message, client::IntoClientRequest},
};
use tokio_util::sync::CancellationToken;

use super::{ReadOperation, discovery::Credentials};
use crate::error::{AppError, AppResult};

pub(super) type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub(super) struct Transport {
    credentials: Credentials,
    http: Client,
    pub cancel: CancellationToken,
}

impl Transport {
    pub fn new(credentials: Credentials, cancel: CancellationToken) -> AppResult<Self> {
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(8))
            // This client can only construct URLs to the discovered loopback port.
            .tls_danger_accept_invalid_certs(true)
            .build()
            .map_err(|_| AppError::new("Internal", "Could not create local transport"))?;
        Ok(Self {
            credentials,
            http,
            cancel,
        })
    }

    pub fn matches(&self, credentials: &Credentials) -> bool {
        &self.credentials == credentials
    }

    async fn request(&self, method: Method, path: &str, body: Option<Value>) -> AppResult<Value> {
        let response_error = if method == Method::GET {
            "InvalidInput"
        } else {
            "OutcomeUnknown"
        };
        let url = format!("https://127.0.0.1:{}{}", self.credentials.port, path);
        let mut request = self
            .http
            .request(method, url)
            .basic_auth("riot", Some(&self.credentials.password));
        if let Some(body) = body {
            request = request.json(&body);
        }
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(AppError::new("StaleSession", "The client session has ended")),
            result = async {
                let mut response = request.send().await.map_err(|e| {
                    if e.is_timeout() { AppError::new("Timeout", "Local request timed out; write outcome may be unknown") }
                    else { AppError::new("Disconnected", "Local client request failed") }
                })?;
                match response.status().as_u16() {
                    200..=299 => {},
                    401 | 403 => return Err(AppError::new("Unauthorized", "Local client authentication failed")),
                    404 => return Err(AppError::new("Unsupported", "Local client resource is unavailable")),
                    429 => return Err(AppError::new("RateLimited", "Local client rate limit reached")),
                    _ => return Err(AppError::new("Io", "Local client rejected the operation")),
                }
                if response.content_length().is_some_and(|n| n > 16 * 1024 * 1024) {
                    return Err(AppError::new(response_error, "Local response is too large"));
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(|_| AppError::new("Io", "Could not read local response"))? {
                    if bytes.len() + chunk.len() > 16 * 1024 * 1024 { return Err(AppError::new(response_error, "Local response is too large")); }
                    bytes.extend_from_slice(&chunk);
                }
                if bytes.is_empty() { return Ok(Value::Null); }
                serde_json::from_slice(&bytes).map_err(|_| AppError::new(response_error, "Malformed local response"))
            } => result,
        }
    }

    pub async fn read(&self, operation: ReadOperation) -> AppResult<Value> {
        self.request(Method::GET, &operation.path()?, None).await
    }

    pub async fn ready(&self, accept: bool) -> AppResult<Value> {
        self.request(
            Method::POST,
            if accept {
                "/lol-matchmaking/v1/ready-check/accept"
            } else {
                "/lol-matchmaking/v1/ready-check/decline"
            },
            None,
        )
        .await
    }

    pub async fn swap(&self, id: u32) -> AppResult<Value> {
        self.request(
            Method::POST,
            &format!("/lol-champ-select/v1/session/bench/swap/{id}"),
            None,
        )
        .await
    }

    pub async fn chat(&self, room: &str, body: &str) -> AppResult<Value> {
        super::validate_identifier(room)?;
        if body.is_empty() || body.len() > 16000 {
            return Err(AppError::new(
                "InvalidInput",
                "Chat summary size is invalid",
            ));
        }
        self.request(
            Method::POST,
            &format!("/lol-chat/v1/conversations/{room}/messages"),
            Some(serde_json::json!({"body": body, "type": "celebration"})),
        )
        .await
    }

    pub async fn hovercard(&self, queue: &str, tier: &str) -> AppResult<Value> {
        self.request(
            Method::PUT,
            "/lol-chat/v1/me",
            Some(serde_json::json!({"lol": {
                "level":"30", "rankedSplitRewardLevel":"3", "rankedLeagueDivision":"I",
                "rankedLeagueQueue":queue, "rankedLeagueTier":tier,
                "regalia":"{bannerType:2,crestType:2}","skinVariant":"","skinname":""
            }})),
        )
        .await
    }

    pub async fn websocket(&self) -> AppResult<Socket> {
        let mut request = format!("wss://127.0.0.1:{}/", self.credentials.port)
            .into_client_request()
            .map_err(|_| AppError::new("Internal", "Invalid local websocket address"))?;
        let auth = format!(
            "Basic {}",
            STANDARD.encode(format!("riot:{}", self.credentials.password))
        );
        request.headers_mut().insert(
            "Authorization",
            auth.parse()
                .map_err(|_| AppError::new("InvalidInput", "Invalid local credentials"))?,
        );
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            "wamp".parse().expect("static header"),
        );
        let connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .build()
            .map_err(|_| AppError::new("Internal", "Could not create local websocket TLS"))?;
        let connection = tokio_tungstenite::connect_async_tls_with_config(
            request,
            Some(
                tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                    .max_message_size(Some(4 * 1024 * 1024))
                    .max_frame_size(Some(4 * 1024 * 1024)),
            ),
            false,
            Some(Connector::NativeTls(connector)),
        );
        let (mut socket, _) = tokio::select! {
            _ = self.cancel.cancelled() => return Err(AppError::new("StaleSession", "The client session has ended")),
            result = tokio::time::timeout(Duration::from_secs(5), connection) => result
                .map_err(|_| AppError::new("Timeout", "Local websocket connection timed out"))?
                .map_err(|_| AppError::new("Disconnected", "Local websocket connection failed"))?,
        };
        for topic in [
            "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
            "OnJsonApiEvent_lol-champ-select_v1_session",
            "OnJsonApiEvent_lol-summoner_v1_current-summoner",
            "OnJsonApiEvent_lol-lobby_v2_comms_members",
        ] {
            socket
                .send(Message::Text(
                    serde_json::json!([5, topic]).to_string().into(),
                ))
                .await
                .map_err(|_| {
                    AppError::new("Disconnected", "Local websocket subscription failed")
                })?;
        }
        Ok(socket)
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use futures_util::StreamExt;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream as BlockingStream},
        thread,
    };

    pub type FixtureAcceptor = std::sync::Arc<rustls::ServerConfig>;
    pub type FixtureStream = rustls::StreamOwned<rustls::ServerConnection, BlockingStream>;

    // The loopback server uses a throwaway self-signed identity generated for each test run, so no
    // key material is stored in the repository.
    pub fn fixture_listener() -> (TcpListener, FixtureAcceptor, u16) {
        static CONFIG: std::sync::OnceLock<FixtureAcceptor> = std::sync::OnceLock::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let acceptor = CONFIG
            .get_or_init(|| {
                let key = rcgen::KeyPair::generate().unwrap();
                let params =
                    rcgen::CertificateParams::new(vec!["127.0.0.1".into(), "localhost".into()])
                        .unwrap();
                let certificate = params.self_signed(&key).unwrap();
                let provider = std::sync::Arc::new(rustls::crypto::ring::default_provider());
                std::sync::Arc::new(
                    rustls::ServerConfig::builder_with_provider(provider)
                        .with_safe_default_protocol_versions()
                        .unwrap()
                        .with_no_client_auth()
                        .with_single_cert(
                            vec![certificate.der().clone()],
                            rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der())
                                .unwrap(),
                        )
                        .unwrap(),
                )
            })
            .clone();
        (listener, acceptor, port)
    }

    pub fn accept_tls(stream: BlockingStream, acceptor: &FixtureAcceptor) -> FixtureStream {
        rustls::StreamOwned::new(
            rustls::ServerConnection::new(acceptor.clone()).unwrap(),
            stream,
        )
    }

    pub fn fixture_transport(port: u16) -> Transport {
        Transport::new(
            Credentials {
                pid: 1,
                started: 1,
                port,
                password: "fixture-token".into(),
            },
            CancellationToken::new(),
        )
        .unwrap()
    }

    pub fn accept_http(
        listener: &TcpListener,
        acceptor: &FixtureAcceptor,
    ) -> (FixtureStream, String) {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut stream = accept_tls(stream, acceptor);
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        (stream, String::from_utf8(request).unwrap())
    }

    pub fn respond(stream: &mut FixtureStream, status: u16, body: &str) {
        write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        stream.flush().unwrap();
    }

    #[tokio::test]
    async fn https_status_mapping_and_authentication_stay_local() {
        let (listener, acceptor, port) = fixture_listener();
        let cases = [
            (200, "\"ReadyCheck\"", None),
            (401, "{}", Some("Unauthorized")),
            (404, "{}", Some("Unsupported")),
            (429, "{}", Some("RateLimited")),
            (500, "{}", Some("Io")),
            (200, "malformed", Some("InvalidInput")),
        ];
        let server = thread::spawn(move || {
            for (status, body, _) in cases {
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("GET /lol-gameflow/v1/gameflow-phase HTTP/1.1"));
                assert!(
                    request.to_ascii_lowercase().contains(
                        &format!(
                            "authorization: basic {}",
                            STANDARD.encode("riot:fixture-token")
                        )
                        .to_ascii_lowercase()
                    )
                );
                respond(&mut stream, status, body);
            }
        });
        let transport = fixture_transport(port);
        for (_, _, expected) in cases {
            let result = transport.read(ReadOperation::Phase).await;
            match expected {
                Some(code) => assert_eq!(result.unwrap_err().code, code),
                None => assert_eq!(result.unwrap(), "ReadyCheck"),
            }
        }
        server.join().unwrap();
    }

    #[tokio::test]
    async fn redirects_are_not_followed_and_errors_do_not_leak_credentials() {
        let (listener, acceptor, port) = fixture_listener();
        let server = thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: https://example.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let error = fixture_transport(port)
            .read(ReadOperation::Phase)
            .await
            .unwrap_err();
        assert_eq!(error.code, "Io");
        assert!(!error.to_string().contains("fixture-token"));
        assert!(!error.to_string().contains(&port.to_string()));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn cancelling_in_flight_post_does_not_retry() {
        let (listener, acceptor, port) = fixture_listener();
        let (sent, received) = tokio::sync::oneshot::channel();
        let server = thread::spawn(move || {
            let (_stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-matchmaking/v1/ready-check/accept"));
            sent.send(()).unwrap();
            thread::sleep(Duration::from_millis(100));
            listener.set_nonblocking(true).unwrap();
            assert!(
                matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
            );
        });
        let transport = std::sync::Arc::new(fixture_transport(port));
        let worker = transport.clone();
        let request = tokio::spawn(async move { worker.ready(true).await });
        received.await.unwrap();
        transport.cancel.cancel();
        assert_eq!(request.await.unwrap().unwrap_err().code, "StaleSession");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn timed_out_post_has_uncertain_result_and_is_not_retried() {
        let (listener, acceptor, port) = fixture_listener();
        let server = thread::spawn(move || {
            let (_stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-matchmaking/v1/ready-check/accept"));
            thread::sleep(Duration::from_millis(150));
            listener.set_nonblocking(true).unwrap();
            assert!(
                matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
            );
        });
        let mut transport = fixture_transport(port);
        transport.http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .tls_danger_accept_invalid_certs(true)
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let error = transport.ready(true).await.unwrap_err();
        assert_eq!(error.code, "Timeout");
        assert!(error.message.contains("unknown"));
        server.join().unwrap();
    }

    #[tokio::test]
    #[allow(clippy::result_large_err)] // Tungstenite fixes the handshake callback error type.
    async fn wss_negotiates_wamp_and_subscribes_before_events() {
        let (listener, acceptor, port) = fixture_listener();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let stream = accept_tls(stream, &acceptor);
            let mut socket = tokio_tungstenite::tungstenite::accept_hdr(stream, |request: &tokio_tungstenite::tungstenite::handshake::server::Request, mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                assert_eq!(request.headers()["sec-websocket-protocol"], "wamp");
                assert_eq!(request.headers()["authorization"], format!("Basic {}", STANDARD.encode("riot:fixture-token")));
                response.headers_mut().insert("sec-websocket-protocol", "wamp".parse().unwrap());
                Ok(response)
            }).unwrap();
            for _ in 0..4 {
                let message = socket.read().unwrap().into_text().unwrap();
                let subscription: Value = serde_json::from_str(&message).unwrap();
                assert_eq!(subscription[0], 5);
            }
            socket.send(Message::Text("[8,\"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase\",{\"eventType\":\"Update\",\"data\":\"UnknownFuturePhase\"}]".into())).unwrap();
            socket.close(None).unwrap();
        });
        let transport = fixture_transport(port);
        let mut socket = transport.websocket().await.unwrap();
        let message = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert_eq!(
            super::super::parse_event(&message).unwrap()["data"],
            "UnknownFuturePhase"
        );
        server.join().unwrap();
    }
}
