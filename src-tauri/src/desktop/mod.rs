use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

fn apply_topmost(app: &AppHandle) -> AppResult<()> {
    let Some(state) = app.try_state::<crate::AppState>() else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let config = state
        .config
        .lock()
        .map_err(|_| AppError::new("Internal", "Configuration unavailable"))?
        .get();
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(true);
    let desired = {
        let mut policy = state
            .topmost
            .lock()
            .map_err(|_| AppError::new("Internal", "Window policy unavailable"))?;
        let desired = policy.desired(
            config.always_on_top,
            config.is_auto_aram_topmost,
            visible,
            minimized,
        );
        if policy.applied == Some(desired) {
            return Ok(());
        }
        policy.applied = Some(desired);
        desired
    };
    // Native setters may dispatch window events synchronously; release policy locks first.
    if window.set_always_on_top(desired).is_err() {
        state
            .topmost
            .lock()
            .map_err(|_| AppError::new("Internal", "Window policy unavailable"))?
            .applied = None;
        return Err(AppError::new("Io", "Cannot update window"));
    }
    Ok(())
}

pub fn update_topmost(app: &AppHandle) -> AppResult<()> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = apply_topmost(&handle) {
            let _ = tauri::Emitter::emit(
                &handle,
                "operation-result",
                serde_json::json!({"error":error}),
            );
        }
    })
    .map_err(|_| AppError::new("Io", "Cannot schedule window update"))
}

pub fn schedule_topmost_update(app: &AppHandle) {
    if let Err(error) = update_topmost(app) {
        let _ = tauri::Emitter::emit(app, "operation-result", serde_json::json!({"error":error}));
    }
}

pub fn save_window_size(window: &tauri::Window) -> AppResult<()> {
    let Some(state) = window.try_state::<crate::AppState>() else {
        return Ok(());
    };
    if !state.window_ready.load(std::sync::atomic::Ordering::SeqCst)
        || window.is_minimized().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
    {
        return Ok(());
    }
    let physical = window
        .inner_size()
        .map_err(|_| AppError::new("Io", "Cannot read window size"))?;
    let scale = window
        .scale_factor()
        .map_err(|_| AppError::new("Io", "Cannot read window scale"))?;
    let logical = physical.to_logical::<u32>(scale);
    let size = crate::config::WindowSize {
        width: logical.width,
        height: logical.height,
    };
    if !size.is_valid() {
        return Ok(());
    }
    let position = window
        .outer_position()
        .map_err(|_| AppError::new("Io", "Cannot read window position"))?;
    state
        .config
        .lock()
        .map_err(|_| AppError::new("Internal", "Configuration unavailable"))?
        .update_window_geometry(
            size,
            Some(crate::config::WindowPosition {
                x: position.x,
                y: position.y,
            }),
        )
}

pub fn restore_window_position(
    window: &tauri::WebviewWindow,
    position: crate::config::WindowPosition,
) -> tauri::Result<()> {
    let size = window.outer_size()?;
    let reachable = window.available_monitors()?.iter().any(|monitor| {
        let area = monitor.work_area();
        let x = i64::from(position.x);
        let y = i64::from(position.y);
        x + i64::from(size.width) >= i64::from(area.position.x) + 64
            && x + 64 <= i64::from(area.position.x) + i64::from(area.size.width)
            && y >= i64::from(area.position.y)
            && y + 32 <= i64::from(area.position.y) + i64::from(area.size.height)
    });
    if reachable {
        window.set_position(tauri::PhysicalPosition::new(position.x, position.y))?;
    }
    Ok(())
}

pub fn schedule_window_size_save(window: &tauri::Window) {
    let Some(state) = window.try_state::<crate::AppState>() else {
        return;
    };
    let revision = state
        .window_resize_revision
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        if window
            .state::<crate::AppState>()
            .window_resize_revision
            .load(std::sync::atomic::Ordering::SeqCst)
            != revision
        {
            return;
        }
        if let Err(error) = save_window_size(&window) {
            let _ = tauri::Emitter::emit(
                &window,
                "operation-result",
                serde_json::json!({"error":error}),
            );
        }
    });
}

