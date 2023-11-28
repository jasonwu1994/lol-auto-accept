import {useState, useEffect} from 'react';
import ApiUtils from '../api/api-utils';


function useSummonerName(puuid) {
  const [summonerName, setSummonerName] = useState('');

  useEffect(() => {
    const fetchSummonerName = async () => {
      const summonerData = await ApiUtils.getSummonerByPuuidFromCache(puuid);
      if (summonerData) {
        setSummonerName(summonerData.gameName || summonerData.internalName);
      }
    };

    if (puuid) {
      fetchSummonerName();
    }
  }, [puuid]);

  return summonerName;
}

export default useSummonerName;