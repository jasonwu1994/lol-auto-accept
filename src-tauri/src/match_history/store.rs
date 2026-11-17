//! Feature-local preferences: Riot ID search history.
//! Versioned JSON, written atomically; never shares a file with credentials.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::PathBuf};

pub const SEARCH_HISTORY_MAX: usize = 20;
const FILE_MAX: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub puuid: String,
    pub platform_id: String,
    pub game_name: String,
    pub tag_line: String,
    pub profile_icon_id: Option<u32>,
    #[serde(default)]
    pub is_pinned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// Files written before player notes were removed still carry a `notes` field; serde
/// skips it on read and the next save drops it.
struct Data {
    version: u32,
    search_history: Vec<SearchItem>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            version: 1,
            search_history: Vec::new(),
        }
    }
}

pub struct HistoryPreferences {
    path: PathBuf,
    data: Data,
}

fn player_key(platform_id: &str, puuid: &str) -> AppResult<String> {
    crate::lcu::validate_identifier(puuid)?;
    if platform_id.len() > 32
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
        Ok(Self { path, data })
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

    pub fn search_history(&self) -> Vec<SearchItem> {
        self.data.search_history.clone()
    }

    /// Upstream ordering: pinned entries keep their relative order ahead of the rest;
    /// a re-saved unpinned entry moves to the front of the unpinned area; overflow
    /// drops the last unpinned entry.
    pub fn save_search(&mut self, mut item: SearchItem) -> AppResult<Vec<SearchItem>> {
        player_key(&item.platform_id, &item.puuid)?;
        item.game_name = text(&item.game_name, 32);
        item.tag_line = text(&item.tag_line, 8);
        let list = &mut self.data.search_history;
        let old = list
            .iter()
            .position(|i| i.puuid == item.puuid && i.platform_id == item.platform_id);
        let was_pinned = old.is_some_and(|i| list[i].is_pinned);
        item.is_pinned = item.is_pinned || was_pinned;
        if let (Some(index), true) = (old, was_pinned && item.is_pinned) {
            list[index] = item;
        } else {
            if let Some(index) = old {
                list.remove(index);
            }
            let position = list.iter().position(|i| !i.is_pinned).unwrap_or(list.len());
            list.insert(position, item);
            if list.len() > SEARCH_HISTORY_MAX {
                if let Some(last) = list.iter().rposition(|i| !i.is_pinned) {
                    list.remove(last);
                } else if old.is_none() {
                    list.pop();
                }
            }
        }
        self.save()?;
        Ok(self.search_history())
    }

    pub fn delete_search(&mut self, platform_id: &str, puuid: &str) -> AppResult<Vec<SearchItem>> {
        self.data
            .search_history
            .retain(|i| !(i.puuid == puuid && i.platform_id == platform_id));
        self.save()?;
        Ok(self.search_history())
    }

    pub fn toggle_pin(&mut self, platform_id: &str, puuid: &str) -> AppResult<Vec<SearchItem>> {
        if let Some(item) = self
            .data
            .search_history
            .iter_mut()
            .find(|i| i.puuid == puuid && i.platform_id == platform_id)
        {
            item.is_pinned = !item.is_pinned;
        }
        // Stable sort keeps relative order within each group.
        self.data.search_history.sort_by_key(|i| !i.is_pinned);
        self.save()?;
        Ok(self.search_history())
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
        assert_eq!(store.search_history().len(), 1);
        store.toggle_pin("TW2", "p1").unwrap();
        assert!(
            !String::from_utf8(fs::read(&path).unwrap())
                .unwrap()
                .contains("notes")
        );
    }

    #[test]
    fn search_history_keeps_pins_ahead_and_caps_unpinned() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = HistoryPreferences::open(dir.path().join("m.json")).unwrap();
        for n in 0..SEARCH_HISTORY_MAX {
            store.save_search(item(&format!("p{n}"))).unwrap();
        }
        store.toggle_pin("TW2", "p0").unwrap();
        assert_eq!(store.search_history()[0].puuid, "p0");
        let list = store.save_search(item("new")).unwrap();
        assert_eq!(list.len(), SEARCH_HISTORY_MAX);
        assert_eq!(list[0].puuid, "p0");
        assert_eq!(list[1].puuid, "new");
        assert!(!list.iter().any(|i| i.puuid == "p1"));
        let list = store.save_search(item("p5")).unwrap();
        assert_eq!(list[1].puuid, "p5");
    }

    #[test]
    fn damaged_file_is_ignored_until_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.json");
        fs::write(&path, b"{not json").unwrap();
        let store = HistoryPreferences::open(path.clone()).unwrap();
        assert!(store.search_history().is_empty());
        assert_eq!(fs::read(&path).unwrap(), b"{not json");
    }
}
