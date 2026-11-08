mod discovery;
mod transport;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, broadcast, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::{
    automation,
    error::{AppError, AppResult},
};
use transport::Transport;

pub use discovery::legacy_app_running;

#[derive(Clone, Debug)]
pub enum ReadOperation {
    Gameflow,
    Phase,
    ChampSelect,
    CurrentSummoner,
    LobbyMembers,
    PickableChampions,
    SummonersById(String),
    SummonerByPuuid(String),
    RankedByPuuid(String),
    Matches { begin: u32, end: u32 },
    PlayerMatches { puuid: String, count: u32 },
    HistoryGame(String),
}

pub fn validate_identifier(value: &str) -> AppResult<()> {
    if value == "."
        || value == ".."
        || value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'@' | b'.'))
    {
        return Err(AppError::new(
            "InvalidInput",
            "Identifier contains invalid characters",
        ));
    }
    Ok(())
}

fn numeric_id(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|b| b.is_ascii_digit())
        || value.parse::<u64>().is_err()
    {
        return Err(AppError::new(
            "InvalidInput",
            "A numeric identifier is required",
        ));
    }
    Ok(())
}

impl ReadOperation {
    fn path(&self) -> AppResult<String> {
        Ok(match self {
            Self::Gameflow => "/lol-gameflow/v1/session".into(),
            Self::Phase => "/lol-gameflow/v1/gameflow-phase".into(),
            Self::ChampSelect => "/lol-champ-select/v1/session".into(),
            Self::CurrentSummoner => "/lol-summoner/v1/current-summoner".into(),
            Self::LobbyMembers => "/lol-lobby/v2/comms/members".into(),
            Self::PickableChampions => "/lol-champ-select/v1/pickable-champion-ids".into(),
            Self::SummonersById(id) => {
                numeric_id(id)?;
                format!("/lol-summoner/v2/summoners?ids=%5B{id}%5D")
            }
            Self::SummonerByPuuid(id) => {
                validate_identifier(id)?;
                format!("/lol-summoner/v2/summoners/puuid/{id}")
            }
            Self::RankedByPuuid(id) => {
                validate_identifier(id)?;
                format!("/lol-ranked/v1/ranked-stats/{id}")
            }
            Self::HistoryGame(id) => {
                numeric_id(id)?;
                format!("/lol-match-history/v1/games/{id}")
            }
            Self::PlayerMatches { puuid, count } => {
                validate_identifier(puuid)?;
                if !(1..=10).contains(count) {
                    return Err(AppError::new(
                        "InvalidInput",
                        "History count is out of range",
                    ));
                }
                let end = count - 1;
                format!(
                    "/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex={end}"
                )
            }
            Self::Matches { begin, end } => {
                if end < begin || end - begin >= 100 || *end > 1000 {
                    return Err(AppError::new(
                        "InvalidInput",
                        "History page is out of range",
                    ));
                }
                format!(
                    "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex={begin}&endIndex={end}"
                )
            }
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcuSnapshot {
    pub connection: String,
    pub generation: u64,
    pub revision: u64,
    pub session_key: String,
    pub phase: String,
    pub gameflow: Value,
    pub champ_select: Value,
    pub current_summoner: Value,
    pub lobby_members: Value,
    pub aram_preferences: Vec<u32>,
    pub aram_revision: u64,
    pub automation_blocked: Option<String>,
    pub last_operation: Option<OperationResult>,
}

impl Default for LcuSnapshot {
    fn default() -> Self {
        Self {
            connection: "Disconnected".into(),
            generation: 0,
            revision: 0,
            session_key: String::new(),
            phase: "None".into(),
            gameflow: Value::Null,
            champ_select: Value::Null,
            current_summoner: Value::Null,
            lobby_members: Value::Null,
            aram_preferences: Vec::new(),
            aram_revision: 0,
            automation_blocked: None,
            last_operation: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub revision: u64,
    pub operation: String,
    pub status: String,
    pub message: String,
}

type CachedRead = Arc<Mutex<Option<(Instant, AppResult<Value>)>>>;

/// How often a live connection re-checks the client process and re-reads its state.
const CLIENT_POLL: Duration = if cfg!(test) {
    Duration::from_secs(60)
} else {
    Duration::from_secs(2)
};
/// Delay before re-reading after a snapshot attempt that did not complete.
const REFRESH_RETRY: Duration = Duration::from_millis(300);

struct State {
    snapshot: LcuSnapshot,
    transport: Option<Arc<Transport>>,
    session: CancellationToken,
    sequence: u64,
    ledger: HashSet<String>,
    ready_claimed: bool,
    hovercard: Option<String>,
    account: Option<String>,
    preparations: HashMap<String, (u8, Instant)>,
    observed_events: HashMap<String, Value>,
    read_cache: HashMap<String, CachedRead>,
}

pub struct LcuService {
    state: Mutex<State>,
    events: broadcast::Sender<LcuSnapshot>,
    changes: watch::Sender<u64>,
    config: watch::Sender<Value>,
    source_config: OnceLock<watch::Receiver<Value>>,
    write_gate: Mutex<()>,
    read_only: bool,
    data: OnceLock<DataSources>,
    #[cfg(test)]
    fixture_writes: bool,
    #[cfg(test)]
    fixture_legacy: std::sync::atomic::AtomicBool,
}

struct DataSources {
    history: Arc<std::sync::Mutex<crate::history::HistoryStore>>,
    external: Arc<crate::external::ExternalData>,
}

impl LcuService {
    pub fn new() -> AppResult<Arc<Self>> {
        let (events, _) = broadcast::channel(64);
        let (changes, _) = watch::channel(0);
        let (config, _) = watch::channel(Value::Null);
        Ok(Arc::new(Self {
            state: Mutex::new(State {
                snapshot: LcuSnapshot::default(),
                transport: None,
                session: CancellationToken::new(),
                sequence: 0,
                ledger: HashSet::new(),
                ready_claimed: false,
                hovercard: None,
                account: None,
                preparations: HashMap::new(),
                observed_events: HashMap::new(),
                read_cache: HashMap::new(),
            }),
            events,
            changes,
            config,
            source_config: OnceLock::new(),
            write_gate: Mutex::new(()),
            read_only: std::env::var("LOL_APP_READ_ONLY").as_deref() == Ok("1"),
            data: OnceLock::new(),
            #[cfg(test)]
            fixture_writes: false,
            #[cfg(test)]
            fixture_legacy: std::sync::atomic::AtomicBool::new(false),
        }))
    }

    pub fn configure_data_sources(
        &self,
        history: Arc<std::sync::Mutex<crate::history::HistoryStore>>,
        external: Arc<crate::external::ExternalData>,
    ) -> AppResult<()> {
        self.data
            .set(DataSources { history, external })
            .map_err(|_| AppError::new("Internal", "Data sources are already configured"))
    }

    pub(crate) async fn recent_games(
        &self,
        snapshot: &LcuSnapshot,
        count: u32,
    ) -> AppResult<(Vec<Value>, Value)> {
        let saved = self.sync_recent_history(snapshot, count).await?;
        let sources = self
            .data
            .get()
            .ok_or_else(|| AppError::new("Internal", "History storage is unavailable"))?;
        let locale = if self.config.borrow()["language"] == "en" {
            "en_US"
        } else {
            "zh_TW"
        };
        let champions = sources.external.champions(locale).await?;
        Ok((saved, champions))
    }

    async fn sync_recent_history(
        &self,
        snapshot: &LcuSnapshot,
        count: u32,
    ) -> AppResult<Vec<Value>> {
        let sources = self
            .data
            .get()
            .ok_or_else(|| AppError::new("Internal", "History storage is unavailable"))?;
        let owner = snapshot.current_summoner["puuid"]
            .as_str()
            .ok_or_else(|| AppError::new("Disconnected", "No authenticated player"))?;
        let matches = self
            .query(ReadOperation::Matches {
                begin: 0,
                end: count - 1,
            })
            .await?;
        let games = matches
            .pointer("/games/games")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::new("InvalidInput", "Invalid match history"))?;
        let game_ids: Vec<String> = games
            .iter()
            .map(|game| automation::value_text(&game["gameId"]))
            .collect();
        let mut known = {
            let history = sources
                .history
                .lock()
                .map_err(|_| AppError::new("Internal", "History storage lock failed"))?;
            history.existing_game_ids(owner, &game_ids)?
        };
        let mut saved = Vec::with_capacity(game_ids.len());
        for id in game_ids {
            if !known.insert(id.clone()) {
                continue;
            }
            let game = self.query(ReadOperation::HistoryGame(id)).await?;
            saved.push(serde_json::json!({"_id": automation::value_text(&game["gameId"]), "timestamp": game["gameCreation"], "ownerPuuid": owner, "data": game}));
        }
        self.checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        let saved = {
            let mut history = sources
                .history
                .lock()
                .map_err(|_| AppError::new("Internal", "History storage lock failed"))?;
            history.save_games(owner, &saved)?;
            history.trim(owner, count)?;
            history.list_games(owner, count)?
        };
        Ok(saved)
    }

    pub async fn snapshot(&self) -> LcuSnapshot {
        self.state.lock().await.snapshot.clone()
    }
    pub fn subscribe(&self) -> broadcast::Receiver<LcuSnapshot> {
        self.events.subscribe()
    }

    fn publish(&self, state: &mut State) {
        state.snapshot.revision += 1;
        let _ = self.events.send(state.snapshot.clone());
        self.changes.send_replace(state.snapshot.revision);
    }

    fn replace_session(state: &mut State) {
        state.session.cancel();
        state.read_cache.clear();
        state.session = CancellationToken::new();
        state.sequence += 1;
        state.snapshot.session_key = format!("{}:{}", state.snapshot.generation, state.sequence);
        state.snapshot.aram_preferences.clear();
    }

    async fn disconnected(&self, connection: &str) {
        let mut state = self.state.lock().await;
        if state.snapshot.connection == connection
            && state.transport.is_none()
            && state.snapshot.phase == "None"
            && state.snapshot.champ_select.is_null()
            && state.snapshot.gameflow.is_null()
            && state.snapshot.current_summoner.is_null()
            && state.snapshot.lobby_members.is_null()
            && state.snapshot.aram_preferences.is_empty()
        {
            return;
        }
        if let Some(transport) = state.transport.take() {
            transport.cancel.cancel();
        }
        Self::replace_session(&mut state);
        state.snapshot.connection = connection.into();
        state.snapshot.phase = "None".into();
        state.snapshot.gameflow = Value::Null;
        state.snapshot.champ_select = Value::Null;
        state.snapshot.current_summoner = Value::Null;
        state.snapshot.lobby_members = Value::Null;
        self.publish(&mut state);
    }

    pub async fn query(&self, operation: ReadOperation) -> AppResult<Value> {
        // Display lookups can overlap UI and summary work. Action preflights and
        // live snapshot resources deliberately continue to read the transport.
        let ttl = match &operation {
            ReadOperation::SummonersById(_) | ReadOperation::SummonerByPuuid(_) => {
                Some(Duration::from_secs(120))
            }
            ReadOperation::RankedByPuuid(_) => Some(Duration::from_secs(30)),
            _ => None,
        };
        let path = operation.path()?;
        let (transport, token, cached) = {
            let mut state = self.state.lock().await;
            let transport = state
                .transport
                .clone()
                .ok_or_else(|| AppError::new("Disconnected", "League client is not connected"))?;
            let cached = ttl.map(|_| {
                // Only evict idle entries: an active lookup must keep its shared
                // lock so another caller cannot start a duplicate request.
                if state.read_cache.len() >= 128 && !state.read_cache.contains_key(&path) {
                    state
                        .read_cache
                        .retain(|_, entry| Arc::strong_count(entry) > 1);
                }
                if state.read_cache.len() < 128 || state.read_cache.contains_key(&path) {
                    state.read_cache.entry(path).or_default().clone()
                } else {
                    Arc::default()
                }
            });
            (transport, state.session.clone(), cached)
        };
        tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "The client session has changed")),
            result = async {
                if let (Some(entry), Some(ttl)) = (cached, ttl) {
                    let mut cached = entry.lock().await;
                    if let Some((expires, value)) = &*cached
                        && *expires > Instant::now()
                    {
                        return value.clone();
                    }
                    let result = transport.read(operation).await;
                    let ttl = if result.is_ok() { ttl } else { Duration::from_secs(1) };
                    *cached = Some((Instant::now() + ttl, result.clone()));
                    result
                } else {
                    transport.read(operation).await
                }
            } => {
                if token.is_cancelled() {
                    Err(AppError::new("StaleSession", "The client session has changed"))
                } else {
                    result
                }
            },
        }
    }

    async fn checked_session(
        &self,
        generation: u64,
        session_key: &str,
    ) -> AppResult<(Arc<Transport>, CancellationToken)> {
        let state = self.state.lock().await;
        if state.snapshot.generation != generation || state.snapshot.session_key != session_key {
            return Err(AppError::new(
                "StaleSession",
                "The client session has changed",
            ));
        }
        if state.snapshot.connection != "Connected" {
            return Err(AppError::new(
                "Disconnected",
                "League client is not connected",
            ));
        }
        if let Some(reason) = &state.snapshot.automation_blocked {
            return Err(AppError::new("Unsupported", reason));
        }
        Ok((
            state
                .transport
                .clone()
                .ok_or_else(|| AppError::new("Disconnected", "League client is not connected"))?,
            state.session.clone(),
        ))
    }

    async fn check_write_gate(&self) -> AppResult<()> {
        #[cfg(test)]
        if self.fixture_writes {
            if self
                .fixture_legacy
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                self.block_for_legacy().await;
                return Err(AppError::new(
                    "Unsupported",
                    "Close the previous Electron application before using automation",
                ));
            }
            return Ok(());
        }
        if self.read_only {
            return Err(AppError::new(
                "Unsupported",
                "Read-only validation mode is active",
            ));
        }
        let legacy = tokio::task::spawn_blocking(legacy_app_running)
            .await
            .map_err(|_| AppError::new("Internal", "Could not verify running applications"))?;
        if legacy {
            self.block_for_legacy().await;
            return Err(AppError::new(
                "Unsupported",
                "Close the previous Electron application before using automation",
            ));
        }
        Ok(())
    }

    async fn block_for_legacy(&self) {
        let mut state = self.state.lock().await;
        let reason = "Close the previous Electron application before using automation";
        if state.snapshot.automation_blocked.as_deref() != Some(reason) {
            Self::replace_session(&mut state);
            state.snapshot.automation_blocked = Some(reason.into());
            self.publish(&mut state);
        }
    }

    fn check_settings(&self, expected: Option<&Value>) -> AppResult<()> {
        let Some(expected) = expected else {
            return Ok(());
        };
        let current = if let Some(source) = self.source_config.get() {
            source.borrow().clone()
        } else {
            self.config.borrow().clone()
        };
        if &current != expected {
            return Err(AppError::new(
                "StaleSession",
                "Automation settings have changed",
            ));
        }
        Ok(())
    }

    pub async fn respond_ready_check(
        &self,
        accept: bool,
        generation: u64,
        session_key: &str,
    ) -> AppResult<Value> {
        self.ready_response(accept, generation, session_key, None)
            .await
    }

    async fn ready_response(
        &self,
        accept: bool,
        generation: u64,
        session_key: &str,
        settings: Option<&Value>,
    ) -> AppResult<Value> {
        let _gate = if settings.is_some() {
            self.write_gate.lock().await
        } else {
            self.write_gate
                .try_lock()
                .map_err(|_| AppError::new("Busy", "Another operation is still in progress"))?
        };
        self.check_write_gate().await?;
        let (transport, token) = self.checked_session(generation, session_key).await?;
        {
            let state = self.state.lock().await;
            if settings.is_some() && state.ready_claimed {
                return Err(AppError::new(
                    "StaleSession",
                    "This ready check has already been handled",
                ));
            }
        }
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "The ready check has ended")),
            result = async {
                if transport.read(ReadOperation::Phase).await? != "ReadyCheck" { return Err(AppError::new("StaleSession", "There is no current ready check")); }
                self.check_write_gate().await?;
                self.checked_session(generation, session_key).await?;
                {
                    let mut state = self.state.lock().await;
                    self.check_settings(settings)?;
                    if state.snapshot.generation != generation || state.snapshot.session_key != session_key || state.snapshot.phase != "ReadyCheck" || token.is_cancelled() {
                        return Err(AppError::new("StaleSession", "The ready check has ended"));
                    }
                    if settings.is_some() && state.ready_claimed { return Err(AppError::new("StaleSession", "This ready check has already been handled")); }
                    state.ready_claimed = true;
                }
                transport.ready(accept).await
            } => result,
        };
        self.record_result(
            if settings.is_some() {
                "autoAccept"
            } else {
                "readyCheck"
            },
            &result,
            generation,
            session_key,
        )
        .await;
        result
    }

    pub async fn swap_bench(
        &self,
        champion_id: u32,
        generation: u64,
        session_key: &str,
    ) -> AppResult<Value> {
        if champion_id == 0 || champion_id > 10000 {
            return Err(AppError::new("InvalidInput", "Invalid champion selection"));
        }
        let _gate = self
            .write_gate
            .try_lock()
            .map_err(|_| AppError::new("Busy", "Another operation is still in progress"))?;
        self.check_write_gate().await?;
        let (transport, token) = self.checked_session(generation, session_key).await?;
        let snapshot = self.snapshot().await;
        if snapshot.phase != "ChampSelect" {
            return Err(AppError::new(
                "StaleSession",
                "Champion selection has ended",
            ));
        }
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "Champion selection ended")),
            result = async {
                if transport.read(ReadOperation::Phase).await? != "ChampSelect" {
                    return Err(AppError::new("StaleSession", "Champion selection has ended"));
                }
                let live = transport.read(ReadOperation::ChampSelect).await?;
                if live["benchEnabled"] != true
                    || !live["benchChampions"].as_array().is_some_and(|bench| {
                        bench.iter().any(|champion| champion["championId"] == champion_id)
                    })
                    || live.pointer("/chatDetails/multiUserChatId")
                        != snapshot.champ_select.pointer("/chatDetails/multiUserChatId")
                {
                    return Err(AppError::new("StaleSession", "Bench availability changed"));
                }
                let pickable = transport.read(ReadOperation::PickableChampions).await?;
                if !pickable.as_array().is_some_and(|ids| ids.iter().any(|id| *id == champion_id)) {
                    return Err(AppError::new("Unavailable", "Champion cannot be selected"));
                }
                self.check_write_gate().await?;
                self.checked_session(generation, session_key).await?;
                {
                    let mut state = self.state.lock().await;
                    if token.is_cancelled() || state.snapshot.generation != generation
                        || state.snapshot.session_key != session_key || state.snapshot.phase != "ChampSelect"
                        || state.snapshot.aram_revision != snapshot.aram_revision
                        || state.snapshot.champ_select["benchEnabled"] != true
                        || !state.snapshot.champ_select["benchChampions"].as_array().is_some_and(|bench| {
                            bench.iter().any(|champion| champion["championId"] == champion_id)
                        })
                    {
                        return Err(AppError::new("StaleSession", "Champion selection has changed"));
                    }
                    // Suppress a queued automatic attempt after an uncertain manual POST.
                    // Explicit manual choices do not consult this automation ledger.
                    let room = snapshot.champ_select.pointer("/chatDetails/multiUserChatId")
                        .and_then(Value::as_str).unwrap_or(session_key);
                    state.ledger.insert(format!("swap:{room}:{champion_id}"));
                    state.snapshot.aram_preferences.clear();
                    state.snapshot.aram_revision += 1;
                    self.publish(&mut state);
                }
                transport.swap(champion_id).await
            } => result,
        };
        self.record_result("manualBenchSwap", &result, generation, session_key)
            .await;
        result
    }

    pub async fn set_aram_preferences(
        &self,
        ids: Vec<u32>,
        generation: u64,
        session_key: &str,
    ) -> AppResult<Vec<u32>> {
        if ids.len() > 200 || ids.iter().any(|id| *id == 0 || *id > 10000) {
            return Err(AppError::new("InvalidInput", "Invalid champion selection"));
        }
        let mut state = self.state.lock().await;
        if state.snapshot.generation != generation
            || state.snapshot.session_key != session_key
            || state.snapshot.phase != "ChampSelect"
            || state.snapshot.connection != "Connected"
        {
            return Err(AppError::new(
                "StaleSession",
                "Champion selection has changed",
            ));
        }
        let mut seen = HashSet::new();
        state.snapshot.aram_preferences = ids.into_iter().filter(|id| seen.insert(*id)).collect();
        state.snapshot.aram_revision += 1;
        self.publish(&mut state);
        Ok(state.snapshot.aram_preferences.clone())
    }

    pub async fn set_hovercard(
        &self,
        queue: &str,
        tier: &str,
        generation: u64,
        session_key: &str,
    ) -> AppResult<Value> {
        self.hovercard_response(queue, tier, generation, session_key, None)
            .await
    }

    async fn hovercard_response(
        &self,
        queue: &str,
        tier: &str,
        generation: u64,
        session_key: &str,
        settings: Option<&Value>,
    ) -> AppResult<Value> {
        automation::validate_hovercard(queue, tier)?;
        let _gate = self.write_gate.lock().await;
        self.check_write_gate().await?;
        let (transport, token) = self.checked_session(generation, session_key).await?;
        {
            let mut state = self.state.lock().await;
            self.check_settings(settings)?;
            if state.snapshot.generation != generation
                || state.snapshot.session_key != session_key
                || token.is_cancelled()
            {
                return Err(AppError::new(
                    "StaleSession",
                    "The client session has changed",
                ));
            }
            let owner = state.snapshot.current_summoner["puuid"]
                .as_str()
                .unwrap_or("");
            let key = format!("hovercard:{generation}:{owner}:{queue}:{tier}");
            if state.hovercard.as_ref() == Some(&key) {
                return Ok(Value::Null);
            }
            state.hovercard = Some(key);
        }
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "The client session has changed")),
            result = transport.hovercard(queue, tier) => result,
        };
        self.record_result(
            if settings.is_some() {
                "autoHovercard"
            } else {
                "hovercard"
            },
            &result,
            generation,
            session_key,
        )
        .await;
        result
    }

    pub(crate) async fn record_result(
        &self,
        operation: &str,
        result: &AppResult<Value>,
        generation: u64,
        session_key: &str,
    ) {
        let mut state = self.state.lock().await;
        if state.snapshot.generation != generation || state.snapshot.session_key != session_key {
            return;
        }
        state.snapshot.last_operation = Some(OperationResult {
            revision: state.snapshot.revision + 1,
            operation: operation.into(),
            status: if result.is_ok() {
                "Succeeded"
            } else {
                "FailedOrUnknown"
            }
            .into(),
            message: if result.is_ok() {
                "Operation completed".into()
            } else {
                "Operation did not complete with a confirmed result; it will not be retried automatically".into()
            },
        });
        self.publish(&mut state);
    }

    pub async fn run(
        self: Arc<Self>,
        mut config: watch::Receiver<Value>,
        shutdown: CancellationToken,
    ) {
        let _ = self.source_config.set(config.clone());
        self.config.send_replace(config.borrow().clone());
        let worker = self.clone();
        let automation_stop = shutdown.child_token();
        let automation = tokio::spawn(async move {
            worker.run_automation(automation_stop).await;
        });
        let relay_service = self.clone();
        let relay_stop = shutdown.child_token();
        let relay = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = relay_stop.cancelled() => break,
                    result = config.changed() => {
                        if result.is_err() { break; }
                        relay_service.config.send_replace(config.borrow().clone());
                    }
                }
            }
        });
        let mut failures = 0u32;
        self.disconnected("Discovering").await;
        loop {
            if shutdown.is_cancelled() {
                break;
            }
            let discovered = tokio::task::spawn_blocking(discovery::discover).await;
            if let Ok(Ok(Some(credentials))) = discovered {
                let cancel = shutdown.child_token();
                if let Ok(transport) = Transport::new(credentials, cancel) {
                    let transport = Arc::new(transport);
                    {
                        let mut state = self.state.lock().await;
                        state.snapshot.generation += 1;
                        state.snapshot.connection = "Connecting".into();
                        state.transport = Some(transport.clone());
                        Self::replace_session(&mut state);
                        self.publish(&mut state);
                    }
                    let mut established = false;
                    let result = self.connected(transport, &shutdown, &mut established).await;
                    // Backoff is for clients that cannot be reached, not for one that
                    // worked and later went away.
                    failures = if result.is_ok() || established {
                        0
                    } else {
                        failures.saturating_add(1)
                    };
                }
            }
            self.disconnected(if failures == 0 {
                "Disconnected"
            } else {
                "Reconnecting"
            })
            .await;
            let backoff = (2000u64.saturating_mul(1 << failures.min(4))).min(8000);
            let jitter = (std::process::id() as u64 * 37 + failures as u64 * 71) % 251;
            tokio::select! {
                _ = shutdown.cancelled() => break,
                _ = tokio::time::sleep(Duration::from_millis(backoff + jitter)) => {},
            }
        }
        shutdown.cancel();
        let _ = automation.await;
        let _ = relay.await;
        self.disconnected("ShuttingDown").await;
    }

    fn invalidate_state(&self, state: &mut State) {
        if state.transport.is_none() {
            return;
        }
        Self::replace_session(state);
        state.snapshot.connection = "Connecting".into();
        state.snapshot.phase = "None".into();
        state.snapshot.champ_select = Value::Null;
        state.snapshot.gameflow = Value::Null;
        state.snapshot.current_summoner = Value::Null;
        state.snapshot.lobby_members = Value::Null;
        self.publish(state);
    }

    async fn invalidate(&self) {
        let mut state = self.state.lock().await;
        self.invalidate_state(&mut state);
    }

    async fn invalidate_event(&self, event: &Value) {
        let mut state = self.state.lock().await;
        let topic = event["topic"].as_str().unwrap_or("");
        let data = &event["data"];
        let (key, observed, fallback) = if topic.ends_with("gameflow-phase") {
            (
                "phase",
                data.clone(),
                Value::String(state.snapshot.phase.clone()),
            )
        } else if topic.ends_with("current-summoner") {
            (
                "account",
                data["puuid"].clone(),
                state.snapshot.current_summoner["puuid"].clone(),
            )
        } else if topic.ends_with("v1_session") {
            (
                "room",
                data.pointer("/chatDetails/multiUserChatId")
                    .cloned()
                    .unwrap_or(Value::Null),
                state
                    .snapshot
                    .champ_select
                    .pointer("/chatDetails/multiUserChatId")
                    .cloned()
                    .unwrap_or(Value::Null),
            )
        } else if event["eventType"] == "Delete" {
            ("lobby", Value::Null, state.snapshot.lobby_members.clone())
        } else {
            return;
        };
        let observed = if event["eventType"] == "Delete" {
            Value::Null
        } else {
            observed
        };
        let changed = event["eventType"] == "Delete"
            || state.observed_events.get(key).unwrap_or(&fallback) != &observed;
        state.observed_events.insert(key.into(), observed);
        if changed {
            self.invalidate_state(&mut state);
        }
    }

    async fn connected(
        &self,
        transport: Arc<Transport>,
        shutdown: &CancellationToken,
        established: &mut bool,
    ) -> AppResult<()> {
        let mut socket = transport.websocket().await?;
        let (hints, mut updates) = watch::channel(0u64);
        let reader = async {
            loop {
                tokio::select! {
                    biased;
                    _ = shutdown.cancelled() => { let _ = socket.close(None).await; return Ok(()); },
                    message = socket.next() => match message {
                        Some(Ok(Message::Text(text))) => {
                            if let Some(event) = parse_event(&text) {
                                self.invalidate_event(&event).await;
                                hints.send_modify(|revision| *revision += 1);
                            }
                        },
                        Some(Ok(Message::Ping(data))) => { socket.send(Message::Pong(data)).await.map_err(|_| AppError::new("Disconnected", "Websocket closed"))?; },
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Err(AppError::new("Disconnected", "Websocket closed")),
                        _ => {},
                    }
                }
            }
        };
        let snapshots = async {
            // The reader remains active during all GETs. Buffered events trigger a fresh
            // snapshot instead of overwriting it with potentially older event payloads.
            let mut healthy = self.try_refresh(&transport).await?;
            *established |= healthy;
            let mut poll =
                tokio::time::interval_at(tokio::time::Instant::now() + CLIENT_POLL, CLIENT_POLL);
            poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                let retry = tokio::time::sleep(REFRESH_RETRY);
                tokio::select! {
                    _ = shutdown.cancelled() => return Ok(()),
                    result = updates.changed() => {
                        result.map_err(|_| AppError::new("Disconnected", "Websocket closed"))?;
                    },
                    _ = poll.tick() => {
                        let discovered = tokio::task::spawn_blocking(discovery::discover).await.map_err(|_| AppError::new("Internal", "Client discovery failed"))??;
                        if !discovered.as_ref().is_some_and(|v| transport.matches(v)) { return Err(AppError::new("Disconnected", "Client process changed")); }
                    },
                    _ = retry, if !healthy => {},
                }
                healthy = self.try_refresh(&transport).await?;
                *established |= healthy;
            }
        };
        tokio::select! { result = reader => result, result = snapshots => result }
    }

    async fn optional_read(transport: &Transport, operation: ReadOperation) -> AppResult<Value> {
        match transport.read(operation).await {
            Ok(value) => Ok(value),
            Err(error) if error.code == "Unsupported" => Ok(Value::Null),
            Err(error) => Err(error),
        }
    }

    /// For data that is only displayed: an unavailable resource reads as unknown so it cannot
    /// hold back the phase that drives automation.
    async fn display_read(transport: &Transport, operation: ReadOperation) -> AppResult<Value> {
        match transport.read(operation).await {
            Err(error)
                if matches!(
                    error.code.as_str(),
                    "Unauthorized" | "Disconnected" | "StaleSession"
                ) =>
            {
                Err(error)
            }
            Err(_) => Ok(Value::Null),
            Ok(value) => Ok(value),
        }
    }

    /// Runs one snapshot attempt on a live connection. `Ok(false)` means the attempt produced no
    /// snapshot but the connection is still usable, so the caller should retry on it. Rapid phase
    /// changes such as a dodge returning to queue land here; reconnecting for them would leave no
    /// connection when the next ready check arrives.
    async fn try_refresh(&self, transport: &Transport) -> AppResult<bool> {
        let Err(error) = self.refresh(transport).await else {
            return Ok(true);
        };
        match error.code.as_str() {
            "StaleSession" => Ok(false),
            "Unsupported" | "Io" | "InvalidInput" | "RateLimited" | "Timeout" => {
                let mut state = self.state.lock().await;
                if state.snapshot.connection == "Connected" {
                    self.invalidate_state(&mut state);
                }
                Ok(false)
            }
            _ => Err(error),
        }
    }

    async fn refresh(&self, transport: &Transport) -> AppResult<()> {
        let phase_sequence = self.state.lock().await.sequence;
        let phase = transport.read(ReadOperation::Phase).await?;
        let phase = phase
            .as_str()
            .ok_or_else(|| AppError::new("InvalidInput", "Invalid game phase"))?
            .to_owned();
        self.observe_read("phase", Value::String(phase.clone()), phase_sequence)
            .await?;
        if self.snapshot().await.phase != phase {
            self.invalidate().await;
        }
        let summoner_sequence = self.state.lock().await.sequence;
        let summoner = Self::optional_read(transport, ReadOperation::CurrentSummoner).await?;
        self.observe_read("account", summoner["puuid"].clone(), summoner_sequence)
            .await?;
        if self.snapshot().await.current_summoner.get("puuid") != summoner.get("puuid") {
            self.invalidate().await;
        }
        let sequence = self.state.lock().await.sequence;
        let gameflow = Self::display_read(transport, ReadOperation::Gameflow).await?;
        let champ = if phase == "ChampSelect" {
            transport.read(ReadOperation::ChampSelect).await?
        } else {
            Value::Null
        };
        self.observe_read(
            "room",
            champ
                .pointer("/chatDetails/multiUserChatId")
                .cloned()
                .unwrap_or(Value::Null),
            sequence,
        )
        .await?;
        let lobby = Self::display_read(transport, ReadOperation::LobbyMembers).await?;
        if transport.read(ReadOperation::Phase).await?.as_str() != Some(&phase)
            || Self::optional_read(transport, ReadOperation::CurrentSummoner)
                .await?
                .get("puuid")
                != summoner.get("puuid")
        {
            self.invalidate().await;
            return Err(AppError::new(
                "StaleSession",
                "Client state changed during initialization",
            ));
        }
        let blocked = if self.read_only {
            Some("Read-only validation mode is active".to_owned())
        } else if tokio::task::spawn_blocking(legacy_app_running)
            .await
            .unwrap_or(true)
        {
            Some("Close the previous Electron application before using automation".to_owned())
        } else if summoner.get("puuid").and_then(Value::as_str).is_none() {
            Some("No authenticated player is available".to_owned())
        } else {
            None
        };
        let mut state = self.state.lock().await;
        if state.sequence != sequence {
            return Err(AppError::new(
                "StaleSession",
                "Client state changed during snapshot",
            ));
        }
        let account = summoner["puuid"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let account_changed = account
            .as_ref()
            .is_some_and(|account| state.account.as_ref() != Some(account));
        let room_changed = state
            .snapshot
            .champ_select
            .pointer("/chatDetails/multiUserChatId")
            != champ.pointer("/chatDetails/multiUserChatId");
        if state.snapshot.phase != phase || account_changed || room_changed {
            Self::replace_session(&mut state);
        }
        if phase != "ReadyCheck" {
            state.ready_claimed = false;
        }
        if account_changed && state.account.is_some() {
            state.ledger.clear();
            state.preparations.clear();
            state.ready_claimed = false;
        }
        if account.is_some() {
            state.account = account;
        }
        if blocked.is_some() && state.snapshot.automation_blocked != blocked {
            Self::replace_session(&mut state);
        }
        state
            .observed_events
            .insert("phase".into(), Value::String(phase.clone()));
        state
            .observed_events
            .insert("account".into(), summoner["puuid"].clone());
        state.observed_events.insert(
            "room".into(),
            champ
                .pointer("/chatDetails/multiUserChatId")
                .cloned()
                .unwrap_or(Value::Null),
        );
        if state.snapshot.phase != phase
            || state.snapshot.gameflow != gameflow
            || state.snapshot.champ_select != champ
            || state.snapshot.current_summoner != summoner
            || state.snapshot.lobby_members != lobby
            || state.snapshot.connection != "Connected"
            || state.snapshot.automation_blocked != blocked
        {
            state.snapshot.phase = phase;
            state.snapshot.gameflow = gameflow;
            state.snapshot.champ_select = champ;
            state.snapshot.current_summoner = summoner;
            state.snapshot.lobby_members = lobby;
            state.snapshot.connection = "Connected".into();
            state.snapshot.automation_blocked = blocked;
            self.publish(&mut state);
        }
        Ok(())
    }

    async fn observe_read(&self, key: &str, value: Value, sequence: u64) -> AppResult<()> {
        let mut state = self.state.lock().await;
        if state.sequence != sequence {
            return Err(AppError::new(
                "StaleSession",
                "Client state changed during snapshot",
            ));
        }
        state.observed_events.insert(key.into(), value);
        Ok(())
    }

    async fn claim(&self, key: String) -> bool {
        let mut state = self.state.lock().await;
        if state.ledger.len() > 1000 {
            state.ledger.clear();
        }
        state.ledger.insert(key)
    }

    async fn run_automation(self: Arc<Self>, shutdown: CancellationToken) {
        let summaries = self.clone();
        let summary_stop = shutdown.child_token();
        let task = tokio::spawn(async move {
            summaries.run_automation_lane(summary_stop, true).await;
        });
        self.run_automation_lane(shutdown.clone(), false).await;
        shutdown.cancel();
        let _ = task.await;
    }

    async fn run_automation_lane(self: Arc<Self>, shutdown: CancellationToken, summaries: bool) {
        let mut changes = self.changes.subscribe();
        let mut config = self.config.subscribe();
        let mut retry = tokio::time::interval(Duration::from_secs(1));
        retry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let snapshot = self.snapshot().await;
            let settings = config.borrow().clone();
            if snapshot.connection == "Connected"
                && snapshot.automation_blocked.is_none()
                && !settings.is_null()
            {
                let work = async {
                    if summaries {
                        self.automate_summaries(&snapshot, &settings).await;
                    } else {
                        self.automate(&snapshot, &settings).await;
                    }
                };
                tokio::select! {
                    _ = shutdown.cancelled() => break,
                    _ = config.changed() => continue,
                    _ = work => {},
                }
            }
            tokio::select! {
                _ = shutdown.cancelled() => break,
                _ = config.changed() => {},
                _ = changes.changed() => {},
                _ = retry.tick() => {},
            }
        }
    }

    async fn automate(&self, snapshot: &LcuSnapshot, settings: &Value) {
        if snapshot.phase == "ReadyCheck"
            && settings["isAutoAccept"] == true
            && !self.state.lock().await.ready_claimed
        {
            let _ = self
                .ready_response(
                    true,
                    snapshot.generation,
                    &snapshot.session_key,
                    Some(settings),
                )
                .await;
        }
        if settings["isHovercard"] == true {
            let queue = settings["hovercardRankedType"].as_str().unwrap_or("");
            let tier = settings["hovercardTierType"].as_str().unwrap_or("");
            let owner = snapshot.current_summoner["puuid"].as_str().unwrap_or("");
            let key = format!("hovercard:{}:{owner}:{queue}:{tier}", snapshot.generation);
            let already_handled = self.state.lock().await.hovercard.as_ref() == Some(&key);
            if !already_handled {
                let _ = self
                    .hovercard_response(
                        queue,
                        tier,
                        snapshot.generation,
                        &snapshot.session_key,
                        Some(settings),
                    )
                    .await;
            }
        }
        if snapshot.phase != "ChampSelect" {
            return;
        }
        let room = snapshot
            .champ_select
            .pointer("/chatDetails/multiUserChatId")
            .and_then(Value::as_str)
            .unwrap_or(&snapshot.session_key);
        for id in automation::bench_candidates(snapshot) {
            if !self
                .state
                .lock()
                .await
                .ledger
                .contains(&format!("swap:{room}:{id}"))
            {
                let result = self.swap(snapshot, id).await;
                if result
                    .as_ref()
                    .is_err_and(|error| error.code == "StaleSession")
                {
                    break;
                }
                self.record_result(
                    "benchSwap",
                    &result,
                    snapshot.generation,
                    &snapshot.session_key,
                )
                .await;
                if result.is_ok() {
                    break;
                }
                if result.as_ref().is_err_and(|error| {
                    !matches!(error.code.as_str(), "Unsupported" | "InvalidInput")
                }) {
                    let mut state = self.state.lock().await;
                    if state.snapshot.session_key == snapshot.session_key
                        && state.snapshot.aram_revision == snapshot.aram_revision
                    {
                        state.snapshot.aram_preferences.clear();
                        self.publish(&mut state);
                    }
                    break;
                }
            }
        }
    }

    async fn automate_summaries(&self, snapshot: &LcuSnapshot, settings: &Value) {
        if snapshot.phase != "ChampSelect" {
            return;
        }
        let Some(room) = snapshot
            .champ_select
            .pointer("/chatDetails/multiUserChatId")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        else {
            return;
        };
        for (flag, kind) in [
            ("isShowTeammateRanked", "ranked"),
            ("isShowRecentTeammate", "recent"),
        ] {
            let key = format!("{kind}:{room}");
            let eligible = {
                let state = self.state.lock().await;
                !state.ledger.contains(&key)
                    && !state
                        .preparations
                        .get(&key)
                        .is_some_and(|(attempts, last)| {
                            *attempts >= 3 || last.elapsed() < Duration::from_secs(2)
                        })
            };
            if settings[flag] == true && eligible {
                let result = self.send_summary(snapshot, settings, kind, room).await;
                if result.is_err() {
                    let mut state = self.state.lock().await;
                    let previous = state
                        .preparations
                        .get(&key)
                        .map_or(0, |(attempts, _)| *attempts);
                    state
                        .preparations
                        .insert(key, (previous + 1, Instant::now()));
                }
                self.record_result(kind, &result, snapshot.generation, &snapshot.session_key)
                    .await;
            }
        }
    }

    async fn swap(&self, snapshot: &LcuSnapshot, id: u32) -> AppResult<Value> {
        let _gate = self.write_gate.lock().await;
        self.check_write_gate().await?;
        let (transport, token) = self
            .checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        let live = transport.read(ReadOperation::ChampSelect).await?;
        if live["benchEnabled"] != true
            || !live["benchChampions"]
                .as_array()
                .is_some_and(|bench| bench.iter().any(|champion| champion["championId"] == id))
        {
            return Err(AppError::new("StaleSession", "Bench availability changed"));
        }
        self.check_write_gate().await?;
        self.checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        {
            let mut state = self.state.lock().await;
            if state.snapshot.session_key != snapshot.session_key
                || state.snapshot.aram_revision != snapshot.aram_revision
                || token.is_cancelled()
                || !automation::bench_candidates(&state.snapshot).contains(&id)
            {
                return Err(AppError::new("StaleSession", "Champion preference changed"));
            }
            let room = snapshot
                .champ_select
                .pointer("/chatDetails/multiUserChatId")
                .and_then(Value::as_str)
                .unwrap_or(&snapshot.session_key);
            if !state.ledger.insert(format!("swap:{room}:{id}")) {
                return Ok(Value::Null);
            }
        }
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "Champion selection ended")),
            result = transport.swap(id) => result,
        };
        if result.is_ok() {
            let mut state = self.state.lock().await;
            if state.snapshot.session_key == snapshot.session_key
                && state.snapshot.aram_revision == snapshot.aram_revision
            {
                state.snapshot.aram_preferences.clear();
                self.publish(&mut state);
            }
        }
        result
    }

    async fn send_summary(
        &self,
        snapshot: &LcuSnapshot,
        settings: &Value,
        kind: &str,
        room: &str,
    ) -> AppResult<Value> {
        let (_, token) = self
            .checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        let body = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(AppError::new("StaleSession", "Champion selection ended")),
            result = async {
                if kind == "ranked" { automation::ranked_summary(self, snapshot, settings).await }
                else { automation::recent_summary(self, snapshot, settings).await }
            } => result?,
        };
        self.checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        self.check_settings(Some(settings))?;
        if body.is_empty() {
            self.claim(format!("{kind}:{room}")).await;
            return Ok(Value::Null);
        }
        let _gate = self.write_gate.lock().await;
        self.check_write_gate().await?;
        let (transport, token) = self
            .checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        let current = self.snapshot().await;
        let live = transport.read(ReadOperation::ChampSelect).await?;
        if current.phase != "ChampSelect"
            || live
                .pointer("/chatDetails/multiUserChatId")
                .and_then(Value::as_str)
                != Some(room)
            || current
                .champ_select
                .pointer("/chatDetails/multiUserChatId")
                .and_then(Value::as_str)
                != Some(room)
        {
            return Err(AppError::new("StaleSession", "The chat room changed"));
        }
        self.check_write_gate().await?;
        self.checked_session(snapshot.generation, &snapshot.session_key)
            .await?;
        {
            let mut state = self.state.lock().await;
            self.check_settings(Some(settings))?;
            if state.snapshot.generation != snapshot.generation
                || state.snapshot.session_key != snapshot.session_key
                || token.is_cancelled()
            {
                return Err(AppError::new("StaleSession", "Champion selection ended"));
            }
            if !state.ledger.insert(format!("{kind}:{room}")) {
                return Ok(Value::Null);
            }
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => Err(AppError::new("StaleSession", "Champion selection ended")),
            result = transport.chat(room, &body) => result,
        }
    }
}

