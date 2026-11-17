//! Game-data images for the match-history page (`lolasset://` protocol).
//!
//! Only `/lol-game-data/assets/...` image paths are accepted. The connected client
//! serves them first; CommunityDragon's mirror of the same plugin path is the
//! fallback. Copies are kept on disk (256 MiB budget, oldest removed first) and a
//! bounded memory cache, refreshed after 24 hours, with 60-second failure backoff.

use crate::{
    error::{AppError, AppResult},
    lcu::LcuService,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime},
};
use tokio::sync::{Mutex, Semaphore};

const PREFIX: &str = "/lol-game-data/assets/";
const CDRAGON: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";
const REFRESH: Duration = Duration::from_secs(24 * 60 * 60);
const FAILURE_BACKOFF: Duration = Duration::from_secs(60);
const DISK_BUDGET: u64 = 256 * 1024 * 1024;
const MEMORY_BUDGET: usize = 32 * 1024 * 1024;
const MAX_ASSET: usize = 4 * 1024 * 1024;

pub fn validate_asset_path(path: &str) -> AppResult<&'static str> {
    let invalid = || AppError::new("InvalidInput", "Unsupported asset path");
    let rest = path.strip_prefix(PREFIX).ok_or_else(invalid)?;
    if path.len() > 300
        || rest.is_empty()
        || rest
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !rest
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.' | b' '))
    {
        return Err(invalid());
    }
    let lower = rest.to_ascii_lowercase();
    Ok(if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        return Err(invalid());
    })
}

/// CommunityDragon lowercases client asset paths.
pub fn cdragon_url(path: &str) -> String {
    format!("{CDRAGON}{}", path[PREFIX.len()..].to_ascii_lowercase()).replace(' ', "%20")
}

struct Memory {
    entries: HashMap<String, (Arc<Vec<u8>>, Instant)>,
    order: VecDeque<String>,
    bytes: usize,
}

pub struct AssetCache {
    dir: PathBuf,
    public: reqwest::Client,
    permits: Semaphore,
    memory: Mutex<Memory>,
    inflight: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    failures: Mutex<HashMap<String, Instant>>,
    writes: AtomicU64,
}

impl AssetCache {
    pub fn new(dir: PathBuf, public: reqwest::Client) -> AppResult<Self> {
        fs::create_dir_all(&dir).map_err(|_| AppError::new("Io", "Cannot create asset cache"))?;
        Ok(Self {
            dir,
            public,
            permits: Semaphore::new(8),
            memory: Mutex::new(Memory {
                entries: HashMap::new(),
                order: VecDeque::new(),
                bytes: 0,
            }),
            inflight: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
            writes: AtomicU64::new(0),
        })
    }

    fn disk_path(&self, path: &str) -> PathBuf {
        let digest = Sha256::digest(path.as_bytes());
        let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        self.dir.join(format!("{name}.bin"))
    }

    async fn remember(&self, path: &str, bytes: Arc<Vec<u8>>) {
        let mut memory = self.memory.lock().await;
        if let Some((old, _)) = memory.entries.remove(path) {
            memory.bytes -= old.len();
            memory.order.retain(|key| key != path);
        }
        memory.bytes += bytes.len();
        memory.entries.insert(path.into(), (bytes, Instant::now()));
        memory.order.push_back(path.into());
        while memory.bytes > MEMORY_BUDGET {
            let Some(oldest) = memory.order.pop_front() else {
                break;
            };
            if let Some((old, _)) = memory.entries.remove(&oldest) {
                memory.bytes -= old.len();
            }
        }
    }

    fn read_disk(&self, path: &str) -> Option<(Vec<u8>, bool)> {
        let file = self.disk_path(path);
        let metadata = fs::metadata(&file).ok()?;
        let fresh = metadata
            .modified()
            .ok()
            .and_then(|time| SystemTime::now().duration_since(time).ok())
            .is_some_and(|age| age < REFRESH);
        let bytes = fs::read(&file).ok()?;
        (!bytes.is_empty()).then_some((bytes, fresh))
    }

    fn write_disk(&self, path: &str, bytes: &[u8]) {
        let target = self.disk_path(path);
        let Ok(mut temp) = tempfile::NamedTempFile::new_in(&self.dir) else {
            return;
        };
        if std::io::Write::write_all(&mut temp, bytes).is_ok() {
            let _ = temp.persist(&target);
        }
        if self
            .writes
            .fetch_add(1, Ordering::Relaxed)
            .is_multiple_of(64)
        {
            self.trim_disk();
        }
    }

