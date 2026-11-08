import {trackOperation} from '../analytics/client';
import store from '../redux/store';
import i18n from '../i18n/i18n';
import {gamePhaseToAppState} from '../redux/reducers/GameReducer';
let previous = {};
let connectedGeneration;
function dispatchChanged(type,data) {
  const serialized=JSON.stringify(data);
  if(previous[type]===serialized)return;
  previous[type]=serialized;
  store.dispatch({type,data});
}
export function applySnapshot(value) {
    trackOperation(value);

    dispatchChanged('change-sessionIdentity',{connectionGeneration:value.connectionGeneration,sessionKey:value.sessionKey});
    const configEnvelope=JSON.stringify({config:value.config,configRevision:value.configRevision});
    if(previous.configEnvelope!==configEnvelope) {
      previous.configEnvelope=configEnvelope;
      store.dispatch({type:'change-config',data:value.config,configRevision:value.configRevision});
    }
    const config=store.getState().ConfigReducer;
    if(i18n.language !== config.language) {
      i18n.changeLanguage(config.language);
      delete previous['change-appState'];
    }
    if(value.connection==='Connected')connectedGeneration=value.connectionGeneration;
    // Every phase change re-reads the client as 'Connecting' on the same connection; that is not the client closing.
    const rereading=value.connection==='Connecting' && value.connectionGeneration===connectedGeneration;
    if(!rereading)dispatchChanged('change-connection',value.connection);
    dispatchChanged('change-gamePhase',value.phase);
    if(!rereading)dispatchChanged('change-appState',value.connection === 'Connected' ? gamePhaseToAppState(value.phase) : 'main.appStates.lolClosed');
    dispatchChanged('change-displaySnapshot', {
      connection:value.connection, phase:value.phase,
      connectionGeneration:value.connectionGeneration, sessionKey:value.sessionKey,
      gameflowSession:value.gameflowSession, champSelectSession:value.champSelectSession,
      aramPreferences:value.aramPreferences,
    });
    dispatchChanged('change-lobby-members',value.lobbyMembers?.players ?? {});
}
