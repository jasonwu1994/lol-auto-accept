import {instrumentInvoke} from '../analytics/client';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {AppSnapshot} from './contracts';
import {subscribeSnapshot} from './subscription';

let snapshot: AppSnapshot | null = null;
let snapshotListener: ((value:AppSnapshot)=>void) | null = null;
function publishSnapshot(value:AppSnapshot) {
  if(snapshot && (value.connectionGeneration<snapshot.connectionGeneration || (value.connectionGeneration===snapshot.connectionGeneration && value.revision<=snapshot.revision)))return;
  snapshot=value;
  snapshotListener?.(value);
}
export const desktop = {
  invoke: instrumentInvoke(invoke) as typeof invoke,
  scheduleShow: () => {
    const timer = setTimeout(() => {invoke('show_main_window').catch(reportError);}, 150);
    return () => clearTimeout(timer);
  },
  listenOperations: () => listen<{connectionGeneration?:number;sessionKey?:string;error?:unknown;status?:string;message?:string}>('operation-result',event=>{
    const result=event.payload;
    if (result.connectionGeneration !== undefined && result.connectionGeneration !== snapshot?.connectionGeneration) return;
    if (result.sessionKey && result.sessionKey !== snapshot?.sessionKey) return;
    if (result.error) reportError(result.error);
    else if (result.status === 'failed' || result.status === 'uncertain') reportError({message:result.message || result.status});
  }),
  session: () => ({connectionGeneration: snapshot?.connectionGeneration ?? 0, sessionKey: snapshot?.sessionKey ?? ''}),
  snapshot: () => snapshot,
  refresh: async () => publishSnapshot(await invoke<AppSnapshot>('bootstrap')),
  subscribe: async (apply:(value:AppSnapshot)=>void) => {
    snapshotListener=apply;
    const stop=await subscribeSnapshot<AppSnapshot>({
      listen: handler=>listen<AppSnapshot>('app-state-changed',event=>handler(event.payload)),
      bootstrap: ()=>invoke<AppSnapshot>('bootstrap'),
    },publishSnapshot);
    return ()=>{stop();if(snapshotListener===apply)snapshotListener=null;};
  },
};
export function reportError(error: unknown) {
  const value = error as {code?: string; message?: string};
  window.dispatchEvent(new CustomEvent('desktop-error', {detail: value?.message || value?.code || 'Operation failed'}));
}
export function perform<T>(operation: Promise<T>): Promise<T | undefined> {
  return operation.catch(error => {reportError(error); return undefined;});
}
