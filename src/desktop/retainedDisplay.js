export function hasGamePlayers(session) {
  const data = session?.gameData;
  return ['teamOne','teamTwo','playerChampionSelections'].some(key => Array.isArray(data?.[key]) && data[key].length > 0);
}
export function hasChampions(session) {
  return ['myTeam','benchChampions'].some(key => Array.isArray(session?.[key]) && session[key].length > 0);
}

// Display data survives empty lifecycle snapshots; live identity is never retained here.
export function retainDisplay(previous, snapshot) {
  const connected = snapshot.connection === 'Connected';
  const gameflowIsLive = connected && hasGamePlayers(snapshot.gameflowSession);
  const champSelectIsLive = connected && snapshot.phase === 'ChampSelect' && hasChampions(snapshot.champSelectSession);
  const next = {...previous, gameflowIsLive, champSelectIsLive};
  if (gameflowIsLive) {
    next.gameflowSession = snapshot.gameflowSession;
  }
  if (champSelectIsLive) {
    next.champSelectSession = snapshot.champSelectSession;
    next.aramPreferences = snapshot.aramPreferences ?? [];
    next.myTeam = (snapshot.champSelectSession.myTeam ?? []).map(player => ({...player,slotId:player.cellId,isSelf:player.cellId === snapshot.champSelectSession.localPlayerCellId}));
  }
  return next;
}
