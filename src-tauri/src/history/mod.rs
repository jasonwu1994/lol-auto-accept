use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

const MAX_IMPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_GAMES: usize = 10_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyExport {
    pub schema_version: u32,
    pub games: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub checksum: String,
    pub dry_run: bool,
    pub account_counts: BTreeMap<String, usize>,
}

struct Game {
    id: String,
    owner: String,
    creation: i64,
    payload: String,
}

pub struct HistoryStore {
    connection: Connection,
}

impl HistoryStore {
    pub fn open_with_legacy(directory: &Path, legacy_directory: &Path) -> AppResult<Self> {
        let destination = directory.join("history.sqlite3");
        let legacy = legacy_directory.join("history.sqlite3");
        if !destination.exists() && legacy.exists() {
            std::fs::create_dir_all(directory).map_err(|_| database_error())?;
            let source = Connection::open_with_flags(&legacy, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| database_error())?;
            source
                .busy_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| database_error())?;
            let snapshot = tempfile::NamedTempFile::new_in(directory)
                .map_err(|_| database_error())?
                .into_temp_path();
            // A SQLite snapshot includes committed WAL data without changing the old database.
            source
                .execute(
                    "VACUUM INTO ?1",
                    [snapshot.to_str().ok_or_else(database_error)?],
                )
                .map_err(|_| database_error())?;
            snapshot
                .persist_noclobber(&destination)
                .map_err(|_| database_error())?;
        }
        Self::open(directory)
    }

    pub fn open(directory: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(directory).map_err(|_| database_error())?;
        let connection =
            Connection::open(directory.join("history.sqlite3")).map_err(|_| database_error())?;
        Self::initialize(connection)
    }

    fn initialize(mut connection: Connection) -> AppResult<Self> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| database_error())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
            )
            .map_err(|_| database_error())?;
        let transaction = connection.transaction().map_err(|_| database_error())?;
        transaction.execute_batch("
            CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS games(game_id TEXT PRIMARY KEY,game_creation INTEGER NOT NULL,payload_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS owner_games(owner_puuid TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK(legacy_imported IN(0,1)),PRIMARY KEY(owner_puuid,game_id));
            CREATE TABLE IF NOT EXISTS legacy_imports(checksum TEXT PRIMARY KEY,record_count INTEGER NOT NULL);
            INSERT OR IGNORE INTO schema_migrations VALUES(1);").map_err(|_| database_error())?;
        let version: u32 = transaction
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .map_err(|_| database_error())?;
        if version > 2 {
            return Err(AppError::new(
                "Unsupported",
                "History schema is newer than this application",
            ));
        }
        let has_protection = {
            let mut columns = transaction
                .prepare("PRAGMA table_info(owner_games)")
                .map_err(|_| database_error())?;
            let names = columns
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|_| database_error())?;
            names
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| database_error())?
                .iter()
                .any(|name| name == "legacy_imported")
        };
        if !has_protection {
            transaction.execute("ALTER TABLE owner_games ADD COLUMN legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK(legacy_imported IN(0,1))",[]).map_err(|_| database_error())?;
            // Version 1 recorded imports without per-row provenance; preserve all
            // existing associations rather than guessing which rows were imported.
            transaction.execute("UPDATE owner_games SET legacy_imported=1 WHERE EXISTS(SELECT 1 FROM legacy_imports)",[]).map_err(|_| database_error())?;
        }
        transaction
            .execute("INSERT OR IGNORE INTO schema_migrations VALUES(2)", [])
            .map_err(|_| database_error())?;
        transaction.commit().map_err(|_| database_error())?;
        Ok(Self { connection })
    }

    pub fn save_games(&mut self, owner: &str, games: &[Value]) -> AppResult<usize> {
        validate_owner(owner)?;
        if games.len() > 100 {
            return Err(invalid("Too many games in one save"));
        }
        let records = games
            .iter()
            .map(|value| parse_game(value, Some(owner)))
            .collect::<AppResult<Vec<_>>>()?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| database_error())?;
        let mut inserted = 0;
        for game in &records {
            inserted += insert_game(&transaction, game, false)?;
        }
        transaction.commit().map_err(|_| database_error())?;
        Ok(inserted)
    }

    pub fn list_games(&self, owner: &str, limit: u32) -> AppResult<Vec<Value>> {
        validate_owner(owner)?;
        if !(1..=10_000).contains(&limit) {
            return Err(invalid("Invalid history limit"));
        }
        let mut statement = self.connection.prepare("SELECT g.game_id,g.game_creation,g.payload_json FROM games g JOIN owner_games o ON g.game_id=o.game_id WHERE o.owner_puuid=?1 ORDER BY g.game_creation DESC,g.game_id DESC LIMIT ?2").map_err(|_| database_error())?;
        let rows = statement
            .query_map(params![owner, limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| database_error())?;
        rows.map(|row| {
            let (id, creation, payload) = row.map_err(|_| database_error())?;
            let data: Value = serde_json::from_str(&payload).map_err(|_| database_error())?;
            Ok(json!({"_id":id,"timestamp":creation,"ownerPuuid":owner,"data":data}))
        })
        .collect()
    }

    pub fn existing_game_ids(&self, owner: &str, ids: &[String]) -> AppResult<HashSet<String>> {
        validate_owner(owner)?;
        if ids.len() > 100
            || ids.iter().any(|id| {
                id.is_empty()
                    || id.len() > 20
                    || !id.bytes().all(|byte| byte.is_ascii_digit())
                    || id.parse::<u64>().unwrap_or(0) == 0
            })
        {
            return Err(invalid("Invalid game membership query"));
        }
        let mut statement = self
            .connection
            .prepare("SELECT game_id FROM owner_games WHERE owner_puuid=?1 AND game_id=?2")
            .map_err(|_| database_error())?;
        let mut found = HashSet::new();
        for id in ids {
            if let Some(id) = statement
                .query_row(params![owner, id], |row| row.get::<_, String>(0))
                .optional()
                .map_err(|_| database_error())?
            {
                found.insert(id);
            }
        }
        Ok(found)
    }

    pub fn trim(&mut self, owner: &str, retain: u32) -> AppResult<usize> {
        validate_owner(owner)?;
        if retain > 10_000 {
            return Err(invalid("Invalid retention count"));
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| database_error())?;
        let deleted = transaction.execute("DELETE FROM owner_games WHERE owner_puuid=?1 AND legacy_imported=0 AND game_id IN (SELECT g.game_id FROM games g JOIN owner_games o ON g.game_id=o.game_id WHERE o.owner_puuid=?1 AND o.legacy_imported=0 ORDER BY g.game_creation DESC,g.game_id DESC LIMIT -1 OFFSET ?2)",params![owner,retain]).map_err(|_| database_error())?;
        transaction.execute("DELETE FROM games WHERE NOT EXISTS (SELECT 1 FROM owner_games o WHERE o.game_id=games.game_id)",[]).map_err(|_| database_error())?;
        transaction.commit().map_err(|_| database_error())?;
        Ok(deleted)
    }

    pub fn import_legacy(&mut self, source: &str, dry_run: bool) -> AppResult<ImportReport> {
        if source.len() > MAX_IMPORT_BYTES {
            return Err(invalid("Import exceeds 64 MiB"));
        }
        let export: LegacyExport =
            serde_json::from_str(source).map_err(|_| invalid("Invalid legacy export"))?;
        if export.schema_version != 1 || export.games.len() > MAX_GAMES {
            return Err(invalid("Unsupported export version or record count"));
        }
        let records = export
            .games
            .iter()
            .map(|game| parse_game(game, None))
            .collect::<AppResult<Vec<_>>>()?;
        let checksum = Sha256::digest(source.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let mut report = ImportReport {
            imported: 0,
            skipped: 0,
            failed: 0,
            checksum,
            dry_run,
            account_counts: BTreeMap::new(),
        };
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| database_error())?;
        for game in &records {
            let added = insert_game(&transaction, game, true)?;
            report.imported += added;
            report.skipped += 1 - added;
            *report.account_counts.entry(game.owner.clone()).or_default() += 1;
        }
        for (owner, count) in &mut report.account_counts {
            *count = transaction
                .query_row(
                    "SELECT count(*) FROM owner_games WHERE owner_puuid=?1",
                    [owner],
                    |row| row.get::<_, u32>(0),
                )
                .map_err(|_| database_error())? as usize;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO legacy_imports(checksum,record_count) VALUES(?1,?2)",
                params![report.checksum, records.len() as i64],
            )
            .map_err(|_| database_error())?;
        if dry_run {
            transaction.rollback().map_err(|_| database_error())?;
        } else {
            transaction.commit().map_err(|_| database_error())?;
        }
        Ok(report)
    }
}