// sRGB equivalents of the HeroUI preset --background tokens.
pub fn theme_background(dark: bool, design_theme: &str) -> tauri::window::Color {
    let (dark_rgb, light_rgb) = match design_theme {
        "sky" => ([2, 7, 10], [236, 247, 254]),
        "lavender" => ([7, 5, 10], [247, 243, 254]),
        "mint" => ([3, 7, 4], [238, 248, 241]),
        "netflix" => ([8, 5, 5], [250, 243, 242]),
        "uber" => ([7, 5, 6], [248, 244, 245]),
        "spotify" => ([5, 6, 5], [244, 245, 244]),
        "coinbase" => ([6, 6, 6], [245, 245, 246]),
        "airbnb" => ([6, 6, 6], [245, 245, 245]),
        "discord" => ([5, 6, 9], [243, 245, 252]),
        "rabbit" => ([9, 5, 4], [251, 243, 240]),
        _ => ([6, 6, 7], [245, 245, 245]),
    };
    let [r, g, b] = if dark { dark_rgb } else { light_rgb };
    tauri::window::Color(r, g, b, 255)
}

pub fn open_external(app: &AppHandle, url: &str) -> AppResult<()> {
    validate_url(url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::new("Io", "Cannot open link"))
}
fn validate_url(raw: &str) -> AppResult<()> {
    let url =
        reqwest::Url::parse(raw).map_err(|_| AppError::new("InvalidInput", "Invalid link"))?;
    let allowed = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && match url.host_str() {
            Some("github.com") => {
                url.path() == "/jasonwu1994/lol-auto-accept"
                    || url.path().starts_with("/jasonwu1994/lol-auto-accept/")
            }
            Some("www.deeplol.gg") => url.path().starts_with("/balance/aram/"),
            _ => false,
        };
    if allowed {
        Ok(())
    } else {
        Err(AppError::new("InvalidInput", "Link is not allowed"))
    }
}
pub fn show(app: &AppHandle) {
    if !app
        .try_state::<crate::AppState>()
        .is_some_and(|state| state.window_ready.load(std::sync::atomic::Ordering::SeqCst))
    {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        schedule_topmost_update(app);
        let _ = window.set_focus();
    }
}
pub fn clipboard(text: String) -> AppResult<()> {
    if text.len() > 65536 {
        return Err(AppError::new("InvalidInput", "Clipboard text too large"));
    }
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|_| AppError::new("Io", "Clipboard unavailable"))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    name: String,
    terminated: bool,
    reason: String,
}
pub fn terminate_league() -> AppResult<Vec<ProcessResult>> {
    if std::env::var_os("LOL_APP_READ_ONLY").is_some() {
        return Err(AppError::new("Unauthorized", "Read-only validation mode"));
    }
    let installation = InstalledExecutables::load()?;
    let mut system = sysinfo::System::new_all()
        .map_err(|_| AppError::new("Io", "Cannot enumerate processes"))?;
    let mut observed = Vec::new();
    let candidates: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, p)| {
            let name = p.name().to_string_lossy().to_string();
            if !allowed_process(&name) {
                return None;
            }
            let Some(exe) = p
                .exe()
                .map(Path::to_path_buf)
                .filter(|exe| installation.contains(&name, exe))
            else {
                observed.push((
                    *pid,
                    p.start_time(),
                    name,
                    false,
                    false,
                    "Installation identity could not be verified",
                ));
                return None;
            };
            Some((*pid, p.start_time(), exe, name))
        })
        .collect();
    for (pid, start, exe, name) in candidates {
        system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        // Closing a parent client process may also close its UX children.
        // An already-exited candidate has reached the requested outcome.
        let kill_requested = system.process(pid).is_some_and(|p| {
            same_process(start, &exe, p.start_time(), p.exe())
                && installation.contains(&name, &exe)
                && p.kill()
        });
        observed.push((
            pid,
            start,
            name,
            true,
            kill_requested,
            "Process changed, exited, or access was denied",
        ));
    }
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    Ok(observed
        .into_iter()
        .map(
            |(pid, start, name, verified, kill_requested, failure_reason)| {
                // A parent exit can close an observed child before its own kill request.
                let terminated = termination_succeeded(
                    verified,
                    kill_requested,
                    start,
                    system.process(pid).map(|process| process.start_time()),
                );
                ProcessResult {
                    name,
                    terminated,
                    reason: if terminated {
                        "Terminated"
                    } else {
                        failure_reason
                    }
                    .into(),
                }
            },
        )
        .collect())
}

