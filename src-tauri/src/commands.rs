use crate::{
    AppState,
    config::AppConfig,
    error::{AppError, AppResult},
    lcu::ReadOperation,
};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use tauri::{Manager, State};
fn guard(window: &tauri::WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::new("Unauthorized", "Unknown window"))
    }
}
fn lock_error() -> AppError {
    AppError::new("Internal", "Storage unavailable")
}
#[tauri::command]
pub fn show_main_window(window: tauri::WebviewWindow, state: State<'_, AppState>) -> AppResult<()> {
    guard(&window)?;
    window
        .show()
        .map_err(|_| AppError::new("Io", "Cannot show main window"))?;
    state.window_ready.store(true, Ordering::SeqCst);
    crate::desktop::schedule_topmost_update(window.app_handle());
    window
        .set_focus()
        .map_err(|_| AppError::new("Io", "Cannot focus main window"))?;
    Ok(())
}
#[tauri::command]
pub async fn bootstrap(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    let snapshot = state.snapshot().await?;
    crate::desktop::schedule_topmost_update(window.app_handle());
    Ok(snapshot)
}
#[tauri::command]
pub fn update_config(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    config: AppConfig,
    expected_revision: u64,
) -> AppResult<Value> {
    guard(&window)?;
    let mut store = state.config.lock().map_err(|_| lock_error())?;
    if state.config_revision.load(Ordering::SeqCst) != expected_revision {
        return Err(AppError::new(
            "StaleConfig",
            "Settings changed; refresh before saving",
        ));
    }
    let config = store.update(config)?;
    let config_revision = state.config_revision.fetch_add(1, Ordering::SeqCst) + 1;
    state
        .config_tx
        .send_replace(serde_json::to_value(&config).map_err(|_| lock_error())?);
    drop(store);
    window
        .set_theme(config.window_theme())
        .map_err(|_| AppError::new("Io", "Cannot update theme"))?;
    window
        .set_background_color(Some(crate::desktop::theme_background(
            config.resolve_dark(window.theme().unwrap_or(tauri::Theme::Dark)),
            &config.design_theme,
        )))
        .map_err(|_| AppError::new("Io", "Cannot update window background"))?;
    crate::desktop::update_topmost(window.app_handle())?;
    Ok(json!({"config":config,"configRevision":config_revision}))
}
#[tauri::command]
pub async fn get_gameflow_session(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::Gameflow).await
}
#[tauri::command]
pub async fn get_gameflow_phase(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::Phase).await
}
#[tauri::command]
pub async fn get_champ_select_session(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::ChampSelect).await
}
#[tauri::command]
pub async fn get_current_summoner(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::CurrentSummoner).await
}
#[tauri::command]
pub async fn get_lobby_members(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::LobbyMembers).await
}
#[tauri::command]
pub async fn get_pickable_champion_ids(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::PickableChampions).await
}
#[tauri::command]
pub async fn get_summoners_by_id(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    summoner_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::SummonersById(summoner_id)).await
}
#[tauri::command]
pub async fn get_summoner_by_puuid(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    puuid: String,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::SummonerByPuuid(puuid)).await
}
#[tauri::command]
pub async fn get_history_game(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    game_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    state.query(ReadOperation::HistoryGame(game_id)).await
}
#[tauri::command]
pub async fn get_player_matches(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    puuid: String,
    count: u32,
) -> AppResult<Value> {
    guard(&window)?;
    state
        .query(ReadOperation::PlayerMatches { puuid, count })
        .await
}

