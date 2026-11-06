import {describe,it,expect,vi} from 'vitest';
vi.mock('../../desktop/tauri',()=>({desktop:{session:()=>({connectionGeneration:1})}}));
import RecentUtils, {recentPlayersQueryKey, recentTeams, recentTeamResult} from './RecentUtils';
import {currentChampionsByPuuid} from './currentPlayers';
const game=(ids)=>({data:{gameId:'42',participants:ids.map((id,i)=>({participantId:i+1,teamId:100})),participantIdentities:ids.map((id,i)=>({participantId:i+1,player:{puuid:id}}))}});
describe('recent players remains distinct from current premades',()=>{
  it('excludes owner and lobby friends as triggers but includes them after a non-lobby player matches',()=>{
    const groups=RecentUtils.filterPlayersAndLobbyMembersAndOwnerPuuids(['owner','friend','other'],['owner','friend'],'owner');
    expect(groups).toEqual({ownerPuuid:'owner',lobbyMembersPuuids:['friend'],playersPuuids:['other']});
    expect(RecentUtils.filterParticipantsByPuuids(groups,[game(['owner','friend'])])).toEqual([]);
    const result=RecentUtils.filterParticipantsByPuuids(groups,[game(['owner','friend','other'])]);
    expect(result[0].participants.map(p=>p.player.puuid)).toEqual(['other','friend','owner']);
    expect(result[0].gameId).toBe('42');
  });
  it('ignores absent payload and missing identities without inferring a group',()=>{
    expect(RecentUtils.filterParticipantsByPuuids({ownerPuuid:'o',lobbyMembersPuuids:[],playersPuuids:['p']},[{}, {data:{}}, {data:{participantIdentities:[{participantId:1}],participants:[]}}])).toEqual([]);
  });
  it('retains game ids as strings and isolates owner metadata',()=>{
    expect(RecentUtils.mapMatchesToGameIds({games:{games:[{gameId:'9007199254740993'}]}})).toEqual(['9007199254740993']);
    const raw={gameId:'42',gameCreation:123};
    expect(RecentUtils.mapGamesToDBFormat([raw],'owner')[0]).toEqual({_id:'42',timestamp:123,ownerPuuid:'owner',data:raw});
  });
});

it('limits encounters to the configured most recent games without purging imported rows',()=>{
  const groups={ownerPuuid:'owner',lobbyMembersPuuids:[],playersPuuids:['target']};
  const imported=Array.from({length:260},(_,index)=>({data:{gameId:String(260-index),gameCreation:260-index,participantIdentities:[{participantId:1,player:{puuid:[4,19,20,259].includes(index)?'target':'unrelated'}}],participants:[{participantId:1,teamId:100}]}}));
  const before=JSON.stringify(imported);
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,imported,20).map(game=>game.gameIndex)).toEqual([4,19]);
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,imported,5).map(game=>game.gameIndex)).toEqual([4]);
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,imported,4)).toEqual([]);
  expect(imported).toHaveLength(260);expect(JSON.stringify(imported)).toBe(before);
  expect(()=>RecentUtils.filterRecentParticipantsByPuuids(groups,imported,0)).toThrow('Invalid');
});