fn termination_succeeded(
    verified: bool,
    kill_requested: bool,
    original_start: u64,
    current_start: Option<u64>,
) -> bool {
    verified && (kill_requested || current_start != Some(original_start))
}

fn same_process(start: u64, exe: &Path, current_start: u64, current_exe: Option<&Path>) -> bool {
    start == current_start && current_exe == Some(exe)
}

struct InstalledExecutables {
    paths: Vec<PathBuf>,
}

impl InstalledExecutables {
    fn load() -> AppResult<Self> {
        let program_data = std::env::var_os("PROGRAMDATA").ok_or_else(installation_unavailable)?;
        let path = PathBuf::from(program_data).join("Riot Games/RiotClientInstalls.json");
        let file = fs::File::open(path).map_err(|_| installation_unavailable())?;
        let mut bytes = Vec::new();
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| installation_unavailable())?;
        if bytes.len() > 1024 * 1024 {
            return Err(installation_unavailable());
        }
        let metadata: Value =
            serde_json::from_slice(&bytes).map_err(|_| installation_unavailable())?;
        Self::from_metadata(&metadata)
    }

    fn from_metadata(metadata: &Value) -> AppResult<Self> {
        let associations = metadata["associated_client"]
            .as_object()
            .ok_or_else(installation_unavailable)?;
        let mut paths = Vec::new();
        for (game_directory, client) in associations {
            let Some(client) = client.as_str() else {
                continue;
            };
            let game_directory = Path::new(game_directory);
            let client = Path::new(client);
            if !game_directory.is_absolute()
                || !client.is_absolute()
                || !client
                    .file_name()
                    .is_some_and(|name| name.eq_ignore_ascii_case("RiotClientServices.exe"))
                || !game_directory.join("LeagueClient.exe").is_file()
                || !client.is_file()
            {
                continue;
            }
            let Some(client_directory) = client.parent() else {
                continue;
            };
            // Riot's fixed installation association identifies the executable family;
            // a process name alone is never authorization to terminate it.
            for candidate in [
                game_directory.join("LeagueClient.exe"),
                game_directory.join("LeagueClientUx.exe"),
                game_directory.join("LeagueClientUxRender.exe"),
                game_directory.join("Game/League of Legends.exe"),
                client.to_path_buf(),
                client_directory.join("UX/RiotClientUx.exe"),
                client_directory.join("UX/RiotClientUxRender.exe"),
            ] {
                if candidate.is_file()
                    && let Ok(path) = candidate.canonicalize()
                {
                    paths.push(path);
                }
            }
        }
        if paths.is_empty() {
            return Err(installation_unavailable());
        }
        Ok(Self { paths })
    }

    fn contains(&self, name: &str, executable: &Path) -> bool {
        allowed_process(name)
            && executable
                .file_name()
                .is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(name))
            && executable
                .canonicalize()
                .is_ok_and(|path| self.paths.contains(&path))
    }
}

