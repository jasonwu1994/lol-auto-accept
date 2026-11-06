import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {listen} from '@tauri-apps/api/event';
import {startAnalytics, viewScreen, heartbeat, HEARTBEAT_MS} from '../analytics/client';
export {trackEvent} from '../analytics/client';
export default function GoogleAnalytics() {
  const location=useLocation();
  useEffect(()=>startAnalytics(),[]);
  useEffect(()=>{viewScreen(location.pathname);},[location.pathname]);
  useEffect(()=>{
    let disposed=false,stop=()=>{};
    let timer;
    if(window.__TAURI_INTERNALS__)listen('analytics-heartbeat',()=>heartbeat()).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(()=>{});
    else timer=setInterval(heartbeat,HEARTBEAT_MS);
    return ()=>{disposed=true;stop();clearInterval(timer);};
  },[]);
  return null;
}
