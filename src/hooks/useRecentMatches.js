import {useCallback, useSyncExternalStore} from 'react';
import {useSelector} from 'react-redux';
import {desktop} from '../desktop/tauri';
import {loadRecentMatch, recentLookupKey, recentMatchStore, recentQueryKeyForPhase} from '../components/common/RecentUtils';

export default function useRecentMatches() {
  const phase = useSelector(state => state.GameReducer.gamePhase);
  const live = useSelector(state => phase === 'ChampSelect' ? state.GameReducer.champSelectIsLive : state.GameReducer.gameflowIsLive);
  const session = useSelector(state => state.GameReducer.gameflowSession);
  const champSelect = useSelector(state => state.GameReducer.champSelectSession);
  const identity = useSelector(state => state.GameReducer.sessionIdentity);
  const count = useSelector(state => state.ConfigReducer.recentTeammateCheckGameCount);
  const connection = useSelector(state => state.AuthReducer.connection);
  const ownerPuuid = desktop.snapshot()?.currentSummoner?.puuid;
  const queryKey = recentQueryKeyForPhase(phase, session, champSelect, identity, count, ownerPuuid);
  const storeKey = recentLookupKey({live, phase, connection, ownerPuuid, queryKey});
  const subscribe = useCallback(listener => recentMatchStore.subscribe(storeKey,
    signal => connection === 'Connected' ? loadRecentMatch(queryKey, signal) : Promise.resolve([]), listener), [storeKey]);
  return useSyncExternalStore(subscribe, () => recentMatchStore.read(storeKey), () => recentMatchStore.read(storeKey));
}
