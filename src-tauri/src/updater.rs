//! In-app update for the portable EXE. The latest GitHub release is downloaded next to
//! the running EXE under its release name (`lol-app-X.Y.Z.exe`), checked against the
//! SHA-256 digest GitHub publishes for the asset, and started; this process then releases
//! its single-instance lock and exits. The new process waits for this one to exit, then
//! deletes the old EXE before it starts the app (releases without that step just start).
use crate::error::{AppError, AppResult};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/jasonwu1994/lol-auto-accept/releases/download/";
const MAX_ASSET_SIZE: u64 = 256 * 1024 * 1024;
const PROGRESS_EVENT: &str = "app-update-progress";
/// Passed to the new EXE with the path of the EXE it replaces.
pub const REPLACE_OLD_ARG: &str = "--replace-old";
/// How long the new EXE waits for the old process to exit before starting anyway.
const REPLACE_WAIT: Duration = Duration::from_secs(20);

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub version: String,
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.trim().trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let version = (next()?, next()?, next()?);
    parts.next().is_none().then_some(version)
}

fn invalid(message: &str) -> AppError {
    AppError::new("InvalidInput", message)
}

/// Picks the release's EXE and checks that it is a newer stable version published by
/// this repository's release workflow, with a SHA-256 digest to verify it against.
pub fn select_asset(release: &Value, current_version: &str) -> AppResult<ReleaseAsset> {
    if release["draft"].as_bool() == Some(true) || release["prerelease"].as_bool() == Some(true) {
        return Err(invalid("The latest release is not a stable release"));
    }
    let tag = release["tag_name"]
        .as_str()
        .ok_or_else(|| invalid("The latest release has no version"))?;
    let latest = parse_version(tag).ok_or_else(|| invalid("Unrecognized release version"))?;
    let current =
        parse_version(current_version).ok_or_else(|| invalid("Unrecognized app version"))?;
    if latest <= current {
        return Err(AppError::new(
            "AlreadyLatest",
            "This is already the latest version",
        ));
    }
    let version = format!("{}.{}.{}", latest.0, latest.1, latest.2);
    let name = format!("lol-app-{version}.exe");
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["name"].as_str() == Some(&name))
        })
        .ok_or_else(|| invalid("The release has no app download"))?;
    let url = asset["browser_download_url"].as_str().unwrap_or_default();
    if url != format!("{RELEASE_DOWNLOAD_PREFIX}{tag}/{name}") {
        return Err(invalid("Unexpected download address"));
    }
    let size = asset["size"].as_u64().unwrap_or(0);
    if size == 0 || size > MAX_ASSET_SIZE {
        return Err(invalid("Unexpected download size"));
    }
    let sha256 = asset["digest"]
        .as_str()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|hex| hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| invalid("The release download has no checksum"))?
        .to_ascii_lowercase();
    Ok(ReleaseAsset {
        version,
        name,
        url: url.into(),
        size,
        sha256,
    })
}

/// GitHub serves release files from its own hosts after a redirect; nothing else is followed.
fn allowed_download_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "github.com"
                || host == "objects.githubusercontent.com"
                || host == "release-assets.githubusercontent.com"
        })
}

fn download_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("lol-auto-accept/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if allowed_download_host(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| AppError::new("Internal", "Cannot initialize download client"))
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Downloads `asset` from `url` to `target`, reporting progress, and keeps it only when
/// the size and SHA-256 digest match.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    asset: &ReleaseAsset,
    target: &Path,
    mut progress: impl FnMut(u64, u64),
) -> AppResult<()> {
    let mut part = target.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let result = async {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|_| AppError::new("Io", "Download failed"))?;
        if !response.status().is_success() {
            return Err(AppError::new("Io", "Download failed"));
        }
        let mut file = tokio::fs::File::create(&part).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                AppError::new("PermissionDenied", "Cannot write next to the app")
            } else {
                AppError::new("Io", "Cannot write the download")
            }
        })?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0u64;
        let mut reported = Instant::now();
        progress(0, asset.size);
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::new("Io", "Download interrupted"))?
        {
            downloaded += chunk.len() as u64;
            if downloaded > asset.size {
                return Err(invalid("Download is larger than expected"));
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|_| AppError::new("Io", "Cannot write the download"))?;
            if reported.elapsed() >= Duration::from_millis(100) {
                reported = Instant::now();
                progress(downloaded, asset.size);
            }
        }
        file.sync_all()
            .await
            .map_err(|_| AppError::new("Io", "Cannot write the download"))?;
        drop(file);
        progress(downloaded, asset.size);
        if downloaded != asset.size {
            return Err(AppError::new("Io", "Download incomplete"));
        }
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if digest != asset.sha256 {
            return Err(invalid("Download checksum mismatch"));
        }
        if tokio::fs::try_exists(target).await.unwrap_or(false) {
            tokio::fs::remove_file(target)
                .await
                .map_err(|_| AppError::new("Io", "Cannot replace an existing download"))?;
        }
        tokio::fs::rename(&part, target)
            .await
            .map_err(|_| AppError::new("Io", "Cannot save the download"))
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }
    result
}