fn parse_game(value: &Value, requested_owner: Option<&str>) -> AppResult<Game> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Game must be an object"))?;
    let owner = object
        .get("ownerPuuid")
        .and_then(Value::as_str)
        .or(requested_owner)
        .ok_or_else(|| invalid("Missing game owner"))?;
    validate_owner(owner)?;
    if requested_owner.is_some_and(|requested| owner != requested) {
        return Err(invalid("Game belongs to another account"));
    }
    let data = object
        .get("data")
        .filter(|data| data.is_object())
        .ok_or_else(|| invalid("Missing game payload"))?;
    let raw_id = data
        .get("gameId")
        .ok_or_else(|| invalid("Missing game ID"))?;
    let id = match raw_id {
        Value::String(id) => id.clone(),
        Value::Number(number) if number.is_u64() => number.to_string(),
        _ => return Err(invalid("Invalid game ID")),
    };
    if id.is_empty()
        || id.len() > 20
        || !id.bytes().all(|byte| byte.is_ascii_digit())
        || id.parse::<u64>().unwrap_or(0) == 0
    {
        return Err(invalid("Invalid game ID"));
    }
    if object
        .get("_id")
        .is_some_and(|legacy_id| legacy_id.as_str() != Some(&id))
    {
        return Err(invalid("Game IDs do not match"));
    }
    let creation = data
        .get("gameCreation")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(|| invalid("Missing game creation time"))?;
    let payload = canonical_payload(data.clone())?;
    if payload.len() > 1024 * 1024 {
        return Err(invalid("Game payload exceeds 1 MiB"));
    }
    Ok(Game {
        id,
        owner: owner.into(),
        creation,
        payload,
    })
}

