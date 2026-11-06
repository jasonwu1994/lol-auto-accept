import {useCallback, useSyncExternalStore} from 'react';
import {useSelector} from 'react-redux';
import {desktop} from '../desktop/tauri';
import {loadRecentMatch, recentMatchStore, recentPlayersQueryKey} from '../components/common/RecentUtils';

export default function useRecentMatches() {
  const live = useSelector(state => state.GameReducer.gameflowIsLive);
  const session = useSelector(state => state.GameReducer.gameflowSession);
  const identity = useSelector(state => state.GameReducer.sessionIdentity);
  const count = useSelector(state => state.ConfigReducer.recentTeammateCheckGameCount);
  const connection = useSelector(state => state.AuthReducer.connection);
  const queryKey = recentPlayersQueryKey(session, identity, count, desktop.snapshot()?.currentSummoner?.puuid);
  const storeKey = live === false || connection !== 'Connected' ? null : JSON.stringify([connection, queryKey]);
  const subscribe = useCallback(listener => recentMatchStore.subscribe(storeKey,
    signal => connection === 'Connected' ? loadRecentMatch(queryKey, signal) : Promise.resolve([]), listener), [storeKey]);
  return useSyncExternalStore(subscribe, () => recentMatchStore.read(storeKey), () => recentMatchStore.read(storeKey));
}