/// Downloads the latest release next to the running EXE and starts it; the caller then
/// exits this process so the new one can take over and delete the old EXE.
pub async fn install(app: &AppHandle, release: &Value) -> AppResult<()> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err(AppError::new("Busy", "An update is already in progress"));
    }
    let result = async {
        let asset = select_asset(release, env!("CARGO_PKG_VERSION"))?;
        let current =
            std::env::current_exe().map_err(|_| AppError::new("Io", "Cannot locate the app"))?;
        let dir = current
            .parent()
            .ok_or_else(|| AppError::new("Io", "Cannot locate the app folder"))?;
        let target = dir.join(&asset.name);
        if same_path(&target, &current) {
            return Err(AppError::new(
                "AlreadyLatest",
                "This is already the latest version",
            ));
        }
        let client = download_client()?;
        download(&client, &asset.url, &asset, &target, |downloaded, total| {
            let _ = app.emit(
                PROGRESS_EVENT,
                json!({"downloaded": downloaded, "total": total}),
            );
        })
        .await?;
        // The new EXE first waits until it can delete this one (that is, until this
        // process has exited), so it reaches its single-instance check only afterwards.
        // The lock is released only once the spawn succeeded: if it fails, this window
        // stays the one instance.
        std::process::Command::new(&target)
            .arg(REPLACE_OLD_ARG)
            .arg(&current)
            .current_dir(dir)
            .spawn()
            .map_err(|_| AppError::new("Io", "Cannot start the new version"))?;
        tauri_plugin_single_instance::destroy(app);
        Ok(())
    }
    .await;
    if result.is_err() {
        INSTALLING.store(false, Ordering::SeqCst);
    }
    result
}

/// The old EXE may be deleted only when it sits next to this one and is another EXE.
fn replaceable(old: &Path, current: &Path) -> bool {
    let same_dir = match (old.parent(), current.parent()) {
        (Some(a), Some(b)) => same_path(a, b),
        _ => false,
    };
    let is_exe = old
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
    same_dir && is_exe && !same_path(old, current)
}

fn old_exe_argument(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == REPLACE_OLD_ARG {
            return args.next().map(PathBuf::from);
        }
    }
    None
}