fn canonical_payload(data: Value) -> AppResult<String> {
    serde_json::to_string(&crate::dto::public_value(data))
        .map_err(|_| invalid("Invalid game payload"))
}

fn insert_game(transaction: &Transaction<'_>, game: &Game, imported: bool) -> AppResult<usize> {
    let existing: Option<String> = transaction
        .query_row(
            "SELECT payload_json FROM games WHERE game_id=?1",
            [&game.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| database_error())?;
    if let Some(existing) = existing {
        let existing = serde_json::from_str(&existing).map_err(|_| database_error())?;
        if canonical_payload(existing)? != game.payload {
            return Err(invalid(
                "Conflicting payload for existing game; import rolled back",
            ));
        }
    }
    transaction
        .execute(
            "INSERT OR IGNORE INTO games(game_id,game_creation,payload_json) VALUES(?1,?2,?3)",
            params![game.id, game.creation, game.payload],
        )
        .map_err(|_| database_error())?;
    let inserted = transaction.execute(
        "INSERT OR IGNORE INTO owner_games(owner_puuid,game_id,legacy_imported) VALUES(?1,?2,?3)",
        params![game.owner, game.id, imported],
    ).map_err(|_| database_error())?;
    if imported {
        transaction.execute("UPDATE owner_games SET legacy_imported=1 WHERE owner_puuid=?1 AND game_id=?2 AND legacy_imported=0",params![game.owner,game.id]).map_err(|_| database_error())?;
    }
    Ok(inserted)
}

fn validate_owner(owner: &str) -> AppResult<()> {
    if owner.is_empty()
        || owner.len() > 128
        || !owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid("Invalid account ID"));
    }
    Ok(())
}
fn invalid(message: &str) -> AppError {
    AppError::new("InvalidInput", message)
}
fn database_error() -> AppError {
    AppError::new("Io", "History database operation failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> HistoryStore {
        HistoryStore::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn game(owner: &str, id: &str, time: i64) -> Value {
        json!({"_id":id,"ownerPuuid":owner,"data":{"gameId":id,"gameCreation":time,"participants":[]}})
    }
    fn export(games: Vec<Value>) -> String {
        json!({"schemaVersion":1,"games":games}).to_string()
    }
    #[test]
    fn new_history_directory_does_not_create_a_legacy_database() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("config/history");
        let legacy = root.path().join("local-data");
        let db = HistoryStore::open_with_legacy(&directory, &legacy).unwrap();
        assert!(db.list_games("a", 100).unwrap().is_empty());
        assert!(directory.join("history.sqlite3").is_file());
        assert!(!legacy.exists());
    }

    #[test]
    fn history_directory_migration_preserves_wal_accounts_and_import_protection() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("config/history");
        let legacy = root.path().join("local-data");
        let mut old = HistoryStore::open(&legacy).unwrap();
        old.connection
            .execute_batch("PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        let imported = export(vec![game("a", "1", 10)]);
        old.import_legacy(&imported, false).unwrap();
        old.save_games("b", &[game("b", "2", 20)]).unwrap();
        assert!(legacy.join("history.sqlite3-wal").metadata().unwrap().len() > 0);
        let old_bytes = std::fs::read(legacy.join("history.sqlite3")).unwrap();

        let mut migrated = HistoryStore::open_with_legacy(&directory, &legacy).unwrap();
        assert_eq!(migrated.list_games("a", 100).unwrap()[0]["_id"], "1");
        assert_eq!(migrated.list_games("b", 100).unwrap()[0]["_id"], "2");
        assert_eq!(
            migrated.import_legacy(&imported, false).unwrap().imported,
            0
        );
        migrated.save_games("a", &[game("a", "3", 30)]).unwrap();
        migrated.trim("a", 1).unwrap();
        assert_eq!(migrated.list_games("a", 100).unwrap().len(), 2);
        assert_eq!(old.list_games("a", 100).unwrap().len(), 1);
        assert_eq!(
            std::fs::read(legacy.join("history.sqlite3")).unwrap(),
            old_bytes
        );
        drop(migrated);
        let reopened = HistoryStore::open_with_legacy(&directory, &legacy).unwrap();
        assert_eq!(reopened.list_games("a", 100).unwrap().len(), 2);
    }

    #[test]
    fn existing_history_is_never_overwritten_by_legacy_data() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("config/history");
        let legacy = root.path().join("local-data");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("history.sqlite3"), b"corrupt old database").unwrap();
        {
            let mut current = HistoryStore::open(&directory).unwrap();
            current.save_games("a", &[game("a", "3", 30)]).unwrap();
        }
        let current = HistoryStore::open_with_legacy(&directory, &legacy).unwrap();
        assert_eq!(current.list_games("a", 100).unwrap()[0]["_id"], "3");
    }

    #[test]
    fn failed_history_migration_leaves_no_destination_and_can_retry() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("config/history");
        let legacy = root.path().join("local-data");
        std::fs::create_dir_all(&legacy).unwrap();
        let legacy_file = legacy.join("history.sqlite3");
        std::fs::write(&legacy_file, b"corrupt old database").unwrap();
        assert!(HistoryStore::open_with_legacy(&directory, &legacy).is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
        assert_eq!(
            std::fs::read(&legacy_file).unwrap(),
            b"corrupt old database"
        );
        std::fs::remove_file(&legacy_file).unwrap();
        {
            let mut old = HistoryStore::open(&legacy).unwrap();
            old.save_games("a", &[game("a", "1", 10)]).unwrap();
        }
        let migrated = HistoryStore::open_with_legacy(&directory, &legacy).unwrap();
        assert_eq!(migrated.list_games("a", 100).unwrap()[0]["_id"], "1");
    }

    #[test]
    fn dry_run_repeated_import_and_accounts() {
        let mut db = store();
        let source = export(vec![
            game("a", "1", 10),
            game("b", "1", 10),
            game("a", "1", 10),
        ]);
        assert_eq!(db.import_legacy(&source, true).unwrap().imported, 2);
        assert!(db.list_games("a", 100).unwrap().is_empty());
        assert_eq!(db.import_legacy(&source, false).unwrap().imported, 2);
        let repeated = db.import_legacy(&source, false).unwrap();
        assert_eq!((repeated.imported, repeated.skipped), (0, 3));
        assert_eq!(db.list_games("a", 100).unwrap().len(), 1);
        assert_eq!(db.list_games("b", 100).unwrap().len(), 1);
    }
    #[test]
    fn retention_uses_time_and_keeps_other_owners() {
        let mut db = store();
        db.save_games("a", &[game("a", "9", 20), game("a", "10", 10)])
            .unwrap();
        db.save_games("b", &[game("b", "10", 10)]).unwrap();
        assert_eq!(db.trim("a", 1).unwrap(), 1);
        assert_eq!(db.list_games("a", 100).unwrap()[0]["_id"], "9");
        assert_eq!(db.list_games("b", 100).unwrap()[0]["_id"], "10");
    }
    #[test]
    fn failed_transaction_has_no_partial_records() {
        let mut db = store();
        db.save_games("a", &[game("a", "1", 10)]).unwrap();
        let source = export(vec![game("a", "2", 20), game("a", "1", 99)]);
        assert!(db.import_legacy(&source, false).is_err());
        assert_eq!(db.list_games("a", 100).unwrap().len(), 1);
        assert_eq!(
            db.import_legacy(&export(vec![game("a", "2", 20)]), false)
                .unwrap()
                .imported,
            1
        );
    }
    #[test]
    fn rejects_corrupt_and_cross_account_data() {
        let mut db = store();
        assert!(db.import_legacy("broken", false).is_err());
        assert!(db.save_games("a", &[game("b", "1", 10)]).is_err());
        assert!(
            db.import_legacy(&export(vec![json!({"_id":"1"})]), false)
                .is_err()
        );
        assert!(db.list_games("a", 0).is_err());
        assert_eq!(
            db.import_legacy(&export(vec![]), false).unwrap().imported,
            0
        );
    }
    #[test]
    fn interrupted_transaction_rolls_back_on_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut db = HistoryStore::open(dir.path()).unwrap();
            let transaction = db.connection.transaction().unwrap();
            insert_game(
                &transaction,
                &parse_game(&game("a", "1", 10), None).unwrap(),
                false,
            )
            .unwrap();
        }
        let db = HistoryStore::open(dir.path()).unwrap();
        assert!(db.list_games("a", 100).unwrap().is_empty());
    }

    #[test]
    fn numeric_legacy_and_string_frontend_ids_share_games_without_precision_loss() {
        let raw: Value = serde_json::from_str(r#"{"_id":"18446744073709551615","ownerPuuid":"a","data":{"gameId":18446744073709551615,"gameCreation":10,"participantIdentities":[{"player":{"summonerId":9007199254740993,"accountId":9007199254740995}}],"participants":[{"championId":1,"teamParticipantId":2}]}}"#).unwrap();
        let mut frontend = crate::dto::public_value(raw.clone());
        frontend["ownerPuuid"] = json!("b");
        for (first, second) in [
            (raw.clone(), frontend.clone()),
            (frontend.clone(), raw.clone()),
        ] {
            let mut db = store();
            assert_eq!(
                db.import_legacy(&export(vec![first.clone()]), false)
                    .unwrap()
                    .imported,
                1
            );
            assert_eq!(
                db.save_games(
                    second["ownerPuuid"].as_str().unwrap(),
                    std::slice::from_ref(&second)
                )
                .unwrap(),
                1
            );
            assert_eq!(
                db.import_legacy(&export(vec![first]), false)
                    .unwrap()
                    .skipped,
                1
            );
            let games = db.list_games("b", 100).unwrap();
            assert_eq!(games[0]["data"]["gameId"], "18446744073709551615");
            assert_eq!(
                games[0]["data"]["participantIdentities"][0]["player"]["summonerId"],
                "9007199254740993"
            );
            assert_eq!(games[0]["data"]["participants"][0]["championId"], 1);
            assert_eq!(games[0]["data"]["participants"][0]["teamParticipantId"], 2);
        }
    }

    #[test]
    fn existing_numeric_rows_are_compared_canonically_without_rewriting_payload() {
        let mut db = store();
        let raw = json!({"gameId":1,"gameCreation":10,"summonerId":9007199254740993u64,"wins":7});
        let original = raw.to_string();
        db.connection
            .execute(
                "INSERT INTO games VALUES(?1,?2,?3)",
                params!["1", 10, original],
            )
            .unwrap();
        db.connection
            .execute(
                "INSERT INTO owner_games(owner_puuid,game_id) VALUES('a','1')",
                [],
            )
            .unwrap();
        let incoming = json!({"_id":"1","ownerPuuid":"b","data":crate::dto::public_value(raw)});
        assert_eq!(
            db.save_games("b", std::slice::from_ref(&incoming)).unwrap(),
            1
        );
        let stored: String = db
            .connection
            .query_row(
                "SELECT payload_json FROM games WHERE game_id='1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, original);
        let mut changed = incoming;
        changed["data"]["wins"] = json!(8);
        assert!(db.save_games("b", &[changed]).is_err());
    }

    #[test]
    fn imported_history_survives_lookup_retention_while_new_cache_is_bounded() {
        let mut db = store();
        let imported: Vec<_> = (1..=260).map(|id| game("a", &id.to_string(), id)).collect();
        db.import_legacy(&export(imported.clone()), false).unwrap();
        assert_eq!(db.trim("a", 20).unwrap(), 0);
        assert_eq!(db.list_games("a", 1000).unwrap().len(), 260);
        db.save_games("a", &imported[..1]).unwrap();
        assert_eq!(db.trim("a", 0).unwrap(), 0);
        let cache: Vec<_> = (1000..=1020)
            .map(|id| game("a", &id.to_string(), id))
            .collect();
        db.save_games("a", &cache).unwrap();
        assert_eq!(db.trim("a", 20).unwrap(), 1);
        assert_eq!(db.list_games("a", 1000).unwrap().len(), 280);
        assert_eq!(db.list_games("a", 20).unwrap().len(), 20);
        assert_eq!(db.list_games("a", 20).unwrap()[0]["_id"], "1020");
        db.save_games("b", &[game("b", "1", 1)]).unwrap();
        assert_eq!(db.trim("b", 0).unwrap(), 1);
        assert!(db.list_games("b", 1000).unwrap().is_empty());
        assert_eq!(db.list_games("a", 1000).unwrap().len(), 280);
        assert_eq!(db.trim("a", 0).unwrap(), 20);
        assert_eq!(db.list_games("a", 1000).unwrap().len(), 260);
    }

    #[test]
    fn import_protects_existing_cache_but_dry_run_does_not() {
        let mut db = store();
        db.save_games("a", &[game("a", "1", 1), game("a", "2", 2)])
            .unwrap();
        db.import_legacy(&export(vec![game("a", "1", 1)]), true)
            .unwrap();
        let applied = db
            .import_legacy(&export(vec![game("a", "2", 2)]), false)
            .unwrap();
        assert_eq!((applied.imported, applied.skipped), (0, 1));
        assert_eq!(db.trim("a", 0).unwrap(), 1);
        assert_eq!(db.list_games("a", 100).unwrap()[0]["_id"], "2");
        db.save_games("a", &[game("a", "2", 2)]).unwrap();
        assert_eq!(db.trim("a", 0).unwrap(), 0);
    }

    #[test]
    fn version_one_upgrade_preserves_unknown_import_provenance_and_reopens() {
        for previously_imported in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let connection = Connection::open(directory.path().join("history.sqlite3")).unwrap();
            connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(1);
              CREATE TABLE games(game_id TEXT PRIMARY KEY,game_creation INTEGER NOT NULL,payload_json TEXT NOT NULL);
              CREATE TABLE owner_games(owner_puuid TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,PRIMARY KEY(owner_puuid,game_id));
              CREATE TABLE legacy_imports(checksum TEXT PRIMARY KEY,record_count INTEGER NOT NULL);").unwrap();
            connection
                .execute(
                    "INSERT INTO games VALUES('1',1,?1)",
                    [game("a", "1", 1)["data"].to_string()],
                )
                .unwrap();
            connection.execute_batch("INSERT INTO owner_games VALUES('a','1');INSERT INTO owner_games VALUES('b','1');").unwrap();
            if previously_imported {
                connection
                    .execute(
                        "INSERT INTO legacy_imports VALUES('fixture-checksum',1)",
                        [],
                    )
                    .unwrap();
            }
            drop(connection);
            let mut db = HistoryStore::open(directory.path()).unwrap();
            assert_eq!(db.trim("a", 0).unwrap(), usize::from(!previously_imported));
            assert_eq!(
                db.list_games("a", 100).unwrap().len(),
                usize::from(previously_imported)
            );
            assert_eq!(db.list_games("b", 100).unwrap().len(), 1);
            drop(db);
            let mut reopened = HistoryStore::open(directory.path()).unwrap();
            assert_eq!(
                reopened.trim("b", 0).unwrap(),
                usize::from(!previously_imported)
            );
            let version: u32 = reopened
                .connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(version, 2);
            assert_eq!(
                reopened.list_games("a", 100).unwrap().len(),
                usize::from(previously_imported)
            );
        }
    }

    #[test]
    fn membership_queries_are_bounded_deduplicated_and_owner_scoped() {
        let mut db = store();
        db.save_games("a", &[game("a", "1", 1)]).unwrap();
        let ids = vec!["1".into(), "1".into(), "2".into()];
        assert_eq!(
            db.existing_game_ids("a", &ids).unwrap(),
            HashSet::from(["1".into()])
        );
        assert!(db.existing_game_ids("b", &ids).unwrap().is_empty());
        assert!(db.existing_game_ids("a", &[]).unwrap().is_empty());
        for invalid_id in ["0", "../1", "18446744073709551616"] {
            assert!(db.existing_game_ids("a", &[invalid_id.into()]).is_err());
        }
        assert!(db.existing_game_ids("a", &vec!["1".into(); 101]).is_err());
        assert!(db.existing_game_ids("", &ids).is_err());
    }
}