it('keeps the history query stable for cosmetic gameflow changes but refreshes relevant scopes',()=>{
  const identity={connectionGeneration:1,sessionKey:'match'};
  const session={gameData:{gameId:'42',teamOne:[{puuid:'a',championId:1},{puuid:'b'}]}};
  const key=recentPlayersQueryKey(session,identity,5);
  // loadRecentMatch reads the current game id from this slot to exclude it from encounters.
  expect(JSON.parse(key)[2]).toBe('42');
  const changed={gameData:{gameId:'42',teamOne:[{puuid:'b'},{puuid:'a',championId:2}]},timer:20};
  expect(recentPlayersQueryKey(changed,identity,5)).toBe(key);
  expect(recentPlayersQueryKey(changed,identity,10)).not.toBe(key);
  expect(recentPlayersQueryKey(changed,{...identity,connectionGeneration:2},5)).not.toBe(key);
  expect(recentPlayersQueryKey(changed,{...identity,sessionKey:'next'},5)).toBe(key);
  expect(recentPlayersQueryKey(changed,identity,5,'another-owner')).not.toBe(key);
  expect(recentPlayersQueryKey({...changed,gameData:{...changed.gameData,gameId:'43'}},identity,5)).not.toBe(key);
  expect(recentPlayersQueryKey({...changed,gameData:{...changed.gameData,playerChampionSelections:[{puuid:'extra'}]}},identity,5)).not.toBe(key);
});
it('retains matched players with absent team metadata without inventing a team or loss',()=>{
  const participants=[{teamId:100},{teamId:200},{teamId:999},{}, {teamId:null}];
  const teams=recentTeams({participants,teams:[{teamId:100,win:'Win'}]});
  expect(teams.map(team=>[team.teamId,team.participants.length,recentTeamResult(team.win)])).toEqual([[100,1,'Win'],[200,1,'—'],['unknown',3,'—']]);
  expect(recentTeamResult('Fail')).toBe('Lose');
  expect(recentTeamResult('Lose')).toBe('Lose');
  expect(recentTeams({})).toEqual([]);
});

it('does not count the current or just-finished game as an earlier encounter',()=>{
  const groups={ownerPuuid:'owner',lobbyMembersPuuids:[],playersPuuids:['target']};
  const row=(id,puuid)=>({_id:String(id),data:{gameId:id,participantIdentities:[{participantId:1,player:{puuid}}],participants:[{participantId:1,teamId:100}]}});
  // Newest first: the game that just ended (everyone in it is in the current roster), then earlier games.
  const history=[row(900,'target'),row(899,'unrelated'),row(898,'target'),row(897,'target')];
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,history,3,900).map(game=>game.gameId)).toEqual([898,897]);
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,history,3,'900').map(game=>game.gameId)).toEqual([898,897]);
  // The window counts earlier games only, so excluding the current one does not shorten it.
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,history,2,900).map(game=>game.gameId)).toEqual([898]);
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,history,4,900).map(game=>game.gameId)).toEqual([898,897]);
  // No current game id (not started yet, or unknown): nothing is excluded.
  for(const none of [undefined,null,0,'0'])expect(RecentUtils.filterRecentParticipantsByPuuids(groups,history,4,none).map(game=>game.gameId)).toEqual([900,898,897]);
  expect(history).toHaveLength(4);
});

it('includes formerly hidden players once their in-game identity becomes available',()=>{
  const identity={connectionGeneration:1};
  const before={gameData:{gameId:900,teamOne:[{puuid:'owner'},{}]}};
  const after={gameData:{...before.gameData,playerChampionSelections:[{puuid:'revealed',championId:17,nameHidden:true}]}};
  const key=recentPlayersQueryKey(after,identity,5,'owner');
  expect(key).not.toBe(recentPlayersQueryKey(before,identity,5,'owner'));
  const puuids=JSON.parse(key)[3];
  expect(puuids).toContain('revealed');
  const groups=RecentUtils.filterPlayersAndLobbyMembersAndOwnerPuuids(puuids,[],'owner');
  const games=[{_id:'899',data:{gameId:899,participantIdentities:[
    {participantId:1,player:{puuid:'revealed',gameName:'ActualName'}}],participants:[{participantId:1,teamId:200}]}}];
  expect(RecentUtils.filterRecentParticipantsByPuuids(groups,games,5,900)[0].participants[0].player.gameName).toBe('ActualName');
});

it('maps each current player to the champion they have in this game',()=>{
  const session={gameData:{teamOne:[{puuid:'a',championId:62},{puuid:'b',championId:0}],teamTwo:[{puuid:'c',championId:'17'},{championId:5}],
    playerChampionSelections:[{puuid:'d',championId:81},{puuid:'a',championId:62}]}};
  expect([...currentChampionsByPuuid(session)]).toEqual([['a',62],['c',17],['d',81]]);
  expect(currentChampionsByPuuid(undefined).size).toBe(0);
  expect(currentChampionsByPuuid({gameData:{teamOne:[{puuid:'x'}]}}).size).toBe(0);
});
