import {expect,it,vi} from 'vitest';
vi.mock('../desktop/tauri',()=>({desktop:{invoke:vi.fn()}}));
import {createChampionIconStore} from './championIcons';
const DAY=86400000;

it('shares icon reads across rows and reuses fresh local icons for a day',async()=>{
  const now=2*DAY;
  const invoke=vi.fn(async()=>({dataUrl:'data:image/png;base64,local',checkedAt:now/1000}));
  const store=createChampionIconStore(invoke,()=>now);
  const first=vi.fn(),second=vi.fn();
  const stop=store.subscribe(89,first);store.subscribe(89,second);
  await vi.waitFor(()=>expect(store.read(89)).toBe('data:image/png;base64,local'));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('get_champion_icon',{championId:89,refresh:false});
  expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce();
  stop();store.subscribe(89,vi.fn());
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('publishes an expired local icon before its background refresh completes',async()=>{
  const now=2*DAY;
  let complete;
  const invoke=vi.fn().mockResolvedValueOnce({dataUrl:'old-local-icon',checkedAt:0})
    .mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const store=createChampionIconStore(invoke,()=>now);
  const notify=vi.fn();store.subscribe(1,notify);
  await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
  expect(store.read(1)).toBe('old-local-icon');
  expect(invoke).toHaveBeenLastCalledWith('get_champion_icon',{championId:1,refresh:true});
  complete({dataUrl:'new-local-icon',checkedAt:now/1000});
  await vi.waitFor(()=>expect(store.read(1)).toBe('new-local-icon'));
});

it('keeps the displayed icon if refresh fails and ignores invalid champion ids',async()=>{
  const invoke=vi.fn().mockResolvedValueOnce({dataUrl:'old-local-icon',checkedAt:0}).mockRejectedValueOnce(Error('offline'));
  const store=createChampionIconStore(invoke,()=>2*DAY);
  store.subscribe(1,vi.fn());
  await vi.waitFor(()=>expect(invoke).toHaveBeenCalledTimes(2));
  expect(store.read(1)).toBe('old-local-icon');
  store.subscribe('../secret',vi.fn());store.subscribe(0,vi.fn());
  expect(invoke).toHaveBeenCalledTimes(2);
});
