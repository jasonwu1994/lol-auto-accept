import {afterEach,expect,it,vi} from 'vitest';
import {createHistoryRequests} from './historyRequests';
afterEach(()=>vi.useRealTimers());

it('shares one history request per second across players and never overlaps slow requests',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const schedule=createHistoryRequests();
  const starts=[];
  const first=schedule(()=>{starts.push(Date.now());return new Promise(resolve=>setTimeout(()=>resolve('one'),1500));});
  const second=schedule(()=>{starts.push(Date.now());return 'two';});
  const third=schedule(()=>{starts.push(Date.now());return 'three';});
  await vi.advanceTimersByTimeAsync(999);expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(501);expect(starts).toEqual([0,1500]);
  await vi.advanceTimersByTimeAsync(999);expect(starts).toEqual([0,1500]);
  await vi.advanceTimersByTimeAsync(1);expect(starts).toEqual([0,1500,2500]);
  expect(await Promise.all([first,second,third])).toEqual(['one','two','three']);
});

it('drops queued work after settings change without blocking the next request',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const schedule=createHistoryRequests();
  await schedule(async()=>{});
  let enabled=true;
  const cancelled=vi.fn();
  const result=schedule(cancelled,()=>{if(!enabled)throw Error('disabled');}).catch(error=>error.message);
  await vi.advanceTimersByTimeAsync(100);
  enabled=false;
  const next=vi.fn(async()=> 'next');
  const following=schedule(next);
  await vi.advanceTimersByTimeAsync(900);
  expect(await result).toBe('disabled');
  expect(cancelled).not.toHaveBeenCalled();
  expect(await following).toBe('next');
  expect(next).toHaveBeenCalledOnce();
});
