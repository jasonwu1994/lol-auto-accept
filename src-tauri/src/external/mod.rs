use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

type CachedResponse = Arc<Mutex<Option<(Instant, AppResult<Value>)>>>;

pub struct ExternalData {
    client: reqwest::Client,
    requests: Semaphore,
    cache: Mutex<HashMap<String, CachedResponse>>,
}
impl ExternalData {
    pub fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .user_agent("lol-auto-accept/1.5.2")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| AppError::new("Internal", "Cannot initialize public data client"))?;
        Ok(Self {
            client,
            requests: Semaphore::new(2),
            cache: Mutex::new(HashMap::new()),
        })
    }
    async fn fetch(&self, url: String) -> AppResult<Value> {
        let entry = {
            let mut cache = self.cache.lock().await;
            if cache.len() >= 16 && !cache.contains_key(&url) {
                cache.retain(|_, entry| Arc::strong_count(entry) > 1);
            }
            if cache.len() < 16 || cache.contains_key(&url) {
                cache.entry(url.clone()).or_default().clone()
            } else {
                Arc::default()
            }
        };
        // A per-URL lock joins concurrent misses without blocking other URLs.
        // Cache hits do not wait for a network permit.
        let mut cached = entry.lock().await;
        if let Some((expires, result)) = &*cached
            && *expires > Instant::now()
        {
            return result.clone();
        }
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|_| AppError::new("Internal", "Public data worker stopped"))?;
        let result = self.request(&url).await;
        let ttl = if result.is_ok() { 3600 } else { 60 };
        *cached = Some((Instant::now() + Duration::from_secs(ttl), result.clone()));
        result
    }
    async fn request(&self, url: &str) -> AppResult<Value> {
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| AppError::new("Io", "Public data unavailable"))?;
        if response.status().as_u16() == 429 {
            return Err(AppError::new(
                "RateLimited",
                "Public data rate limited; retry after one minute",
            ));
        }
        if !response.status().is_success() {
            return Err(AppError::new("Io", "Public data request failed"));
        }
        const MAX: usize = 16 * 1024 * 1024;
        if response.content_length().unwrap_or(0) > MAX as u64 {
            return Err(AppError::new("InvalidInput", "Public data too large"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::new("Io", "Public data read failed"))?
        {
            if bytes.len() + chunk.len() > MAX {
                return Err(AppError::new("InvalidInput", "Public data too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| AppError::new("Io", "Invalid public data"))
    }
    pub async fn versions(&self) -> AppResult<Value> {
        self.fetch("https://ddragon.leagueoflegends.com/api/versions.json".into())
            .await
    }
    pub async fn champions(&self, locale: &str) -> AppResult<Value> {
        if !["zh_TW", "en_US"].contains(&locale) {
            return Err(AppError::new("InvalidInput", "Unsupported locale"));
        }
        let versions = self.versions().await?;
        let version = versions[0]
            .as_str()
            .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '.'))
            .ok_or_else(|| AppError::new("Io", "Invalid data version"))?;
        let data = self
            .fetch(format!(
                "https://ddragon.leagueoflegends.com/cdn/{version}/data/{locale}/champion.json"
            ))
            .await?;
        let champions = data["data"]
            .as_object()
            .ok_or_else(|| AppError::new("Io", "Invalid champions data"))?;
        Ok(Value::Array(champions.values().cloned().collect()))
    }
    pub async fn balance(&self) -> AppResult<Value> {
        let versions = self
            .fetch("https://b2c-api-cdn.deeplol.gg/champion/version?cnt=3".into())
            .await?;
        let version = versions["game_version_list"][0]
            .as_str()
            .ok_or_else(|| AppError::new("Io", "Invalid balance version"))?;
        let mut url = reqwest::Url::parse("https://b2c-api-cdn.deeplol.gg/champion/balance")
            .map_err(|_| AppError::new("Internal", "Invalid service address"))?;
        url.query_pairs_mut().append_pair("version", version);
        self.fetch(url.to_string()).await
    }
    pub async fn latest_release(&self) -> AppResult<Value> {
        self.fetch(
            "https://api.github.com/repos/jasonwu1994/lol-auto-accept/releases/latest".into(),
        )
        .await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn server(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0u8; 4096];
            let count = stream.read(&mut bytes).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&bytes[..count]).into_owned()
        });
        (url, handle)
    }
    #[tokio::test]
    async fn concurrent_misses_share_a_request_and_cached_hits_need_no_permit() {
        let (url, handle) =
            server("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        let data = ExternalData::new().unwrap();
        let (first, second) = tokio::join!(data.fetch(url.clone()), data.fetch(url.clone()));
        assert_eq!(first.unwrap(), serde_json::json!({}));
        assert_eq!(second.unwrap(), serde_json::json!({}));
        handle.join().unwrap();
        let _permits = data.requests.acquire_many(2).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), data.fetch(url))
                .await
                .unwrap()
                .is_ok()
        );
    }

    #[tokio::test]
    async fn public_client_has_no_lcu_auth_and_cache_avoids_repeat_requests() {
        let (url, handle) =
            server("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        let data = ExternalData::new().unwrap();
        assert_eq!(
            data.fetch(url.clone()).await.unwrap(),
            serde_json::json!({})
        );
        let request = handle.join().unwrap().to_ascii_lowercase();
        assert!(!request.contains("authorization:"));
        assert!(!request.contains("x-target-port:"));
        assert!(data.fetch(url).await.is_ok());
    }
    #[tokio::test]
    async fn rate_limit_cooldown_avoids_repeated_network_attempts() {
        let (url, handle) = server(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let data = ExternalData::new().unwrap();
        assert_eq!(
            data.fetch(url.clone()).await.unwrap_err().code,
            "RateLimited"
        );
        handle.join().unwrap();
        assert_eq!(data.fetch(url).await.unwrap_err().code, "RateLimited");
    }
    #[tokio::test]
    async fn redirects_and_oversized_content_are_rejected() {
        let data = ExternalData::new().unwrap();
        let (url, handle) = server(
            "HTTP/1.1 302 Found\r\nLocation: https://example.invalid\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        assert_eq!(data.request(&url).await.unwrap_err().code, "Io");
        handle.join().unwrap();
        let (url, handle) =
            server("HTTP/1.1 200 OK\r\nContent-Length: 20000000\r\nConnection: close\r\n\r\n");
        assert_eq!(data.request(&url).await.unwrap_err().code, "InvalidInput");
        handle.join().unwrap();
    }
}
