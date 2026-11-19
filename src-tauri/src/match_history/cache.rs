//! On-disk cache of finished games for the match-history page.
//!
//! Finished games never change, so their summaries, complete LCU games and details
//! (SGP DETAILS / LCU timelines) are kept by `(platform, source, kind, game id)`. Each
//! player's newest list (the "head": game IDs in order) is kept separately, so a tab
//! opened after a restart can show the last list at once and only probe the newest
//! games. Entries not used for [`MAX_IDLE_SECS`] are dropped, and the least recently
//! used ones go when the file outgrows [`MAX_BYTES`]. It is a cache: a missing or
//! broken file only means reading from the client again.

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

/// Five days without being used.
pub const MAX_IDLE_SECS: i64 = 5 * 24 * 60 * 60;
/// A head older than this is not shown: the player has likely played past it.
pub const MAX_HEAD_AGE_SECS: i64 = 5 * 24 * 60 * 60;
pub const MAX_BYTES: i64 = 512 * 1024 * 1024;
pub const MAX_HEAD_IDS: usize = 200;
/// `used_at` is rewritten on a read at most this often.
const TOUCH_SECS: i64 = 60 * 60;
/// Size is checked after this many writes.
const PRUNE_EVERY_WRITES: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// SGP SUMMARY list entry.
    Summary,
    /// Complete LCU game (`/lol-match-history/v1/games/{id}`).
    Game,
    /// SGP DETAILS.
    Details,
    /// LCU timeline.
    Timeline,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Game => "game",
            Self::Details => "details",
            Self::Timeline => "timeline",
        }
    }
}

