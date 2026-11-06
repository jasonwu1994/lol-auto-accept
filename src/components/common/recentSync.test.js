import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const f=vi.hoisted(()=>({session:{connectionGeneration:1,sessionKey:'first'},owner:'owner',matches:vi.fn(),history:vi.fn(),save:vi.fn(),trim:vi.fn(),existing:vi.fn(),ownerLookup:vi.fn()}));
vi.mock('../../desktop/tauri',()=>({desktop:{session:()=>({...f.session})}}));
vi.mock('../../api/api-utils',()=>({default:{getCurrentSummonerPuuid:()=>f.ownerLookup(),getCurrentSummonerMatches:(...args)=>f.matches(...args),getHistoryGames:(...args)=>f.history(...args)}}));
vi.mock('./DatabaseUtils',()=>({default:{getExistingGameIds:(...args)=>f.existing(...args),saveGames:(...args)=>f.save(...args),trimGamesByOwnerPuuid:(...args)=>f.trim(...args)}}));
import RecentUtils, {createRecentMatchStore, retryRecentRefresh} from './RecentUtils';
afterEach(()=>vi.useRealTimers());
it('keeps completed and empty recent results across navigation without another load',async()=>{
  vi.useFakeTimers();
  for(const games of [[{gameId:'42'}],[]]) {
    const store=createRecentMatchStore();
    const load=vi.fn(async()=>games);
    store.subscribe('match',load,vi.fn())();
    await vi.advanceTimersByTimeAsync(0);
    const first=store.read('match');
    expect(first).toEqual({loading:false,games,error:null});
    await vi.advanceTimersByTimeAsync(3600000);
    store.subscribe('match',load,vi.fn())();
    expect(store.read('match')).toBe(first);
    expect(load).toHaveBeenCalledOnce();
  }
});
it('joins an in-flight recent lookup on navigation and discards replaced matches',async()=>{
  vi.useFakeTimers();
  const store=createRecentMatchStore();
  let complete, oldSignal;
  const load=vi.fn(signal=>{oldSignal=signal;return new Promise(resolve=>{complete=resolve;});});
  store.subscribe('old',load,vi.fn())();
  store.subscribe('old',load,vi.fn())();
  expect(load).toHaveBeenCalledOnce();
  expect(oldSignal.aborted).toBe(false);
  store.subscribe('new',async()=>[{gameId:'new'}],vi.fn());
  expect(oldSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  complete([{gameId:'old'}]);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.read('new').games).toEqual([{gameId:'new'}]);
});
it('background sidebar and page subscriptions share one lookup and both receive its result',async()=>{
  const store=createRecentMatchStore();
  let finish;
  const load=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const sidebar=vi.fn(),page=vi.fn();
  store.subscribe('shared-match',load,sidebar);
  store.subscribe('shared-match',load,page);
  finish([{gameId:'shared'}]);
  await vi.waitFor(()=>expect(store.read('shared-match').loading).toBe(false));
  expect(load).toHaveBeenCalledOnce();
  expect(sidebar).toHaveBeenCalledOnce();
  expect(page).toHaveBeenCalledOnce();
});
it('a changed hidden-page scope prevents old refresh persistence',async()=>{
  let valid=true;
  f.history.mockImplementationOnce(async()=>{valid=false;return [{gameId:'42',gameCreation:1}];});
  await expect(RecentUtils.syncRecentGames(0,4,undefined,()=>{if(!valid)throw Error('scope changed');})).rejects.toThrow('scope changed');
  expect(f.save).not.toHaveBeenCalled();
  expect(f.trim).not.toHaveBeenCalled();
});
beforeEach(()=>{f.session={connectionGeneration:1,sessionKey:'first'};f.owner='owner';f.ownerLookup.mockReset().mockImplementation(async()=>f.owner);f.existing.mockReset().mockResolvedValue([]);f.matches.mockReset().mockResolvedValue({games:{games:[{gameId:'42'}]}});f.history.mockReset().mockResolvedValue([{gameId:'42',gameCreation:1}]);f.save.mockReset().mockResolvedValue(1);f.trim.mockReset().mockResolvedValue(0);});
it('an older count request cannot save or trim after a newer request completes',async()=>{
  let complete;
  f.history.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const old=RecentUtils.syncRecentGames(0,4);
  await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
  await RecentUtils.syncRecentGames(0,19);
  complete([{gameId:'42',gameCreation:1}]);
  await expect(old).rejects.toThrow('superseded');
  expect(f.save).toHaveBeenCalledTimes(1);expect(f.trim).toHaveBeenCalledOnce();expect(f.trim).toHaveBeenCalledWith('owner',20);
});
it('aborted refresh and same-phase session change block persistence',async()=>{
  const controller=new AbortController();
  f.history.mockImplementationOnce(async()=>{controller.abort();return [{gameId:'42',gameCreation:1}];});
  await expect(RecentUtils.syncRecentGames(0,9,controller.signal)).rejects.toThrow('superseded');
  f.history.mockImplementationOnce(async()=>{f.session.sessionKey='second';return [];});
  await expect(RecentUtils.syncRecentGames(0,9)).rejects.toThrow('superseded');
  expect(f.save).not.toHaveBeenCalled();expect(f.trim).not.toHaveBeenCalled();
});
it('a change after save prevents obsolete retention',async()=>{
  f.save.mockImplementationOnce(async()=>{f.owner='new-owner';return 1;});
  await expect(RecentUtils.syncRecentGames(0,4)).rejects.toThrow('Account changed');
  expect(f.trim).not.toHaveBeenCalled();
});

