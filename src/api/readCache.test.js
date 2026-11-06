import {afterEach, expect, it, vi} from 'vitest';
import {createReadCache} from './readCache';

afterEach(()=>vi.useRealTimers());
it('coalesces concurrent reads, expires success, and retries failure', async()=>{
  vi.useFakeTimers();
  const cache=createReadCache();
  const load=vi.fn(async()=>({name:'Player'}));
  const values=await Promise.all(Array.from({length:10},()=>cache.read('player',100,load)));
  expect(load).toHaveBeenCalledOnce(); expect(values).toHaveLength(10);
  await cache.read('player',100,load); expect(load).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(101);
  await cache.read('player',100,load); expect(load).toHaveBeenCalledTimes(2);
  const failure=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue('ok');
  await expect(cache.read('error',100,failure)).rejects.toThrow('offline');
  await expect(cache.read('error',100,failure)).resolves.toBe('ok');
});
it('bounds retained entries and a cleared pending read cannot replace a new entry',async()=>{
  const cache=createReadCache(2);
  const load=vi.fn(async()=>1);
  for(const key of ['a','b','c','a']) await cache.read(key,10000,load);
  expect(load).toHaveBeenCalledTimes(4);
  let reject;
  const old=cache.read('pending',10000,()=>new Promise((_,r)=>{reject=r;}));
  await Promise.resolve(); cache.clear();
  await cache.read('pending',10000,async()=>2);
  reject(Error('old failure')); await expect(old).rejects.toThrow('old failure');
  await expect(cache.read('pending',10000,load)).resolves.toBe(2);
  expect(load).toHaveBeenCalledTimes(4);
});
