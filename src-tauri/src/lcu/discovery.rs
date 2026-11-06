use std::{fs, path::Path};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

use crate::error::{AppError, AppResult};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Credentials {
    pub pid: u32,
    pub started: u64,
    pub port: u16,
    pub password: String,
}

pub(super) fn parse_lockfile(text: &str, pid: u32, started: u64) -> Option<Credentials> {
    let fields: Vec<_> = text.trim().split(':').collect();
    if fields.len() != 5
        || fields[0] != "LeagueClient"
        || fields[1].parse::<u32>().ok()? != pid
        || fields[4] != "https"
    {
        return None;
    }
    let port = fields[2].parse().ok()?;
    if port == 0 || fields[3].is_empty() || fields[3].len() > 256 {
        return None;
    }
    Some(Credentials {
        pid,
        started,
        port,
        password: fields[3].to_owned(),
    })
}

fn argument<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.iter()
        .find_map(|arg| arg.trim_matches('"').strip_prefix(key))
}

pub(super) fn from_arguments(args: &[String], pid: u32, started: u64) -> Option<Credentials> {
    let port: u16 = argument(args, "--app-port=")?.parse().ok()?;
    let password = argument(args, "--remoting-auth-token=")?;
    if port == 0 || password.is_empty() || password.len() > 256 || !password.is_ascii() {
        return None;
    }
    Some(Credentials {
        pid,
        started,
        port,
        password: password.to_owned(),
    })
}

pub(super) fn discover() -> AppResult<Option<Credentials>> {
    let mut system = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
    )
    .map_err(|_| AppError::new("Io", "Process discovery is unavailable"))?;
    let candidates: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let name = process.name().to_string_lossy();
            is_client_process(&name).then_some(*pid)
        })
        .collect();
    if candidates.is_empty() {
        return Ok(None);
    }
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&candidates),
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );
    let mut found = Vec::new();
    for process in system.processes().values() {
        if !process
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("LeagueClientUx.exe")
        {
            continue;
        }
        let pid = process.pid().as_u32();
        let started = process.start_time();
        let args: Vec<_> = process
            .cmd()
            .iter()
            .map(|v| v.to_string_lossy().into_owned())
            .collect();
        if let Some(credentials) = from_arguments(&args, pid, started) {
            found.push(credentials);
            continue;
        }
        // Only the directory of an identified client is considered; never scan disks.
        if let Some(directory) = process.exe().and_then(Path::parent)
            && let Ok(text) = fs::read_to_string(directory.join("lockfile"))
        {
            // The lockfile PID identifies LeagueClient rather than its Ux child.
            let lock_pid = text.split(':').nth(1).and_then(|v| v.parse::<u32>().ok());
            if let Some(parent) = lock_pid.and_then(|id| system.process(sysinfo::Pid::from_u32(id)))
                && parent
                    .name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("LeagueClient.exe")
                && parent.exe().and_then(Path::parent) == Some(directory)
                && let Some(credentials) =
                    parse_lockfile(&text, parent.pid().as_u32(), parent.start_time())
            {
                found.push(credentials);
            }
        }
    }
    found.sort_by_key(|v| (v.pid, v.port));
    found.dedup();
    if found.len() > 1 {
        return Err(AppError::new(
            "Unsupported",
            "Multiple League clients are running",
        ));
    }
    Ok(found.pop())
}

pub fn legacy_app_running() -> bool {
    let Ok(mut system) = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()),
    ) else {
        return true;
    };
    if system.processes().values().any(|process| {
        process
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("lol-app.exe")
    }) {
        return true;
    }
    let candidates: Vec<_> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            process
                .name()
                .to_string_lossy()
                .eq_ignore_ascii_case("electron.exe")
                .then_some(*pid)
        })
        .collect();
    if candidates.is_empty() {
        return false;
    }
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&candidates),
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if name == "lol-app.exe" {
            return true;
        }
        if name != "electron.exe" {
            return false;
        }
        process.cwd().is_some_and(|path| {
            path.to_string_lossy()
                .to_ascii_lowercase()
                .contains("lol-auto-accept")
        }) || process.cmd().iter().any(|arg| {
            let arg = arg
                .to_string_lossy()
                .to_ascii_lowercase()
                .replace('\\', "/");
            arg.contains("lol-auto-accept") || arg.ends_with("/main/main.js")
        })
    })
}

fn is_client_process(name: &str) -> bool {
    name.eq_ignore_ascii_case("LeagueClientUx.exe") || name.eq_ignore_ascii_case("LeagueClient.exe")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_foreign_stale_or_invalid_lockfiles() {
        assert!(parse_lockfile("LeagueClient:9:1234:fixture:https", 9, 1).is_some());
        for text in [
            "LeagueClient:8:1234:fixture:https",
            "Other:9:1234:fixture:https",
            "LeagueClient:9:0:fixture:https",
            "LeagueClient:9:1234:fixture:http",
            "LeagueClient:9:1234::https",
        ] {
            assert!(parse_lockfile(text, 9, 1).is_none());
        }
    }
    #[test]
    fn reads_only_exact_client_flags() {
        let args = vec![
            "--app-port=1234".into(),
            "--remoting-auth-token=fixture".into(),
        ];
        assert_eq!(from_arguments(&args, 1, 2).unwrap().port, 1234);
        assert!(from_arguments(&["--app-port=65536".into(), args[1].clone()], 1, 2).is_none());
    }

    #[test]
    fn expensive_process_fields_are_only_requested_for_exact_clients() {
        assert!(is_client_process("LeagueClientUx.exe"));
        assert!(is_client_process("leagueclient.EXE"));
        for name in [
            "LeagueClientUxRender.exe",
            "RiotClientServices.exe",
            "NotLeagueClient.exe",
            "electron.exe",
            "LeagueClientUx.exe.bak",
        ] {
            assert!(!is_client_process(name));
        }
    }
}
