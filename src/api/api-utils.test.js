import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const f=vi.hoisted(()=>({session:{connectionGeneration:1,sessionKey:'one'},invoke:vi.fn()}));
vi.mock('../desktop/tauri',()=>({desktop:{invoke:f.invoke,session:()=>f.session}}));
import ApiUtils from './api-utils';
beforeEach(()=>{f.session={connectionGeneration:f.session.connectionGeneration+1,sessionKey:'one'};f.invoke.mockReset();});
afterEach(()=>vi.useRealTimers());
it('returns names synchronously across navigation without expiring within the session',async()=>{
  vi.useFakeTimers();
  f.invoke.mockResolvedValue({gameName:'Player',tagLine:'TW'});
  expect(ApiUtils.getCachedSummoner('player')).toBeUndefined();
  await ApiUtils.getSummonerByPuuid('player');
  vi.advanceTimersByTime(3600000);
  expect(ApiUtils.getCachedSummoner('player')).toEqual({gameName:'Player',tagLine:'TW'});
  await ApiUtils.getSummonerByPuuid('player');
  expect(f.invoke).toHaveBeenCalledOnce();
  f.session={...f.session,sessionKey:'new'};
  expect(ApiUtils.getCachedSummoner('player')).toBeUndefined();
});
it('shares identity IPC across views but never caches current-owner checks or writes',async()=>{
  f.invoke.mockResolvedValue({gameName:'Player'});
  await Promise.all(Array.from({length:10},()=>ApiUtils.getSummonerByPuuidFromCache('player')));
  await ApiUtils.getSummonerByPuuidFromCache('player');
  expect(f.invoke).toHaveBeenCalledTimes(1);
  await ApiUtils.getCurrentSummoner(); await ApiUtils.getCurrentSummoner();
  await ApiUtils.postAcceptMatchmaking({}); await ApiUtils.postAcceptMatchmaking({});
  expect(f.invoke).toHaveBeenCalledTimes(5);
});
it('rejects stale pending results and fetches again for a new session',async()=>{
  let resolve;
  f.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({gameName:'New'});
  const old=ApiUtils.getSummonerByPuuid('player'); await Promise.resolve();
  f.session={...f.session,sessionKey:'two'};
  expect(await ApiUtils.getSummonerByPuuid('player')).toEqual({gameName:'New'});
  resolve({gameName:'Old'}); await expect(old).rejects.toThrow('session changed');
  expect(await ApiUtils.getSummonerByPuuid('player')).toEqual({gameName:'New'});
  expect(f.invoke).toHaveBeenCalledTimes(2);
});
it('loads champion catalog once per locale and notifies once',async()=>{
  f.invoke.mockResolvedValue([{key:'1',name:'Champion'}]);
  const notify=vi.fn();const stop=ApiUtils.subscribeChampions(notify);
  await Promise.all([ApiUtils.getAllChampionsByCache('en_US'),ApiUtils.getAllChampionsByCache('en_US')]);
  expect(f.invoke).toHaveBeenCalledOnce();expect(notify).toHaveBeenCalledOnce();stop();
});
it('stops missing-history downloads immediately after cancellation',async()=>{
  const controller=new AbortController();
  f.invoke.mockImplementation(async()=>{controller.abort();return {gameId:'1'};});
  await expect(ApiUtils.getHistoryGames(['1','2','2'],controller.signal)).rejects.toThrow('cancelled');
  expect(f.invoke).toHaveBeenCalledOnce();
});
it('throttles hidden-player list and game reads together while cache hits reuse their request',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const starts=[];
  f.invoke.mockImplementation(async command=>{starts.push([command,Date.now()]);return {};});
  const list=ApiUtils.getPlayerMatches('hidden-player',10);
  const game=ApiUtils.getEncounterGame('123');
  const duplicate=ApiUtils.getEncounterGame('123');
  await vi.advanceTimersByTimeAsync(0);
  expect(starts).toEqual([['get_player_matches',0]]);
  expect(f.invoke).toHaveBeenCalledWith('get_player_matches',{puuid:'hidden-player',count:10});
  await vi.advanceTimersByTimeAsync(999);
  expect(f.invoke).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await Promise.all([list,game,duplicate]);
  expect(starts).toEqual([['get_player_matches',0],['get_history_game',1000]]);
  await ApiUtils.getEncounterGame('123');
  expect(f.invoke).toHaveBeenCalledTimes(2);
});
