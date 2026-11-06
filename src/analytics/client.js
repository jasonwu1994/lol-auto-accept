import version from '../../package.json';
export const MEASUREMENT_ID = 'G-JDEJZFZKCV';
export const HEARTBEAT_MS = 120000;
const idKey = 'analytics-install-v1';
const screens = ['main','duo','rank','recentPlayers','aram','selectedRole','about'];
const events = new Set(['app_open','session_summary','heartbeat','screen_view','screen_engagement','setting_changed','appearance_changed','language_changed','action_requested','action_completed','automation_completed','lookup_completed','search_used','sort_changed','tab_changed','update_prompt_viewed','update_link_opened','external_link_opened','operation_failed']);
const tokens = new Set([...screens,'default','sky','lavender','mint','netflix','uber','spotify','coinbase','airbnb','discord','rabbit','RANKED_SOLO_5x5','RANKED_FLEX_SR','RANKED_BOTH','Iron','Bronze','Silver','Gold','Platinum','Emerald','Diamond','Master','Grandmaster','Challenger','unknown','foreground','background','success','partial','failed','uncertain','manual','automatic','accept','decline','terminate','bench_swap','clipboard','preferences','always_on_top','hovercard','ranked','recent','hidden_player_history','team_recovery','champions','balance','live_players','profile','release','github','deeplol','pick','solo','flex','ascending','descending','none','light','dark','system','zh','en','enabled','disabled','changed','session_changed','unavailable','timeout','invalid_input','other','under_1s','1s_to_3s','3s_to_10s','over_10s']);
const numeric = new Set(['duration_ms','engagement_time_msec','requested_count','completed_count','result_count','column_index','selected_count']);
export const settingKeys = ['isAutoAccept','isShowRecentTeammate','recentTeammateCheckGameCount','isCheckHiddenPlayerHistory','hiddenPlayerHistoryGameCount','isShowTeammateRanked','showTeammateRankedType','isHovercard','hovercardTierType','hovercardRankedType','language','isDarkMode','appearanceMode','designTheme','alwaysOnTop','isAutoAramTopmost','navOrder'];
export function sanitizeEvent(name, input = {}) {
  if (!events.has(name)) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (numeric.has(key) && Number.isFinite(value)) out[key] = Math.max(0, Math.min(86400000, Math.round(value)));
    else if (['screen','visibility','result','trigger','feature','action','target','tab','direction','error_code','duration_bucket','value'].includes(key) && tokens.has(value)) out[key] = value;
    else if (key === 'value' && Number.isInteger(value) && value >= 0 && value <= 100) out[key] = value;
    else if (key === 'setting' && settingKeys.includes(value)) out[key] = value;
  }
  return {name, params: out};
}
export const durationBucket = ms => ms < 1000 ? 'under_1s' : ms < 3000 ? '1s_to_3s' : ms < 10000 ? '3s_to_10s' : 'over_10s';
export const errorCode = error => ({StaleSession:'session_changed',Unavailable:'unavailable',Timeout:'timeout',InvalidInput:'invalid_input'})[error?.code] ?? 'other';
let enabled = false, started = false, screen = 'main', lastActivity = 0, sessionStarted = 0, lastSummary = 0, lastTick = 0, engagement = 0, script, loaded = false;
function storage() {try {return globalThis.localStorage;} catch {return null;}}
function command(...args) {try {globalThis.window?.gtag?.(...args);} catch { /* Analytics must never interrupt app operations. */ }}
export function trackEvent(name, params = {}) {
  const event = sanitizeEvent(name, params);
  if (!enabled || !event || (!loaded && (window.dataLayer?.length ?? 0) > 100)) return;
  command('event', event.name, {...event.params, app_version:version.version, schema_version:1, screen, screen_name:screen, screen_class:screen, app_name:'LoL Auto Accept', page_location:`https://lol-auto-accept.invalid/${screen}`, page_title:screen, page_referrer:'', send_to:MEASUREMENT_ID});
}
function active() {return document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastActivity < 60000;}
function tick() {const now=Date.now();if(active()) engagement+=Math.min(now-lastTick,15000);lastTick=now;}
function flushScreen() {tick();if(engagement>0)trackEvent('screen_engagement',{engagement_time_msec:engagement});engagement=0;}
function openSession() {sessionStarted=Date.now();lastSummary=sessionStarted;trackEvent('app_open');}
export function viewScreen(path) {
  const next = screens.includes(path.replace(/^\//,'')) ? path.replace(/^\//,'') : 'main';
  if(next===screen)return;
  if(enabled)flushScreen();screen=next;if(enabled)trackEvent('screen_view');
}
export function heartbeat() {
  if(!enabled)return;
  flushScreen();trackEvent('heartbeat',{visibility:active()?'foreground':'background'});
  const now=Date.now();trackEvent('session_summary',{duration_ms:now-lastSummary});lastSummary=now;
}
function enable() {
  if(enabled || typeof window==='undefined')return;
  let client;
  try {client=storage()?.getItem(idKey);if(!client){client=crypto.randomUUID();storage()?.setItem(idKey,client);}}catch{return;}
  if(!client)return;
  enabled=true;window[`ga-disable-${MEASUREMENT_ID}`]=false;
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){window.dataLayer.push(arguments);};
  command('consent',started?'update':'default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  command('js',new Date());
  command('config',MEASUREMENT_ID,{client_id:client,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:`https://lol-auto-accept.invalid/${screen}`,page_referrer:'',page_title:screen,cookie_flags:'SameSite=None;Secure',...(started?{update:true}:{})});
  if(!started){script=document.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;script.referrerPolicy='no-referrer';script.onload=()=>{loaded=true;};document.head.append(script);started=true;}
  lastActivity=Date.now();lastTick=Date.now();engagement=0;openSession();trackEvent('screen_view');heartbeat();
}
export function startAnalytics() {
  enable();lastTick=Date.now();
  const activity=()=>{const now=Date.now();if(enabled && now-lastActivity>1800000){sessionStarted=now;lastSummary=now;}lastActivity=now;};
  const visibility=()=>{if(enabled)flushScreen();};
  const timer=setInterval(tick,10000);
  for(const event of ['pointerdown','keydown','wheel'])window.addEventListener(event,activity,{passive:true});
  document.addEventListener('visibilitychange',visibility);
  return ()=>{clearInterval(timer);for(const event of ['pointerdown','keydown','wheel'])window.removeEventListener(event,activity);document.removeEventListener('visibilitychange',visibility);};
}
export function trackSettings(before, after) {
  for(const key of settingKeys)if(JSON.stringify(before?.[key])!==JSON.stringify(after?.[key])){
    const name=key==='language'?'language_changed':['appearanceMode','isDarkMode','designTheme'].includes(key)?'appearance_changed':'setting_changed';
    const raw=after[key];const value=typeof raw==='boolean'?(raw?'enabled':'disabled'):(tokens.has(raw)||Number.isInteger(raw))?raw:'changed';
    trackEvent(name,{setting:key,value});
  }
}
export async function measured(feature, work, action=false) {
  const start=Date.now();if(action)trackEvent('action_requested',{action:feature,trigger:'manual'});
  try {const result=await work();const status=feature==='terminate'&&Array.isArray(result)&&result.some(item=>!item.terminated)?'partial':'success';trackEvent(action?'action_completed':'lookup_completed',{[action?'action':'feature']:feature,result:status,duration_bucket:durationBucket(Date.now()-start),...(action?{trigger:'manual'}:{})});return result;}
  catch(error){trackEvent('operation_failed',{feature,error_code:errorCode(error),...(action?{trigger:'manual'}:{})});trackEvent(action?'action_completed':'lookup_completed',{[action?'action':'feature']:feature,result:'failed',duration_bucket:durationBucket(Date.now()-start)});throw error;}
}
const actions={respond_ready_check:'accept',swap_bench_champion:'bench_swap',write_clipboard:'clipboard',set_aram_preferences:'preferences',set_always_on_top:'always_on_top',terminate_league_processes:'terminate',set_hovercard:'hovercard'};
const lookups={get_ranked_stats:'ranked',get_live_players:'live_players',get_latest_release:'release',get_champions:'champions',get_champions_balance:'balance'};
export function instrumentInvoke(invoke) {
  return (name,args)=>{
    if(name==='update_config')return invoke(name,args);
    const action=name==='respond_ready_check'&&args?.action==='decline'?'decline':actions[name];
    const feature=action||lookups[name];
    return feature?measured(feature,()=>invoke(name,args),Boolean(action)):invoke(name,args);
  };
}
let operationKey;
export function trackOperation(value) {
  const op=value.lastOperation;if(!op)return;
  const key=JSON.stringify([value.connectionGeneration,op.revision]);if(key===operationKey)return;operationKey=key;
  const feature={benchSwap:'bench_swap',autoAccept:'accept',accept:'accept',ranked:'ranked',recent:'recent',autoHovercard:'hovercard'}[op.operation];
  if(feature)trackEvent('automation_completed',{feature,trigger:'automatic',result:['success','succeeded'].includes(String(op.status).toLowerCase())?'success':['uncertain','failedorunknown'].includes(String(op.status).toLowerCase())?'uncertain':'failed'});
}
