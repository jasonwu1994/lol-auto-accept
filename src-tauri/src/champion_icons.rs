use crate::error::{AppError, AppResult};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Semaphore};

const DAY: u64 = 24 * 60 * 60;
const MAX_BYTES: usize = 512 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionIcon {
    data_url: String,
    checked_at: u64,
}

pub struct ChampionIcons {
    directory: PathBuf,
    client: reqwest::Client,
    requests: Semaphore,
    locks: Mutex<HashMap<u32, Arc<Mutex<()>>>>,
    failed: Mutex<HashMap<u32, SystemTime>>,
}

impl ChampionIcons {
    pub fn new(directory: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&directory).map_err(|_| io_error())?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| io_error())?;
        Ok(Self {
            directory,
            client,
            requests: Semaphore::new(2),
            locks: Mutex::new(HashMap::new()),
            failed: Mutex::new(HashMap::new()),
        })
    }

    pub async fn get(&self, id: u32, refresh: bool) -> AppResult<ChampionIcon> {
        self.get_from(
            id,
            refresh,
            &format!("https://cdn.communitydragon.org/latest/champion/{id}/square"),
        )
        .await
    }

    async fn get_from(&self, id: u32, refresh: bool, url: &str) -> AppResult<ChampionIcon> {
        if id == 0 || id > 10000 {
            return Err(AppError::new("InvalidInput", "Invalid champion identifier"));
        }
        let gate = self.locks.lock().await.entry(id).or_default().clone();
        let _guard = gate.lock().await;
        let path = self.directory.join(format!("{id}.png"));
        let stamp = self.directory.join(format!("{id}.checked"));
        let cached = read_image(&path).ok();
        let checked_at = std::fs::read_to_string(&stamp)
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let now = SystemTime::now();
        let timestamp = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        if let Some(bytes) = &cached
            && (!refresh || timestamp.saturating_sub(checked_at) < DAY)
        {
            return Ok(as_icon(bytes, checked_at));
        }
        if self.failed.lock().await.get(&id).is_some_and(|last| {
            now.duration_since(*last).unwrap_or_default() < Duration::from_secs(60)
        }) {
            return cached
                .map(|bytes| as_icon(&bytes, checked_at))
                .ok_or_else(unavailable);
        }
        let result = self.download(url).await;
        match result {
            Ok(bytes) => {
                let saved = (|| {
                    atomic_write(&path, &bytes)?;
                    atomic_write(&stamp, timestamp.to_string().as_bytes())?;
                    Ok::<_, AppError>(())
                })();
                if saved.is_err() {
                    self.failed.lock().await.insert(id, now);
                }
                Ok(as_icon(&bytes, timestamp))
            }
            Err(error) => {
                self.failed.lock().await.insert(id, now);
                cached.map(|bytes| as_icon(&bytes, checked_at)).ok_or(error)
            }
        }
    }

    async fn download(&self, url: &str) -> AppResult<Vec<u8>> {
        let _permit = self.requests.acquire().await.map_err(|_| unavailable())?;
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        if response.content_length().unwrap_or(0) > MAX_BYTES as u64 {
            return Err(unavailable());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err(unavailable());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !valid_png(&bytes) {
            return Err(unavailable());
        }
        Ok(bytes)
    }
}

