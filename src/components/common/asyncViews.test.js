import {it,expect,vi} from 'vitest';
import {orderBalanceRows} from './balanceOrder';
import {enrichRankedPlayers} from './rankedPlayers';
it('refreshes ARAM data even when champion order is unchanged and resets order on disconnect',()=>{
  const session={myTeam:[{cellId:1,championId:2},{cellId:0,championId:3}],benchChampions:[{championId:1}]};
  const first=[{champion_id:1,damage:5},{champion_id:2,damage:6},{champion_id:3,damage:7}];
  expect(orderBalanceRows(first,session).map(row=>row.champion_id)).toEqual([3,2,1]);
  const refreshed=first.map(row=>({...row,damage:100}));
  expect(orderBalanceRows(refreshed,session).map(row=>row.damage)).toEqual([100,100,100]);
  expect(orderBalanceRows(refreshed,null)).toEqual(refreshed);
  expect(session.myTeam[0].championId).toBe(2);
  expect(orderBalanceRows(undefined,null)).toEqual([]);
});
it('preserves every rank row and distinguishes unavailable players without failing the whole team',async()=>{
  const lookup=vi.fn(async id=>{if(id==='2')throw Error('unavailable');return {queues:[]};});
  const result=await enrichRankedPlayers([{summonerId:'9007199254740993'},{summonerId:'2'},{summonerId:'0'}],lookup);
  expect(result).toHaveLength(3);
  expect(result[0].rankedStats).toEqual({queues:[]});
  expect(result[1].rankedStats).toBe(null);
  expect(result[2].rankedStats).toBe(null);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(await enrichRankedPlayers(undefined,lookup)).toEqual([]);
});
