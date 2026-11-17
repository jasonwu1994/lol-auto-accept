use super::{ReplayGameMeta, store::SearchItem};
use crate::{
    AppState,
    error::{AppError, AppResult},
};
use serde_json::Value;
use tauri::State;

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
pub async fn get_match_history_context(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.match_history.context().await
}

#[tauri::command]
pub async fn get_match_history_profile(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.profile(&scope, &puuid).await
}

#[tauri::command]
pub async fn get_match_history_ranked(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.ranked(&scope, &puuid).await
}

#[tauri::command]
pub async fn get_match_history_mastery(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.mastery(&scope, &puuid).await
}

#[tauri::command]
pub async fn get_match_history_mastery_top(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
    count: u32,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.mastery_top(&scope, &puuid, count).await
}

#[tauri::command]
pub async fn get_match_history_page(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
    beg_index: u32,
    end_index: u32,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.page(&scope, &puuid, beg_index, end_index).await
}

#[tauri::command]
pub async fn get_match_history_game(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.game(&scope, &game_id).await
}

#[tauri::command]
pub async fn get_match_history_timeline(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.timeline(&scope, &game_id).await
}

#[tauri::command]
pub async fn get_match_history_sgp_page(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
    start_index: u32,
    count: u32,
    tag: Option<String>,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service
        .sgp_page(&scope, &puuid, start_index, count, tag)
        .await
}

#[tauri::command]
pub async fn get_match_history_sgp_details(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.sgp_details(&scope, &game_id).await
}

#[tauri::command]
pub async fn get_match_history_collection(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    puuid: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.sgp_collection(&scope, &puuid).await
}

#[tauri::command]
pub async fn search_match_history_players(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_name: String,
    tag_line: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.search(&scope, &game_name, &tag_line).await
}

#[tauri::command]
pub async fn get_match_history_game_data(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    kind: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.game_data(&scope, &kind).await
}

#[tauri::command]
pub async fn get_match_history_augment_text(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    guard(&window)?;
    state.match_history.augment_text().await
}

#[tauri::command]
pub async fn get_match_replay_state(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.replay_state(&scope, &game_id).await
}

#[tauri::command]
pub async fn create_match_replay_metadata(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
    meta: ReplayGameMeta,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.create_replay_metadata(&scope, &game_id, meta).await
}

#[tauri::command]
pub async fn run_match_replay_action(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    scope: String,
    game_id: String,
    action: String,
) -> AppResult<Value> {
    guard(&window)?;
    let service = &state.match_history;
    let scope = service.scope(&scope).await?;
    service.replay_action(&scope, &game_id, &action).await
}

#[tauri::command]
pub fn get_match_history_search_history(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<SearchItem>> {
    guard(&window)?;
    Ok(state
        .match_history
        .store
        .lock()
        .map_err(|_| lock_error())?
        .search_history())
}

#[tauri::command]
pub fn update_match_history_search_history(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    action: String,
    item: SearchItem,
) -> AppResult<Vec<SearchItem>> {
    guard(&window)?;
    let mut store = state.match_history.store.lock().map_err(|_| lock_error())?;
    match action.as_str() {
        "save" => store.save_search(item),
        "delete" => store.delete_search(&item.platform_id, &item.puuid),
        "pin" => store.toggle_pin(&item.platform_id, &item.puuid),
        _ => Err(AppError::new(
            "InvalidInput",
            "Unknown search history action",
        )),
    }
}

/// `lolasset://` handler: serves validated game-data images to the main window only.
pub fn serve_asset(
    app: &tauri::AppHandle,
    label: &str,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    use tauri::Manager;
    let reject = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            .body(Vec::new())
            .unwrap_or_default()
    };
    if label != "main" || request.method() != tauri::http::Method::GET {
        responder.respond(reject(403));
        return;
    }
    let path = request.uri().path().to_owned();
    let path = percent_decode(&path);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let service = &state.match_history;
        let response = match service.assets.get(service.lcu(), &path).await {
            Ok((bytes, mime)) => tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Cache-Control", "max-age=86400")
                .header("X-Content-Type-Options", "nosniff")
                .body(bytes.as_ref().clone())
                .unwrap_or_else(|_| reject(500)),
            Err(error) if error.code == "InvalidInput" => reject(400),
            Err(_) => reject(404),
        };
        responder.respond(response);
    });
}

/// Decodes `%20`-style escapes the webview applies to spaces; any other escape is
/// left encoded so validation rejects it.
fn percent_decode(path: &str) -> String {
    path.replace("%20", " ")
}
