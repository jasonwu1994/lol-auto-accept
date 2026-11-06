export function currentPlayers(session, recovered = {}) {
  const data = session?.gameData ?? {};
  const selections = Array.isArray(data.playerChampionSelections) ? data.playerChampionSelections : [];
  const byPuuid = new Map(selections.filter(player => player.puuid).map(player => [player.puuid, player]));
  const seen = new Set();
  const team = players => (Array.isArray(players) ? players : []).map(player => {
    if (player.puuid) seen.add(player.puuid);
    return {...byPuuid.get(player.puuid), ...player};
  });
  const teamOne = team(data.teamOne);
  const teamTwo = team(data.teamTwo);
  const unassigned = [];
  for (const player of selections) {
    if (!player.puuid || seen.has(player.puuid)) continue;
    seen.add(player.puuid);
    // Selection order and missing team slots do not establish team or premade membership.
    const {teamParticipantId, ...selection} = player;
    const recovery = recovered[player.puuid];
    const target = recovery?.side === 'teamOne' ? teamOne : recovery?.side === 'teamTwo' ? teamTwo : unassigned;
    target.push({...selection, rosterRecovered: true, groupUnknown: true, ...(recovery ? {nameHidden: recovery.nameHidden} : {})});
  }
  return {teamOne, teamTwo, unassigned};
}

// puuid -> champion the player has in the current game; players without a picked champion are omitted.
export function currentChampionsByPuuid(session) {
  const champions = new Map();
  for (const player of Object.values(currentPlayers(session)).flat()) {
    const id = Number(player.championId);
    if (player.puuid && Number.isInteger(id) && id > 0) champions.set(player.puuid, id);
  }
  return champions;
}

export function rosterRecoveryKey(session) {
  const data = session?.gameData;
  return JSON.stringify([data?.gameId, ...['teamOne', 'teamTwo', 'playerChampionSelections'].map(key =>
    (data?.[key] ?? []).map(player => [player.puuid, player.championId]))]);
}

export function recoverPlayerTeams(session, livePlayers, champions) {
  const roster = currentPlayers(session);
  const all = Object.values(roster).flat();
  const keys = new Map(champions.map(champion => [String(champion.key), String(champion.id).toLowerCase()]));
  const recovered = {};
  for (const player of roster.unassigned) {
    const key = keys.get(String(player.championId));
    const matches = key ? livePlayers.filter(live => live.championKey?.toLowerCase() === key) : [];
    if (all.filter(other => String(other.championId) === String(player.championId)).length !== 1 || matches.length !== 1) continue;
    const side = matches[0].team === 'ORDER' ? 'teamOne' : matches[0].team === 'CHAOS' ? 'teamTwo' : null;
    if (side) recovered[player.puuid] = {side, nameHidden: Boolean(matches[0].nameHidden)};
  }
  return recovered;
}
