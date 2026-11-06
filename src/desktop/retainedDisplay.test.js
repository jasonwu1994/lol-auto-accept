import GameReducer from '../redux/reducers/GameReducer';
import {rosterRecoveryKey} from '../components/common/currentPlayers';
import {expect,it} from 'vitest';
import {retainDisplay} from './retainedDisplay';
const first={connection:'Connected',phase:'ChampSelect',connectionGeneration:1,sessionKey:'one',currentSummoner:{puuid:'owner'},gameflowSession:{gameData:{gameId:1,teamOne:[{puuid:'a',championId:1}]}},champSelectSession:{localPlayerCellId:0,myTeam:[{cellId:0,championId:1}],benchChampions:[{championId:2}]},aramPreferences:[2]};
it('keeps the last roster, bench and preferences through game entry, exit and disconnect',()=>{
 const shown=retainDisplay({},first);
 for(const phase of ['GameStart','InProgress','EndOfGame','Lobby','None']){
  const next=retainDisplay(shown,{...first,phase,sessionKey:phase,gameflowSession:null,champSelectSession:null,aramPreferences:[]});
  expect(next.gameflowSession).toBe(shown.gameflowSession);expect(next.champSelectSession).toBe(shown.champSelectSession);expect(next.aramPreferences).toEqual([2]);expect(next.gameflowIsLive).toBe(false);expect(next.champSelectIsLive).toBe(false);
 }
 const disconnected=retainDisplay(shown,{connection:'Disconnected'});expect(disconnected.myTeam).toEqual(shown.myTeam);expect(disconnected.gameflowIsLive).toBe(false);
});
it('only replaces retained sections when valid new data arrives and respects explicit preference clears',()=>{
 const shown=retainDisplay({},first);
 const empty=retainDisplay(shown,{...first,sessionKey:'two',gameflowSession:{gameData:{teamOne:[]}},champSelectSession:{myTeam:[]}});
 expect(empty.gameflowSession).toBe(shown.gameflowSession);expect(empty.champSelectIsLive).toBe(false);
 const fresh=retainDisplay(empty,{...first,sessionKey:'two',champSelectSession:{localPlayerCellId:1,myTeam:[{cellId:1,championId:3}],benchChampions:[]},aramPreferences:[]});
 expect(fresh.myTeam[0]).toMatchObject({championId:3,isSelf:true});expect(fresh.aramPreferences).toEqual([]);expect(fresh.champSelectSession.benchChampions).toEqual([]);expect(fresh.champSelectIsLive).toBe(true);
});

it('retains confirmed teams on exit but ignores late results for old sessions or rosters',()=>{
 const state={...retainDisplay({},first),sessionIdentity:{connectionGeneration:1,sessionKey:'one'}};
 const data={key:rosterRecoveryKey(first.gameflowSession),identity:JSON.stringify(state.sessionIdentity),players:{hidden:{side:'teamOne'}}};
 const next=GameReducer(state,{type:'change-rosterRecovery',data});
 expect(next.rosterRecovery.players.hidden.side).toBe('teamOne');
 const paused=retainDisplay(next,{...first,connection:'Disconnected',gameflowSession:null});
 expect(paused.rosterRecovery).toEqual(next.rosterRecovery);
 expect(GameReducer(paused,{type:'change-rosterRecovery',data})).toBe(paused);
 expect(GameReducer(state,{type:'change-rosterRecovery',data:{...data,identity:'old'}})).toBe(state);
 expect(GameReducer(state,{type:'change-rosterRecovery',data:{...data,key:'other-game'}})).toBe(state);
});
