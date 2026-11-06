import {describe,it,expect,vi} from 'vitest';
import {subscribeSnapshot,type Revisioned} from './subscription';
const state=(revision:number,connectionGeneration=1)=>({revision,connectionGeneration});
describe('snapshot subscription',()=>{
  it('buffers events before bootstrap and rejects stale generations and duplicate revisions',async()=>{
    let emit:(value:Revisioned)=>void=()=>{};
    const applied:Revisioned[]=[];
    const stop=vi.fn();
    const unsubscribe=await subscribeSnapshot({listen:async handler=>{emit=handler;return stop;},bootstrap:async()=>{emit(state(3));emit(state(1));return state(2);}},value=>applied.push(value));
    emit(state(3));emit(state(1,2));emit(state(100,1));
    expect(applied).toEqual([state(2),state(3),state(1,2)]);
    unsubscribe();emit(state(2,2));expect(applied).toHaveLength(3);expect(stop).toHaveBeenCalledTimes(1);
  });
  it('unsubscribes when bootstrap fails',async()=>{
    const stop=vi.fn();
    await expect(subscribeSnapshot({listen:async()=>stop,bootstrap:async()=>{throw Error('offline');}},()=>{})).rejects.toThrow('offline');
    expect(stop).toHaveBeenCalledOnce();
  });
});
