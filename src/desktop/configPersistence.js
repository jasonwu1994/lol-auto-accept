import {trackSettings} from '../analytics/client';
export function createConfigPersistence({reduce,save,onError,onStale}) {
  let queue = Promise.resolve();
  let revision = 0;
  return store => next => {
    const apply = action => {
      if(action.configRevision < revision)return;
      revision=action.configRevision;
      if(JSON.stringify(store.getState().ConfigReducer)!==JSON.stringify(action.data))return next(action);
    };
    return action => {
      const before=store.getState().ConfigReducer;
      if(action.type==='change-config')return apply(action);
      if(reduce(before,action)===before)return next(action);
      queue=queue.then(async ()=>{
        const before=store.getState().ConfigReducer;
        const config=reduce(before,action);
        const saved=await save(config,revision);
        apply({type:'change-config',data:saved.config,configRevision:saved.configRevision});
        trackSettings(before,saved.config);
      }).catch(async error=>{
        if(error?.code==='StaleConfig' && onStale) {
          try {await onStale();} catch(refreshError) {onError(refreshError);}
        }
        onError(error);
      });
      return queue;
    };
  };
}