it('fetches only distinct missing games and retains uncached account validation',async()=>{
  f.matches.mockResolvedValue({games:{games:[{gameId:'41'},{gameId:'42'},{gameId:'42'}]}});
  f.existing.mockResolvedValue(['41']);
  await RecentUtils.syncRecentGames(0,4);
  expect(f.matches).toHaveBeenCalledOnce();
  expect(f.history).toHaveBeenCalledOnce();
  expect(f.history.mock.calls[0][0]).toEqual(['42']);
  expect(f.ownerLookup).toHaveBeenCalledTimes(3);
});
it('passes cancellation and supersession checks through the detail request loop',async()=>{
  const controller=new AbortController();
  f.history.mockImplementationOnce(async(ids,signal,assertIntent)=>{
    expect(signal).toBe(controller.signal);
    assertIntent();
    controller.abort();
    assertIntent();
  });
  await expect(RecentUtils.syncRecentGames(0,4,controller.signal)).rejects.toThrow('superseded');
  expect(f.save).not.toHaveBeenCalled();
  expect(f.trim).not.toHaveBeenCalled();
});

it('recovers recent history after a transient failure and stops after success',async()=>{
  vi.useFakeTimers();
  f.matches.mockRejectedValueOnce(Error('temporary'));
  const controller=new AbortController();
  const pending=retryRecentRefresh(()=>RecentUtils.syncRecentGames(0,4,controller.signal),controller.signal);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.matches).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(f.matches).toHaveBeenCalledTimes(2);
  expect(f.save).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20000);
  expect(f.matches).toHaveBeenCalledTimes(2);
});
it('caps failures at three attempts using two and four second delays',async()=>{
  vi.useFakeTimers();
  f.matches.mockRejectedValue(Error('unavailable'));
  const controller=new AbortController();
  const pending=retryRecentRefresh(()=>RecentUtils.syncRecentGames(0,4,controller.signal),controller.signal);
  const rejection=expect(pending).rejects.toThrow('unavailable');
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.matches).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3999);
  expect(f.matches).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await rejection;
  expect(f.matches).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  expect(f.save).not.toHaveBeenCalled();
});
it('aborting a pending retry clears its timer and cannot cancel a replacement refresh',async()=>{
  vi.useFakeTimers();
  f.matches.mockRejectedValueOnce(Error('temporary'));
  const controller=new AbortController();
  const old=retryRecentRefresh(()=>RecentUtils.syncRecentGames(0,4,controller.signal),controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  await old;
  expect(vi.getTimerCount()).toBe(0);
  const nextController=new AbortController();
  await retryRecentRefresh(()=>RecentUtils.syncRecentGames(0,19,nextController.signal),nextController.signal);
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.matches).toHaveBeenCalledTimes(2);
  expect(f.trim).toHaveBeenCalledExactlyOnceWith('owner',20);
});
it('aborting an active refresh prevents a late failure from scheduling retries',async()=>{
  vi.useFakeTimers();
  let reject;
  f.matches.mockImplementationOnce(()=>new Promise((resolve,rejectRequest)=>{reject=rejectRequest;}));
  const controller=new AbortController();
  const pending=retryRecentRefresh(()=>RecentUtils.syncRecentGames(0,4,controller.signal),controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  reject(Error('late failure'));
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  expect(f.matches).toHaveBeenCalledOnce();
  expect(f.save).not.toHaveBeenCalled();
});
it('retains recent results while paused or refreshing and replaces them only on a successful response',async()=>{
 vi.useFakeTimers();const store=createRecentMatchStore();const games=[{gameId:'one'}];
 store.subscribe('one',async()=>games,vi.fn());await vi.advanceTimersByTimeAsync(0);
 store.subscribe(null,vi.fn(),vi.fn());expect(store.read(null).games).toBe(games);
 let resolve;store.subscribe('two',()=>new Promise(done=>{resolve=done;}),vi.fn());expect(store.read('two').games).toBe(games);
 store.subscribe(null,vi.fn(),vi.fn());resolve([{gameId:'stale'}]);await vi.advanceTimersByTimeAsync(0);expect(store.read(null).games).toBe(games);
 store.subscribe('three',async()=>[],vi.fn());await vi.advanceTimersByTimeAsync(0);expect(store.read('three').games).toEqual([]);
});
