import {beforeEach,afterEach,it,expect,vi} from 'vitest';
let client, data;
const stops=[];
beforeEach(async()=>{
 vi.resetModules();data=new Map();vi.stubGlobal('localStorage',{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)});
 vi.stubGlobal('window',{dataLayer:[],addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('document',{visibilityState:'visible',hasFocus:()=>true,cookie:'',createElement:()=>({remove:vi.fn()}),head:{append:vi.fn()},addEventListener:vi.fn(),removeEventListener:vi.fn()});
 client=await import('./client');
});
afterEach(()=>{for(const stop of stops.splice(0))stop();vi.unstubAllGlobals();});
const events=()=>window.dataLayer.filter(x=>x[0]==='event').map(x=>({name:x[1],params:x[2]}));
it('drops identifiers, arbitrary payloads and unsupported events',()=>{
 expect(client.sanitizeEvent('random',{})).toBeNull();
 expect(client.sanitizeEvent('search_used',{feature:'balance',puuid:'private',text:'secret',value:'secret',result_count:4})).toEqual({name:'search_used',params:{feature:'balance',result_count:4}});
});
it('records results without command arguments or raw error messages',async()=>{
 stops.push(client.startAnalytics());const invoke=client.instrumentInvoke(async()=>{throw {code:'StaleSession',message:'private-name'};});
 await expect(invoke('write_clipboard',{text:'private-name'})).rejects.toMatchObject({code:'StaleSession'});
 expect(events().map(e=>e.name)).toContain('action_requested');expect(events().find(e=>e.name==='operation_failed').params.error_code).toBe('session_changed');
 expect(JSON.stringify(events())).not.toContain('private-name');
});
it('deduplicates automatic results and respects native status casing',()=>{
 stops.push(client.startAnalytics());const value={connectionGeneration:1,lastOperation:{revision:5,operation:'autoAccept',status:'Succeeded'}};
 client.trackOperation(value);client.trackOperation(value);
 expect(events().filter(e=>e.name==='automation_completed')).toHaveLength(1);
 expect(events().find(e=>e.name==='automation_completed').params.result).toBe('success');
});
it('counts no engagement while hidden and stores only successful config changes',()=>{
 stops.push(client.startAnalytics());document.visibilityState='hidden';client.heartbeat();
 expect(events().filter(e=>e.name==='screen_engagement')).toHaveLength(0);
 client.trackSettings({designTheme:'default',windowPosition:{x:1}},{designTheme:'mint',windowPosition:{x:2}});
 expect(events().filter(e=>e.name==='appearance_changed').map(e=>e.params.value)).toEqual(['mint']);
 expect(JSON.stringify(events())).not.toContain('windowPosition');
});

it('does not let a failing analytics transport interrupt gameplay commands',async()=>{
 stops.push(client.startAnalytics());window.gtag=()=>{throw Error('blocked');};
 const invoke=client.instrumentInvoke(async()=> 'ok');
 await expect(invoke('swap_bench_champion',{})).resolves.toBe('ok');
});

it('starts without a setting and does not consult the removed preference',()=>{
 data.set('analytics-consent-v1','denied');
 stops.push(client.startAnalytics());
 expect(events().some(e=>e.name==='app_open')).toBe(true);
 expect(events().some(e=>e.name==='heartbeat')).toBe(true);
 expect(document.head.append).toHaveBeenCalledOnce();
 stops.push(client.startAnalytics());
 expect(document.head.append).toHaveBeenCalledOnce();
 expect(client).not.toHaveProperty('setConsent');
});