/// Runs first in a freshly updated EXE: waits for the old process to exit (its EXE stays
/// locked until then) and deletes it. Runs before the single-instance check, which
/// would otherwise hand this launch to the old process.
pub fn finish_replacement() {
    let Some(old) = old_exe_argument(std::env::args_os().skip(1)) else {
        return;
    };
    let Ok(current) = std::env::current_exe() else {
        return;
    };
    if !replaceable(&old, &current) {
        return;
    }
    let deadline = Instant::now() + REPLACE_WAIT;
    loop {
        match std::fs::remove_file(&old) {
            Ok(()) => return,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(200)),
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    const DIGEST: &str = "ee984cbdd313a3fb70d974d35180d5c4f2cc9c455f9dde3906ee27665964cc19";

    fn release(tag: &str) -> Value {
        let name = format!("lol-app-{}.exe", tag.trim_start_matches('v'));
        json!({
            "tag_name": tag,
            "draft": false,
            "prerelease": false,
            "assets": [{
                "name": name,
                "size": 22451200,
                "digest": format!("sha256:{DIGEST}"),
                "browser_download_url": format!("{RELEASE_DOWNLOAD_PREFIX}{tag}/{name}")
            }]
        })
    }

    #[test]
    fn picks_a_newer_release_exe_with_its_digest() {
        let asset = select_asset(&release("v2.3.0"), "2.2.2").unwrap();
        assert_eq!(asset.version, "2.3.0");
        assert_eq!(asset.name, "lol-app-2.3.0.exe");
        assert_eq!(asset.size, 22451200);
        assert_eq!(asset.sha256, DIGEST);
    }

    #[test]
    fn refuses_same_older_and_prerelease_versions() {
        assert_eq!(
            select_asset(&release("v2.2.2"), "2.2.2").unwrap_err().code,
            "AlreadyLatest"
        );
        assert_eq!(
            select_asset(&release("v2.1.9"), "2.2.2").unwrap_err().code,
            "AlreadyLatest"
        );
        assert!(select_asset(&release("v3.0.0-beta.1"), "2.2.2").is_err());
        let mut pre = release("v2.3.0");
        pre["prerelease"] = json!(true);
        assert!(select_asset(&pre, "2.2.2").is_err());
    }

    #[test]
    fn refuses_foreign_urls_and_missing_digests() {
        let mut foreign = release("v2.3.0");
        foreign["assets"][0]["browser_download_url"] =
            json!("https://example.com/lol-app-2.3.0.exe");
        assert!(select_asset(&foreign, "2.2.2").is_err());
        let mut unsigned = release("v2.3.0");
        unsigned["assets"][0]
            .as_object_mut()
            .unwrap()
            .remove("digest");
        assert!(select_asset(&unsigned, "2.2.2").is_err());
        let mut renamed = release("v2.3.0");
        renamed["assets"][0]["name"] = json!("setup.exe");
        assert!(select_asset(&renamed, "2.2.2").is_err());
    }

    #[test]
    fn follows_only_github_download_hosts() {
        let ok = |url: &str| allowed_download_host(&reqwest::Url::parse(url).unwrap());
        assert!(ok("https://release-assets.githubusercontent.com/x"));
        assert!(ok("https://objects.githubusercontent.com/x"));
        assert!(!ok("http://objects.githubusercontent.com/x"));
        assert!(!ok("https://evil.example/x"));
    }

    #[test]
    fn deletes_only_another_exe_in_the_same_folder() {
        let current = Path::new(r"C:\Apps\lol-app-2.3.0.exe");
        assert!(replaceable(
            Path::new(r"C:\Apps\lol-app-2.2.2.exe"),
            current
        ));
        assert!(replaceable(Path::new(r"c:\apps\Old Name.EXE"), current));
        assert!(!replaceable(
            Path::new(r"C:\Apps\lol-app-2.3.0.exe"),
            current
        ));
        assert!(!replaceable(
            Path::new(r"C:\Other\lol-app-2.2.2.exe"),
            current
        ));
        assert!(!replaceable(Path::new(r"C:\Apps\config.json"), current));
    }

    #[test]
    fn reads_the_old_exe_argument() {
        let args = ["--x", REPLACE_OLD_ARG, r"C:\Apps\old.exe"].map(OsString::from);
        assert_eq!(
            old_exe_argument(args),
            Some(PathBuf::from(r"C:\Apps\old.exe"))
        );
        assert_eq!(old_exe_argument([OsString::from(REPLACE_OLD_ARG)]), None);
        assert_eq!(old_exe_argument(Vec::<OsString>::new()), None);
    }

    fn serve(body: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
        });
        url
    }

    fn asset_for(body: &[u8]) -> ReleaseAsset {
        ReleaseAsset {
            version: "2.3.0".into(),
            name: "lol-app-2.3.0.exe".into(),
            url: String::new(),
            size: body.len() as u64,
            sha256: Sha256::digest(body)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        }
    }

    #[tokio::test]
    async fn keeps_a_verified_download_and_reports_progress() {
        let body: &'static [u8] = b"new app bytes";
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("lol-app-2.3.0.exe");
        let mut last = (0, 0);
        download(
            &reqwest::Client::new(),
            &serve(body),
            &asset_for(body),
            &target,
            |d, t| last = (d, t),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), body);
        assert_eq!(last, (body.len() as u64, body.len() as u64));
        assert!(!dir.path().join("lol-app-2.3.0.exe.part").exists());
    }

    #[tokio::test]
    async fn discards_a_download_with_the_wrong_digest() {
        let body: &'static [u8] = b"tampered bytes";
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("lol-app-2.3.0.exe");
        let mut asset = asset_for(body);
        asset.sha256 = "0".repeat(64);
        let error = download(
            &reqwest::Client::new(),
            &serve(body),
            &asset,
            &target,
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error.message, "Download checksum mismatch");
        assert!(!target.exists());
        assert!(!dir.path().join("lol-app-2.3.0.exe.part").exists());
    }
}
