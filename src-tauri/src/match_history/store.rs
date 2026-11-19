//! Feature-local preferences: the last signed-in account, favorite players and
//! Riot ID search history. Versioned JSON, written atomically; never shares a file
//! with credentials.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::PathBuf};

pub const SEARCH_HISTORY_MAX: usize = 20;
pub const FAVORITES_MAX: usize = 50;
const FILE_MAX: u64 = 4 * 1024 * 1024;

/// A player saved on this computer. `platform_id + puuid` is the identity; the
/// names and icon are labels refreshed whenever the player is seen again.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub puuid: String,
    pub platform_id: String,
    pub game_name: String,
    pub tag_line: String,
    pub profile_icon_id: Option<u32>,
    /// Only read from files written before favorites existed: pinned searches are
    /// moved into favorites on load and never written again.
    #[serde(default, skip_serializing)]
    pub is_pinned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// Files written before player notes were removed still carry a `notes` field; serde
/// skips it on read and the next save drops it.
struct Data {
    version: u32,
    search_history: Vec<SearchItem>,
    #[serde(default)]
    favorites: Vec<SearchItem>,
    /// The account last signed in to the client, shown while it is closed.
    #[serde(default)]
    account: Option<SearchItem>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            version: 1,
            search_history: Vec::new(),
            favorites: Vec::new(),
            account: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub account: Option<SearchItem>,
    pub favorites: Vec<SearchItem>,
    pub search_history: Vec<SearchItem>,
}

pub struct HistoryPreferences {
    path: PathBuf,
    data: Data,
}

fn player_key(platform_id: &str, puuid: &str) -> AppResult<String> {
    crate::lcu::validate_identifier(puuid)?;
    if platform_id.is_empty()
        || platform_id.len() > 32
        || !platform_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(AppError::new("InvalidInput", "Invalid platform"));
    }
    Ok(format!("{platform_id}:{puuid}"))
}

fn text(value: &str, max: usize) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max)
        .collect()
}

/// Validates the identity and trims the labels of a player about to be stored.
fn clean(mut item: SearchItem) -> AppResult<SearchItem> {
    player_key(&item.platform_id, &item.puuid)?;
    item.game_name = text(&item.game_name, 32);
    item.tag_line = text(&item.tag_line, 8);
    item.is_pinned = false;
    Ok(item)
}

fn same(a: &SearchItem, b: &SearchItem) -> bool {
    a.puuid == b.puuid && a.platform_id == b.platform_id
}

