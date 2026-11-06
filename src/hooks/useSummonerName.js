import {useState, useEffect} from 'react';
import {useSelector} from 'react-redux';
import ApiUtils from '../api/api-utils';
import {hasPuuid, readRetainedIdentity, retainIdentity, initialPlayerIdentity, playerName, resolvePlayerIdentity} from '../components/common/playerIdentity';
import {hasPlayerId} from '../desktop/identifiers';

export function usePlayerIdentity(player) {
  const live = useSelector(state => state.GameReducer.gameflowIsLive !== false || state.GameReducer.champSelectIsLive !== false);
  const generation = useSelector(state => state.GameReducer.sessionIdentity?.connectionGeneration);
  const sessionKey = useSelector(state => state.GameReducer.sessionIdentity?.sessionKey);
  const initial = initialPlayerIdentity(player);
  const puuid = player?.puuid;
  const summonerId = player?.summonerId;
  const recovered = initial.recovered;
  const key = JSON.stringify([generation, sessionKey, puuid, summonerId, initial.name, recovered]);
  const [result, setResult] = useState(null);
  const cached = ApiUtils.getCachedSummoner(hasPuuid(player) ? puuid : undefined, hasPlayerId(summonerId) ? summonerId : undefined);
  useEffect(() => {
    if (!live) return;
    let active = true;
    let timer;
    const fetchName = async (attempt = 0) => {
      const identity = await resolvePlayerIdentity({puuid, summonerId, gameName: initial.name, rosterRecovered: recovered},
        id => ApiUtils.getSummonerByPuuidFromCache(id), id => ApiUtils.getSummonersById(id));
      if (!active) return;
      retainIdentity(player, identity);
      setResult({key, identity});
      if (!identity.name && attempt < 2 && (hasPuuid({puuid}) || hasPlayerId(summonerId))) {
        timer = setTimeout(() => fetchName(attempt + 1), 2000 * (attempt + 1));
      }
    };
    fetchName();
    return () => {active = false; clearTimeout(timer);};
  }, [key, puuid, summonerId, initial.name, recovered, live]);
  const retained = readRetainedIdentity(player);
  if (result?.key === key && result.identity.name) return result.identity;
  if (cached) return {...initial, name: playerName(cached) || initial.name};
  if (retained) return {...retained, recovered:initial.recovered};
  return {...initial, loading: live && (hasPuuid(player) || hasPlayerId(summonerId))};
}

export default function useSummonerName(puuid) {
  return usePlayerIdentity({puuid}).name;
}
