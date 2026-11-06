use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

impl WindowSize {
    pub fn is_valid(self) -> bool {
        (640..=16384).contains(&self.width) && (480..=16384).contains(&self.height)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct AppConfig {
    pub schema_version: u32,
    pub is_auto_accept: bool,
    pub is_show_recent_teammate: bool,
    pub recent_teammate_check_game_count: u32,
    pub is_check_hidden_player_history: bool,
    pub hidden_player_history_game_count: u32,
    pub is_show_teammate_ranked: bool,
    pub show_teammate_ranked_type: String,
    pub is_hovercard: bool,
    pub hovercard_tier_type: String,
    pub hovercard_ranked_type: String,
    pub language: String,
    pub is_dark_mode: bool,
    pub design_theme: String,
    pub appearance_mode: Option<String>,
    pub always_on_top: bool,
    pub is_auto_aram_topmost: bool,
    pub window_size: Option<WindowSize>,
    pub window_position: Option<WindowPosition>,
    pub nav_order: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            is_auto_accept: true,
            is_show_recent_teammate: true,
            recent_teammate_check_game_count: 20,
            is_check_hidden_player_history: true,
            hidden_player_history_game_count: 5,
            is_show_teammate_ranked: true,
            show_teammate_ranked_type: "RANKED_BOTH".into(),
            is_hovercard: false,
            hovercard_tier_type: "Challenger".into(),
            hovercard_ranked_type: "RANKED_SOLO_5x5".into(),
            language: "zh".into(),
            is_dark_mode: true,
            design_theme: "default".into(),
            appearance_mode: None,
            always_on_top: false,
            is_auto_aram_topmost: false,
            window_size: None,
            window_position: None,
            nav_order: [
                "/main",
                "/duo",
                "/rank",
                "/recentPlayers",
                "/aram",
                "/selectedRole",
                "/about",
            ]
            .map(String::from)
            .to_vec(),
        }
    }
}

impl AppConfig {
    pub fn window_theme(&self) -> Option<tauri::Theme> {
        if self.appearance_mode.as_deref() == Some("system") {
            None
        } else {
            Some(if self.resolve_dark(tauri::Theme::Dark) {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            })
        }
    }
    pub fn resolve_dark(&self, system: tauri::Theme) -> bool {
        match self.appearance_mode.as_deref() {
            Some("system") => system == tauri::Theme::Dark,
            Some("dark") => true,
            Some("light") => false,
            _ => self.is_dark_mode,
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        if self
            .appearance_mode
            .as_deref()
            .is_some_and(|mode| !["light", "dark", "system"].contains(&mode))
            || ![
                "default", "sky", "lavender", "mint", "netflix", "uber", "spotify", "coinbase",
                "airbnb", "discord", "rabbit",
            ]
            .contains(&self.design_theme.as_str())
            || self.schema_version != 1
            || self.nav_order.len() != 7
            || [
                "/main",
                "/duo",
                "/rank",
                "/recentPlayers",
                "/aram",
                "/selectedRole",
                "/about",
            ]
            .iter()
            .any(|path| {
                self.nav_order
                    .iter()
                    .filter(|saved| saved.as_str() == *path)
                    .count()
                    != 1
            })
            || self.window_size.is_some_and(|size| !size.is_valid())
            || !(1..=100).contains(&self.recent_teammate_check_game_count)
            || !(1..=10).contains(&self.hidden_player_history_game_count)
            || !["zh", "en"].contains(&self.language.as_str())
            || !["RANKED_SOLO_5x5", "RANKED_FLEX_SR", "RANKED_BOTH"]
                .contains(&self.show_teammate_ranked_type.as_str())
            || ![
                "RANKED_SOLO_5x5",
                "RANKED_FLEX_SR",
                "RANKED_FLEX_TT",
                "RANKED_TFT",
                "RANKED_TFT_DOUBLE_UP",
                "RANKED_TFT_TURBO",
            ]
            .contains(&self.hovercard_ranked_type.as_str())
            || ![
                "Iron",
                "Bronze",
                "Silver",
                "Gold",
                "Platinum",
                "Emerald",
                "Diamond",
                "Master",
                "Grandmaster",
                "Challenger",
            ]
            .contains(&self.hovercard_tier_type.as_str())
        {
            return Err(AppError::new(
                "InvalidInput",
                "Unsupported configuration value",
            ));
        }
        Ok(())
    }
}

enum RecoverySource {
    Current,
    Legacy,
}

pub struct ConfigStore {
    path: PathBuf,
    config: AppConfig,
    recovery: Option<RecoverySource>,
}

impl ConfigStore {
    pub fn open(directory: &Path) -> AppResult<Self> {
        fs::create_dir_all(directory).map_err(|_| io_error())?;
        let path = directory.join("config.json");
        let config = match fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(64 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| io_error())?;
                if bytes.len() > 64 * 1024 {
                    return Err(AppError::new("InvalidInput", "Configuration is too large"));
                }
                let parsed: AppConfig = serde_json::from_slice(&bytes).map_err(|_| {
                    AppError::new(
                        "InvalidInput",
                        "Configuration is invalid; original file preserved",
                    )
                })?;
                parsed.validate()?;
                parsed
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => AppConfig::default(),
            Err(_) => return Err(io_error()),
        };
        Ok(Self {
            path,
            config,
            recovery: None,
        })
    }

