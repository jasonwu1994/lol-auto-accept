export function startRankedLookup(ids, lookup, publish) {
  let active = true;
  let timer;
  let retries = 0;
  const results = new Map();
  const run = async pending => {
    const failed = [];
    await Promise.all(pending.map(async id => {
      try {results.set(id, await lookup(id));}
      catch {failed.push(id);}
    }));
    if (!active) return;
    publish(ids.map(summonerId => ({summonerId, rankedStats: results.get(summonerId) ?? null})));
    if (failed.length && retries < 2) {
      retries++;
      timer = setTimeout(() => run(failed), retries * 1500);
    }
  };
  run(ids);
  return () => {active = false; clearTimeout(timer);};
}

const emptyRanked = {loaded: false, players: []};

export function rankedMatchKey(session, identity, ownerPuuid) {
  const data = session?.gameData ?? {};
  const players = [...(data.teamOne ?? []), ...(data.teamTwo ?? []), ...(data.playerChampionSelections ?? [])];
  const roster = [...new Set(players.map(player => JSON.stringify([player.puuid ?? '', String(player.summonerId ?? '')])))].sort();
  return JSON.stringify([identity?.connectionGeneration, ownerPuuid ?? '', data.gameId ?? '', roster]);
}

export function createRankedMatchStore() {
  let key;
  let snapshot = emptyRanked;
  let stop = () => {};
  let paused = false;
  const listeners = new Set();
  return {
    read(expected) {return expected == null || key === expected ? snapshot : emptyRanked;},
    subscribe(expected, ids, lookup, listener) {
      if (expected == null) {
        stop(); paused = true;
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
      if (key !== expected || (paused && !snapshot.loaded)) {
        paused = false;
        stop();
        key = expected;
        snapshot = emptyRanked;
        stop = startRankedLookup(ids, lookup, players => {
          if (key !== expected) return;
          snapshot = {loaded: true, players};
          listeners.forEach(notify => notify());
        });
      }
      listeners.add(listener);
      // Keep the bounded read batch alive across navigation so returning joins it.
      return () => listeners.delete(listener);
    }
  };
}

export const rankedMatchStore = createRankedMatchStore();
