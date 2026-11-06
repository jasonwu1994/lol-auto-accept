import {describe, expect, it, vi} from 'vitest';
import {currentPlayers, recoverPlayerTeams, rosterRecoveryKey} from './currentPlayers';
import {initialPlayerIdentity, playerName, resolvePlayerIdentity} from './playerIdentity';
import {groupCurrentTeam} from './premade';

describe('current player identity', () => {
  it('looks up a missing name by PUUID without labelling ordinary players', async () => {
    const lookup = vi.fn(async () => ({gameName: 'Recovered', tagLine: 'TW2'}));
    expect(await resolvePlayerIdentity({puuid: 'missing'}, lookup)).toEqual({name: 'Recovered#TW2', recovered: false, loading: false});
    expect(lookup).toHaveBeenCalledWith('missing');
    expect(await resolvePlayerIdentity({puuid: 'missing'}, async () => ({}))).toEqual(initialPlayerIdentity({}));
    expect(await resolvePlayerIdentity({puuid: 'missing'}, async () => {throw Error('unavailable');})).toEqual(initialPlayerIdentity({}));
  });
  it('labels only roster-recovered players regardless of name query outcome', async () => {
    const player = {puuid:'missing-roster', rosterRecovered:true};
    expect(await resolvePlayerIdentity(player, async()=>({gameName:'Name',tagLine:'TW'})))
      .toEqual({name:'Name#TW',recovered:true,loading:false});
    expect(await resolvePlayerIdentity(player, async()=>{throw Error('not found');}))
      .toEqual({name:'',recovered:true,loading:false});
  });
  it('falls back to a valid summoner ID when no usable PUUID is present', async () => {
    const byPuuid=vi.fn();
    const byId=vi.fn(async()=>[{gameName:'Player',tagLine:'TW'}]);
    expect((await resolvePlayerIdentity({summonerId:'9007199254740993'},byPuuid,byId)).name).toBe('Player#TW');
    expect(byId).toHaveBeenCalledWith('9007199254740993');
    expect(byPuuid).not.toHaveBeenCalled();
  });
  it('preserves a source name on lookup failure and does not label existing names as recovered', async () => {
    const player = {puuid: 'known', summonerName: 'Visible'};
    expect(await resolvePlayerIdentity(player, async () => ({gameName: 'Visible', tagLine: 'TW2'}))).toEqual({name: 'Visible#TW2', recovered: false, loading: false});
    expect(await resolvePlayerIdentity(player, async () => {throw Error('unavailable');})).toEqual(initialPlayerIdentity(player));
    expect(playerName({riotIdGameName: 'Name', riotIdTagLine: 'TAG'})).toBe('Name#TAG');
  });
  it('does not query an absent or sentinel PUUID', async () => {
    const lookup = vi.fn();
    for (const puuid of [undefined, '', '00000000-0000-0000-0000-000000000000']) {
      expect(await resolvePlayerIdentity({puuid}, lookup)).toEqual(initialPlayerIdentity({}));
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('current roster', () => {
  it('recovers selection-only players without guessing team or grouping', () => {
    const session = {gameData: {
      teamOne: [{puuid: 'a', championId: 1, teamParticipantId: 3}, {puuid: 'b', championId: 2, teamParticipantId: 3}],
      teamTwo: [{puuid: 'c', championId: 3, teamParticipantId: 3}],
      playerChampionSelections: [{puuid: 'a', championId: 1}, {puuid: 'b', championId: 2}, {puuid: 'c', championId: 3}, {puuid: 'missing', championId: 4}, {puuid: 'missing', championId: 4}]
    }};
    const before = structuredClone(session);
    const roster = currentPlayers(session);
    expect(roster.unassigned).toEqual([{puuid: 'missing', championId: 4, rosterRecovered: true, groupUnknown: true}]);
    expect(groupCurrentTeam(roster.teamOne).map(group => group.length)).toEqual([2]);
    expect(groupCurrentTeam(roster.teamTwo).map(group => group.length)).toEqual([1]);
    expect(groupCurrentTeam(roster.unassigned)[0][0].groupUnknown).toBe(true);
    expect(session).toEqual(before);
  });
  it('handles partial or absent data and never fabricates player identities', () => {
    expect(currentPlayers(null)).toEqual({teamOne: [], teamTwo: [], unassigned: []});
    expect(currentPlayers({gameData: {playerChampionSelections: [{championId: 1}]}}).unassigned).toEqual([]);
  });
});

it('assigns recovered players to the end of a uniquely matched live team without guessing parties', () => {
  const session={gameData:{gameId:1,teamOne:[{puuid:'a',championId:1}],teamTwo:[{puuid:'b',championId:2}],playerChampionSelections:[{puuid:'hidden',championId:17}]}};
  const live=[{championKey:'Teemo',team:'ORDER',nameHidden:true}];
  const champions=[{key:'17',id:'Teemo'}];
  const recovery=recoverPlayerTeams(session,live,champions);
  const roster=currentPlayers(session,recovery);
  expect(roster.teamOne.map(p=>p.puuid)).toEqual(['a','hidden']);
  expect(roster.unassigned).toEqual([]);
  expect(roster.teamOne[1]).toMatchObject({groupUnknown:true,nameHidden:true});
  expect(roster.teamOne[1]).not.toHaveProperty('teamParticipantId');
  expect(recoverPlayerTeams(session,[...live,...live],champions)).toEqual({});
  expect(recoverPlayerTeams({...session,gameData:{...session.gameData,teamTwo:[{puuid:'b',championId:17}]}},live,champions)).toEqual({});
  expect(rosterRecoveryKey(session)).not.toBe(rosterRecoveryKey({gameData:{...session.gameData,gameId:2}}));
});
