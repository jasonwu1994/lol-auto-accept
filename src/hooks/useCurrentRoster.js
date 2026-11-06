import {trackEvent} from '../analytics/client';
import {useEffect} from 'react';
import {useDispatch, useSelector, useStore} from 'react-redux';
import ApiUtils from '../api/api-utils';
import {desktop} from '../desktop/tauri';
import {currentPlayers, recoverPlayerTeams, rosterRecoveryKey} from '../components/common/currentPlayers';

export default function useCurrentRoster() {
  const game = useSelector(state => state.GameReducer);
  return resolvedRoster(game);
}

export function resolvedRoster(game) {
  const key = rosterRecoveryKey(game.gameflowSession);
  return currentPlayers(game.gameflowSession, game.rosterRecovery?.key === key ? game.rosterRecovery.players : {});
}

// Mounted at the layout level so team recovery does not depend on visiting Duo
// or completing the much slower history requests.
export function useRosterRecovery() {
  const game = useSelector(state => state.GameReducer);
  const dispatch = useDispatch();
  const store = useStore();
  const key = rosterRecoveryKey(game.gameflowSession);
  const identity = JSON.stringify(game.sessionIdentity);
  const live = game.gameflowIsLive && ['GameStart', 'InProgress', 'PreEndOfGame'].includes(game.gamePhase);
  useEffect(() => {
    if (!live || !currentPlayers(game.gameflowSession).unassigned.length) return;
    let active = true;
    let timer;
    const valid = () => active && JSON.stringify(desktop.session()) === identity &&
      rosterRecoveryKey(store.getState().GameReducer.gameflowSession) === key && store.getState().GameReducer.gameflowIsLive;
    const load = async () => {
      if (!valid()) return;
      try {
        const current = store.getState().GameReducer;
        if (!resolvedRoster(current).unassigned.length) return;
        const [players, champions] = await Promise.all([ApiUtils.getLivePlayers(), ApiUtils.getAllChampionsByCache()]);
        if (!valid()) return;
        const recovered=recoverPlayerTeams(game.gameflowSession, players, champions);
        dispatch({type: 'change-rosterRecovery', data: {key, identity, players: recovered}});
        if(Object.keys(recovered).length)trackEvent('lookup_completed',{feature:'team_recovery',result:'success',completed_count:Object.keys(recovered).length});
      } catch { /* Live data is temporarily unavailable during the loading screen. */ }
      if (valid() && resolvedRoster(store.getState().GameReducer).unassigned.length) timer = setTimeout(load, 3000);
    };
    load();
    return () => {active = false; clearTimeout(timer);};
  }, [key, identity, live, dispatch, store]);
}