fn valid_png(bytes: &[u8]) -> bool {
    if bytes.len() < 33 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    (1..=1024).contains(&width) && (1..=1024).contains(&height)
}
fn read_image(path: &Path) -> AppResult<Vec<u8>> {
    if std::fs::metadata(path).map_err(|_| io_error())?.len() > MAX_BYTES as u64 {
        return Err(io_error());
    }
    let bytes = std::fs::read(path).map_err(|_| io_error())?;
    if !valid_png(&bytes) {
        return Err(unavailable());
    }
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or_else(io_error)?)
        .map_err(|_| io_error())?;
    file.write_all(bytes).map_err(|_| io_error())?;
    file.persist(path).map_err(|_| io_error())?;
    Ok(())
}
fn as_icon(bytes: &[u8], checked_at: u64) -> ChampionIcon {
    ChampionIcon {
        data_url: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        checked_at,
    }
}
fn io_error() -> AppError {
    AppError::new("Io", "Cannot save champion icon cache")
}
fn unavailable() -> AppError {
    AppError::new("Unavailable", "Champion icon is unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    #[tokio::test]
    #[ignore = "Requires access to the public champion CDN"]
    async fn live_cdn_icon_is_persisted_and_reused() {
        let directory = tempfile::tempdir().unwrap();
        let root = std::env::var_os("LOL_ICON_PROBE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| directory.path().into());
        let cache = ChampionIcons::new(root.clone()).unwrap();
        let icon = cache.get(89, true).await.unwrap();
        let path = root.join("89.png");
        assert!(valid_png(&std::fs::read(&path).unwrap()));
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(cache.get(89, true).await.unwrap().data_url, icon.data_url);
        assert_eq!(
            std::fs::metadata(path).unwrap().modified().unwrap(),
            modified
        );
        println!("Live icon cached and reused at {}", root.display());
    }
    fn serve(body: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let n = stream.read(&mut request).unwrap();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
            stream.write_all(&body).unwrap();
            String::from_utf8_lossy(&request[..n]).into_owned()
        });
        (format!("http://{addr}/icon"), thread)
    }
    #[tokio::test]
    async fn concurrent_downloads_share_one_request_and_disk_cache_survives_restart() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = STANDARD.decode(PNG).unwrap();
        let (url, server) = serve(bytes.clone());
        let cache = ChampionIcons::new(directory.path().into()).unwrap();
        let (a, b) = tokio::join!(
            cache.get_from(89, true, &url),
            cache.get_from(89, true, &url)
        );
        assert_eq!(a.unwrap().data_url, b.unwrap().data_url);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(!request.contains("authorization:"));
        assert_eq!(
            std::fs::read(directory.path().join("89.png")).unwrap(),
            bytes
        );
        let reopened = ChampionIcons::new(directory.path().into()).unwrap();
        assert!(reopened.get_from(89, true, &url).await.is_ok());
    }
    #[tokio::test]
    async fn stale_icons_are_served_locally_and_refresh_failure_preserves_them() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = STANDARD.decode(PNG).unwrap();
        std::fs::write(directory.path().join("1.png"), &bytes).unwrap();
        std::fs::write(directory.path().join("1.checked"), "0").unwrap();
        let cache = ChampionIcons::new(directory.path().into()).unwrap();
        let local = cache
            .get_from(1, false, "http://127.0.0.1:1/icon")
            .await
            .unwrap();
        assert_eq!(local.checked_at, 0);
        let refreshed = cache
            .get_from(1, true, "http://127.0.0.1:1/icon")
            .await
            .unwrap();
        assert_eq!(local.data_url, refreshed.data_url);
        assert_eq!(
            std::fs::read(directory.path().join("1.png")).unwrap(),
            bytes
        );
    }
    #[tokio::test]
    async fn expired_icons_refresh_and_invalid_responses_never_overwrite_good_images() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = STANDARD.decode(PNG).unwrap();
        std::fs::write(directory.path().join("2.png"), &bytes).unwrap();
        std::fs::write(directory.path().join("2.checked"), "0").unwrap();
        let cache = ChampionIcons::new(directory.path().into()).unwrap();
        let (url, server) = serve(bytes.clone());
        assert!(cache.get_from(2, true, &url).await.unwrap().checked_at > 0);
        server.join().unwrap();
        std::fs::write(directory.path().join("2.checked"), "0").unwrap();
        let (url, server) = serve(b"not an image".to_vec());
        assert!(cache.get_from(2, true, &url).await.is_ok());
        server.join().unwrap();
        assert_eq!(
            std::fs::read(directory.path().join("2.png")).unwrap(),
            bytes
        );
        assert_eq!(
            std::fs::read_to_string(directory.path().join("2.checked")).unwrap(),
            "0"
        );
        assert!(cache.get_from(0, true, &url).await.is_err());
    }
}
