import {expect,it} from 'vitest';
import {validOnlineCount} from './OnlineCount';
it('accepts fresh counts including zero and rejects expired or malformed responses',()=>{
 const now=Date.now(),base={activeUsers:0,windowMinutes:5,updatedAt:new Date(now).toISOString()};
 expect(validOnlineCount(base,now)).toBe(true);
 for(const value of [null,{},{...base,schemaVersion:2},{...base,available:false}, {...base,activeUsers:-1},{...base,activeUsers:1.2},{...base,windowMinutes:30},{...base,updatedAt:'bad'},{...base,updatedAt:new Date(now-181000).toISOString()},{...base,updatedAt:new Date(now+31000).toISOString()}])expect(validOnlineCount(value,now)).toBe(false);
});
