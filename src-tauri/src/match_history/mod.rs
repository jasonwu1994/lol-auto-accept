//! Match-history page backend: named, validated LCU reads scoped to one connection
//! generation and account, game-data assets, Tencent augment text and search history.
//!
//! Every client path is produced by [`HistoryRead::path`] from typed, validated input;
//! the frontend never supplies a host, method or raw path.

pub mod assets;
pub mod commands;
pub mod sgp;
pub mod store;

use crate::{
    error::{AppError, AppResult},
    lcu::{LcuService, ReadScope, validate_identifier},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

/// Upstream completes up to 10 summaries and 5 timelines at once.
const GAME_CONCURRENCY: usize = 10;
const TIMELINE_CONCURRENCY: usize = 5;
const REPLAY_CONCURRENCY: usize = 5;
/// LCU returns at most 100 games per request; larger pages are split.
const PAGE_CHUNK: u32 = 100;
const MAX_PAGE_SPAN: u32 = 200;
/// Collect mode scans at most 1000 games; regular paging may go further back.
const MAX_INDEX: u32 = 1999;
const AUGMENT_TEXT_URL: &str =
    "https://game.gtimg.cn/images/lol/act/img/js/kiwi/kiwi_augments.json";
const AUGMENT_TEXT_REFRESH: Duration = Duration::from_secs(3 * 60 * 60);
const AUGMENT_TEXT_RETRY: Duration = Duration::from_secs(60);

pub const GAME_DATA_KINDS: [&str; 12] = [
    "game-mode-mutators",
    "map-assets",
    "game-queues",
    "items",
    "summoner-spells",
    "perks",
    "perkstyles",
    "queues",
    "maps",
    "cherry-augments",
    "champion-summary",
    "challenges",
];

#[derive(Clone, Debug, PartialEq)]
pub enum HistoryRead {
    Summoner(String),
    Profile(String),
    Ranked(String),
    Matches { puuid: String, begin: u32, end: u32 },
    Game(String),
    Timeline(String),
    Mastery(String),
    GameData(String),
    RegionLocale,
    RsoAuthorization,
    GameVersion,
    ReplayConfiguration,
    ReplayMetadata(String),
    EntitlementsToken,
    LeagueSessionToken,
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

impl HistoryRead {
    pub fn path(&self) -> AppResult<String> {
        Ok(match self {
            Self::Summoner(puuid) => {
                validate_identifier(puuid)?;
                format!("/lol-summoner/v2/summoners/puuid/{puuid}")
            }
            Self::Profile(puuid) => {
                validate_identifier(puuid)?;
                format!("/lol-summoner/v1/summoner-profile?puuid={puuid}")
            }
            Self::Ranked(puuid) => {
                validate_identifier(puuid)?;
                format!("/lol-ranked/v1/ranked-stats/{puuid}")
            }
            Self::Matches { puuid, begin, end } => {
                validate_identifier(puuid)?;
                if end < begin || end - begin >= PAGE_CHUNK || *end > MAX_INDEX {
                    return Err(AppError::new(
                        "InvalidInput",
                        "History page is out of range",
                    ));
                }
                format!(
                    "/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={begin}&endIndex={end}"
                )
            }
            Self::Game(id) => {
                numeric_id(id)?;
                format!("/lol-match-history/v1/games/{id}")
            }
            Self::Timeline(id) => {
                numeric_id(id)?;
                format!("/lol-match-history/v1/game-timelines/{id}")
            }
            Self::Mastery(puuid) => {
                validate_identifier(puuid)?;
                format!("/lol-champion-mastery/v1/{puuid}/champion-mastery")
            }
            Self::GameData(kind) => {
                if !GAME_DATA_KINDS.contains(&kind.as_str()) {
                    return Err(AppError::new("InvalidInput", "Unknown game data kind"));
                }
                match kind.as_str() {
                    "map-assets" => "/lol-game-data/assets/v1/map-assets/map-assets.json".into(),
                    // Live queue list: carries mapId and gameMode for the mode icons.
                    "game-queues" => "/lol-game-queues/v1/queues".into(),
                    _ => format!("/lol-game-data/assets/v1/{kind}.json"),
                }
            }
            Self::RegionLocale => "/riotclient/region-locale".into(),
            Self::RsoAuthorization => "/lol-rso-auth/v1/authorization".into(),
            Self::GameVersion => "/lol-patch/v1/game-version".into(),
            Self::ReplayConfiguration => "/lol-replays/v1/configuration".into(),
            Self::EntitlementsToken => "/entitlements/v1/token".into(),
            Self::LeagueSessionToken => "/lol-league-session/v1/league-session-token".into(),
            Self::ReplayMetadata(id) => {
                numeric_id(id)?;
                format!("/lol-replays/v1/metadata/{id}")
            }
        })
    }
}

/// `{ id, currentValue }` of the collection challenges present in all-player-data,
/// in upstream's display order.
pub fn collection_counts(data: &Value) -> Vec<Value> {
    let challenges = data["playerChallenges"].as_array();
    sgp::COLLECTION_CHALLENGES
        .iter()
        .filter_map(|id| {
            let challenge = challenges?
                .iter()
                .find(|challenge| challenge["id"].as_u64() == Some(*id))?;
            let value = challenge["currentValue"].as_f64()?;
            Some(serde_json::json!({ "id": id, "currentValue": value }))
        })
        .collect()
}

/// Splits an inclusive LCU index range into requests of at most 100 games.
pub fn page_chunks(begin: u32, end: u32) -> AppResult<Vec<(u32, u32)>> {
    if end < begin || end - begin >= MAX_PAGE_SPAN || end > MAX_INDEX {
        return Err(AppError::new(
            "InvalidInput",
            "History page is out of range",
        ));
    }
    let mut chunks = Vec::new();
    let mut start = begin;
    while start <= end {
        let stop = (start + PAGE_CHUNK - 1).min(end);
        chunks.push((start, stop));
        start = stop + 1;
    }
    Ok(chunks)
}

/// Merges chunked LCU pages, keeping upstream order and dropping repeated game IDs.
pub fn merge_pages(pages: Vec<Value>) -> AppResult<Value> {
    let mut seen = HashSet::new();
    let mut games = Vec::new();
    let mut first = None;
    for page in pages {
        let list = page
            .pointer("/games/games")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::new("InvalidInput", "Invalid match history"))?;
        for game in list {
            // Reads pass through `public_value`, which turns IDs into decimal strings
            // for JavaScript; accept both forms.
            let id = match &game["gameId"] {
                Value::Number(number) => number.to_string(),
                Value::String(text)
                    if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) =>
                {
                    text.clone()
                }
                _ => continue,
            };
            if seen.insert(id) {
                games.push(game.clone());
            }
        }
        if first.is_none() {
            first = Some(page);
        }
    }
    let mut merged = first.unwrap_or_else(|| json!({"games":{}}));
    let count = games.len();
    merged["games"]["games"] = Value::Array(games);
    merged["games"]["gameCount"] = json!(count);
    Ok(merged)
}

