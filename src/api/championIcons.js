import {desktop} from '../desktop/tauri';
const DAY = 24 * 60 * 60 * 1000;

export function createChampionIconStore(invoke, now = () => Date.now()) {
  const entries = new Map();
  return {
    read(id) {return entries.get(Number(id))?.dataUrl ?? '';},
    subscribe(id, listener) {
      id = Number(id);
      if (!Number.isInteger(id) || id < 1 || id > 10000) return () => {};
      if (!entries.has(id)) entries.set(id,{dataUrl:'',nextCheck:0,pending:null,listeners:new Set()});
      const entry = entries.get(id);
      entry.listeners.add(listener);
      const publish = icon => {
        if (entry.dataUrl !== icon.dataUrl) {
          entry.dataUrl = icon.dataUrl;
          entry.listeners.forEach(notify => notify());
        }
      };
      if (!entry.pending && now() >= entry.nextCheck) {
        entry.pending = (async () => {
          let icon = await invoke('get_champion_icon',{championId:id,refresh:false});
          publish(icon);
          if (now() - icon.checkedAt * 1000 >= DAY) {
            icon = await invoke('get_champion_icon',{championId:id,refresh:true});
            publish(icon);
          }
          entry.nextCheck = Math.max(now() + 60000, icon.checkedAt * 1000 + DAY);
        })().catch(() => {entry.nextCheck = now() + 60000;}).finally(() => {entry.pending = null;});
      }
      return () => entry.listeners.delete(listener);
    },
  };
}

export const championIconStore = createChampionIconStore((command,args) => desktop.invoke(command,args));
