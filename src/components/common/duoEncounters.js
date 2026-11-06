import {trackEvent, durationBucket} from '../../analytics/client';
import {createReadCache} from '../../api/readCache';
import {hasPuuid, playerName} from './playerIdentity';
import {decimalId} from '../../desktop/identifiers';

const matchReads = createReadCache(4);
const missingParty = player => player.teamParticipantId === undefined || player.teamParticipantId === null || player.teamParticipantId === '';
const needsHistory = player => hasPuuid(player) && (player.rosterRecovered || player.nameHidden || player.isNameObfuscated || player.nameVisibilityType === 'HIDDEN' || (!playerName(player) && missingParty(player)));

export function prepareDuoRoster(roster, livePlayers = [], champions = [], historyEnabled = true) {
  const keys = new Map(champions.map(champion => [String(champion.key), champion.id]));
  const all = Object.values(roster).flat();
  const result = {teamOne: [], teamTwo: [], unassigned: []};
  for (const [side, players] of Object.entries(roster)) {
    for (const original of players) {
      const key = keys.get(String(original.championId));
      const matches = key ? livePlayers.filter(player => player.championKey.toLowerCase() === key.toLowerCase()) : [];
      const unique = all.filter(player => String(player.championId) === String(original.championId)).length === 1 && matches.length === 1;
      const live = unique ? matches[0] : null;
      const player = {...original, nameHidden: Boolean(original.nameHidden || live?.nameHidden)};
      const hidden = Boolean(needsHistory(player));
      player.needsHistory = historyEnabled && hidden;
      player.groupUnknown = Boolean(original.groupUnknown || missingParty(player));
      let target = side;
      if (side === 'unassigned' && live) {
        target = live.team === 'ORDER' ? 'teamOne' : live.team === 'CHAOS' ? 'teamTwo' : side;
      }
      result[target].push(player);
    }
  }
  return result;
}

// When no lookup can run (no live game, e.g. the app was just opened), players that would need a
// history lookup get a settled result instead of an endless "loading" note: unknown-team players say
// so, everyone else simply shows nothing.
export function idleEvidence(roster, evidence = {}) {
  const result = {...evidence};
  for (const [side, players] of Object.entries(roster)) {
    for (const player of players) {
      if (!player.needsHistory || result[player.puuid]) continue;
      result[player.puuid] = side === 'unassigned' ? {status: 'unknownTeam', rows: []} : {status: 'skipped', rows: []};
    }
  }
  return result;
}

export function encounterRows(subjectPuuid, teammates, games) {
  return games.flatMap(({game, index}) => {
    const identities = new Map((game.participantIdentities ?? []).map(identity => [identity.player?.puuid, identity.participantId]));
    const participants = new Map((game.participants ?? []).map(player => [player.participantId, player]));
    const subject = participants.get(identities.get(subjectPuuid));
    if (!Number.isInteger(subject?.teamId) || subject.teamId <= 0) return [];
    const encounters = teammates.flatMap(player => {
      if (!hasPuuid(player) || player.puuid === subjectPuuid) return [];
      const other = participants.get(identities.get(player.puuid));
      if (!Number.isInteger(other?.teamId) || other.teamId <= 0) return [];
      return [{puuid: player.puuid, championId: player.championId, relation: other.teamId === subject.teamId ? 'ally' : 'enemy'}];
    });
    return encounters.length ? [{index, gameId: String(game.gameId), encounters}] : [];
  });
}

export async function loadPlayerEncounters(player, teammates, currentGameId, api, assertCurrent = () => {}, count = 5) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Invalid history count');
  assertCurrent();
  await api.getSummonerByPuuidFromCache(player.puuid);
  assertCurrent();
  const response = await api.getPlayerMatches(player.puuid, count, assertCurrent);
  assertCurrent();
  if (!Array.isArray(response?.games?.games)) throw new Error('History unavailable');
  const seen = new Set();
  const summaries = response.games.games.filter(game => {
    const id = String(game.gameId);
    if (id === String(currentGameId) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, count);
  const games = [];
  let unavailable = 0;
  for (const [offset, summary] of summaries.entries()) {
    assertCurrent();
    try {
      const game = await api.getEncounterGame(decimalId(summary.gameId), assertCurrent);
      assertCurrent();
      if (String(game.gameId) !== decimalId(summary.gameId)) throw new Error('Game changed');
      if (summary.platformId && game.platformId && summary.platformId !== game.platformId) throw new Error('Platform changed');
      if (!Array.isArray(game.participants) || !Array.isArray(game.participantIdentities)
        || game.participants.length < 2 || game.participantIdentities.length !== game.participants.length) throw new Error('Incomplete match');
      const subject = (game.participantIdentities ?? []).find(identity => identity.player?.puuid === player.puuid);
      const participant = (game.participants ?? []).find(item => item.participantId === subject?.participantId);
      if (!subject || !Number.isInteger(participant?.teamId) || participant.teamId <= 0) throw new Error('Incomplete match');
      games.push({game, index: offset + 1});
    } catch {
      assertCurrent();
      unavailable++;
    }
  }
  return {status: unavailable ? 'partial' : 'loaded', checked: games.length, rows: encounterRows(player.puuid, teammates, games)};
}

export function loadDuoEncounters(key, roster, gameId, api, assertCurrent, useLive = true, count = 5, enabled = true) {
  return matchReads.read(key, 30000, async () => {
    const [live, champions] = await Promise.all([
      useLive ? api.getLivePlayers().catch(() => []) : Promise.resolve([]),
      api.getAllChampionsByCache().catch(() => []),
    ]);
    assertCurrent();
    const prepared = prepareDuoRoster(roster, live, champions, enabled);
    const evidence = {};
    const pending = Object.entries(prepared).flatMap(([side, team]) => team.filter(player => player.needsHistory).map(player => ({player, side, team})));
    // Bound history reads to two players at once; full game requests are shared by the API cache.
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const {player, side, team} = pending[cursor++];
        assertCurrent();
        if (side === 'unassigned') {evidence[player.puuid] = {status: 'unknownTeam', rows: []}; continue;}
        try {const start=Date.now();evidence[player.puuid] = await loadPlayerEncounters(player, team, gameId, api, assertCurrent, count);trackEvent('lookup_completed',{feature:'hidden_player_history',result:evidence[player.puuid].status==='partial'?'partial':'success',requested_count:count,completed_count:evidence[player.puuid].checked,duration_bucket:durationBucket(Date.now()-start)});}
        catch {assertCurrent(); evidence[player.puuid] = {status: 'error', rows: []};trackEvent('lookup_completed',{feature:'hidden_player_history',result:'failed',requested_count:count});}
      }
    };
    await Promise.all([worker(), worker()]);
    return {roster: prepared, evidence};
  });
}
