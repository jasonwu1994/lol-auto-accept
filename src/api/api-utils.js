import axios from 'axios'
import i18next from 'i18next';
import store from '../redux/store';

class ApiUtils {
  static store;
  static port = 0;
  static authorization = '';
  static champions = {"zh_TW": [], "en_US": []}; // 根據語言快取
  static lastFetchedChampions = {"zh_TW": null, "en_US": null}; // 存儲上次獲取數據的時間戳
  static championsBalance = {};
  static lastFetchedChampionsBalance = null; // 存儲上次獲取數據的時間戳
  static isDev = ApiUtils.checkIsDev();
  static apiBaseUrl = ApiUtils.getApiBaseUrl();
  static summonerCache = new Map();

  static checkIsDev() {
    // console.log("window.location.hostname:",window.location.hostname)
    return window.location.hostname === 'localhost';
  }

  static getApiBaseUrl() {
    return '/lol'
  }

  static setStore(store) {
    ApiUtils.store = store;
    ApiUtils.initialize();
  }

  static enCodedAuth(username, password) {
    const encodedAuth = Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
    return `Basic ${encodedAuth}`;
  }

  static initialize() {
    axios.defaults.headers.common['Accept'] = 'application/json';
    let prevAuth = ApiUtils.getReduxState().AuthReducer.auth;
    ApiUtils.store.subscribe(() => {
      const currentAuth = ApiUtils.getReduxState().AuthReducer.auth;
      // console.log("api-utils subscribe", prevAuth, currentAuth);
      if (JSON.stringify(prevAuth) !== JSON.stringify(currentAuth)) {
        console.log("prevAuth !== currentAuth")
        ApiUtils.port = currentAuth.port;
        axios.defaults.headers.common['Authorization'] = ApiUtils.enCodedAuth(currentAuth.username, currentAuth.password);
        axios.defaults.headers.common['x-target-port'] = `${ApiUtils.port}`;
      }
      prevAuth = currentAuth
    });

    // 快取英雄資料
    const cacheChampionsData = async () => {
      try {
        await Promise.all([
          ApiUtils.getAllChampionsByCache('zh_TW'),
          ApiUtils.getAllChampionsByCache('en_US')
        ]);
        console.log("英雄資料已成功快取");
      } catch (error) {
        console.error("快取英雄資料失敗", error);
      }
    };
    cacheChampionsData();

    // 設定 40 分鐘自動調用快取資料
    const interval = 40 * 60 * 1000; // 40 分鐘
    setInterval(() => {
      cacheChampionsData();
    }, interval);
  }

  static getReduxState() {
    if (!ApiUtils.store) {
      console.warn("ApiUtils.store is undefined. Reinitializing...");
      ApiUtils.store = store; // 自動重新設置為全局的 Redux store
    }
    return ApiUtils.store.getState();
  }

  static postAcceptMatchmaking() {
    axios.post(`${ApiUtils.getApiBaseUrl()}/lol-matchmaking/v1/ready-check/accept`)
      .then(response => console.log(response.data))
      .catch(error => console.error(error));
  }

  static postDeclineMatchmaking() {
    axios.post(`${ApiUtils.getApiBaseUrl()}/lol-matchmaking/v1/ready-check/decline`)
      .then(response => console.log(response.data))
      .catch(error => console.error(error));
  }