    pub fn open_recovering(directory: &Path) -> AppResult<Self> {
        match Self::open(directory) {
            Ok(store) => Ok(store),
            Err(error) if error.code == "InvalidInput" => Ok(Self {
                path: directory.join("config.json"),
                config: AppConfig {
                    is_auto_accept: false,
                    is_show_recent_teammate: false,
                    is_show_teammate_ranked: false,
                    is_hovercard: false,
                    ..AppConfig::default()
                },
                recovery: Some(RecoverySource::Current),
            }),
            Err(error) => Err(error),
        }
    }

    pub fn open_with_legacy(directory: &Path, candidates: &[PathBuf]) -> AppResult<Self> {
        let path = directory.join("config.json");
        if path.try_exists().map_err(|_| io_error())? {
            return Self::open_recovering(directory);
        }
        for candidate in candidates {
            match candidate.try_exists() {
                Ok(false) => continue,
                Ok(true) => {}
                Err(_) => return Self::legacy_recovery(directory),
            }
            let parsed = (|| {
                let mut bytes = Vec::new();
                fs::File::open(candidate)
                    .map_err(|_| io_error())?
                    .take(64 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| io_error())?;
                if bytes.len() > 64 * 1024 {
                    return Err(AppError::new(
                        "InvalidInput",
                        "Previous configuration is too large",
                    ));
                }
                let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
                    AppError::new("InvalidInput", "Previous configuration is invalid")
                })?;
                let config: AppConfig =
                    serde_json::from_value(value.get("config").cloned().ok_or_else(|| {
                        AppError::new("InvalidInput", "Previous configuration is missing")
                    })?)
                    .map_err(|_| {
                        AppError::new("InvalidInput", "Previous configuration is invalid")
                    })?;
                config.validate()?;
                Ok(config)
            })();
            return match parsed {
                Ok(config) => {
                    fs::create_dir_all(directory).map_err(|_| io_error())?;
                    Ok(Self {
                        path,
                        config,
                        recovery: None,
                    })
                }
                Err(_) => Self::legacy_recovery(directory),
            };
        }
        Self::open(directory)
    }

    fn legacy_recovery(directory: &Path) -> AppResult<Self> {
        fs::create_dir_all(directory).map_err(|_| io_error())?;
        Ok(Self {
            path: directory.join("config.json"),
            config: AppConfig {
                is_auto_accept: false,
                is_show_recent_teammate: false,
                is_show_teammate_ranked: false,
                is_hovercard: false,
                ..AppConfig::default()
            },
            recovery: Some(RecoverySource::Legacy),
        })
    }

    pub fn recovery_warning(&self) -> Option<String> {
        match self.recovery {
            Some(RecoverySource::Current) => Some("Configuration could not be loaded. Automatic actions are disabled. The original file is preserved; saving settings will create a recovery backup before replacing it.".into()),
            Some(RecoverySource::Legacy) => Some("The previous application settings could not be read. Automatic actions are disabled. The old file is unchanged; saving settings will create the new application's configuration.".into()),
            None => None,
        }
    }

    pub fn get(&self) -> AppConfig {
        self.config.clone()
    }

    pub fn update(&mut self, mut config: AppConfig) -> AppResult<AppConfig> {
        // Window geometry is owned by native resize events, not frontend snapshots.
        config.window_size = self.config.window_size;
        config.window_position = self.config.window_position;
        self.save(config)
    }

    pub fn update_window_size(&mut self, size: WindowSize) -> AppResult<()> {
        self.update_window_geometry(size, self.config.window_position)
    }

    pub fn update_window_geometry(
        &mut self,
        size: WindowSize,
        position: Option<WindowPosition>,
    ) -> AppResult<()> {
        if self.recovery.is_some()
            || (self.config.window_size == Some(size) && self.config.window_position == position)
        {
            return Ok(());
        }
        let mut config = self.get();
        config.window_size = Some(size);
        config.window_position = position;
        self.save(config)?;
        Ok(())
    }

    fn save(&mut self, config: AppConfig) -> AppResult<AppConfig> {
        config.validate()?;
        let bytes = serde_json::to_vec_pretty(&config).map_err(|_| io_error())?;
        if matches!(self.recovery, Some(RecoverySource::Current)) {
            backup_original(&self.path)?;
        }
        atomic_write(&self.path, &bytes)?;
        self.config = config;
        self.recovery = None;
        Ok(self.get())
    }
}

