import axios from 'axios'

class ApiUtils {
  static store;
  static port = 0;
  static authorization = '';
  static champions = [];
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
    ApiUtils.store.subscribe(() => {
      if (ApiUtils.champions.length > 0) {
        // console.log("已經有英雄資訊，不需要再取得", ApiUtils.champions.length)
      } else {
        console.log("準備所有英雄資訊 ", ApiUtils.getAllChampionsByCache().then(res => console.log(res)).catch(error => console.log(error)));
      }
    });
  }

  static getReduxState() {
    return ApiUtils.store.getState();
  }

  static async getCurrentSummoner() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-summoner/v1/current-summoner`)
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

  static getAllChampions() {
    return axios.get(`${ApiUtils.getApiBaseUrl()}/lol-champ-select/v1/all-grid-champions`)
  }

  static getChampionNameById(championId) {
    const champion = ApiUtils.champions.find((champion) => champion.id === championId);
    return champion ? champion.name : championId;
  }

  static async getChampionIdByName(name) {
    let champions = await ApiUtils.getAllChampionsByCache()
    const champion = champions.find((champion) => champion.name === name);
    return champion ? champion.id : name;
  }

  static async getAllChampionsByCache() {
    if (ApiUtils.champions.length !== 0) {
      console.log("return champions by cache")
      return ApiUtils.champions
    }
    try {
      const response = await ApiUtils.getAllChampions();
      ApiUtils.champions = response.data
      console.log("return champions by api")
      return ApiUtils.champions;
    } catch (error) {
      console.error(error);
      ApiUtils.champions = []
      return [];
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


}


export default ApiUtils;
