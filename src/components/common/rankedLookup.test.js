import {afterEach, expect, it, vi} from 'vitest';
import {createRankedMatchStore, rankedMatchKey, startRankedLookup} from './rankedLookup';
afterEach(() => vi.useRealTimers());

it('retains synchronous match results across navigation and beyond the API TTL', async () => {
  vi.useFakeTimers();
  const store = createRankedMatchStore();
  const lookup = vi.fn(async id => ({id, queues: []}));
  const stop = store.subscribe('match-one', ['1', '2'], lookup, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  const first = store.read('match-one');
  expect(first.loaded).toBe(true);
  stop();
  await vi.advanceTimersByTimeAsync(3600000);
  const stopAgain = store.subscribe('match-one', ['1', '2'], lookup, vi.fn());
  expect(store.read('match-one')).toBe(first);
  expect(lookup).toHaveBeenCalledTimes(2);
  stopAgain();
  store.subscribe('match-two', ['1', '3'], lookup, vi.fn());
  expect(store.read('match-two').loaded).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(lookup).toHaveBeenCalledTimes(4);
});

it('navigation joins pending reads and old matches cannot publish into a new match', async () => {
  vi.useFakeTimers();
  let resolve;
  const store = createRankedMatchStore();
  const lookup = vi.fn(() => new Promise(done => {resolve = done;}));
  store.subscribe('old', ['1'], lookup, vi.fn())();
  store.subscribe('old', ['1'], lookup, vi.fn())();
  expect(lookup).toHaveBeenCalledOnce();
  store.subscribe('new', ['2'], async () => ({name:'new'}), vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  resolve({name:'old'});
  await vi.advanceTimersByTimeAsync(0);
  expect(store.read('new').players[0].rankedStats.name).toBe('new');
});

it('keys ranks by account, game and player identity rather than phase, order or champion', () => {
  const session = {gameData:{gameId:'10',teamOne:[{puuid:'a',summonerId:'1',championId:1},{puuid:'b',summonerId:'2'}]}};
  const identity = {connectionGeneration:1,sessionKey:'phase-one'};
  const key = rankedMatchKey(session,identity,'owner');
  const reordered=structuredClone(session);
  reordered.gameData.teamOne.reverse();reordered.gameData.teamOne[0].championId=22;
  expect(rankedMatchKey(reordered,{...identity,sessionKey:'phase-two'},'owner')).toBe(key);
  expect(rankedMatchKey(session,identity,'other-owner')).not.toBe(key);
  expect(rankedMatchKey({...session,gameData:{...session.gameData,gameId:'11'}},identity,'owner')).not.toBe(key);
  expect(rankedMatchKey({...session,gameData:{...session.gameData,teamOne:[{puuid:'c',summonerId:'1'}]}},identity,'owner')).not.toBe(key);
});

it('retries only failed IDs twice while preserving successful rows', async () => {
  vi.useFakeTimers();
  const attempts = new Map();
  const lookup = vi.fn(async id => {
    const count = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, count);
    if (id === 'bad' || (id === 'recover' && count < 2)) throw Error('temporary');
    return {wins: id === 'ok' ? 10 : 20};
  });
  const publish = vi.fn();
  const stop = startRankedLookup(['ok', 'recover', 'bad'], lookup, publish);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish.mock.lastCall[0]).toEqual([
    {summonerId: 'ok', rankedStats: {wins: 10}},
    {summonerId: 'recover', rankedStats: null},
    {summonerId: 'bad', rankedStats: null}
  ]);
  await vi.runAllTimersAsync();
  expect(Object.fromEntries(attempts)).toEqual({ok: 1, recover: 2, bad: 3});
  expect(publish.mock.lastCall[0][0].rankedStats).toEqual({wins: 10});
  expect(publish.mock.lastCall[0][1].rankedStats).toEqual({wins: 20});
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

it('cleanup cancels delayed retries and suppresses late completion', async () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const lookup = vi.fn().mockRejectedValue(Error('offline'));
  const stop = startRankedLookup(['one'], lookup, publish);
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.runAllTimersAsync();
  expect(lookup).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  let resolve;
  const delayed = vi.fn(() => new Promise(done => {resolve = done;}));
  const stopDelayed = startRankedLookup(['two'], delayed, publish);
  stopDelayed();
  resolve({wins: 1});
  await vi.advanceTimersByTimeAsync(10000);
  expect(publish).toHaveBeenCalledOnce();
  expect(delayed).toHaveBeenCalledOnce();
});

it('does not overlap retry attempts with an unresolved lookup', async () => {
  vi.useFakeTimers();
  let reject;
  const lookup = vi.fn(() => new Promise((_, fail) => {reject = fail;}));
  const stop = startRankedLookup(['one'], lookup, vi.fn());
  await vi.advanceTimersByTimeAsync(10000);
  expect(lookup).toHaveBeenCalledOnce();
  reject(Error('offline'));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1499);
  expect(lookup).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(lookup).toHaveBeenCalledTimes(2);
  stop();
  reject(Error('offline'));
});
it('freezes loaded ranks during empty lifecycle snapshots and rejects late completion after pause',async()=>{
 vi.useFakeTimers();const store=createRankedMatchStore();
 store.subscribe('one',['1'],async()=>({wins:9}),vi.fn());await vi.advanceTimersByTimeAsync(0);
 const ready=store.read('one');store.subscribe(null,[],vi.fn(),vi.fn());expect(store.read(null)).toBe(ready);
 let done;store.subscribe('two',['2'],()=>new Promise(resolve=>{done=resolve;}),vi.fn());
 store.subscribe(null,[],vi.fn(),vi.fn());done({wins:99});await vi.advanceTimersByTimeAsync(0);expect(store.read(null).players).toEqual([]);
});
