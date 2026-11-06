export function groupCurrentTeam(players = [], evidence = {}) {
  if (!Array.isArray(players)) return [];
  const known = new Map();
  const unknown = [];
  for (const player of players) {
    const id=player.teamParticipantId;
    if (id === undefined || id === null || id === '') {unknown.push([{...player,groupUnknown:!player.soloFallback}]);continue;}
    const key=String(id);
    known.set(key,[...(known.get(key) ?? []),player]);
  }
  const groups = [...known.values()].sort((a,b)=>b.length-a.length);
  const tails = [];
  const after = new Map();
  for (const group of unknown) {
    const player = group[0];
    const counts = new Map();
    for (const row of evidence[player.puuid]?.rows ?? []) {
      for (const puuid of new Set(row.encounters.map(other => other.puuid))) counts.set(puuid, (counts.get(puuid) ?? 0) + 1);
    }
    let anchor;
    let best = 0;
    for (const knownGroup of groups) for (const mate of knownGroup) {
      const count = counts.get(mate.puuid) ?? 0;
      if (count > best) {best = count; anchor = knownGroup;}
    }
    if (anchor) after.set(anchor, [...(after.get(anchor) ?? []), group]);
    else tails.push(group);
  }
  // Historical overlap changes display order only: never merge premade groups.
  return groups.flatMap(group => [group, ...(after.get(group) ?? [])]).concat(tails);
}

export function formatPremadeGroup(players, t) {
  const labels = ['solo', 'duo', 'trio', 'quad', 'quint'];
  const label = players.some(player => player.groupUnknown) ? 'unknown' : labels[players.length - 1] ?? 'unknown';
  return [t(`common.premade.${label}`), ...players.map(player => `${player.championName} ${player.name}`)].join('\n');
}