  static getChampSelectSession() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/session`);
  }

  static getGameflowSession() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-gameflow/v1/session`)
  }

  static getGameflowPhase() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-gameflow/v1/gameflow-phase`)
  }

  static postConversations(str) {
    if (str === "") return
    let payload = {
      body: str,
      fromId: "",
      fromPid: "",
      fromSummonerId: 0,
      id: "",
      isHistorical: false,
      timestamp: "",
      type: "celebration"
    };
    let chatRoomId = ApiUtils.getReduxState().GameReducer.chatRoomId
    axios.post(`${ApiUtils.getApiBaseUrl()}/lol-chat/v1/conversations/${chatRoomId}/messages`, payload)
      .then(response => console.log("postConversations ", response.data))
      .catch(error => console.error(error));
  }

  static async getCurrentSummoner() {
    try {
      const response = await axios.get(
        `${ApiUtils.getApiBaseUrl()}/lol-summoner/v1/current-summoner`
      );
      console.log("API getCurrentSummoner:", response.data)
      return response.data;
    } catch (error) {
      console.error("Error fetching CurrentSummoner:", error);
      return {};
    }
  }

  static async getCurrentSummonerPuuid() {
    try {
      const response = await ApiUtils.getCurrentSummoner()
      if (response?.puuid) {
        return response.puuid;
      }
      return response.data;
    } catch (error) {
      console.error("Error fetching getCurrentSummonerPuuid:", error);
      return "";
    }
  }

  static getSummonersById(summonerId) {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-summoner/v2/summoners?ids=%5B${summonerId}%5D`)
      .then(response => {
        console.log("getSummonersById ", response.data);
        return response.data;
      })
      .catch(error => {
        console.error("getSummonersById ", error);
      })
  }

  //summonerName 必須是gameName+tagLine
  static getSummonersByName(summonerName) {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-summoner/v1/summoners?name=${summonerName}`)
  }

  static async getSummonerByPuuid(puuid) {
    return await axios.get(`${ApiUtils.getApiBaseUrl()}/lol-summoner/v2/summoners/puuid/${puuid}`)
      .then(response => {
        // console.log("getSummonerByPuuid ", response.data);
        return response.data;
      })
      .catch(error => {
        console.error("getSummonerByPuuid ", error);
        return null;
      })
  }

  static async getSummonerByPuuidFromCache(puuid) {
    const CACHE_TIME = 30 * 60 * 1000 // 快取30分鐘
    const CACHE_MAX_SIZE = 100
    const currentTime = Date.now();
    const cacheEntry = ApiUtils.summonerCache.get(puuid);
    // console.log("SummonerCache", ApiUtils.summonerCache)

    if (cacheEntry && currentTime - cacheEntry.timestamp < CACHE_TIME) {
      return cacheEntry.data;
    } else {
      // 快取中沒有數據或已過期
      const summonerData = await ApiUtils.getSummonerByPuuid(puuid);
      if (summonerData) {
        ApiUtils.summonerCache.set(puuid, {data: summonerData, timestamp: currentTime});
        // 檢查快取大小，清理舊的
        if (ApiUtils.summonerCache.size > CACHE_MAX_SIZE) {
          const keysToDelete = Array.from(ApiUtils.summonerCache.keys()).slice(0, 50);
          keysToDelete.forEach(key => ApiUtils.summonerCache.delete(key));
        }
      }

      return summonerData;
    }
  }

  static async getSummonerPuuidById(summonerId) {
    let summoners = await ApiUtils.getSummonersById(summonerId);
    return summoners[0].puuid;
  }

  static async getRankedStats(summonerId) {
    let puuid = await ApiUtils.getSummonerPuuidById(summonerId);
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-ranked/v1/ranked-stats/${puuid}`)
      .then(response => {
        console.log('getRankedStats ', response.data);
        return response.data
      })
      .catch(error => {
        console.error('getRankedStats ', error);
        throw error;
      });
  }

  static putHovercard(queue, tier) {
    const payload = {
      availability: "",
      icon: null,
      id: null,
      lastSeenOnlineTimestamp: null,
      lol: {
        level: "30",
        rankedSplitRewardLevel: "3",
        rankedLeagueDivision: "I",
        rankedLeagueQueue: queue,
        rankedLeagueTier: tier,
        regalia: "{bannerType:2,crestType:2}",
        skinVariant: "",
        skinname: ""
      },
      name: "",
      statusMessage: null
    };
    axios.put(`${ApiUtils.getApiBaseUrl()}/lol-chat/v1/me`, payload)
      .then(response => console.log(response.data))
      .catch(error => console.error(error));
  }

  static async getAllChampions(lang) {
    try {
      const versionsResponse = await ApiUtils.getVersions(); // 先取得版本號
      const version = versionsResponse.data[0]; // 取最新的版本號
      const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${lang}/champion.json`);

      // 轉換資料結構
      const championsData = Object.values(response.data.data);
      console.log('getAllChampions:', championsData);
      return championsData;
    } catch (error) {
      console.error('Error fetching champions data:', error);
      return [];
    }
  }

  // 依照 championId 取得英雄名字
  static getChampionNameById(championId) {
    const lang = ApiUtils.getCurrentLang();
    const champion = ApiUtils.champions[lang].find((champion) => champion.key === championId.toString());
    return champion ? champion.name : championId;
  }

  static async getChampionIdByName(name) {
    let champions = await ApiUtils.getAllChampionsByCache()
    const champion = champions.find((champion) => champion.name === name);
    return champion ? champion.id : name;
  }

  static async getAllChampionsByCache(lang = null) {
    if (!lang) {
      lang = ApiUtils.getCurrentLang();
    }
    const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 小時 快取時間
    const currentTime = Date.now();

    // 如果 champions 已經存在且未過期，返回快取
    if (ApiUtils.champions[lang].length !== 0 &&
      ApiUtils.lastFetchedChampions[lang] &&
      (currentTime - ApiUtils.lastFetchedChampions[lang]) < CACHE_DURATION) {
      console.log(`Returning ${lang} champions from cache`);
      return ApiUtils.champions[lang];
    }

    // 否則，打 API 重新抓取
    try {
      const championsData = await ApiUtils.getAllChampions(lang);
      ApiUtils.champions[lang] = championsData; // 更新快取
      ApiUtils.lastFetchedChampions[lang] = currentTime; // 更新抓取時間
      console.log(`Returning ${lang} champions from API`);
      return ApiUtils.champions[lang];
    } catch (error) {
      console.error('Error fetching champions by cache:', error);
      return [];
    }
  }

  static async getChampionsBalance() {
    try {
      // 取得最新版本號
      const versionResponse = await axios.get(`https://b2c-api-cdn.deeplol.gg/champion/version?cnt=3`, {
        headers: {
          'Accept': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

      const versionList = versionResponse.data.game_version_list;
      if (!Array.isArray(versionList) || versionList.length === 0) {
        throw new Error('No valid versions received from version API');
      }

      // 使用最新版本號請求balance數據
      const latestVersion = versionList[0];
      return await axios.get(`https://b2c-api-cdn.deeplol.gg/champion/balance?version=${latestVersion}`, {
        headers: {
          'Accept': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Authorization': '',
          'x-target-port': '',
        },
      });
    } catch (error) {
      console.error('Error fetching champions balance:', error);
      throw error;
    }
  }

  static async getChampionsBalanceByCache() {
    const CACHE_DURATION = 1 * 60 * 60 * 1000; // 1 小時 快取時間
    const currentTime = Date.now();

    // 如果 championsBalance 已經存在，並且未超過快取時間，則直接返回快取
    if (Object.keys(ApiUtils.championsBalance).length !== 0 &&
      ApiUtils.lastFetchedChampionsBalance &&
      (currentTime - ApiUtils.lastFetchedChampionsBalance) < CACHE_DURATION) {
      console.log("return champions balance by cache");
      return ApiUtils.championsBalance;
    }

    // 否則，重新調用API來獲取最新的數據
    try {
      const response = await ApiUtils.getChampionsBalance();
      ApiUtils.championsBalance = response.data;
      ApiUtils.lastFetchedChampionsBalance = currentTime; // 更新最後的獲取時間
      console.log("return champions balance by api", ApiUtils.championsBalance);
      return ApiUtils.championsBalance;
    } catch (error) {
      console.error("Error fetching champions balance:", error);
      ApiUtils.championsBalance = {};
      return {};
    }
  }

  static getBannableChampionIds() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/bannable-champion-ids`)
  }

  static getPickableChampionIds() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/pickable-champion-ids`)
  }

  static getChampSelectTrades() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/session/trades`)
  }

  static postChampSelectTrades(id) {
    return axios.post(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/session/trades/${id}`)
  }

  static postChampSelectBenchSwap(championId) {
    return axios.post(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/session/bench/swap/${championId}`)
  }

  static getVersions() {
    return axios.get(`https://ddragon.leagueoflegends.com/api/versions.json`)
  }

  static getCurrentLang() {
    return i18next.language === 'en' ? 'en_US' : 'zh_TW';
  }

  static async getCurrentSummonerMatches(begIndex, endIndex) {
    try {
      const response = await axios.get(
        `${ApiUtils.getApiBaseUrl()}/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${begIndex}&endIndex=${endIndex}`
      );
      console.log("API getCurrentSummonerMatches:", response.data)
      return response.data;
    } catch (error) {
      console.error("Error fetching matches:", error);
      return {};
    }
  }

  static async getHistoryGame(gameId) {
    try {
      const response = await axios.get(
        `${ApiUtils.getApiBaseUrl()}/lol-match-history/v1/games/${gameId}`
      );
      console.log("API getHistoryGames:", response.data)
      return response.data;
    } catch (error) {
      console.error("Error fetching matches:", error);
      return {};
    }
  }

  static async getHistoryGames(gameIds) {
    const results = [];
    for (const gameId of gameIds) {
      try {
        const data = await ApiUtils.getHistoryGame(gameId);
        results.push(data);
      } catch (error) {
        console.error(`Error processing gameId ${gameId}:`, error);
      }
    }
    return results;
  }

  static async getLobbyCommsMembers() {
    try {
      const response = await axios.get(
        `${ApiUtils.getApiBaseUrl()}/lol-lobby/v2/comms/members`
      );
      console.log("API getLobbyCommsMembers:", response.data)
      return response.data;
    } catch (error) {
      console.error("Error fetching getLobbyCommsMembers:", error);
      return {};
    }
  }

  /**
   * 獲取 Lobby 成員的 PUUID 陣列
   * @returns {Promise<string[]>} 成員的 PUUID 陣列
   */
  static async getLobbyCommsMembersPuuids() {
    try {
      const response = await this.getLobbyCommsMembers();

      // 檢查 players 是否存在並且是對象
      if (response.players && typeof response.players === "object") {
        // 取出 players 的所有 key 作為 PUUID
        const puuids = Object.keys(response.players);
        return puuids;
      }

      // 如果 players 不存在或格式不正確，返回空陣列
      return [];
    } catch (error) {
      console.error("Error fetching getLobbyCommsMembersPuuid:", error);
      return [];
    }
  }

}


export default ApiUtils;
