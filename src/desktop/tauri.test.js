import {it,expect,vi} from 'vitest';
const transport=vi.hoisted(()=>({invoke:vi.fn(),event:null,stop:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:transport.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(_name,handler)=>{transport.event=handler;return transport.stop;})}));
import {desktop} from './tauri';
it('waits briefly after the rendered UI is ready before revealing the native window',async()=>{
  vi.useFakeTimers();
  try {
    transport.invoke.mockClear().mockResolvedValue(undefined);
    const cancel=desktop.scheduleShow();
    await vi.advanceTimersByTimeAsync(149);
    expect(transport.invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.invoke).toHaveBeenCalledExactlyOnceWith('show_main_window');
    cancel();
  } finally {vi.useRealTimers();}
});
it('does not reveal a window when the ready view is disposed before its delay finishes',async()=>{
  vi.useFakeTimers();
  try {
    transport.invoke.mockClear();
    desktop.scheduleShow()();
    await vi.runAllTimersAsync();
    expect(transport.invoke).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
it('CAS refresh uses the snapshot ordering guard and cannot replay older events',async()=>{
  const value=revision=>({revision,connectionGeneration:1,sessionKey:'current',configRevision:revision,config:{language:'zh'}});
  transport.invoke.mockResolvedValueOnce(value(2));
  const applied=[];
  const stop=await desktop.subscribe(snapshot=>applied.push(snapshot.revision));
  transport.invoke.mockResolvedValueOnce(value(1));await desktop.refresh();
  transport.invoke.mockResolvedValueOnce(value(4));await desktop.refresh();
  transport.event({payload:value(3)});
  expect(applied).toEqual([2,4]);expect(desktop.snapshot().revision).toBe(4);
  stop();expect(transport.stop).toHaveBeenCalledOnce();
});