pub fn valid_source(source: &str) -> bool {
    matches!(source, "sgp" | "lcu")
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

fn cache_error() -> AppError {
    AppError::new("Io", "Match history cache operation failed")
}

/// A cached head: game IDs newest first and when it was saved.
#[derive(Clone, Debug, PartialEq)]
pub struct Head {
    pub ids: Vec<String>,
    pub saved_at: i64,
    /// The list reached the end of the player's history when it was saved.
    pub complete: bool,
}

pub struct GameCache {
    connection: Connection,
    writes: u32,
    max_bytes: i64,
}

impl GameCache {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| cache_error())?;
        }
        let connection = Connection::open(path).map_err(|_| cache_error())?;
        Self::initialize(connection, MAX_BYTES)
    }

    fn initialize(connection: Connection, max_bytes: i64) -> AppResult<Self> {
        connection
            .busy_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| cache_error())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
                 CREATE TABLE IF NOT EXISTS games(
                   platform TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, game_id TEXT NOT NULL,
                   json TEXT NOT NULL, bytes INTEGER NOT NULL, used_at INTEGER NOT NULL,
                   PRIMARY KEY(platform, source, kind, game_id));
                 CREATE INDEX IF NOT EXISTS games_used ON games(used_at);
                 CREATE TABLE IF NOT EXISTS heads(
                   platform TEXT NOT NULL, puuid TEXT NOT NULL, source TEXT NOT NULL, tag TEXT NOT NULL,
                   ids TEXT NOT NULL, complete INTEGER NOT NULL, saved_at INTEGER NOT NULL, used_at INTEGER NOT NULL,
                   PRIMARY KEY(platform, puuid, source, tag));",
            )
            .map_err(|_| cache_error())?;
        let mut cache = Self {
            connection,
            writes: 0,
            max_bytes,
        };
        cache.prune(now())?;
        Ok(cache)
    }

    /// Drops idle entries, then the least recently used games past the size budget.
    fn prune(&mut self, now: i64) -> AppResult<()> {
        let cutoff = now - MAX_IDLE_SECS;
        self.connection
            .execute("DELETE FROM games WHERE used_at < ?1", [cutoff])
            .map_err(|_| cache_error())?;
        self.connection
            .execute("DELETE FROM heads WHERE used_at < ?1", [cutoff])
            .map_err(|_| cache_error())?;
        let total: i64 = self
            .connection
            .query_row("SELECT COALESCE(SUM(bytes), 0) FROM games", [], |row| {
                row.get(0)
            })
            .map_err(|_| cache_error())?;
        if total > self.max_bytes {
            // Keep the most recently used rows whose running total fits in 80% of the budget.
            self.connection
                .execute(
                    "DELETE FROM games WHERE rowid IN (
                       SELECT rowid FROM (
                         SELECT rowid, SUM(bytes) OVER (ORDER BY used_at DESC, rowid DESC) AS running FROM games)
                       WHERE running > ?1)",
                    [self.max_bytes * 4 / 5],
                )
                .map_err(|_| cache_error())?;
        }
        Ok(())
    }

    pub fn get(
        &self,
        platform: &str,
        source: &str,
        kind: Kind,
        game_id: &str,
    ) -> AppResult<Option<Value>> {
        let now = now();
        let row: Option<(String, i64)> = self
            .connection
            .query_row(
                "SELECT json, used_at FROM games WHERE platform=?1 AND source=?2 AND kind=?3 AND game_id=?4",
                params![platform, source, kind.name(), game_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| cache_error())?;
        let Some((json, used_at)) = row else {
            return Ok(None);
        };
        if now - used_at > TOUCH_SECS {
            let _ = self.connection.execute(
                "UPDATE games SET used_at=?5 WHERE platform=?1 AND source=?2 AND kind=?3 AND game_id=?4",
                params![platform, source, kind.name(), game_id, now],
            );
        }
        // A row that no longer parses is treated as missing and replaced on the next read.
        Ok(serde_json::from_str(&json).ok())
    }

    pub fn put(
        &mut self,
        platform: &str,
        source: &str,
        kind: Kind,
        game_id: &str,
        value: &Value,
    ) -> AppResult<()> {
        let json = serde_json::to_string(value).map_err(|_| cache_error())?;
        self.connection
            .execute(
                "INSERT OR REPLACE INTO games(platform, source, kind, game_id, json, bytes, used_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![platform, source, kind.name(), game_id, json, json.len() as i64, now()],
            )
            .map_err(|_| cache_error())?;
        self.writes += 1;
        if self.writes.is_multiple_of(PRUNE_EVERY_WRITES) {
            self.prune(now())?;
        }
        Ok(())
    }

    pub fn head(
        &self,
        platform: &str,
        puuid: &str,
        source: &str,
        tag: &str,
    ) -> AppResult<Option<Head>> {
        let row: Option<(String, bool, i64)> = self
            .connection
            .query_row(
                "SELECT ids, complete, saved_at FROM heads WHERE platform=?1 AND puuid=?2 AND source=?3 AND tag=?4",
                params![platform, puuid, source, tag],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| cache_error())?;
        let Some((ids, complete, saved_at)) = row else {
            return Ok(None);
        };
        let _ = self.connection.execute(
            "UPDATE heads SET used_at=?5 WHERE platform=?1 AND puuid=?2 AND source=?3 AND tag=?4",
            params![platform, puuid, source, tag, now()],
        );
        let Ok(ids) = serde_json::from_str::<Vec<String>>(&ids) else {
            return Ok(None);
        };
        Ok(Some(Head {
            ids,
            saved_at,
            complete,
        }))
    }

    pub fn save_head(
        &mut self,
        platform: &str,
        puuid: &str,
        source: &str,
        tag: &str,
        ids: &[String],
        complete: bool,
    ) -> AppResult<()> {
        let ids = &ids[..ids.len().min(MAX_HEAD_IDS)];
        let json = serde_json::to_string(ids).map_err(|_| cache_error())?;
        let now = now();
        self.connection
            .execute(
                "INSERT OR REPLACE INTO heads(platform, puuid, source, tag, ids, complete, saved_at, used_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![platform, puuid, source, tag, json, complete, now],
            )
            .map_err(|_| cache_error())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory(max_bytes: i64) -> GameCache {
        GameCache::initialize(Connection::open_in_memory().unwrap(), max_bytes).unwrap()
    }

    #[test]
    fn games_round_trip_by_full_key() {
        let mut cache = memory(MAX_BYTES);
        cache
            .put("TW2", "sgp", Kind::Details, "1", &json!({"a": 1}))
            .unwrap();
        assert_eq!(
            cache.get("TW2", "sgp", Kind::Details, "1").unwrap(),
            Some(json!({"a": 1}))
        );
        assert_eq!(cache.get("TW2", "sgp", Kind::Summary, "1").unwrap(), None);
        assert_eq!(cache.get("TW2", "lcu", Kind::Details, "1").unwrap(), None);
        assert_eq!(cache.get("KR", "sgp", Kind::Details, "1").unwrap(), None);
    }

    #[test]
    fn heads_round_trip_and_are_capped() {
        let mut cache = memory(MAX_BYTES);
        let ids: Vec<String> = (0..250).map(|n| n.to_string()).collect();
        cache.save_head("TW2", "p", "sgp", "", &ids, false).unwrap();
        let head = cache.head("TW2", "p", "sgp", "").unwrap().unwrap();
        assert_eq!(head.ids.len(), MAX_HEAD_IDS);
        assert_eq!(head.ids[0], "0");
        assert!(!head.complete);
        assert!(cache.head("TW2", "p", "sgp", "q_420").unwrap().is_none());
        cache
            .save_head("TW2", "p", "sgp", "", &["9".into()], true)
            .unwrap();
        let head = cache.head("TW2", "p", "sgp", "").unwrap().unwrap();
        assert_eq!(head.ids, ["9"]);
        assert!(head.complete);
    }

    #[test]
    fn idle_entries_are_dropped() {
        let mut cache = memory(MAX_BYTES);
        cache
            .put("TW2", "sgp", Kind::Summary, "1", &json!(1))
            .unwrap();
        cache
            .save_head("TW2", "p", "sgp", "", &["1".into()], false)
            .unwrap();
        cache.prune(now() + MAX_IDLE_SECS + 10).unwrap();
        assert_eq!(cache.get("TW2", "sgp", Kind::Summary, "1").unwrap(), None);
        assert!(cache.head("TW2", "p", "sgp", "").unwrap().is_none());
    }

    #[test]
    fn oversize_cache_drops_least_recently_used_games() {
        let mut cache = memory(1000);
        let big = json!("x".repeat(300));
        for (id, used) in [("old", 1), ("mid", 2), ("new", 3)] {
            cache.put("TW2", "sgp", Kind::Details, id, &big).unwrap();
            cache
                .connection
                .execute(
                    "UPDATE games SET used_at=?1 WHERE game_id=?2",
                    params![now() + used, id],
                )
                .unwrap();
        }
        cache.put("TW2", "sgp", Kind::Details, "x", &big).unwrap();
        cache
            .connection
            .execute("UPDATE games SET used_at=?1 WHERE game_id='x'", [now() + 4])
            .unwrap();
        cache.prune(now()).unwrap();
        let kept: Vec<String> = cache
            .connection
            .prepare("SELECT game_id FROM games ORDER BY used_at DESC")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(kept, ["x", "new"]);
    }
}