fn installation_unavailable() -> AppError {
    AppError::new(
        "Unsupported",
        "Riot installation metadata is unavailable; no processes were terminated",
    )
}
fn allowed_process(name: &str) -> bool {
    [
        "League of Legends.exe",
        "LeagueClient.exe",
        "LeagueClientUx.exe",
        "LeagueClientUxRender.exe",
        "RiotClientServices.exe",
        "RiotClientUx.exe",
        "RiotClientUxRender.exe",
    ]
    .iter()
    .any(|n| n.eq_ignore_ascii_case(name))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn main_window_waits_for_saved_theme_before_creation() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "main")
            .unwrap();
        assert_eq!(main["create"], false);
        assert_eq!(main["visible"], false);
    }
    #[test]
    fn already_closed_verified_child_is_reported_as_terminated() {
        assert!(termination_succeeded(true, false, 10, None));
        assert!(!termination_succeeded(true, false, 10, Some(10)));
        assert!(!termination_succeeded(false, false, 10, None));
    }
    #[test]
    fn restrict_links() {
        for url in [
            "http://github.com/jasonwu1994/lol-auto-accept",
            "https://github.com.evil.test/jasonwu1994/lol-auto-accept",
            "file:///C:/Windows",
            "https://user:pw@github.com/jasonwu1994/lol-auto-accept",
            "https://github.com/other/repo",
        ] {
            assert!(validate_url(url).is_err());
        }
        assert!(validate_url("https://github.com/jasonwu1994/lol-auto-accept/releases").is_ok());
    }
    #[test]
    fn exact_process_names() {
        assert!(allowed_process("LeagueClient.exe"));
        assert!(!allowed_process("MyLeagueNotes.exe"));
        assert!(!allowed_process("RiotClientFake.exe"));
    }
    #[test]
    fn installation_metadata_excludes_foreign_same_named_processes() {
        let directory = tempfile::tempdir().unwrap();
        let league = directory.path().join("League");
        let riot = directory.path().join("Riot Client");
        fs::create_dir_all(league.join("Game")).unwrap();
        fs::create_dir_all(riot.join("UX")).unwrap();
        for path in [
            league.join("LeagueClient.exe"),
            league.join("LeagueClientUx.exe"),
            league.join("Game/League of Legends.exe"),
            riot.join("RiotClientServices.exe"),
            riot.join("UX/RiotClientUx.exe"),
        ] {
            fs::write(path, b"fixture").unwrap();
        }
        let metadata = serde_json::json!({"associated_client":{league.to_str().unwrap():riot.join("RiotClientServices.exe").to_str().unwrap()}});
        let installation = InstalledExecutables::from_metadata(&metadata).unwrap();
        assert!(installation.contains("LeagueClient.exe", &league.join("LeagueClient.exe")));
        assert!(installation.contains("RiotClientUx.exe", &riot.join("UX/RiotClientUx.exe")));
        let foreign = directory.path().join("League-other");
        fs::create_dir(&foreign).unwrap();
        fs::write(foreign.join("LeagueClient.exe"), b"fixture").unwrap();
        assert!(!installation.contains("LeagueClient.exe", &foreign.join("LeagueClient.exe")));
        assert!(!installation.contains("LeagueClientUx.exe", &league.join("LeagueClient.exe")));
        assert!(
            InstalledExecutables::from_metadata(
                &serde_json::json!({"associated_client":{"relative/path":"RiotClientServices.exe"}})
            )
            .is_err()
        );
        assert!(
            InstalledExecutables::from_metadata(
                &serde_json::json!({"rc_default":riot.join("RiotClientServices.exe")})
            )
            .is_err()
        );
    }
    #[test]
    fn changed_process_identity_is_not_reused() {
        let path = Path::new("C:/fixture/LeagueClient.exe");
        assert!(same_process(1, path, 1, Some(path)));
        assert!(!same_process(1, path, 2, Some(path)));
        assert!(!same_process(1, path, 1, None));
        assert!(!same_process(
            1,
            path,
            1,
            Some(Path::new("C:/foreign/LeagueClient.exe"))
        ));
    }
}
