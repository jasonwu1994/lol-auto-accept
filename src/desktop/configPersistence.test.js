import {it,expect,vi} from 'vitest';
import {createConfigPersistence} from './configPersistence';
import ConfigReducer from '../redux/reducers/ConfigReducer';
it('uses the saved native startup theme before the first snapshot arrives',()=>{
  try {
    vi.stubGlobal('__LOL_INITIAL_DARK_MODE__',false);
    expect(ConfigReducer(undefined,{}).isDarkMode).toBe(false);
    vi.stubGlobal('__LOL_INITIAL_DARK_MODE__',true);
    expect(ConfigReducer(undefined,{}).isDarkMode).toBe(true);
    vi.stubGlobal('__LOL_INITIAL_DARK_MODE__',undefined);
    expect(ConfigReducer(undefined,{}).isDarkMode).toBe(true);
  } finally {vi.unstubAllGlobals();}
});
function harness(save=vi.fn(async(config,expectedRevision)=>({config,configRevision:expectedRevision+1}))) {
  let config=ConfigReducer(undefined,{});
  const onError=vi.fn(),onStale=vi.fn();
  const next=vi.fn(action=>{config=ConfigReducer(config,action);});
  const dispatch=createConfigPersistence({reduce:ConfigReducer,save,onError,onStale})({getState:()=>({ConfigReducer:config})})(next);
  return {dispatch,save,onError,onStale,next,config:()=>config};
}
it('persists the hidden-player toggle and selected count independently from recent teammates',async()=>{
  const h=harness();
  expect(h.config()).toMatchObject({isCheckHiddenPlayerHistory:true,hiddenPlayerHistoryGameCount:5});
  await h.dispatch({type:'change-hiddenPlayerHistoryGameCount',data:10});
  await h.dispatch({type:'change-isCheckHiddenPlayerHistory',data:false});
  expect(h.config()).toMatchObject({isCheckHiddenPlayerHistory:false,hiddenPlayerHistoryGameCount:10,isShowRecentTeammate:true,recentTeammateCheckGameCount:20});
});
it('persists automatic ARAM topmost without changing manual topmost',async()=>{
  const h=harness();
  expect(h.config().isAutoAramTopmost).toBe(false);
  await h.dispatch({type:'change-isAutoAramTopmost',data:true});
  expect(h.config()).toMatchObject({isAutoAramTopmost:true,alwaysOnTop:false});
});
it('serializes changes against acknowledged config and preserves failed saves',async()=>{
  const h=harness();const initial=h.config();
  const first=h.dispatch({type:'change-isAutoAccept',data:false});const second=h.dispatch({type:'change-language',data:'en'});
  expect(h.config()).toBe(initial);await Promise.all([first,second]);
  expect(h.config()).toMatchObject({isAutoAccept:false,language:'en'});
  expect(h.save.mock.calls.map(call=>call[1])).toEqual([0,1]);
  h.save.mockRejectedValueOnce(Error('disk full'));await h.dispatch({type:'change-isAutoAccept',data:true});
  expect(h.config().isAutoAccept).toBe(false);expect(h.onError).toHaveBeenCalledOnce();
  await h.dispatch({type:'change-isDarkMode',data:true});expect(h.config().isDarkMode).toBe(true);
});
it('does not let an old snapshot discard A before queued B merges A',async()=>{
  let complete;
  const save=vi.fn(async(config,expectedRevision)=>({config,configRevision:expectedRevision+1}));
  save.mockImplementationOnce((config,expectedRevision)=>new Promise(resolve=>{complete=()=>resolve({config,configRevision:expectedRevision+1});}));
  const h=harness(save),old=h.config();
  const a=h.dispatch({type:'change-isDarkMode',data:true});const b=h.dispatch({type:'change-alwaysOnTop',data:true});await Promise.resolve();
  h.dispatch({type:'change-config',data:{...old},configRevision:0});complete();await Promise.all([a,b]);
  expect(save.mock.calls[1]).toEqual([{...old,isDarkMode:true,appearanceMode:'dark',alwaysOnTop:true},1]);
  h.dispatch({type:'change-config',data:old,configRevision:0});
  expect(h.config()).toMatchObject({isDarkMode:true,alwaysOnTop:true});
});
it('does not let an older reply overwrite a newer authoritative config revision',async()=>{
  let complete;
  const h=harness(vi.fn((config)=>new Promise(resolve=>{complete=()=>resolve({config,configRevision:1});})));
  const a=h.dispatch({type:'change-isDarkMode',data:true});await Promise.resolve();
  h.dispatch({type:'change-config',data:{...h.config(),isDarkMode:true,alwaysOnTop:true},configRevision:2});
  complete();await a;
  expect(h.config().alwaysOnTop).toBe(true);
});
it('does not apply a failed language change or blindly retry a CAS conflict',async()=>{
  const h=harness(),count=h.next.mock.calls.length;
  h.save.mockRejectedValueOnce(Error('disk full'));await h.dispatch({type:'change-language',data:'en'});
  expect(h.config().language).toBe('zh');expect(h.next).toHaveBeenCalledTimes(count);
  h.save.mockRejectedValueOnce({code:'StaleConfig',message:'Configuration changed'});
  await h.dispatch({type:'change-alwaysOnTop',data:true});
  expect(h.onStale).toHaveBeenCalledOnce();expect(h.save).toHaveBeenCalledTimes(2);expect(h.config().alwaysOnTop).toBe(false);
});
it('restores a saved design theme at startup and falls back safely for old configs',()=>{
  try {
    vi.stubGlobal('__LOL_INITIAL_DESIGN_THEME__','rabbit');
    expect(ConfigReducer(undefined,{}).designTheme).toBe('rabbit');
    vi.stubGlobal('__LOL_INITIAL_DESIGN_THEME__',undefined);
    expect(ConfigReducer(undefined,{}).designTheme).toBe('default');
    vi.stubGlobal('__LOL_INITIAL_DESIGN_THEME__','unknown');
    expect(ConfigReducer(undefined,{}).designTheme).toBe('default');
  } finally {vi.unstubAllGlobals();}
});
it('serializes palette and mode saves and retains the last acknowledged palette on failure',async()=>{
  const h=harness();
  await Promise.all([
    h.dispatch({type:'change-designTheme',data:'lavender'}),
    h.dispatch({type:'change-isDarkMode',data:false}),
  ]);
  expect(h.config()).toMatchObject({designTheme:'lavender',isDarkMode:false});
  expect(h.save.mock.calls[1][0]).toMatchObject({designTheme:'lavender',isDarkMode:false});
  h.save.mockRejectedValueOnce(Error('disk full'));
  await h.dispatch({type:'change-designTheme',data:'rabbit'});
  expect(h.config().designTheme).toBe('lavender');
  expect(h.onError).toHaveBeenCalledOnce();
});

it('persists appearance mode independently from the palette and restores it before bootstrap',async()=>{
  const h=harness();
  await h.dispatch({type:'change-designTheme',data:'sky'});
  await h.dispatch({type:'change-appearanceMode',data:'system'});
  expect(h.config()).toMatchObject({designTheme:'sky',appearanceMode:'system'});
  h.save.mockRejectedValueOnce(Error('disk full'));
  await h.dispatch({type:'change-appearanceMode',data:'light'});
  expect(h.config().appearanceMode).toBe('system');
  await h.dispatch({type:'change-appearanceMode',data:'light'});
  expect(h.config()).toMatchObject({appearanceMode:'light',isDarkMode:false,designTheme:'sky'});
  try {
    vi.stubGlobal('__LOL_INITIAL_APPEARANCE_MODE__','system');
    expect(ConfigReducer(undefined,{}).appearanceMode).toBe('system');
  } finally {vi.unstubAllGlobals();}
});