impl HistoryPreferences {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        let data = match fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(FILE_MAX + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| AppError::new("Io", "Cannot read match history preferences"))?;
                // A damaged file is preserved on disk and replaced only on the next save.
                serde_json::from_slice::<Data>(&bytes)
                    .ok()
                    .filter(|data| data.version == 1 && bytes.len() as u64 <= FILE_MAX)
                    .unwrap_or_default()
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Data::default(),
            Err(_) => return Err(AppError::new("Io", "Cannot read match history preferences")),
        };
        let mut preferences = Self { path, data };
        preferences.migrate_pins();
        Ok(preferences)
    }

    /// Searches pinned by earlier versions become favorites. The file is rewritten
    /// with the next change, so a read-only start leaves it untouched.
    fn migrate_pins(&mut self) {
        let pinned: Vec<SearchItem> = self
            .data
            .search_history
            .iter()
            .filter(|item| item.is_pinned)
            .cloned()
            .collect();
        for mut item in pinned {
            item.is_pinned = false;
            if self.data.favorites.len() < FAVORITES_MAX
                && !self.data.favorites.iter().any(|f| same(f, &item))
            {
                self.data.favorites.push(item);
            }
        }
        for item in &mut self.data.search_history {
            item.is_pinned = false;
        }
    }

    fn save(&self) -> AppResult<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::new("Io", "Invalid preferences path"))?;
        fs::create_dir_all(parent).map_err(|_| AppError::new("Io", "Cannot save preferences"))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| AppError::new("Io", "Cannot save preferences"))?;
        serde_json::to_writer(&mut temp, &self.data)
            .map_err(|_| AppError::new("Io", "Cannot save preferences"))?;
        temp.as_file()
            .sync_all()
            .map_err(|_| AppError::new("Io", "Cannot save preferences"))?;
        temp.persist(&self.path)
            .map_err(|_| AppError::new("Io", "Cannot save preferences"))?;
        Ok(())
    }

    pub fn saved(&self) -> Saved {
        Saved {
            account: self.data.account.clone(),
            favorites: self.data.favorites.clone(),
            search_history: self.data.search_history.clone(),
        }
    }

    /// Most recent first; a repeated search moves to the front; overflow drops the oldest.
    pub fn save_search(&mut self, item: SearchItem) -> AppResult<Saved> {
        let item = clean(item)?;
        let list = &mut self.data.search_history;
        list.retain(|i| !same(i, &item));
        list.insert(0, item);
        list.truncate(SEARCH_HISTORY_MAX);
        self.save()?;
        Ok(self.saved())
    }

    pub fn delete_search(&mut self, item: &SearchItem) -> AppResult<Saved> {
        self.data.search_history.retain(|i| !same(i, item));
        self.save()?;
        Ok(self.saved())
    }

    pub fn clear_search(&mut self) -> AppResult<Saved> {
        self.data.search_history.clear();
        self.save()?;
        Ok(self.saved())
    }

    /// Adds a favorite at the front (an existing one keeps its place and takes the new labels).
    pub fn add_favorite(&mut self, item: SearchItem) -> AppResult<Saved> {
        let item = clean(item)?;
        let list = &mut self.data.favorites;
        if let Some(existing) = list.iter_mut().find(|i| same(i, &item)) {
            *existing = item;
        } else {
            if list.len() >= FAVORITES_MAX {
                return Err(AppError::new("LimitReached", "Too many favorites"));
            }
            list.insert(0, item);
        }
        self.save()?;
        Ok(self.saved())
    }

    pub fn remove_favorite(&mut self, item: &SearchItem) -> AppResult<Saved> {
        self.data.favorites.retain(|i| !same(i, item));
        self.save()?;
        Ok(self.saved())
    }

    /// Moves a favorite to `index` (clamped); unknown players are ignored.
    pub fn move_favorite(&mut self, item: &SearchItem, index: usize) -> AppResult<Saved> {
        let list = &mut self.data.favorites;
        if let Some(from) = list.iter().position(|i| same(i, item)) {
            let entry = list.remove(from);
            list.insert(index.min(list.len()), entry);
            self.save()?;
        }
        Ok(self.saved())
    }

    /// New names or icon of a player already saved (renamed account, new icon). Writes
    /// only when something changed, so viewing a player costs no disk write.
    pub fn refresh_labels(&mut self, item: SearchItem) -> AppResult<Saved> {
        let item = clean(item)?;
        let mut changed = false;
        let lists = self
            .data
            .favorites
            .iter_mut()
            .chain(self.data.search_history.iter_mut())
            .chain(self.data.account.iter_mut());
        for existing in lists {
            if same(existing, &item) && *existing != item {
                *existing = item.clone();
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(self.saved())
    }

    /// Remembers the signed-in account; writes only when it changed.
    pub fn set_account(&mut self, item: SearchItem) -> AppResult<()> {
        let item = clean(item)?;
        if self.data.account.as_ref() == Some(&item) {
            return Ok(());
        }
        self.data.account = Some(item);
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(puuid: &str) -> SearchItem {
        SearchItem {
            puuid: puuid.into(),
            platform_id: "TW2".into(),
            game_name: puuid.into(),
            tag_line: "TW".into(),
            profile_icon_id: None,
            is_pinned: false,
        }
    }

    #[test]
    fn files_with_old_player_notes_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        fs::write(
            &path,
            br#"{"version":1,"notes":{"TW2:p1":{"note":"x","tags":[],"updatedAt":1}},"searchHistory":[{"puuid":"p1","platformId":"TW2","gameName":"a","tagLine":"TW","profileIconId":null}]}"#,
        )
        .unwrap();
        let mut store = HistoryPreferences::open(path.clone()).unwrap();
        assert_eq!(store.saved().search_history.len(), 1);
        store.add_favorite(item("p2")).unwrap();
        assert!(
            !String::from_utf8(fs::read(&path).unwrap())
                .unwrap()
                .contains("notes")
        );
    }

    #[test]
    fn pinned_searches_become_favorites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        fs::write(
            &path,
            br#"{"version":1,"searchHistory":[{"puuid":"p1","platformId":"TW2","gameName":"a","tagLine":"TW","profileIconId":7,"isPinned":true},{"puuid":"p2","platformId":"TW2","gameName":"b","tagLine":"TW","profileIconId":null}]}"#,
        )
        .unwrap();
        let mut store = HistoryPreferences::open(path.clone()).unwrap();
        let saved = store.saved();
        assert_eq!(saved.favorites.len(), 1);
        assert_eq!(saved.favorites[0].puuid, "p1");
        assert_eq!(saved.search_history.len(), 2);
        store.save_search(item("p3")).unwrap();
        let written = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        assert!(!written.contains("isPinned"));
        // Reopening does not duplicate the migrated favorite.
        let store = HistoryPreferences::open(path).unwrap();
        assert_eq!(store.saved().favorites.len(), 1);
    }

    #[test]
    fn search_history_is_most_recent_first_and_capped() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = HistoryPreferences::open(dir.path().join("m.json")).unwrap();
        for n in 0..SEARCH_HISTORY_MAX {
            store.save_search(item(&format!("p{n}"))).unwrap();
        }
        let list = store.save_search(item("new")).unwrap().search_history;
        assert_eq!(list.len(), SEARCH_HISTORY_MAX);
        assert_eq!(list[0].puuid, "new");
        assert!(!list.iter().any(|i| i.puuid == "p0"));
        let list = store.save_search(item("p5")).unwrap().search_history;
        assert_eq!(list[0].puuid, "p5");
        assert_eq!(list.len(), SEARCH_HISTORY_MAX);
        assert!(store.clear_search().unwrap().search_history.is_empty());
    }

    #[test]
    fn favorites_add_update_move_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        let mut store = HistoryPreferences::open(path.clone()).unwrap();
        store.add_favorite(item("a")).unwrap();
        store.add_favorite(item("b")).unwrap();
        let ids = |s: &Saved| {
            s.favorites
                .iter()
                .map(|i| i.puuid.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&store.saved()), ["b", "a"]);
        let mut renamed = item("a");
        renamed.game_name = "renamed".into();
        let saved = store.add_favorite(renamed).unwrap();
        assert_eq!(ids(&saved), ["b", "a"]);
        assert_eq!(saved.favorites[1].game_name, "renamed");
        assert_eq!(
            ids(&store.move_favorite(&item("a"), 0).unwrap()),
            ["a", "b"]
        );
        assert_eq!(
            ids(&store.move_favorite(&item("a"), 99).unwrap()),
            ["b", "a"]
        );
        assert_eq!(ids(&store.remove_favorite(&item("b")).unwrap()), ["a"]);
        let reopened = HistoryPreferences::open(path).unwrap();
        assert_eq!(ids(&reopened.saved()), ["a"]);
        let mut bad = item("../x");
        bad.platform_id = "TW2".into();
        assert!(store.add_favorite(bad).is_err());
        let mut no_platform = item("c");
        no_platform.platform_id = String::new();
        assert!(store.add_favorite(no_platform).is_err());
    }

    #[test]
    fn favorites_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = HistoryPreferences::open(dir.path().join("m.json")).unwrap();
        for n in 0..FAVORITES_MAX {
            store.add_favorite(item(&format!("p{n}"))).unwrap();
        }
        let error = store.add_favorite(item("extra")).unwrap_err();
        assert_eq!(error.code, "LimitReached");
        // Updating an existing favorite still works at the cap.
        assert!(store.add_favorite(item("p3")).is_ok());
    }

    #[test]
    fn labels_refresh_everywhere_and_account_is_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        let mut store = HistoryPreferences::open(path.clone()).unwrap();
        store.add_favorite(item("a")).unwrap();
        store.save_search(item("a")).unwrap();
        store.set_account(item("a")).unwrap();
        let mut renamed = item("a");
        renamed.game_name = "new".into();
        renamed.profile_icon_id = Some(29);
        let saved = store.refresh_labels(renamed.clone()).unwrap();
        assert_eq!(saved.favorites[0], renamed);
        assert_eq!(saved.search_history[0], renamed);
        assert_eq!(saved.account.as_ref(), Some(&renamed));
        let reopened = HistoryPreferences::open(path).unwrap();
        assert_eq!(reopened.saved().account, Some(renamed));
    }

    #[test]
    fn damaged_file_is_ignored_until_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        fs::write(&path, b"{not json").unwrap();
        let store = HistoryPreferences::open(path.clone()).unwrap();
        assert!(store.saved().search_history.is_empty());
        assert_eq!(fs::read(&path).unwrap(), b"{not json");
    }
}