#[tauri::command]
pub async fn get_live_players(window: tauri::WebviewWindow) -> AppResult<Value> {
    guard(&window)?;
    crate::live::read_players().await
}
#[tauri::command]
pub async fn get_ranked_stats(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    summoner_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    let before = state.lcu.snapshot().await;
    let summoners = state
        .query(ReadOperation::SummonersById(summoner_id))
        .await?;
    let puuid = summoners[0]["puuid"]
        .as_str()
        .ok_or_else(|| AppError::new("Unavailable", "Player is unavailable"))?;
    let current = state.lcu.snapshot().await;
    if before.generation != current.generation || before.session_key != current.session_key {
        return Err(AppError::new("StaleSession", "Client session changed"));
    }
    state
        .query(ReadOperation::RankedByPuuid(puuid.into()))
        .await
}
#[tauri::command]
pub async fn get_current_summoner_matches(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    beg_index: u32,
    end_index: u32,
) -> AppResult<Value> {
    guard(&window)?;
    state
        .query(ReadOperation::Matches {
            begin: beg_index,
            end: end_index,
        })
        .await
}
#[tauri::command]
pub async fn get_versions(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.external.versions().await
}
#[tauri::command]
pub async fn get_champions_balance(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.external.balance().await
}
#[tauri::command]
pub async fn get_latest_release(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.external.latest_release().await
}
#[tauri::command]
pub async fn get_champions(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    locale: String,
) -> AppResult<Value> {
    guard(&window)?;
    state.external.champions(&locale).await
}
#[tauri::command]
pub async fn get_champion_icon(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    champion_id: u32,
    refresh: bool,
) -> AppResult<crate::champion_icons::ChampionIcon> {
    guard(&window)?;
    state.champion_icons.get(champion_id, refresh).await
}
#[tauri::command]
pub async fn respond_ready_check(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    action: String,
    connection_generation: u64,
    session_key: String,
) -> AppResult<Value> {
    guard(&window)?;
    if !["accept", "decline"].contains(&action.as_str()) {
        return Err(AppError::new("InvalidInput", "Invalid response"));
    }
    state
        .lcu
        .respond_ready_check(action == "accept", connection_generation, &session_key)
        .await
}
#[tauri::command]
pub async fn swap_bench_champion(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    champion_id: u32,
    connection_generation: u64,
    session_key: String,
) -> AppResult<Value> {
    guard(&window)?;
    state
        .lcu
        .swap_bench(champion_id, connection_generation, &session_key)
        .await
}
#[tauri::command]
pub async fn set_aram_preferences(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    champion_ids: Vec<u32>,
    connection_generation: u64,
    session_key: String,
) -> AppResult<Value> {
    guard(&window)?;
    state
        .lcu
        .set_aram_preferences(champion_ids, connection_generation, &session_key)
        .await?;
    Ok(json!(state.lcu.snapshot().await.aram_preferences))
}
#[tauri::command]
pub async fn set_hovercard(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    queue: String,
    tier: String,
    connection_generation: u64,
    session_key: String,
) -> AppResult<Value> {
    guard(&window)?;
    state
        .lcu
        .set_hovercard(&queue, &tier, connection_generation, &session_key)
        .await
}
#[tauri::command]
pub fn history_save_games(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    owner_puuid: String,
    games: Vec<Value>,
) -> AppResult<usize> {
    guard(&window)?;
    state
        .history
        .lock()
        .map_err(|_| lock_error())?
        .save_games(&owner_puuid, &games)
}
#[tauri::command]
pub fn history_list_games(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    owner_puuid: String,
    limit: u32,
) -> AppResult<Vec<Value>> {
    guard(&window)?;
    state
        .history
        .lock()
        .map_err(|_| lock_error())?
        .list_games(&owner_puuid, limit)
        .map(|games| games.into_iter().map(crate::dto::public_value).collect())
}
#[tauri::command]
pub fn history_trim(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    owner_puuid: String,
    retain_count: u32,
) -> AppResult<usize> {
    guard(&window)?;
    state
        .history
        .lock()
        .map_err(|_| lock_error())?
        .trim(&owner_puuid, retain_count)
}
#[tauri::command]
pub fn set_always_on_top(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    value: bool,
) -> AppResult<bool> {
    guard(&window)?;
    let mut store = state.config.lock().map_err(|_| lock_error())?;
    let mut config = store.get();
    config.always_on_top = value;
    let config = store.update(config)?;
    state.config_revision.fetch_add(1, Ordering::SeqCst);
    state
        .config_tx
        .send_replace(serde_json::to_value(&config).map_err(|_| lock_error())?);
    drop(store);
    crate::desktop::update_topmost(window.app_handle())?;

    Ok(value)
}
#[tauri::command]
pub fn open_external(window: tauri::WebviewWindow, url: String) -> AppResult<()> {
    guard(&window)?;
    crate::desktop::open_external(window.app_handle(), &url)
}
#[tauri::command]
pub fn write_clipboard(window: tauri::WebviewWindow, text: String) -> AppResult<()> {
    guard(&window)?;
    crate::desktop::clipboard(text)
}
#[tauri::command]
pub fn terminate_league_processes(
    window: tauri::WebviewWindow,
) -> AppResult<Vec<crate::desktop::ProcessResult>> {
    guard(&window)?;
    crate::desktop::terminate_league()
}

#[tauri::command]
pub fn history_existing_game_ids(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    owner_puuid: String,
    game_ids: Vec<String>,
) -> AppResult<Vec<String>> {
    guard(&window)?;
    let mut ids: Vec<_> = state
        .history
        .lock()
        .map_err(|_| lock_error())?
        .existing_game_ids(&owner_puuid, &game_ids)?
        .into_iter()
        .collect();
    ids.sort_unstable();
    Ok(ids)
}

#[tauri::command]
pub async fn get_online_count(window: tauri::WebviewWindow) -> AppResult<Value> {
    guard(&window)?;
    crate::online_count::read().await
}