/// Normalizes the client region / RSO platform into the server ID used as part of tab keys.
pub fn server_id(region: &str, rso_platform: &str) -> String {
    let region = region.to_ascii_uppercase();
    let platform = rso_platform.to_ascii_uppercase();
    if region.is_empty() {
        return platform;
    }
    if region == "TENCENT" {
        return format!("TENCENT_{platform}");
    }
    match region.as_str() {
        "NA" => "NA1",
        "BR" => "BR1",
        "TR" => "TR1",
        "LAN" => "LA1",
        "LAS" => "LA2",
        "OCE" => "OC1",
        "EUW1" => "EUW",
        "JP1" => "JP",
        other => other,
    }
    .to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayGameMeta {
    pub game_version: Option<String>,
    pub game_type: Option<String>,
    pub queue_id: Option<i64>,
    pub game_end: Option<i64>,
}

struct AugmentText {
    value: Option<(Instant, Value)>,
    next_check: Instant,
}

pub struct MatchHistoryService {
    lcu: Arc<LcuService>,
    public: reqwest::Client,
    games: Semaphore,
    timelines: Semaphore,
    replays: Semaphore,
    game_data: Mutex<HashMap<(u64, String), Value>>,
    sgp_client: reqwest::Client,
    sgp_server: Mutex<Option<(u64, Option<sgp::Server>)>>,
    augment_text: Mutex<AugmentText>,
    pub assets: assets::AssetCache,
    pub store: std::sync::Mutex<store::HistoryPreferences>,
}

impl MatchHistoryService {
    pub fn new(
        lcu: Arc<LcuService>,
        cache_dir: std::path::PathBuf,
        store_path: std::path::PathBuf,
    ) -> AppResult<Self> {
        let public = reqwest::Client::builder()
            .user_agent("lol-auto-accept")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| AppError::new("Internal", "Cannot initialize public data client"))?;
        let sgp_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| AppError::new("Internal", "Cannot initialize SGP client"))?;
        Ok(Self {
            lcu,
            sgp_client,
            sgp_server: Mutex::new(None),
            public: public.clone(),
            games: Semaphore::new(GAME_CONCURRENCY),
            timelines: Semaphore::new(TIMELINE_CONCURRENCY),
            replays: Semaphore::new(REPLAY_CONCURRENCY),
            game_data: Mutex::new(HashMap::new()),
            augment_text: Mutex::new(AugmentText {
                value: None,
                next_check: Instant::now(),
            }),
            assets: assets::AssetCache::new(cache_dir, public)?,
            store: std::sync::Mutex::new(store::HistoryPreferences::open(store_path)?),
        })
    }

    pub fn lcu(&self) -> &Arc<LcuService> {
        &self.lcu
    }

    async fn get(&self, scope: &ReadScope, read: HistoryRead) -> AppResult<Value> {
        let path = read.path()?;
        let permit = match read {
            HistoryRead::Game(_) => Some(self.games.acquire().await),
            HistoryRead::Timeline(_) => Some(self.timelines.acquire().await),
            HistoryRead::ReplayMetadata(_) => Some(self.replays.acquire().await),
            _ => None,
        };
        if let Some(Err(_)) = permit {
            return Err(AppError::new("Internal", "History worker stopped"));
        }
        self.lcu
            .scoped_get(scope, &path)
            .await
            .map(crate::dto::public_value)
    }

    async fn optional(&self, scope: &ReadScope, read: HistoryRead) -> Value {
        self.get(scope, read).await.unwrap_or(Value::Null)
    }

    pub async fn scope(&self, token: &str) -> AppResult<ReadScope> {
        let scope = ReadScope::parse(token)?;
        match self.lcu.read_scope().await {
            Some(current) if current == scope => Ok(scope),
            Some(_) => Err(AppError::new(
                "StaleSession",
                "The client session has changed",
            )),
            None => Err(AppError::new(
                "Disconnected",
                "League client is not connected",
            )),
        }
    }

    pub async fn context(&self) -> AppResult<Value> {
        let Some(scope) = self.lcu.read_scope().await else {
            return Ok(json!({"connected": false}));
        };
        let me = self
            .get(&scope, HistoryRead::Summoner(scope.account.clone()))
            .await?;
        let region = self.optional(&scope, HistoryRead::RegionLocale).await;
        let rso = self.optional(&scope, HistoryRead::RsoAuthorization).await;
        let version = self.optional(&scope, HistoryRead::GameVersion).await;
        let region_code = region["region"].as_str().unwrap_or_default();
        let rso_platform = rso["currentPlatformId"].as_str().unwrap_or_default();
        let platform = server_id(region_code, rso_platform);
        Ok(json!({
            "connected": true,
            "scope": scope.token(),
            "generation": scope.generation,
            "me": me,
            "platformId": platform,
            "region": region_code,
            "rsoPlatformId": rso_platform,
            "locale": region["locale"],
            "gameVersion": version,
            "capabilities": {
                "lcu": {"matchHistory": true, "game": true, "timeline": true, "ranked": true, "mastery": true, "search": true, "replays": true},
                // SGP reads target only the connected client's own server (no
                // cross-region tabs yet); the token is never sent to the page.
                "sgp": {
                    "available": sgp::Server::find(&platform).is_some(),
                    "serverId": platform,
                    "queues": sgp::SUPPORTED_QUEUES,
                }
            }
        }))
    }

    pub async fn profile(&self, scope: &ReadScope, puuid: &str) -> AppResult<Value> {
        let summoner = self.get(scope, HistoryRead::Summoner(puuid.into())).await?;
        let profile = self
            .optional(scope, HistoryRead::Profile(puuid.into()))
            .await;
        Ok(json!({"summoner": summoner, "profile": profile}))
    }

    pub async fn ranked(&self, scope: &ReadScope, puuid: &str) -> AppResult<Value> {
        self.get(scope, HistoryRead::Ranked(puuid.into())).await
    }

    /// Upstream sidebar: the client's top-N endpoint (POST with `skipCache`), which
    /// also returns the total mastery score.
    pub async fn mastery_top(
        &self,
        scope: &ReadScope,
        puuid: &str,
        count: u32,
    ) -> AppResult<Value> {
        validate_identifier(puuid)?;
        if !(1..=200).contains(&count) {
            return Err(AppError::new(
                "InvalidInput",
                "Mastery count is out of range",
            ));
        }
        self.lcu
            .scoped_post(
                scope,
                &format!("/lol-champion-mastery/v1/{puuid}/champion-mastery/top?count={count}"),
                Some(json!({"skipCache": true})),
            )
            .await
            .map(crate::dto::public_value)
    }

    pub async fn mastery(&self, scope: &ReadScope, puuid: &str) -> AppResult<Value> {
        match self.get(scope, HistoryRead::Mastery(puuid.into())).await {
            Err(error) if error.code == "Unsupported" => Ok(json!([])),
            other => other,
        }
    }

    pub async fn page(
        &self,
        scope: &ReadScope,
        puuid: &str,
        begin: u32,
        end: u32,
    ) -> AppResult<Value> {
        let mut pages = Vec::new();
        for (start, stop) in page_chunks(begin, end)? {
            let page = self
                .get(
                    scope,
                    HistoryRead::Matches {
                        puuid: puuid.into(),
                        begin: start,
                        end: stop,
                    },
                )
                .await?;
            let returned = page
                .pointer("/games/games")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            pages.push(page);
            // A short chunk means the history is exhausted; do not request past it.
            if returned < (stop - start + 1) as usize {
                break;
            }
        }
        let mut merged = merge_pages(pages)?;
        merged["requested"] = json!({"begIndex": begin, "endIndex": end});
        Ok(merged)
    }

    pub async fn game(&self, scope: &ReadScope, game_id: &str) -> AppResult<Value> {
        self.get(scope, HistoryRead::Game(game_id.into())).await
    }

    pub async fn timeline(&self, scope: &ReadScope, game_id: &str) -> AppResult<Value> {
        self.get(scope, HistoryRead::Timeline(game_id.into())).await
    }

    pub async fn search(
        &self,
        scope: &ReadScope,
        game_name: &str,
        tag_line: &str,
    ) -> AppResult<Value> {
        let game_name = game_name.trim();
        let tag_line = tag_line.trim().trim_start_matches('#');
        if game_name.is_empty()
            || game_name.chars().count() > 32
            || tag_line.is_empty()
            || tag_line.chars().count() > 8
            || game_name
                .chars()
                .chain(tag_line.chars())
                .any(char::is_control)
        {
            return Err(AppError::new("InvalidInput", "Enter a Riot ID as name#tag"));
        }
        self.lcu
            .scoped_post(
                scope,
                "/lol-summoner/v1/summoners/aliases",
                Some(json!([{"gameName": game_name, "tagLine": tag_line}])),
            )
            .await
            .map(crate::dto::public_value)
    }

    /// Game data is cached per connection generation; the client serves its own locale.
    pub async fn game_data(&self, scope: &ReadScope, kind: &str) -> AppResult<Value> {
        let key = (scope.generation, kind.to_owned());
        if let Some(value) = self.game_data.lock().await.get(&key) {
            return Ok(value.clone());
        }
        let value = self.get(scope, HistoryRead::GameData(kind.into())).await?;
        let mut cache = self.game_data.lock().await;
        cache.retain(|(generation, _), _| *generation == scope.generation);
        cache.insert(key, value.clone());
        Ok(value)
    }

    /// SGP server of the connected client, derived once per connection generation.
    async fn sgp_server(&self, scope: &ReadScope) -> AppResult<sgp::Server> {
        let mut cached = self.sgp_server.lock().await;
        let server = match *cached {
            Some((generation, server)) if generation == scope.generation => server,
            _ => {
                let region = self.get(scope, HistoryRead::RegionLocale).await?;
                let rso = self.optional(scope, HistoryRead::RsoAuthorization).await;
                let id = server_id(
                    region["region"].as_str().unwrap_or_default(),
                    rso["currentPlatformId"].as_str().unwrap_or_default(),
                );
                let server = sgp::Server::find(&id);
                *cached = Some((scope.generation, server));
                server
            }
        };
        server.ok_or_else(|| AppError::new("Unsupported", "No SGP server is known for this region"))
    }

    async fn sgp_get(&self, scope: &ReadScope, read: sgp::SgpRead) -> AppResult<Value> {
        let server = self.sgp_server(scope).await?;
        let url = read.url(&server)?;
        let token_read = match read.token() {
            sgp::SgpToken::Entitlements => HistoryRead::EntitlementsToken,
            sgp::SgpToken::LeagueSession => HistoryRead::LeagueSessionToken,
        };
        let mut last = AppError::new("SgpUnavailable", "SGP request failed");
        // Upstream retries twice; network errors and 5xx get one more try here.
        for attempt in 0..2 {
            let token = self.lcu.scoped_get(scope, &token_read.path()?).await?;
            // Entitlements is an object; the league-session token is a bare JSON string.
            let token = match read.token() {
                sgp::SgpToken::Entitlements => token["accessToken"].as_str(),
                sgp::SgpToken::LeagueSession => token.as_str(),
            };
            let Some(token) = token.filter(|t| !t.is_empty()) else {
                return Err(AppError::new("SgpTokenNotReady", "SGP token is not ready"));
            };
            match self.sgp_fetch(&url, token, read.body()).await {
                Ok(value) => {
                    self.lcu.ensure_scope(scope).await?;
                    return Ok(value);
                }
                Err((error, retry)) => {
                    last = error;
                    if !retry || attempt == 1 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }
        Err(last)
    }

    async fn sgp_fetch(
        &self,
        url: &str,
        token: &str,
        body: Option<&'static str>,
    ) -> Result<Value, (AppError, bool)> {
        const MAX: usize = 48 * 1024 * 1024;
        let unavailable = || AppError::new("SgpUnavailable", "SGP request failed");
        let request = match body {
            Some(body) => self
                .sgp_client
                .post(url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body),
            None => self.sgp_client.get(url),
        };
        let mut response = request
            .bearer_auth(token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| (unavailable(), true))?;
        let status = response.status();
        if !status.is_success() {
            let code = match status.as_u16() {
                401 | 403 => "SgpUnauthorized",
                404 => "NotFound",
                429 => "RateLimited",
                _ => "SgpUnavailable",
            };
            return Err((
                AppError::new(code, "SGP request failed"),
                status.is_server_error(),
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| (unavailable(), true))? {
            if bytes.len() + chunk.len() > MAX {
                return Err((
                    AppError::new("InvalidInput", "SGP response is too large"),
                    false,
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| {
            (
                AppError::new("InvalidInput", "SGP response is malformed"),
                false,
            )
        })
    }

    pub async fn sgp_page(
        &self,
        scope: &ReadScope,
        puuid: &str,
        start: u32,
        count: u32,
        tag: Option<String>,
    ) -> AppResult<Value> {
        let read = sgp::SgpRead::Summary {
            puuid: puuid.to_owned(),
            start,
            count,
            tag,
        };
        let mut value = self.sgp_get(scope, read).await?;
        // Upstream drops entries the server returned without a `json` body.
        if let Some(games) = value["games"].as_array_mut() {
            games.retain(|game| game["json"].is_object());
        }
        Ok(value)
    }

    pub async fn sgp_details(&self, scope: &ReadScope, game_id: &str) -> AppResult<Value> {
        numeric_id(game_id)?;
        let id = game_id
            .parse::<u64>()
            .map_err(|_| AppError::new("InvalidInput", "A numeric identifier is required"))?;
        let _permit = self
            .timelines
            .acquire()
            .await
            .map_err(|_| AppError::new("Internal", "History worker stopped"))?;
        self.sgp_get(scope, sgp::SgpRead::Details(id)).await
    }

    /// Upstream "assets" (收藏) counts: the collection challenges' current values only,
    /// so the rest of the player's challenge data never reaches the page.
    pub async fn sgp_collection(&self, scope: &ReadScope, puuid: &str) -> AppResult<Value> {
        let value = self
            .sgp_get(scope, sgp::SgpRead::Collection(puuid.to_owned()))
            .await?;
        Ok(Value::Array(collection_counts(&value)))
    }

    /// Tencent's pre-rendered augment tooltips, refreshed every three hours; the last
    /// valid copy is kept when a refresh fails.
    pub async fn augment_text(&self) -> AppResult<Value> {
        let mut state = self.augment_text.lock().await;
        if Instant::now() >= state.next_check {
            match self.fetch_augment_text().await {
                Ok(value) => {
                    state.value = Some((Instant::now(), value));
                    state.next_check = Instant::now() + AUGMENT_TEXT_REFRESH;
                }
                Err(error) => {
                    state.next_check = Instant::now() + AUGMENT_TEXT_RETRY;
                    if state.value.is_none() {
                        return Err(error);
                    }
                }
            }
        }
        let (fetched, value) = state
            .value
            .as_ref()
            .ok_or_else(|| AppError::new("Unavailable", "Augment text is unavailable"))?;
        Ok(
            json!({"entries": value, "ageSeconds": fetched.elapsed().as_secs(), "source": "game.gtimg.cn"}),
        )
    }

    async fn fetch_augment_text(&self) -> AppResult<Value> {
        let mut response = self
            .public
            .get(AUGMENT_TEXT_URL)
            .send()
            .await
            .map_err(|_| AppError::new("Io", "Augment text unavailable"))?;
        if !response.status().is_success() {
            return Err(AppError::new("Io", "Augment text request failed"));
        }
        const MAX: usize = 4 * 1024 * 1024;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AppError::new("Io", "Augment text unavailable"))?
        {
            if bytes.len() + chunk.len() > MAX {
                return Err(AppError::new("InvalidInput", "Augment text is too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let raw: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::new("InvalidInput", "Augment text is malformed"))?;
        // Keep only the fields the page renders; tooltip is plain text in this source.
        let entries: Vec<Value> = raw
            .as_array()
            .ok_or_else(|| AppError::new("InvalidInput", "Augment text is malformed"))?
            .iter()
            .filter_map(|entry| {
                let id = entry["augmentID"].as_i64()?;
                let tooltip = entry["tooltip"].as_str()?;
                Some(json!({"id": id, "tooltip": tooltip.chars().take(2000).collect::<String>(), "mode": entry["mode"]}))
            })
            .collect();
        if entries.is_empty() {
            return Err(AppError::new("InvalidInput", "Augment text is empty"));
        }
        Ok(Value::Array(entries))
    }

    pub async fn replay_state(&self, scope: &ReadScope, game_id: &str) -> AppResult<Value> {
        let configuration = self.get(scope, HistoryRead::ReplayConfiguration).await?;
        if configuration["isReplaysEnabled"] != true
            || configuration["isReplaysForMatchHistoryEnabled"] == false
        {
            return Ok(json!({"enabled": false, "configuration": configuration}));
        }
        let metadata = self
            .get(scope, HistoryRead::ReplayMetadata(game_id.into()))
            .await?;
        Ok(json!({"enabled": true, "configuration": configuration, "metadata": metadata}))
    }

    /// Asks the client to look up replay availability for a game (upstream does this
    /// for every listed game before reading metadata).
    pub async fn create_replay_metadata(
        &self,
        scope: &ReadScope,
        game_id: &str,
        meta: ReplayGameMeta,
    ) -> AppResult<Value> {
        numeric_id(game_id)?;
        let mut version = meta.game_version.unwrap_or_default();
        let game_type = meta.game_type.unwrap_or_default();
        // LCU summaries carry no version: upstream uses the client's replay configuration,
        // and skips the game when replays are turned off.
        if version.is_empty() {
            let configuration = self.get(scope, HistoryRead::ReplayConfiguration).await?;
            if configuration["isReplaysEnabled"] != true {
                return Err(AppError::new("Unavailable", "Replays are turned off"));
            }
            version = configuration["gameVersion"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
        }
        if version.len() > 128 || game_type.len() > 64 {
            return Err(AppError::new("InvalidInput", "Replay metadata is invalid"));
        }
        {
            // Released before the metadata read below, which takes its own permit from the
            // same pool; holding both deadlocks once every permit waits for a second one.
            let _permit = self
                .replays
                .acquire()
                .await
                .map_err(|_| AppError::new("Internal", "History worker stopped"))?;
            self.lcu
                .scoped_post(
                    scope,
                    &format!("/lol-replays/v2/metadata/{game_id}/create"),
                    Some(json!({"gameVersion": version, "gameType": game_type, "queueId": meta.queue_id, "gameEnd": meta.game_end})),
                )
                .await?;
        }
        self.get(scope, HistoryRead::ReplayMetadata(game_id.into()))
            .await
    }

    pub async fn replay_action(
        &self,
        scope: &ReadScope,
        game_id: &str,
        action: &str,
    ) -> AppResult<Value> {
        numeric_id(game_id)?;
        if !["download", "watch"].contains(&action) {
            return Err(AppError::new("InvalidInput", "Unknown replay action"));
        }
        self.lcu
            .scoped_post(
                scope,
                &format!("/lol-replays/v1/rofls/{game_id}/{action}"),
                Some(json!({"componentType": "replay-button_match-history"})),
            )
            .await?;
        self.get(scope, HistoryRead::ReplayMetadata(game_id.into()))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_built_only_from_validated_inputs() {
        assert_eq!(
            HistoryRead::Matches {
                puuid: "abc-1".into(),
                begin: 0,
                end: 19
            }
            .path()
            .unwrap(),
            "/lol-match-history/v1/products/lol/abc-1/matches?begIndex=0&endIndex=19"
        );
        assert!(HistoryRead::Summoner("../x".into()).path().is_err());
        assert!(HistoryRead::Summoner("a/b".into()).path().is_err());
        assert!(HistoryRead::Game("12a".into()).path().is_err());
        assert!(
            HistoryRead::Game("18446744073709551616".into())
                .path()
                .is_err()
        );
        assert!(HistoryRead::GameData("../../x".into()).path().is_err());
        assert!(
            HistoryRead::Matches {
                puuid: "p".into(),
                begin: 0,
                end: 100
            }
            .path()
            .is_err()
        );
        assert_eq!(
            HistoryRead::Timeline("18446744073709551615".into())
                .path()
                .unwrap(),
            "/lol-match-history/v1/game-timelines/18446744073709551615"
        );
    }

    #[test]
    fn page_of_twenty_is_zero_to_nineteen_and_two_hundred_splits_in_two() {
        assert_eq!(page_chunks(0, 19).unwrap(), vec![(0, 19)]);
        assert_eq!(page_chunks(0, 199).unwrap(), vec![(0, 99), (100, 199)]);
        assert_eq!(page_chunks(150, 349).unwrap(), vec![(150, 249), (250, 349)]);
        assert!(page_chunks(0, 200).is_err());
        assert!(page_chunks(5, 4).is_err());
        assert!(page_chunks(1990, 2000).is_err());
    }

    #[test]
    fn merged_pages_keep_order_and_drop_repeats() {
        let a = json!({"platformId":"TW2","games":{"games":[{"gameId":3},{"gameId":2}]}});
        let b = json!({"games":{"games":[{"gameId":2},{"gameId":1},{"bad":true}]}});
        let merged = merge_pages(vec![a, b]).unwrap();
        let ids: Vec<_> = merged["games"]["games"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["gameId"].as_i64().unwrap())
            .collect();
        assert_eq!(ids, vec![3, 2, 1]);
        assert_eq!(merged["platformId"], "TW2");
        assert_eq!(merged["games"]["gameCount"], 3);
    }

    #[test]
    fn merged_pages_keep_games_whose_ids_were_already_made_strings() {
        // What `get()` actually returns: `public_value` has turned every gameId into a string.
        let page = crate::dto::public_value(
            json!({"games":{"games":[{"gameId":18446744073709551615u64},{"gameId":7},{"gameId":7}]}}),
        );
        let merged = merge_pages(vec![
            page,
            json!({"games":{"games":[{"gameId":"x1"},{"gameId":""}]}}),
        ])
        .unwrap();
        let ids: Vec<_> = merged["games"]["games"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["gameId"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(ids, vec!["18446744073709551615", "7"]);
    }

    #[test]
    fn collection_keeps_only_the_six_counts_in_upstream_order() {
        let data = serde_json::json!({
            "puuid": "p",
            "totalPoints": { "current": 10 },
            "playerChallenges": [
                { "id": 504004, "currentValue": 12.0, "category": "COLLECTION" },
                { "id": 505001, "currentValue": 168.0, "friendsAtLevels": [] },
                { "id": 402106, "currentValue": 3.0 },
                { "id": 510001, "currentValue": "bad" }
            ]
        });
        let counts = collection_counts(&data);
        assert_eq!(
            counts,
            vec![
                serde_json::json!({ "id": 505001, "currentValue": 168.0 }),
                serde_json::json!({ "id": 504004, "currentValue": 12.0 }),
            ]
        );
        assert!(collection_counts(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn server_ids_follow_upstream_aliases() {
        assert_eq!(server_id("NA", "NA1"), "NA1");
        assert_eq!(server_id("TENCENT", "hn10"), "TENCENT_HN10");
        assert_eq!(server_id("tw2", "TW2"), "TW2");
        assert_eq!(server_id("", "TW2"), "TW2");
        assert_eq!(server_id("EUW1", ""), "EUW");
    }

    #[test]
    fn scope_tokens_round_trip_and_reject_paths() {
        let scope = ReadScope::parse("7:abc-123").unwrap();
        assert_eq!(scope.generation, 7);
        assert_eq!(scope.token(), "7:abc-123");
        assert!(ReadScope::parse("x:abc").is_err());
        assert!(ReadScope::parse("1:a/b").is_err());
        assert!(ReadScope::parse("nocolon").is_err());
    }
}