fn io_error() -> AppError {
    AppError::new("Io", "Unable to read or save configuration")
}

fn backup_original(path: &Path) -> AppResult<()> {
    let directory = path.parent().ok_or_else(io_error)?;
    let mut source = fs::File::open(path).map_err(|_| io_error())?;
    let mut temporary = tempfile::Builder::new()
        .prefix("config-recovery-")
        .tempfile_in(directory)
        .map_err(|_| io_error())?;
    std::io::copy(&mut source, &mut temporary).map_err(|_| io_error())?;
    temporary.as_file().sync_all().map_err(|_| io_error())?;
    let backup_path = temporary.path().with_extension("backup.json");
    let backup = temporary
        .persist_noclobber(backup_path)
        .map_err(|_| io_error())?;
    let mut permissions = backup.metadata().map_err(|_| io_error())?.permissions();
    permissions.set_readonly(true);
    backup
        .set_permissions(permissions)
        .map_err(|_| io_error())?;
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let directory = path.parent().ok_or_else(io_error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|_| io_error())?;
    temporary.write_all(bytes).map_err(|_| io_error())?;
    temporary.as_file().sync_all().map_err(|_| io_error())?;
    temporary.persist(path).map_err(|_| io_error())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appearance_modes_preserve_legacy_preferences_and_persist_system_mode() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("config.json"),
            r#"{"isDarkMode":false}"#,
        )
        .unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        assert!(!store.get().resolve_dark(tauri::Theme::Dark));
        assert_eq!(store.get().window_theme(), Some(tauri::Theme::Light));
        for mode in ["light", "dark", "system"] {
            let mut config = store.get();
            config.appearance_mode = Some(mode.into());
            store.update(config.clone()).unwrap();
            let restored = ConfigStore::open(directory.path()).unwrap().get();
            assert_eq!(restored, config);
            assert_eq!(restored.resolve_dark(tauri::Theme::Dark), mode != "light");
            assert_eq!(restored.resolve_dark(tauri::Theme::Light), mode == "dark");
            assert_eq!(restored.window_theme().is_none(), mode == "system");
        }
        let mut invalid = store.get();
        invalid.appearance_mode = Some("invalid".into());
        assert!(store.update(invalid).is_err());
    }
    #[test]
    fn design_themes_default_for_old_configs_and_survive_restart() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("config.json"), r#"{"language":"en"}"#).unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        assert_eq!(store.get().design_theme, "default");
        for theme in [
            "default", "sky", "lavender", "mint", "netflix", "uber", "spotify", "coinbase",
            "airbnb", "discord", "rabbit",
        ] {
            for dark in [true, false] {
                let mut config = store.get();
                config.design_theme = theme.into();
                config.is_dark_mode = dark;
                store.update(config.clone()).unwrap();
                assert_eq!(ConfigStore::open(directory.path()).unwrap().get(), config);
            }
        }
        let mut invalid = store.get();
        invalid.design_theme = "unknown".into();
        assert!(store.update(invalid).is_err());
        assert_eq!(store.get().design_theme, "rabbit");
    }
    #[test]
    fn automatic_aram_topmost_defaults_off_and_persists_separately_from_manual_topmost() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("config.json"),
            r#"{"alwaysOnTop":true}"#,
        )
        .unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        assert!(!store.get().is_auto_aram_topmost);
        let mut config = store.get();
        config.is_auto_aram_topmost = true;
        store.update(config.clone()).unwrap();
        let saved = ConfigStore::open(directory.path()).unwrap().get();
        assert!(saved.is_auto_aram_topmost);
        assert!(saved.always_on_top);
        config.is_auto_aram_topmost = false;
        store.update(config).unwrap();
        assert!(store.get().always_on_top);
    }
    #[test]
    fn sidebar_order_survives_restart_and_rejects_duplicate_or_unknown_routes() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("config.json"), r#"{"language":"en"}"#).unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        assert_eq!(store.get().nav_order, AppConfig::default().nav_order);
        let mut config = store.get();
        config.nav_order.rotate_right(2);
        store.update(config.clone()).unwrap();
        assert_eq!(
            ConfigStore::open(directory.path()).unwrap().get().nav_order,
            config.nav_order
        );
        for replacement in ["/removed", "/main"] {
            let mut invalid = config.clone();
            invalid.nav_order[0] = replacement.into();
            assert!(store.update(invalid).is_err());
            assert_eq!(store.get(), config);
        }
    }
    #[test]
    fn hidden_player_history_settings_default_and_persist_with_bounded_count() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("config.json"), r#"{"language":"en"}"#).unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        assert!(store.get().is_check_hidden_player_history);
        assert_eq!(store.get().hidden_player_history_game_count, 5);
        let mut config = store.get();
        config.is_check_hidden_player_history = false;
        config.hidden_player_history_game_count = 10;
        store.update(config.clone()).unwrap();
        assert_eq!(ConfigStore::open(directory.path()).unwrap().get(), config);
        for count in [0, 11] {
            let mut invalid = config.clone();
            invalid.hidden_player_history_game_count = count;
            assert!(store.update(invalid).is_err());
            assert_eq!(store.get(), config);
        }
    }
    #[test]
    fn window_size_survives_restart_and_stale_frontend_preferences() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("config.json"), r#"{"language":"en"}"#).unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        let mut stale = store.get();
        assert_eq!(stale.window_size, None);
        let size = WindowSize {
            width: 1100,
            height: 720,
        };
        let position = WindowPosition { x: -1200, y: 90 };
        store.update_window_geometry(size, Some(position)).unwrap();
        stale.is_dark_mode = false;
        store.update(stale).unwrap();
        let saved = ConfigStore::open(directory.path()).unwrap().get();
        assert_eq!(saved.window_size, Some(size));
        assert_eq!(saved.window_position, Some(position));
        assert_eq!(saved.language, "en");
        assert!(!saved.is_dark_mode);
        let json: Value =
            serde_json::from_slice(&fs::read(directory.path().join("config.json")).unwrap())
                .unwrap();
        assert_eq!(
            json["windowSize"],
            serde_json::json!({"width":1100,"height":720})
        );
    }

    #[test]
    fn automatic_window_size_saves_preserve_corrupt_configuration() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        fs::write(&path, "broken").unwrap();
        let mut store = ConfigStore::open_recovering(directory.path()).unwrap();
        store
            .update_window_size(WindowSize {
                width: 1100,
                height: 720,
            })
            .unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
        assert!(store.recovery_warning().is_some());
    }

    #[test]
    fn invalid_window_size_does_not_change_saved_settings() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = ConfigStore::open(directory.path()).unwrap();
        let before = store.get();
        for size in [
            WindowSize {
                width: 0,
                height: 0,
            },
            WindowSize {
                width: 639,
                height: 480,
            },
            WindowSize {
                width: u32::MAX,
                height: 720,
            },
        ] {
            assert!(store.update_window_size(size).is_err());
            assert_eq!(store.get(), before);
        }
        assert!(!directory.path().join("config.json").exists());
    }
    #[test]
    fn legacy_wrapper_is_read_without_writing_source_or_new_config() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("app-config.json");
        let source = r#"{"config":{"isAutoAccept":false,"isShowTeammateRanked":false,"language":"en","isDarkMode":true}}"#;
        fs::write(&legacy, source).unwrap();
        let new_directory = directory.path().join("new");
        let mut store =
            ConfigStore::open_with_legacy(&new_directory, std::slice::from_ref(&legacy)).unwrap();
        assert!(!store.get().is_auto_accept);
        assert!(!store.get().is_show_teammate_ranked);
        assert_eq!(store.get().language, "en");
        assert!(store.get().is_dark_mode);
        assert_eq!(store.get().recent_teammate_check_game_count, 20);
        assert!(store.recovery_warning().is_none());
        assert!(!new_directory.join("config.json").exists());
        let mut changed = store.get();
        changed.language = "zh".into();
        store.update(changed.clone()).unwrap();
        assert_eq!(ConfigStore::open(&new_directory).unwrap().get(), changed);
        assert_eq!(fs::read_to_string(legacy).unwrap(), source);
        assert!(!new_directory.join("legacy-config-import.json").exists());
    }

    #[test]
    fn missing_legacy_uses_normal_defaults_and_first_existing_candidate_wins() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing.json");
        let new_directory = directory.path().join("new");
        let defaults =
            ConfigStore::open_with_legacy(&new_directory, std::slice::from_ref(&missing)).unwrap();
        assert_eq!(defaults.get(), AppConfig::default());
        assert!(defaults.recovery_warning().is_none());
        let first = directory.path().join("first.json");
        let second = directory.path().join("second.json");
        fs::write(&first, r#"{"config":{"isAutoAccept":false}}"#).unwrap();
        fs::write(
            &second,
            r#"{"config":{"isAutoAccept":true,"language":"en"}}"#,
        )
        .unwrap();
        let loaded =
            ConfigStore::open_with_legacy(&new_directory, &[missing, first, second]).unwrap();
        assert!(!loaded.get().is_auto_accept);
        assert_eq!(loaded.get().language, "zh");
    }

    #[test]
    fn existing_new_config_wins_and_corrupt_new_does_not_fall_back() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("app-config.json");
        fs::write(
            &legacy,
            r#"{"config":{"language":"zh","isAutoAccept":true}}"#,
        )
        .unwrap();
        let new_directory = directory.path().join("new");
        let mut store = ConfigStore::open(&new_directory).unwrap();
        let config = AppConfig {
            language: "en".into(),
            is_auto_accept: false,
            ..AppConfig::default()
        };
        store.update(config.clone()).unwrap();
        assert_eq!(
            ConfigStore::open_with_legacy(&new_directory, std::slice::from_ref(&legacy))
                .unwrap()
                .get(),
            config
        );
        fs::write(new_directory.join("config.json"), "broken").unwrap();
        let failed = ConfigStore::open_with_legacy(&new_directory, &[legacy]).unwrap();
        assert!(failed.recovery_warning().is_some());
        assert!(!failed.get().is_auto_accept);
        assert_eq!(
            fs::read_to_string(new_directory.join("config.json")).unwrap(),
            "broken"
        );
    }

    #[test]
    fn invalid_legacy_disables_automation_and_user_save_leaves_old_source_untouched() {
        for source in [
            "broken",
            "{}",
            r#"{"config":{"schemaVersion":99}}"#,
            r#"{"config":{"language":"invalid"}}"#,
        ] {
            let directory = tempfile::tempdir().unwrap();
            let legacy = directory.path().join("app-config.json");
            let other = directory.path().join("other.json");
            fs::write(&legacy, source).unwrap();
            fs::write(&other, r#"{"config":{"isAutoAccept":true}}"#).unwrap();
            let new_directory = directory.path().join("new");
            let mut store =
                ConfigStore::open_with_legacy(&new_directory, &[legacy.clone(), other]).unwrap();
            let config = store.get();
            assert!(
                !config.is_auto_accept
                    && !config.is_show_recent_teammate
                    && !config.is_show_teammate_ranked
                    && !config.is_hovercard
            );
            assert!(
                store
                    .recovery_warning()
                    .unwrap()
                    .contains("previous application")
            );
            store.update(config).unwrap();
            assert!(store.recovery_warning().is_none());
            assert_eq!(fs::read_to_string(legacy).unwrap(), source);
            assert!(new_directory.join("config.json").is_file());
            assert!(recovery_backups(&new_directory).is_empty());
        }
    }

    #[test]
    fn oversized_legacy_is_bounded_and_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("app-config.json");
        let source = vec![b'x'; 70 * 1024];
        fs::write(&legacy, &source).unwrap();
        let store = ConfigStore::open_with_legacy(
            &directory.path().join("new"),
            std::slice::from_ref(&legacy),
        )
        .unwrap();
        assert!(store.recovery_warning().is_some());
        assert!(!store.get().is_auto_accept);
        assert_eq!(fs::read(legacy).unwrap(), source);
    }

    #[test]
    fn defaults_round_trip_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ConfigStore::open(dir.path()).unwrap();
        let mut config = store.get();
        config.language = "en".into();
        store.update(config.clone()).unwrap();
        config.is_auto_accept = false;
        store.update(config.clone()).unwrap();
        assert_eq!(ConfigStore::open(dir.path()).unwrap().get(), config);
    }
    #[test]
    fn corrupt_config_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), "broken").unwrap();
        assert!(ConfigStore::open(dir.path()).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("config.json")).unwrap(),
            "broken"
        );
    }
    #[test]
    fn invalid_updates_leave_memory_and_disk_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ConfigStore::open(dir.path()).unwrap();
        let original = store.get();
        let mut invalid = original.clone();
        invalid.recent_teammate_check_game_count = 0;
        assert!(store.update(invalid).is_err());
        assert_eq!(store.get(), original);
        assert!(serde_json::from_value::<AppConfig>(serde_json::json!({"password":"x"})).is_err());
    }

    #[test]
    fn save_failure_does_not_change_memory() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ConfigStore::open(dir.path()).unwrap();
        fs::create_dir(dir.path().join("config.json")).unwrap();
        let original = store.get();
        let mut changed = original.clone();
        changed.language = "en".into();
        assert!(store.update(changed).is_err());
        assert_eq!(store.get(), original);
    }

    fn recovery_backups(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .ends_with(".backup.json")
            })
            .collect()
    }

    #[test]
    fn corrupt_and_future_config_recover_without_writing_original() {
        for contents in [
            "broken",
            "{\"schemaVersion\":99}",
            "{\"language\":\"unknown\"}",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("config.json");
            fs::write(&path, contents).unwrap();
            let store = ConfigStore::open_recovering(directory.path()).unwrap();
            assert!(store.recovery_warning().is_some());
            let config = store.get();
            assert!(
                !config.is_auto_accept
                    && !config.is_show_recent_teammate
                    && !config.is_show_teammate_ranked
                    && !config.is_hovercard
            );
            assert_eq!(fs::read_to_string(path).unwrap(), contents);
            assert!(recovery_backups(directory.path()).is_empty());
        }
    }

    #[test]
    fn first_recovery_save_backs_up_exact_original_then_clears_warning() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        fs::write(&path, b"invalid\r\noriginal").unwrap();
        let mut store = ConfigStore::open_recovering(directory.path()).unwrap();
        let mut invalid = store.get();
        invalid.schema_version = 99;
        assert!(store.update(invalid).is_err());
        assert!(recovery_backups(directory.path()).is_empty());
        let saved = store.update(store.get()).unwrap();
        assert!(store.recovery_warning().is_none());
        assert_eq!(ConfigStore::open(directory.path()).unwrap().get(), saved);
        let backups = recovery_backups(directory.path());
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(&backups[0]).unwrap(), b"invalid\r\noriginal");
        assert!(fs::metadata(&backups[0]).unwrap().permissions().readonly());
        store.update(saved).unwrap();
        assert_eq!(recovery_backups(directory.path()).len(), 1);
    }

    #[test]
    fn oversized_configuration_recovers_without_truncating_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        let original = vec![b'x'; 70 * 1024];
        fs::write(&path, &original).unwrap();
        assert!(ConfigStore::open(directory.path()).is_err());
        let store = ConfigStore::open_recovering(directory.path()).unwrap();
        assert!(store.recovery_warning().is_some());
        assert!(!store.get().is_auto_accept);
        assert_eq!(fs::read(path).unwrap(), original);
        assert!(recovery_backups(directory.path()).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn recovery_backup_failure_does_not_save_or_clear_warning() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        fs::write(&path, "broken").unwrap();
        let mut store = ConfigStore::open_recovering(directory.path()).unwrap();
        let original = store.get();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(store.update(original.clone()).is_err());
        assert!(store.recovery_warning().is_some());
        assert_eq!(store.get(), original);
        drop(lock);
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
        assert!(recovery_backups(directory.path()).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn recovery_replace_failure_preserves_source_backup_and_warning() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        fs::write(&path, "broken").unwrap();
        let mut store = ConfigStore::open_recovering(directory.path()).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        assert!(store.update(store.get()).is_err());
        assert!(store.recovery_warning().is_some());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        let backups = recovery_backups(directory.path());
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "broken");
    }
}
