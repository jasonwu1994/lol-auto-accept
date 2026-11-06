pub mod automation;
mod champion_icons;
mod commands;
pub mod config;
mod desktop;
mod dto;
pub mod error;
pub mod external;
pub mod history;
pub mod lcu;
mod live;
mod online_count;
mod topmost;
use error::{AppError, AppResult};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
pub struct AppState {
    config: Mutex<config::ConfigStore>,
    history: Arc<Mutex<history::HistoryStore>>,
    lcu: Arc<lcu::LcuService>,
    external: Arc<external::ExternalData>,
    champion_icons: champion_icons::ChampionIcons,
    config_tx: watch::Sender<Value>,
    shutdown: CancellationToken,
    revision: AtomicU64,
    config_revision: AtomicU64,
    snapshot_gate: tokio::sync::Mutex<()>,
    window_ready: AtomicBool,
    window_resize_revision: AtomicU64,
    topmost: Mutex<topmost::TopmostPolicy>,
}
impl AppState {
    async fn query(&self, operation: lcu::ReadOperation) -> AppResult<Value> {
        self.lcu.query(operation).await.map(dto::public_value)
    }
    async fn snapshot(&self) -> AppResult<Value> {
        let _capture = self.snapshot_gate.lock().await;
        let snapshot = self.lcu.snapshot().await;
        let store = self
            .config
            .lock()
            .map_err(|_| AppError::new("Internal", "Configuration unavailable"))?;
        let config = store.get();
        let startup_warning = store.recovery_warning();
        drop(store);
        let value = json!({"connection":snapshot.connection,"phase":snapshot.phase,
            "gameflowSession":snapshot.gameflow,"champSelectSession":snapshot.champ_select});
        self.topmost
            .lock()
            .map_err(|_| AppError::new("Internal", "Window policy unavailable"))?
            .observe(&value);
        Ok(dto::public_value(
            json!({"appVersion":env!("CARGO_PKG_VERSION"),"startupWarning":startup_warning,"config":config,"configRevision":self.config_revision.load(Ordering::SeqCst),"connection":snapshot.connection,
        "connectionGeneration":snapshot.generation,"sessionKey":snapshot.session_key,"revision":self.revision.fetch_add(1,Ordering::SeqCst),
        "phase":snapshot.phase,"gameflowSession":snapshot.gameflow,"champSelectSession":snapshot.champ_select,
        "currentSummoner":snapshot.current_summoner,"lobbyMembers":snapshot.lobby_members,"aramPreferences":snapshot.aram_preferences,
        "automationBlocked":snapshot.automation_blocked.or_else(||(std::env::var("LOL_APP_READ_ONLY").as_deref()==Ok("1")).then(||"Read-only validation mode is active".into())),"lastOperation":snapshot.last_operation}),
        ))
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_|desktop::show(app)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::get_online_count,commands::get_champion_icon,commands::get_player_matches,commands::get_live_players,commands::show_main_window,commands::bootstrap,commands::update_config,commands::get_gameflow_session,commands::get_gameflow_phase,commands::get_champ_select_session,commands::get_current_summoner,commands::get_lobby_members,commands::get_pickable_champion_ids,commands::get_summoners_by_id,commands::get_summoner_by_puuid,commands::get_ranked_stats,commands::get_current_summoner_matches,commands::get_history_game,commands::get_champions,commands::get_champions_balance,commands::get_versions,commands::get_latest_release,commands::respond_ready_check,commands::set_aram_preferences,commands::swap_bench_champion,commands::set_hovercard,commands::history_save_games,commands::history_list_games,commands::history_existing_game_ids,commands::history_trim,commands::set_always_on_top,commands::open_external,commands::write_clipboard,commands::terminate_league_processes])
        .setup(|app|{
            let config_dir=app.path().app_config_dir()?;
            let legacy_data_dir=app.path().app_local_data_dir()?;
            let executable=std::env::current_exe()?;
            let executable_dir=executable.parent().ok_or("Executable directory is unavailable")?;
            let legacy_candidates=[config_dir.join("app-config.json"),executable_dir.join("app-config.json"),executable_dir.join("resources/app/app-config.json")];
            let config=config::ConfigStore::open_with_legacy(&config_dir,&legacy_candidates)?;
            let initial=config.get();
            let history=Arc::new(Mutex::new(history::HistoryStore::open_with_legacy(&config_dir.join("history"),&legacy_data_dir)?));
            let external=Arc::new(external::ExternalData::new()?);
            let champion_icons=champion_icons::ChampionIcons::new(config_dir.join("cache/champions"))?;
            let lcu=lcu::LcuService::new()?;
            lcu.configure_data_sources(history.clone(),external.clone())?;
            let (config_tx,config_rx)=watch::channel(serde_json::to_value(&initial)?);
            let shutdown=CancellationToken::new();
            let mut events=lcu.subscribe();
            let mut config_events=config_tx.subscribe();
            app.manage(AppState{config:Mutex::new(config),history,lcu:lcu.clone(),external,champion_icons,config_tx,shutdown:shutdown.clone(),revision:AtomicU64::new(1),config_revision:AtomicU64::new(0),snapshot_gate:tokio::sync::Mutex::new(()),window_ready:AtomicBool::new(false),window_resize_revision:AtomicU64::new(0),topmost:Mutex::new(topmost::TopmostPolicy::default())});
            let analytics_handle = app.handle().clone();
            let analytics_shutdown = shutdown.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(120));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                interval.tick().await;
                loop {
                    tokio::select! {
                        _ = analytics_shutdown.cancelled() => break,
                        _ = interval.tick() => { let _ = analytics_handle.emit("analytics-heartbeat", ()); }
                    }
                }
            });
            let window_config=app.config().app.windows.iter().find(|window|window.label=="main").ok_or("Missing main window configuration")?;
            let mut window_builder=tauri::WebviewWindowBuilder::from_config(app,window_config)?
                .theme(initial.window_theme())
                .background_color(desktop::theme_background(initial.is_dark_mode, &initial.design_theme))
                .always_on_top(initial.always_on_top)
                .initialization_script(format!("window.__LOL_INITIAL_DARK_MODE__ = {}; window.__LOL_INITIAL_DESIGN_THEME__ = {}; window.__LOL_INITIAL_APPEARANCE_MODE__ = {};",initial.is_dark_mode,serde_json::to_string(&initial.design_theme)?,serde_json::to_string(&initial.appearance_mode)?));
            if let Some(size)=initial.window_size {
                window_builder=window_builder.inner_size(size.width as f64,size.height as f64);
            }
            let window=window_builder.build()?;
            window.set_background_color(Some(desktop::theme_background(initial.resolve_dark(window.theme().unwrap_or(tauri::Theme::Dark)), &initial.design_theme)))?;
            desktop::schedule_topmost_update(app.handle());
            if let Some(position)=initial.window_position {desktop::restore_window_position(&window,position)?;}
            let handle=app.handle().clone();
            let event_shutdown=shutdown.clone();
            tauri::async_runtime::spawn(async move{
                loop {
                    tokio::select!{
                        _=event_shutdown.cancelled()=>break,
                        _=config_events.changed()=>{if let Ok(snapshot)=handle.state::<AppState>().snapshot().await{let _=desktop::update_topmost(&handle);let _=handle.emit("app-state-changed",snapshot);}},
                        result=events.recv()=>{
                            match result {Err(tokio::sync::broadcast::error::RecvError::Closed)=>break,_=>{
                                if let Ok(snapshot)=handle.state::<AppState>().snapshot().await {let _=desktop::update_topmost(&handle);let _=handle.emit("app-state-changed",snapshot);}
                            }}
                        }
                    }
                }
            });
            tauri::async_runtime::spawn(lcu.run(config_rx,shutdown));
            let open=tauri::menu::MenuItem::with_id(app,"open","Open",true,None::<&str>)?;
            let exit=tauri::menu::MenuItem::with_id(app,"exit","Exit",true,None::<&str>)?;
            let menu=tauri::menu::Menu::with_items(app,&[&open,&exit])?;
            tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().ok_or("Missing application icon")?.clone())
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app,event|match event.id.as_ref(){"open"=>desktop::show(app),"exit"=>{app.state::<AppState>().shutdown.cancel();app.exit(0);},_=>{}})
                .on_tray_icon_event(|tray,event|{if matches!(event,tauri::tray::TrayIconEvent::Click{button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..}){desktop::show(tray.app_handle());}})
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window,event|{
            if window.label()!="main" {return;}
            match event {
                tauri::WindowEvent::Resized(_)|tauri::WindowEvent::Moved(_)=>{desktop::schedule_window_size_save(window);desktop::schedule_topmost_update(window.app_handle());},
                tauri::WindowEvent::CloseRequested{api,..}=>{
                    if let Err(error)=desktop::save_window_size(window){let _=window.emit("operation-result",json!({"error":error}));}
                    api.prevent_close();let _=window.hide();desktop::schedule_topmost_update(window.app_handle());
                },
                tauri::WindowEvent::ThemeChanged(theme)=>{
                    let state=window.state::<AppState>(); let config=state.config.lock().map(|store|store.get());
                    if let Ok(config)=config {let _=window.set_background_color(Some(desktop::theme_background(config.resolve_dark(*theme), &config.design_theme)));}
                },
                tauri::WindowEvent::Focused(_)=>desktop::schedule_topmost_update(window.app_handle()),
                _=>{}
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize application")
        .run(|app,event|{if matches!(event,tauri::RunEvent::Exit|tauri::RunEvent::ExitRequested{..}){
            if let Some(window)=app.get_webview_window("main"){let _=desktop::save_window_size(&window.as_ref().window());}
            app.state::<AppState>().shutdown.cancel();
        }});
}