fn parse_event(text: &str) -> Option<Value> {
    if text.len() > 4 * 1024 * 1024 {
        return None;
    }
    let value: Value = serde_json::from_str(text).ok()?;
    let array = value.as_array()?;
    if array.len() != 3 || array[0] != 8 {
        return None;
    }
    let topic = array[1].as_str()?;
    if !matches!(
        topic,
        "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"
            | "OnJsonApiEvent_lol-champ-select_v1_session"
            | "OnJsonApiEvent_lol-summoner_v1_current-summoner"
            | "OnJsonApiEvent_lol-lobby_v2_comms_members"
    ) {
        return None;
    }
    if !matches!(
        array[2]["eventType"].as_str()?,
        "Create" | "Update" | "Delete"
    ) {
        return None;
    }
    let mut event = array[2].clone();
    event["topic"] = Value::String(topic.to_owned());
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use transport::tests::{accept_http, fixture_listener, fixture_transport, respond};

    async fn fixture_service(port: u16, phase: &str) -> Arc<LcuService> {
        let mut service = LcuService::new().unwrap();
        Arc::get_mut(&mut service).unwrap().fixture_writes = true;
        let mut state = service.state.lock().await;
        state.transport = Some(Arc::new(fixture_transport(port)));
        state.snapshot.connection = "Connected".into();
        state.snapshot.phase = phase.into();
        state.snapshot.session_key = "fixture".into();
        state.snapshot.current_summoner = json!({"puuid":"fixture-owner"});
        state.account = Some("fixture-owner".into());
        drop(state);
        service
    }

    #[tokio::test]
    async fn concurrent_identity_queries_share_one_get_and_session_reset_refetches() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-summoner/v2/summoners?ids=%5B1%5D"));
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 200, r#"[{"puuid":"first"}]"#);
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, r#"[{"puuid":"second"}]"#);
        });
        let service = fixture_service(port, "Lobby").await;
        let worker = service.clone();
        let first =
            tokio::spawn(
                async move { worker.query(ReadOperation::SummonersById("1".into())).await },
            );
        seen_rx.await.unwrap();
        let worker = service.clone();
        let second =
            tokio::spawn(
                async move { worker.query(ReadOperation::SummonersById("1".into())).await },
            );
        tokio::task::yield_now().await;
        release_tx.send(()).unwrap();
        assert_eq!(first.await.unwrap().unwrap()[0]["puuid"], "first");
        assert_eq!(second.await.unwrap().unwrap()[0]["puuid"], "first");
        assert_eq!(
            service
                .query(ReadOperation::SummonersById("1".into()))
                .await
                .unwrap()[0]["puuid"],
            "first"
        );
        {
            let mut state = service.state.lock().await;
            LcuService::replace_session(&mut state);
            assert!(state.read_cache.is_empty());
        }
        assert_eq!(
            service
                .query(ReadOperation::SummonersById("1".into()))
                .await
                .unwrap()[0]["puuid"],
            "second"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn player_history_reads_only_the_requested_players_last_five_games() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-match-history/v1/products/lol/fixture-player/matches?begIndex=0&endIndex=4 "));
            respond(&mut stream, 200, r#"{"games":{"games":[{"gameId":42}]}}"#);
        });
        let service = fixture_service(port, "InProgress").await;
        let result = service
            .query(ReadOperation::PlayerMatches {
                puuid: "fixture-player".into(),
                count: 5,
            })
            .await
            .unwrap();
        assert_eq!(result["games"]["games"][0]["gameId"], 42);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn rank_cache_expires_and_failures_are_retryable() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for (status, body) in [(500, "{}"), (200, r#"{"wins":1}"#), (200, r#"{"wins":2}"#)] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, status, body);
            }
        });
        let service = fixture_service(port, "Lobby").await;
        let operation = ReadOperation::RankedByPuuid("player".into());
        let (first, second) = tokio::join!(
            service.query(operation.clone()),
            service.query(operation.clone())
        );
        assert!(first.is_err());
        assert!(second.is_err());
        let entry = service.state.lock().await.read_cache[&operation.path().unwrap()].clone();
        {
            let mut cached = entry.lock().await;
            let (expires, result) = cached.as_mut().unwrap();
            assert!(result.is_err());
            assert!(*expires <= Instant::now() + Duration::from_secs(1));
        }
        assert!(service.query(operation.clone()).await.is_err());
        entry.lock().await.as_mut().unwrap().0 = Instant::now() - Duration::from_secs(1);
        assert_eq!(service.query(operation.clone()).await.unwrap()["wins"], 1);
        let entry = service.state.lock().await.read_cache[&operation.path().unwrap()].clone();
        {
            let mut cached = entry.lock().await;
            let (expires, _) = cached.as_mut().unwrap();
            assert!(*expires <= Instant::now() + Duration::from_secs(30));
            *expires = Instant::now() - Duration::from_secs(1);
        }
        assert_eq!(service.query(operation).await.unwrap()["wins"], 2);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn lookup_cache_is_bounded_and_live_reads_are_never_cached() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for body in [r#"{"gameName":"name"}"#, "\"Lobby\"", "\"ReadyCheck\""] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, body);
            }
        });
        let service = fixture_service(port, "Lobby").await;
        {
            let mut state = service.state.lock().await;
            for id in 0..128 {
                state.read_cache.insert(id.to_string(), Arc::default());
            }
        }
        service
            .query(ReadOperation::SummonerByPuuid("new-player".into()))
            .await
            .unwrap();
        assert!(service.state.lock().await.read_cache.len() <= 128);
        let operation = ReadOperation::SummonerByPuuid("new-player".into());
        let entry = service.state.lock().await.read_cache[&operation.path().unwrap()].clone();
        assert!(
            entry.lock().await.as_ref().unwrap().0 <= Instant::now() + Duration::from_secs(120)
        );
        assert_eq!(service.query(ReadOperation::Phase).await.unwrap(), "Lobby");
        assert_eq!(
            service.query(ReadOperation::Phase).await.unwrap(),
            "ReadyCheck"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn session_change_cancels_lookup_owner_and_waiters() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (_stream, _) = accept_http(&listener, &acceptor);
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        });
        let service = fixture_service(port, "Lobby").await;
        let worker = service.clone();
        let first = tokio::spawn(async move {
            worker
                .query(ReadOperation::SummonerByPuuid("player".into()))
                .await
        });
        seen_rx.await.unwrap();
        let worker = service.clone();
        let second = tokio::spawn(async move {
            worker
                .query(ReadOperation::SummonerByPuuid("player".into()))
                .await
        });
        tokio::task::yield_now().await;
        service.disconnected("Disconnected").await;
        assert_eq!(first.await.unwrap().unwrap_err().code, "StaleSession");
        assert_eq!(second.await.unwrap().unwrap_err().code, "StaleSession");
        assert!(service.state.lock().await.read_cache.is_empty());
        release_tx.send(()).unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    async fn explicit_decline_prevents_automatic_accept() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-gameflow/v1/gameflow-phase"));
            respond(&mut stream, 200, "\"ReadyCheck\"");
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-matchmaking/v1/ready-check/decline"));
            respond(&mut stream, 204, "");
        });
        let service = fixture_service(port, "ReadyCheck").await;
        assert!(
            service
                .respond_ready_check(false, 0, "fixture")
                .await
                .is_ok()
        );
        assert_eq!(
            service
                .ready_response(true, 0, "fixture", Some(&json!({})))
                .await
                .unwrap_err()
                .code,
            "StaleSession"
        );
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().status,
            "Succeeded"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn manual_bench_swap_works_without_preferences_and_is_not_permanently_claimed() {
        let (listener, acceptor, port) = fixture_listener();
        let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":2}],"chatDetails":{"multiUserChatId":"room"}});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                for (path, response) in [
                    ("GET /lol-gameflow/v1/gameflow-phase", "\"ChampSelect\""),
                    ("GET /lol-champ-select/v1/session", body.as_str()),
                    ("GET /lol-champ-select/v1/pickable-champion-ids", "[2]"),
                    ("POST /lol-champ-select/v1/session/bench/swap/2", ""),
                ] {
                    let (mut stream, request) = accept_http(&listener, &acceptor);
                    assert!(request.starts_with(path));
                    respond(
                        &mut stream,
                        if response.is_empty() { 204 } else { 200 },
                        response,
                    );
                }
            }
        });
        let service = fixture_service(port, "ChampSelect").await;
        service.state.lock().await.snapshot.champ_select = champ;
        service.swap_bench(2, 0, "fixture").await.unwrap();
        service.swap_bench(2, 0, "fixture").await.unwrap();
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().operation,
            "manualBenchSwap"
        );
        assert!(service.state.lock().await.ledger.contains("swap:room:2"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn manual_bench_swap_rejects_invalid_stale_and_busy_without_network() {
        let service = fixture_service(1, "ChampSelect").await;
        assert_eq!(
            service.swap_bench(0, 0, "fixture").await.unwrap_err().code,
            "InvalidInput"
        );
        assert_eq!(
            service
                .swap_bench(10001, 0, "fixture")
                .await
                .unwrap_err()
                .code,
            "InvalidInput"
        );
        assert_eq!(
            service.swap_bench(2, 1, "fixture").await.unwrap_err().code,
            "StaleSession"
        );
        let gate = service.write_gate.lock().await;
        assert_eq!(
            service.swap_bench(2, 0, "fixture").await.unwrap_err().code,
            "Busy"
        );
        drop(gate);
        service.state.lock().await.snapshot.phase = "InProgress".into();
        assert_eq!(
            service.swap_bench(2, 0, "fixture").await.unwrap_err().code,
            "StaleSession"
        );
    }

    #[tokio::test]
    async fn manual_bench_cancels_preflight_before_any_post() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, "\"ChampSelect\"");
            let (stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-champ-select/v1/session"));
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            drop(stream);
        });
        let service = fixture_service(port, "ChampSelect").await;
        let worker = service.clone();
        let task = tokio::spawn(async move { worker.swap_bench(2, 0, "fixture").await });
        seen_rx.await.unwrap();
        service.invalidate().await;
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err().code, "StaleSession");
        release_tx.send(()).unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    async fn manual_bench_swap_requires_live_bench_and_pickability_without_post() {
        for (bench, pickable) in [(false, false), (true, false)] {
            let (listener, acceptor, port) = fixture_listener();
            let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":2}]});
            let live = if bench {
                champ.clone()
            } else {
                json!({"benchEnabled":true,"benchChampions":[]})
            };
            let server = std::thread::spawn(move || {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, "\"ChampSelect\"");
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("GET /lol-champ-select/v1/session"));
                respond(&mut stream, 200, &live.to_string());
                if bench {
                    let (mut stream, request) = accept_http(&listener, &acceptor);
                    assert!(request.starts_with("GET /lol-champ-select/v1/pickable-champion-ids"));
                    respond(&mut stream, 200, if pickable { "[2]" } else { "[]" });
                }
            });
            let service = fixture_service(port, "ChampSelect").await;
            service.state.lock().await.snapshot.champ_select = champ;
            let error = service.swap_bench(2, 0, "fixture").await.unwrap_err();
            assert_eq!(
                error.code,
                if bench { "Unavailable" } else { "StaleSession" }
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn manual_bench_post_failure_cancels_original_auto_preferences_without_retry() {
        let (listener, acceptor, port) = fixture_listener();
        let champ =
            json!({"benchEnabled":true,"benchChampions":[{"championId":2},{"championId":3}]});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            for response in ["\"ChampSelect\"", body.as_str(), "[2]"] {
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("GET "));
                respond(&mut stream, 200, response);
            }
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-champ-select/v1/session/bench/swap/2"));
            respond(&mut stream, 500, "");
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-champ-select/v1/session"));
            respond(&mut stream, 200, &body);
        });
        let service = fixture_service(port, "ChampSelect").await;
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = champ;
            state.snapshot.aram_preferences = vec![2, 3];
        }
        let obsolete_auto = service.snapshot().await;
        assert!(service.swap_bench(2, 0, "fixture").await.is_err());
        assert!(service.snapshot().await.aram_preferences.is_empty());
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().status,
            "FailedOrUnknown"
        );
        service.automate(&obsolete_auto, &json!({})).await;
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().operation,
            "manualBenchSwap"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn manual_bench_rejects_new_preferences_during_preflight_without_clearing_them() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let champ =
            json!({"benchEnabled":true,"benchChampions":[{"championId":2},{"championId":3}]});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            for response in ["\"ChampSelect\"", body.as_str()] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, response);
            }
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-champ-select/v1/pickable-champion-ids"));
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 200, "[2,3]");
        });
        let service = fixture_service(port, "ChampSelect").await;
        service.state.lock().await.snapshot.champ_select = champ;
        let worker = service.clone();
        let task = tokio::spawn(async move { worker.swap_bench(2, 0, "fixture").await });
        seen_rx.await.unwrap();
        service
            .set_aram_preferences(vec![3], 0, "fixture")
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        assert_eq!(task.await.unwrap().unwrap_err().code, "StaleSession");
        assert_eq!(service.snapshot().await.aram_preferences, vec![3]);
        assert!(service.state.lock().await.ledger.is_empty());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn manual_bench_success_preserves_newer_preferences_and_clears_original_ones() {
        for change_preferences in [false, true] {
            let (listener, acceptor, port) = fixture_listener();
            let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":2}]});
            let body = champ.to_string();
            let server = std::thread::spawn(move || {
                for response in ["\"ChampSelect\"", body.as_str(), "[2]"] {
                    let (mut stream, _) = accept_http(&listener, &acceptor);
                    respond(&mut stream, 200, response);
                }
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("POST /lol-champ-select/v1/session/bench/swap/2"));
                seen_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                respond(&mut stream, 204, "");
            });
            let service = fixture_service(port, "ChampSelect").await;
            {
                let mut state = service.state.lock().await;
                state.snapshot.champ_select = champ;
                state.snapshot.aram_preferences = vec![2];
            }
            let worker = service.clone();
            let task = tokio::spawn(async move { worker.swap_bench(2, 0, "fixture").await });
            seen_rx.await.unwrap();
            assert_eq!(
                service.swap_bench(2, 0, "fixture").await.unwrap_err().code,
                "Busy"
            );
            if change_preferences {
                service
                    .set_aram_preferences(vec![3], 0, "fixture")
                    .await
                    .unwrap();
            }
            release_tx.send(()).unwrap();
            task.await.unwrap().unwrap();
            assert_eq!(
                service.snapshot().await.aram_preferences,
                if change_preferences { vec![3] } else { vec![] }
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn bench_success_clears_all_preferences_and_sends_one_swap() {
        let (listener, acceptor, port) = fixture_listener();
        let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":1},{"championId":2}],"chatDetails":{"multiUserChatId":"room"}});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-champ-select/v1/session"));
            respond(&mut stream, 200, &body);
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-champ-select/v1/session/bench/swap/2"));
            respond(&mut stream, 204, "");
        });
        let service = fixture_service(port, "ChampSelect").await;
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = champ;
            state.snapshot.aram_preferences = vec![2, 1];
        }
        service
            .automate(&service.snapshot().await, &json!({}))
            .await;
        assert!(service.snapshot().await.aram_preferences.is_empty());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn native_hovercard_uses_config_and_deduplicates_identical_updates() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("PUT /lol-chat/v1/me"));
            respond(&mut stream, 204, "");
        });
        let service = fixture_service(port, "Lobby").await;
        let config = json!({"isHovercard":true,"hovercardRankedType":"RANKED_SOLO_5x5","hovercardTierType":"Emerald"});
        service.config.send_replace(config.clone());
        service.automate(&service.snapshot().await, &config).await;
        service.config.send_replace(config.clone());
        service.automate(&service.snapshot().await, &config).await;
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().operation,
            "autoHovercard"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn history_sync_wraps_payload_for_real_sqlite_and_preserves_owner() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.contains("current-summoner/matches?begIndex=0&endIndex=0"));
            respond(&mut stream, 200, r#"{"games":{"games":[{"gameId":42}]}}"#);
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.contains("/lol-match-history/v1/games/42"));
            respond(
                &mut stream,
                200,
                r#"{"gameId":42,"gameCreation":1000,"participants":[],"participantIdentities":[]}"#,
            );
        });
        let service = fixture_service(port, "ChampSelect").await;
        let temp = tempfile::tempdir().unwrap();
        let history = Arc::new(std::sync::Mutex::new(
            crate::history::HistoryStore::open(temp.path()).unwrap(),
        ));
        service
            .configure_data_sources(
                history.clone(),
                Arc::new(crate::external::ExternalData::new().unwrap()),
            )
            .unwrap();
        let games = service
            .sync_recent_history(&service.snapshot().await, 1)
            .await
            .unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["_id"], "42");
        assert_eq!(games[0]["data"]["gameCreation"], 1000);
        assert!(
            history
                .lock()
                .unwrap()
                .list_games("other-owner", 1)
                .unwrap()
                .is_empty()
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn history_sync_reuses_owner_cache_and_fetches_only_missing_games() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.contains("current-summoner/matches?begIndex=0&endIndex=1"));
            respond(
                &mut stream,
                200,
                r#"{"games":{"games":[{"gameId":43},{"gameId":42}]}}"#,
            );
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-match-history/v1/games/43 "));
            respond(
                &mut stream,
                200,
                r#"{"gameId":43,"gameCreation":2000,"participants":[],"participantIdentities":[]}"#,
            );
            listener
        });
        let service = fixture_service(port, "ChampSelect").await;
        let temp = tempfile::tempdir().unwrap();
        let history = Arc::new(std::sync::Mutex::new(
            crate::history::HistoryStore::open(temp.path()).unwrap(),
        ));
        let cached = json!({"_id":"42","ownerPuuid":"fixture-owner","data":{"gameId":42,"gameCreation":1000,"participants":[],"participantIdentities":[{"participantId":1,"player":{"puuid":"player","gameName":"OriginalName","tagLine":"OLD"}}]}});
        history
            .lock()
            .unwrap()
            .save_games("fixture-owner", std::slice::from_ref(&cached))
            .unwrap();
        let mut renamed = cached.clone();
        renamed["data"]["participantIdentities"][0]["player"]["gameName"] = json!("Renamed");
        renamed["data"]["participantIdentities"][0]["player"]["tagLine"] = json!("NEW");
        assert!(
            history
                .lock()
                .unwrap()
                .save_games("fixture-owner", &[renamed])
                .is_err()
        );
        service
            .configure_data_sources(
                history.clone(),
                Arc::new(crate::external::ExternalData::new().unwrap()),
            )
            .unwrap();
        let games = service
            .sync_recent_history(&service.snapshot().await, 2)
            .await
            .unwrap();
        assert_eq!(games.len(), 2);
        let preserved = games.iter().find(|game| game["_id"] == "42").unwrap();
        assert_eq!(
            preserved["data"]["participantIdentities"][0]["player"]["gameName"],
            "OriginalName"
        );
        assert!(games.iter().any(|game| game["_id"] == "43"));
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[tokio::test]
    async fn cached_game_for_another_owner_is_not_treated_as_current_owner_membership() {
        let (listener, acceptor, port) = fixture_listener();
        let payload =
            json!({"gameId":42,"gameCreation":1000,"participants":[],"participantIdentities":[]});
        let body = payload.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, r#"{"games":{"games":[{"gameId":42}]}}"#);
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("GET /lol-match-history/v1/games/42 "));
            respond(&mut stream, 200, &body);
        });
        let service = fixture_service(port, "ChampSelect").await;
        let temp = tempfile::tempdir().unwrap();
        let history = Arc::new(std::sync::Mutex::new(
            crate::history::HistoryStore::open(temp.path()).unwrap(),
        ));
        history
            .lock()
            .unwrap()
            .save_games(
                "other-owner",
                &[json!({"_id":"42","ownerPuuid":"other-owner","data":payload})],
            )
            .unwrap();
        service
            .configure_data_sources(
                history.clone(),
                Arc::new(crate::external::ExternalData::new().unwrap()),
            )
            .unwrap();
        let games = service
            .sync_recent_history(&service.snapshot().await, 1)
            .await
            .unwrap();
        assert_eq!(games[0]["ownerPuuid"], "fixture-owner");
        assert_eq!(
            history
                .lock()
                .unwrap()
                .list_games("other-owner", 1)
                .unwrap()
                .len(),
            1
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn stale_history_sync_does_not_commit_or_trim_existing_cache() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (stream, request) = accept_http(&listener, &acceptor);
            assert!(
                request
                    .starts_with("GET /lol-match-history/v1/products/lol/current-summoner/matches")
            );
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            drop(stream);
        });
        let service = fixture_service(port, "ChampSelect").await;
        let temp = tempfile::tempdir().unwrap();
        let history = Arc::new(std::sync::Mutex::new(
            crate::history::HistoryStore::open(temp.path()).unwrap(),
        ));
        history
            .lock()
            .unwrap()
            .save_games(
                "fixture-owner",
                &[
                    json!({"_id":"41","data":{"gameId":41,"gameCreation":1000}}),
                    json!({"_id":"42","data":{"gameId":42,"gameCreation":2000}}),
                ],
            )
            .unwrap();
        service
            .configure_data_sources(
                history.clone(),
                Arc::new(crate::external::ExternalData::new().unwrap()),
            )
            .unwrap();
        let worker = service.clone();
        let task = tokio::spawn(async move {
            worker
                .sync_recent_history(&worker.snapshot().await, 1)
                .await
        });
        seen_rx.await.unwrap();
        assert!(!task.is_finished());
        service.invalidate().await;
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("session cancellation must finish without a server response");
        release_tx.send(()).unwrap();
        assert_eq!(result.unwrap().unwrap_err().code, "StaleSession");
        assert_eq!(
            history
                .lock()
                .unwrap()
                .list_games("fixture-owner", 10)
                .unwrap()
                .len(),
            2
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn transition_event_cancels_old_work_before_snapshot_refresh() {
        let service = fixture_service(1, "ChampSelect").await;
        let token = service.state.lock().await.session.clone();
        service.invalidate_event(&json!({"topic":"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase","eventType":"Update","data":"InProgress"})).await;
        assert!(token.is_cancelled());
        assert_eq!(service.snapshot().await.connection, "Connecting");
        assert!(service.snapshot().await.champ_select.is_null());
        service
            .record_result("old", &Ok(Value::Null), 0, "fixture")
            .await;
        assert!(service.snapshot().await.last_operation.is_none());
    }

    /// Replays the HTTP head the fixture already consumed so tungstenite can run the handshake.
    struct ReplayStream {
        head: std::io::Cursor<Vec<u8>>,
        stream: transport::tests::FixtureStream,
    }

    impl std::io::Read for ReplayStream {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            match self.head.read(buf)? {
                0 => self.stream.read(buf),
                read => Ok(read),
            }
        }
    }

    impl std::io::Write for ReplayStream {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.stream.write(buf)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.stream.flush()
        }
    }

    async fn wait_for_snapshot(service: &LcuService, expected: impl Fn(&LcuSnapshot) -> bool) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while !expected(&service.snapshot().await) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("snapshot did not reach the expected state");
    }

    #[tokio::test]
    #[allow(clippy::result_large_err)] // Tungstenite fixes the handshake callback error type.
    async fn requeue_after_dodge_recovers_without_dropping_the_connection() {
        let (listener, acceptor, port) = fixture_listener();
        let phase = Arc::new(std::sync::Mutex::new("ChampSelect".to_owned()));
        let (lagging_tx, lagging_rx) = tokio::sync::oneshot::channel();
        let (event_tx, event_rx) = std::sync::mpsc::channel::<String>();
        let server_phase = phase.clone();
        // Detached: it blocks in accept until the test process exits.
        std::thread::spawn(move || {
            let mut event_rx = Some(event_rx);
            let mut lagging_tx = Some(lagging_tx);
            loop {
                let (mut stream, request) = accept_http(&listener, &acceptor);
                if request.starts_with("GET / ") {
                    let events = event_rx.take().unwrap();
                    std::thread::spawn(move || {
                        let replay = ReplayStream {
                            head: std::io::Cursor::new(request.into_bytes()),
                            stream,
                        };
                        let mut socket = tokio_tungstenite::tungstenite::accept_hdr(replay, |_: &tokio_tungstenite::tungstenite::handshake::server::Request, mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                            response.headers_mut().insert("sec-websocket-protocol", "wamp".parse().unwrap());
                            Ok(response)
                        }).unwrap();
                        for _ in 0..4 {
                            socket.read().unwrap();
                        }
                        for event in events {
                            socket.send(Message::Text(event.into())).unwrap();
                        }
                    });
                    continue;
                }
                let current = server_phase.lock().unwrap().clone();
                let path = request.split_whitespace().nth(1).unwrap();
                let (status, body) = match path {
                    "/lol-gameflow/v1/gameflow-phase" => (200, format!("\"{current}\"")),
                    "/lol-summoner/v1/current-summoner" => {
                        (200, r#"{"puuid":"fixture-owner"}"#.to_owned())
                    }
                    "/lol-champ-select/v1/session" => {
                        // The room is already gone while the phase still reads ChampSelect.
                        if let Some(lagging) = lagging_tx.take() {
                            let _ = lagging.send(());
                        }
                        (404, "{}".to_owned())
                    }
                    _ => (200, "{}".to_owned()),
                };
                respond(&mut stream, status, &body);
            }
        });
        let service = fixture_service(port, "ChampSelect").await;
        let stop = CancellationToken::new();
        let (worker, worker_stop) = (service.clone(), stop.clone());
        let connection = tokio::spawn(async move {
            let mut established = false;
            let result = worker
                .connected(
                    Arc::new(fixture_transport(port)),
                    &worker_stop,
                    &mut established,
                )
                .await;
            (result, established)
        });

        lagging_rx.await.unwrap();
        *phase.lock().unwrap() = "Matchmaking".into();
        wait_for_snapshot(&service, |value| {
            value.connection == "Connected" && value.phase == "Matchmaking"
        })
        .await;

        *phase.lock().unwrap() = "ReadyCheck".into();
        event_tx
            .send(r#"[8,"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",{"eventType":"Update","data":"ReadyCheck"}]"#.into())
            .unwrap();
        wait_for_snapshot(&service, |value| {
            value.connection == "Connected" && value.phase == "ReadyCheck"
        })
        .await;

        assert!(!connection.is_finished());
        stop.cancel();
        let (result, established) = connection.await.unwrap();
        assert!(result.is_ok());
        assert!(established);
    }

    #[tokio::test]
    async fn only_lost_or_rejected_clients_end_the_connection() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for status in [500, 401] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, status, "{}");
            }
        });
        let service = fixture_service(port, "Matchmaking").await;
        let transport = fixture_transport(port);
        assert!(!service.try_refresh(&transport).await.unwrap());
        assert_eq!(service.snapshot().await.connection, "Connecting");
        assert_eq!(
            service.try_refresh(&transport).await.unwrap_err().code,
            "Unauthorized"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn failing_display_resources_do_not_hold_back_the_ready_check() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for (status, body) in [
                (200, "\"ReadyCheck\""),
                (200, r#"{"puuid":"fixture-owner"}"#),
                (500, "{}"),
                (500, "{}"),
                (200, "\"ReadyCheck\""),
                (200, r#"{"puuid":"fixture-owner"}"#),
            ] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, status, body);
            }
        });
        let service = fixture_service(port, "Matchmaking").await;
        service.refresh(&fixture_transport(port)).await.unwrap();
        let snapshot = service.snapshot().await;
        assert_eq!(snapshot.connection, "Connected");
        assert_eq!(snapshot.phase, "ReadyCheck");
        assert!(snapshot.lobby_members.is_null());
        server.join().unwrap();
    }

    #[tokio::test]
    async fn changing_phase_during_initial_gets_never_publishes_writable_snapshot() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for body in [
                "\"ChampSelect\"",
                r#"{"puuid":"fixture-owner"}"#,
                "{}",
                "{}",
                r#"{"players":{}}"#,
                "\"InProgress\"",
            ] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, body);
            }
        });
        let service = fixture_service(port, "Lobby").await;
        let transport = fixture_transport(port);
        assert_eq!(
            service.refresh(&transport).await.unwrap_err().code,
            "StaleSession"
        );
        assert_ne!(service.snapshot().await.connection, "Connected");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn recent_summary_skips_hidden_champ_select_players_without_error_or_reads() {
        let service = fixture_service(1, "ChampSelect").await;
        let settings = json!({"isShowRecentTeammate":true});
        service.config.send_replace(settings.clone());
        {
            let mut state = service.state.lock().await;
            state.snapshot.lobby_members = json!({"players":{}});
            state.snapshot.champ_select = json!({
                "chatDetails":{"multiUserChatId":"room"},
                "myTeam":[{"puuid":"fixture-owner"}, {"puuid":"","nameVisibilityType":"HIDDEN"},
                    {"puuid":"hidden-id","isNameObfuscated":true}]
            });
        }
        service
            .automate_summaries(&service.snapshot().await, &settings)
            .await;
        let state = service.state.lock().await;
        assert_eq!(
            state.snapshot.last_operation.as_ref().unwrap().status,
            "Succeeded"
        );
        assert!(state.ledger.contains("recent:room"));
        assert!(!state.preparations.contains_key("recent:room"));
    }

    #[tokio::test]
    async fn preparation_failure_is_not_claimed_and_has_bounded_backoff() {
        let service = fixture_service(1, "ChampSelect").await;
        {
            service.state.lock().await.snapshot.champ_select =
                json!({"chatDetails":{"multiUserChatId":"room"}});
        }
        let snapshot = service.snapshot().await;
        let settings = json!({"isShowRecentTeammate":true});
        service.automate_summaries(&snapshot, &settings).await;
        service.automate_summaries(&snapshot, &settings).await;
        let state = service.state.lock().await;
        assert!(!state.ledger.contains("recent:room"));
        assert_eq!(state.preparations["recent:room"].0, 1);
    }

    #[tokio::test]
    async fn successful_swap_with_malformed_body_never_falls_through_to_second_champion() {
        let (listener, acceptor, port) = fixture_listener();
        let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":1},{"championId":2}],"chatDetails":{"multiUserChatId":"room"}});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, &body);
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-champ-select/v1/session/bench/swap/1"));
            respond(&mut stream, 200, "successful-but-not-json");
            listener
        });
        let service = fixture_service(port, "ChampSelect").await;
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = champ;
            state.snapshot.aram_preferences = vec![1, 2];
        }
        service
            .automate(&service.snapshot().await, &json!({}))
            .await;
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
        assert!(service.snapshot().await.aram_preferences.is_empty());
        assert_eq!(
            service.snapshot().await.last_operation.unwrap().status,
            "FailedOrUnknown"
        );
        assert!(service.state.lock().await.ledger.contains("swap:room:1"));
    }

    #[tokio::test]
    async fn transient_missing_account_keeps_ready_claim_for_restored_same_owner() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for missing in [true, false] {
                for (index, body) in [
                    "\"ReadyCheck\"",
                    r#"{"puuid":"fixture-owner"}"#,
                    "{}",
                    r#"{"players":{}}"#,
                    "\"ReadyCheck\"",
                    r#"{"puuid":"fixture-owner"}"#,
                ]
                .iter()
                .enumerate()
                {
                    let (mut stream, _) = accept_http(&listener, &acceptor);
                    respond(
                        &mut stream,
                        if missing && matches!(index, 1 | 5) {
                            404
                        } else {
                            200
                        },
                        body,
                    );
                }
            }
        });
        let mut service = fixture_service(port, "ReadyCheck").await;
        Arc::get_mut(&mut service).unwrap().read_only = true;
        service.state.lock().await.ready_claimed = true;
        service.refresh(&fixture_transport(port)).await.unwrap();
        assert!(service.snapshot().await.current_summoner.is_null());
        assert_eq!(
            service.state.lock().await.account.as_deref(),
            Some("fixture-owner")
        );
        assert!(service.state.lock().await.ready_claimed);
        service.refresh(&fixture_transport(port)).await.unwrap();
        assert!(service.state.lock().await.ready_claimed);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn legacy_start_during_preflight_stops_post_and_cancels_existing_session() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 200, "\"ReadyCheck\"");
            listener
        });
        let service = fixture_service(port, "ReadyCheck").await;
        let token = service.state.lock().await.session.clone();
        let worker = service.clone();
        let task =
            tokio::spawn(async move { worker.respond_ready_check(true, 0, "fixture").await });
        seen_rx.await.unwrap();
        service
            .fixture_legacy
            .store(true, std::sync::atomic::Ordering::SeqCst);
        release_tx.send(()).unwrap();
        assert!(task.await.unwrap().is_err());
        assert!(token.is_cancelled());
        assert!(service.snapshot().await.automation_blocked.is_some());
        assert!(!service.state.lock().await.ready_claimed);
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[tokio::test]
    async fn existing_legacy_instance_blocks_manual_actions_before_any_network() {
        let (listener, _, port) = fixture_listener();
        let service = fixture_service(port, "ReadyCheck").await;
        service
            .fixture_legacy
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            service
                .respond_ready_check(true, 0, "fixture")
                .await
                .unwrap_err()
                .code,
            "Unsupported"
        );
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[tokio::test]
    async fn every_transition_during_connecting_advances_snapshot_fence() {
        let service = fixture_service(1, "Lobby").await;
        service.invalidate_event(&json!({"topic":"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase","eventType":"Update","data":"ReadyCheck"})).await;
        let first = service.state.lock().await.sequence;
        assert_eq!(service.snapshot().await.connection, "Connecting");
        service.invalidate_event(&json!({"topic":"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase","eventType":"Update","data":"ChampSelect"})).await;
        let second = service.state.lock().await.sequence;
        assert!(second > first);
        assert!(
            service
                .observe_read("phase", json!("ReadyCheck"), first)
                .await
                .is_err()
        );
        service.invalidate_event(&json!({"topic":"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase","eventType":"Update","data":"ChampSelect"})).await;
        assert_eq!(service.state.lock().await.sequence, second);
        service.invalidate_event(&json!({"topic":"OnJsonApiEvent_lol-summoner_v1_current-summoner","eventType":"Delete","data":null})).await;
        assert!(service.state.lock().await.sequence > second);
    }

    #[tokio::test]
    async fn failed_preflight_get_does_not_consume_ready_claim() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 500, "{}");
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, "\"ReadyCheck\"");
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-matchmaking/v1/ready-check/accept"));
            respond(&mut stream, 204, "");
        });
        let service = fixture_service(port, "ReadyCheck").await;
        assert!(
            service
                .respond_ready_check(true, 0, "fixture")
                .await
                .is_err()
        );
        assert!(!service.state.lock().await.ready_claimed);
        service
            .respond_ready_check(true, 0, "fixture")
            .await
            .unwrap();
        assert!(service.state.lock().await.ready_claimed);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn source_config_off_fences_post_without_waiting_for_relay() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 200, "\"ReadyCheck\"");
            listener
        });
        let service = fixture_service(port, "ReadyCheck").await;
        let settings = json!({"isAutoAccept":true});
        let (source, receiver) = watch::channel(settings.clone());
        service.source_config.set(receiver).unwrap();
        service.config.send_replace(settings.clone());
        let worker = service.clone();
        let task = tokio::spawn(async move {
            worker
                .ready_response(true, 0, "fixture", Some(&settings))
                .await
        });
        seen_rx.await.unwrap();
        source.send_replace(json!({"isAutoAccept":false}));
        release_tx.send(()).unwrap();
        assert_eq!(task.await.unwrap().unwrap_err().code, "StaleSession");
        assert!(!service.state.lock().await.ready_claimed);
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[tokio::test]
    async fn changed_bench_preference_is_not_written_or_cleared_by_old_work() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":1},{"championId":2}],"chatDetails":{"multiUserChatId":"room"}});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 200, &body);
            listener
        });
        let service = fixture_service(port, "ChampSelect").await;
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = champ;
            state.snapshot.aram_preferences = vec![1];
        }
        let worker = service.clone();
        let task =
            tokio::spawn(
                async move { worker.automate(&worker.snapshot().await, &json!({})).await },
            );
        seen_rx.await.unwrap();
        service
            .set_aram_preferences(vec![2], 0, "fixture")
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        task.await.unwrap();
        assert_eq!(service.snapshot().await.aram_preferences, vec![2]);
        assert!(!service.state.lock().await.ledger.contains("swap:room:1"));
        let listener = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[tokio::test]
    async fn cached_hovercard_does_not_bypass_session_or_read_only_gate() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 204, "");
        });
        let mut service = fixture_service(port, "Lobby").await;
        service
            .set_hovercard("RANKED_SOLO_5x5", "Gold", 0, "fixture")
            .await
            .unwrap();
        assert_eq!(
            service
                .set_hovercard("RANKED_SOLO_5x5", "Gold", 0, "stale")
                .await
                .unwrap_err()
                .code,
            "StaleSession"
        );
        let service_mut = Arc::get_mut(&mut service).unwrap();
        service_mut.fixture_writes = false;
        service_mut.read_only = true;
        assert_eq!(
            service
                .set_hovercard("RANKED_SOLO_5x5", "Gold", 0, "fixture")
                .await
                .unwrap_err()
                .code,
            "Unsupported"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn old_successful_swap_does_not_clear_a_new_preference_revision() {
        let (listener, acceptor, port) = fixture_listener();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let champ = json!({"benchEnabled":true,"benchChampions":[{"championId":1},{"championId":2}],"chatDetails":{"multiUserChatId":"room"}});
        let body = champ.to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = accept_http(&listener, &acceptor);
            respond(&mut stream, 200, &body);
            let (mut stream, request) = accept_http(&listener, &acceptor);
            assert!(request.starts_with("POST /lol-champ-select/v1/session/bench/swap/1"));
            seen_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            respond(&mut stream, 204, "");
        });
        let service = fixture_service(port, "ChampSelect").await;
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = champ;
            state.snapshot.aram_preferences = vec![1];
        }
        let worker = service.clone();
        let task =
            tokio::spawn(
                async move { worker.automate(&worker.snapshot().await, &json!({})).await },
            );
        seen_rx.await.unwrap();
        service
            .set_aram_preferences(vec![2], 0, "fixture")
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        task.await.unwrap();
        assert_eq!(service.snapshot().await.aram_preferences, vec![2]);
        assert!(service.state.lock().await.ledger.contains("swap:room:1"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn account_change_cancels_previous_session_and_resets_account_ledger() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for body in [
                "\"Lobby\"",
                r#"{"puuid":"new-owner"}"#,
                "{}",
                r#"{"players":{}}"#,
                "\"Lobby\"",
                r#"{"puuid":"new-owner"}"#,
            ] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, body);
            }
        });
        let mut service = fixture_service(port, "Lobby").await;
        Arc::get_mut(&mut service).unwrap().read_only = true;
        service.claim("ranked:old-room".into()).await;
        let token = service.state.lock().await.session.clone();
        service.refresh(&fixture_transport(port)).await.unwrap();
        assert!(token.is_cancelled());
        assert!(service.state.lock().await.ledger.is_empty());
        assert_eq!(
            service.snapshot().await.current_summoner["puuid"],
            "new-owner"
        );
        assert_ne!(service.snapshot().await.session_key, "fixture");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn optional_resources_only_tolerate_missing_not_authentication_failure() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for status in [404, 401] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, status, "{}");
            }
        });
        let transport = fixture_transport(port);
        assert!(
            LcuService::optional_read(&transport, ReadOperation::CurrentSummoner)
                .await
                .unwrap()
                .is_null()
        );
        assert_eq!(
            LcuService::optional_read(&transport, ReadOperation::CurrentSummoner)
                .await
                .unwrap_err()
                .code,
            "Unauthorized"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn explicit_ready_actions_can_be_repeated_in_both_directions() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for action in ["accept", "decline", "decline", "accept"] {
                let (mut stream, _) = accept_http(&listener, &acceptor);
                respond(&mut stream, 200, "\"ReadyCheck\"");
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(
                    request.starts_with(&format!("POST /lol-matchmaking/v1/ready-check/{action}"))
                );
                respond(&mut stream, 204, "");
            }
        });
        let service = fixture_service(port, "ReadyCheck").await;
        service
            .respond_ready_check(true, 0, "fixture")
            .await
            .unwrap();
        service
            .respond_ready_check(false, 0, "fixture")
            .await
            .unwrap();
        assert!(
            service
                .respond_ready_check(false, 0, "fixture")
                .await
                .is_ok()
        );
        assert!(
            service
                .respond_ready_check(true, 0, "fixture")
                .await
                .is_ok()
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn concurrent_manual_ready_action_is_not_queued() {
        let service = fixture_service(1, "ReadyCheck").await;
        let _pending = service.write_gate.lock().await;
        let error = service
            .respond_ready_check(true, 0, "fixture")
            .await
            .unwrap_err();
        assert_eq!(error.code, "Busy");
        assert!(!service.state.lock().await.ready_claimed);
    }

    #[tokio::test]
    async fn failed_ready_post_requires_a_new_explicit_action() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for status in [500, 204] {
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("GET /lol-gameflow/v1/gameflow-phase"));
                respond(&mut stream, 200, "\"ReadyCheck\"");
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("POST /lol-matchmaking/v1/ready-check/accept"));
                respond(&mut stream, status, "");
            }
        });
        let service = fixture_service(port, "ReadyCheck").await;
        assert!(
            service
                .respond_ready_check(true, 0, "fixture")
                .await
                .is_err()
        );
        let failed = service.snapshot().await.last_operation.unwrap();
        assert_eq!(failed.status, "FailedOrUnknown");
        assert!(
            service
                .ready_response(true, 0, "fixture", Some(&json!({})))
                .await
                .is_err()
        );
        service
            .respond_ready_check(true, 0, "fixture")
            .await
            .unwrap();
        let succeeded = service.snapshot().await.last_operation.unwrap();
        assert!(succeeded.revision > failed.revision);
        assert_eq!(succeeded.status, "Succeeded");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn hovercard_can_return_to_a_previously_selected_tier() {
        let (listener, acceptor, port) = fixture_listener();
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, request) = accept_http(&listener, &acceptor);
                assert!(request.starts_with("PUT /lol-chat/v1/me"));
                respond(&mut stream, 204, "");
            }
        });
        let service = fixture_service(port, "Lobby").await;
        for tier in ["Gold", "Emerald", "Gold"] {
            service
                .set_hovercard("RANKED_SOLO_5x5", tier, 0, "fixture")
                .await
                .unwrap();
        }
        service
            .set_hovercard("RANKED_SOLO_5x5", "Gold", 0, "fixture")
            .await
            .unwrap();
        server.join().unwrap();
    }

    #[test]
    fn dot_segments_cannot_normalize_to_other_endpoints() {
        assert!(ReadOperation::SummonerByPuuid("..".into()).path().is_err());
        assert!(ReadOperation::SummonerByPuuid(".".into()).path().is_err());
    }
    #[test]
    fn endpoint_inputs_cannot_escape_loopback_paths() {
        assert!(
            ReadOperation::PlayerMatches {
                puuid: "fixture-player".into(),
                count: 0
            }
            .path()
            .is_err()
        );
        assert!(
            ReadOperation::PlayerMatches {
                puuid: "fixture-player".into(),
                count: 11
            }
            .path()
            .is_err()
        );
        assert_eq!(
            ReadOperation::PlayerMatches {
                puuid: "fixture-player".into(),
                count: 10
            }
            .path()
            .unwrap(),
            "/lol-match-history/v1/products/lol/fixture-player/matches?begIndex=0&endIndex=9"
        );
        assert!(
            ReadOperation::PlayerMatches {
                puuid: "../other".into(),
                count: 5
            }
            .path()
            .is_err()
        );
        assert_eq!(
            ReadOperation::PlayerMatches {
                puuid: "fixture-player".into(),
                count: 5
            }
            .path()
            .unwrap(),
            "/lol-match-history/v1/products/lol/fixture-player/matches?begIndex=0&endIndex=4"
        );
        assert!(
            ReadOperation::HistoryGame("1/../../x".into())
                .path()
                .is_err()
        );
        assert!(
            ReadOperation::SummonerByPuuid("x?url=https://example.com".into())
                .path()
                .is_err()
        );
        assert!(
            ReadOperation::Matches { begin: 0, end: 100 }
                .path()
                .is_err()
        );
        assert!(ReadOperation::Matches { begin: 20, end: 1 }.path().is_err());
        assert!(
            ReadOperation::SummonersById("18446744073709551615".into())
                .path()
                .is_ok()
        );
    }
    #[test]
    fn malformed_unknown_and_delete_events_are_safe() {
        for raw in ["", "[]", "[8]", "[8,1,{}]", "[8,\"unexpected\",{}]"] {
            assert!(parse_event(raw).is_none());
        }
        assert!(parse_event(&json!([8,"OnJsonApiEvent_lol-champ-select_v1_session",{"eventType":"Delete","data":null}]).to_string()).is_some());
    }
    #[tokio::test]
    async fn stale_intent_and_disconnect_clear_actionable_data() {
        let service = LcuService::new().unwrap();
        assert!(
            service
                .set_aram_preferences(vec![1], 1, "old")
                .await
                .is_err()
        );
        {
            let mut state = service.state.lock().await;
            state.snapshot.champ_select = json!({"chatDetails":{"multiUserChatId":"room"}});
            state.snapshot.aram_preferences = vec![1];
        }
        service.disconnected("Disconnected").await;
        let snapshot = service.snapshot().await;
        assert!(snapshot.champ_select.is_null());
        assert!(snapshot.aram_preferences.is_empty());
        assert!(
            service
                .checked_session(snapshot.generation, &snapshot.session_key)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn claim_is_retained_across_reconnect_and_timeout() {
        let service = LcuService::new().unwrap();
        assert!(service.claim("ranked:room".into()).await);
        service.disconnected("Reconnecting").await;
        assert!(!service.claim("ranked:room".into()).await);
    }
}