    fn trim_disk(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        let mut files: Vec<_> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                metadata.is_file().then(|| {
                    (
                        metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        metadata.len(),
                        entry.path(),
                    )
                })
            })
            .collect();
        let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
        files.sort_by_key(|(modified, _, _)| *modified);
        for (_, len, path) in files {
            if total <= DISK_BUDGET {
                break;
            }
            if fs::remove_file(path).is_ok() {
                total = total.saturating_sub(len);
            }
        }
    }

    async fn download(&self, lcu: &LcuService, path: &str) -> AppResult<Vec<u8>> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| AppError::new("Internal", "Asset worker stopped"))?;
        match lcu.asset_bytes(path).await {
            Ok((bytes, _)) if !bytes.is_empty() => return Ok(bytes),
            Ok(_) | Err(_) => {}
        }
        let mut response = self
            .public
            .get(cdragon_url(path))
            .send()
            .await
            .map_err(|_| AppError::new("Io", "Asset unavailable"))?;
        if !response.status().is_success() {
            return Err(AppError::new("NotFound", "Asset unavailable"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::new("Io", "Asset unavailable"))?
        {
            if bytes.len() + chunk.len() > MAX_ASSET {
                return Err(AppError::new("InvalidInput", "Asset is too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    pub async fn get(
        &self,
        lcu: &LcuService,
        path: &str,
    ) -> AppResult<(Arc<Vec<u8>>, &'static str)> {
        let mime = validate_asset_path(path)?;
        if let Some((bytes, at)) = self.memory.lock().await.entries.get(path)
            && at.elapsed() < REFRESH
        {
            return Ok((bytes.clone(), mime));
        }
        let lock = self
            .inflight
            .lock()
            .await
            .entry(path.into())
            .or_default()
            .clone();
        let _guard = lock.lock().await;
        let result = self.load(lcu, path).await;
        self.inflight.lock().await.remove(path);
        Ok((result?, mime))
    }

    async fn load(&self, lcu: &LcuService, path: &str) -> AppResult<Arc<Vec<u8>>> {
        if let Some((bytes, at)) = self.memory.lock().await.entries.get(path)
            && at.elapsed() < REFRESH
        {
            return Ok(bytes.clone());
        }
        let disk = self.read_disk(path);
        if let Some((bytes, true)) = &disk {
            let bytes = Arc::new(bytes.clone());
            self.remember(path, bytes.clone()).await;
            return Ok(bytes);
        }
        let backoff = self
            .failures
            .lock()
            .await
            .get(path)
            .is_some_and(|at| at.elapsed() < FAILURE_BACKOFF);
        let result = if backoff {
            Err(AppError::new("Unavailable", "Asset recently failed"))
        } else {
            self.download(lcu, path).await
        };
        let outcome = match (result, disk) {
            (Ok(bytes), _) => {
                self.failures.lock().await.remove(path);
                self.write_disk(path, &bytes);
                Ok(Arc::new(bytes))
            }
            // A stale copy is better than a broken image.
            (Err(_), Some((bytes, false))) => Ok(Arc::new(bytes)),
            (Err(error), _) => {
                if !backoff {
                    self.failures
                        .lock()
                        .await
                        .insert(path.into(), Instant::now());
                }
                Err(error)
            }
        };
        let bytes = outcome?;
        self.remember(path, bytes.clone()).await;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_game_data_images_are_accepted() {
        assert_eq!(
            validate_asset_path("/lol-game-data/assets/v1/champion-icons/1.png").unwrap(),
            "image/png"
        );
        assert_eq!(
            validate_asset_path("/lol-game-data/assets/v1/profile-icons/29.jpg").unwrap(),
            "image/jpeg"
        );
        for bad in [
            "/lol-game-data/assets/../riotclient/x.png",
            "/lol-game-data/assets/v1/x.json",
            "/lol-summoner/v1/current-summoner",
            "/lol-game-data/assets//x.png",
            "/lol-game-data/assets/v1/a%2f.png",
            "/lol-game-data/assets/v1/a?.png",
        ] {
            assert!(validate_asset_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn cdragon_fallback_lowercases_the_plugin_path() {
        assert_eq!(
            cdragon_url(
                "/lol-game-data/assets/ASSETS/Items/Icons2D/1001_Class_T1_BootsofSpeed.png"
            ),
            "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/items/icons2d/1001_class_t1_bootsofspeed.png"
        );
    }

    #[test]
    fn disk_budget_removes_oldest_files_first() {
        let dir = tempfile::tempdir().unwrap();
        let cache = AssetCache::new(dir.path().into(), reqwest::Client::new()).unwrap();
        cache.write_disk("/lol-game-data/assets/a.png", b"abc");
        let (bytes, fresh) = cache.read_disk("/lol-game-data/assets/a.png").unwrap();
        assert_eq!(bytes, b"abc");
        assert!(fresh);
        assert!(cache.read_disk("/lol-game-data/assets/b.png").is_none());
    }
}
