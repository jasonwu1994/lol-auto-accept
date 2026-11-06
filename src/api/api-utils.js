import {decimalId} from '../desktop/identifiers';
import i18next from 'i18next';
import {desktop} from '../desktop/tauri';
import {createReadCache} from './readCache';
import {createHistoryRequests} from './historyRequests';
const query = (command, args) => desktop.invoke(command, args);
const playerReads = createReadCache();
const publicReads = createReadCache(8);
const historyRequest = createHistoryRequests();
let playerScope;
const scope = () => JSON.stringify(desktop.session());
function playerQuery(command, args, ttl = Infinity, schedule = load => load()) {
  const expected = scope();
  if (expected !== playerScope) {playerReads.clear(); playerScope = expected;}
  return playerReads.read(JSON.stringify([command, args]), ttl, async () => {
    const value = await schedule(() => {
      if (scope() !== expected) throw new Error('Client session changed');
      return query(command, args);
    });
    if (scope() !== expected) throw new Error('Client session changed');
    return value;
  });
}
const response = promise => promise.then(data => ({data}));
const championListeners = new Set();
let championRevision = 0;
class ApiUtils {
  static subscribeChampions(listener) {championListeners.add(listener);return ()=>championListeners.delete(listener);}
  static championRevision() {return championRevision;}
  static champions = {zh_TW: [], en_US: []};
  static championNames = {zh_TW: new Map(), en_US: new Map()};
  static setStore() {}
  static checkIsDev() {return import.meta.env.DEV;}
  static postAcceptMatchmaking(intent) {return query('respond_ready_check', {action:'accept', ...intent});}
  static postDeclineMatchmaking(intent) {return query('respond_ready_check', {action:'decline', ...intent});}
  static getChampSelectSession() {return response(query('get_champ_select_session'));}
  static getGameflowSession() {return response(query('get_gameflow_session'));}
  static getGameflowPhase() {return response(query('get_gameflow_phase'));}
  static getCurrentSummoner() {return query('get_current_summoner');}
  static async getCurrentSummonerPuuid() {return (await this.getCurrentSummoner()).puuid;}
  static async getSummonersById(summonerId) {return playerQuery('get_summoners_by_id', {summonerId:decimalId(summonerId)});}
  static getSummonerByPuuid(puuid) {return playerQuery('get_summoner_by_puuid', {puuid});}
  static getSummonerByPuuidFromCache(puuid) {return this.getSummonerByPuuid(puuid);}
  static getCachedSummoner(puuid, summonerId) {
    if (playerScope !== scope()) return undefined;
    if (puuid) return playerReads.peek(JSON.stringify(['get_summoner_by_puuid', {puuid}]));
    if (summonerId) return playerReads.peek(JSON.stringify(['get_summoners_by_id', {summonerId:decimalId(summonerId)}]))?.[0];
    return undefined;
  }
  static async getSummonerPuuidById(id) {return (await this.getSummonersById(id))[0]?.puuid;}
  static async getRankedStats(summonerId) {return playerQuery('get_ranked_stats', {summonerId:decimalId(summonerId)}, 30000);}
  static putHovercard(queue,tier) {return query('set_hovercard', {queue,tier,...desktop.session()});}
  static async getAllChampions(locale) {return query('get_champions',{locale});}
  static async getAllChampionsByCache(locale=this.getCurrentLang()) {
    return publicReads.read(`champions:${locale}`, 3600000, async () => {
      const data=await this.getAllChampions(locale);
      this.champions[locale]=Array.isArray(data)?data:Object.values(data.data ?? data);
      this.championNames[locale]=new Map(this.champions[locale].map(champion=>[String(champion.key),champion.name]));
      championRevision++; championListeners.forEach(listener=>listener());
      return this.champions[locale];
    });
  }
  static getChampionNameById(id) {return this.championNames[this.getCurrentLang()].get(String(id)) ?? String(id ?? '');}
  static async getChampionIdByName(name) {return (await this.getAllChampionsByCache()).find(c=>c.name===name)?.id ?? name;}
  static getChampionsBalance() {return response(query('get_champions_balance'));}
  static getChampionsBalanceByCache() {return publicReads.read('balance', 3600000, ()=>query('get_champions_balance'));}
  static getPickableChampionIds() {return response(query('get_pickable_champion_ids'));}
  static getVersions() {return response(query('get_versions'));}
  static getLatestRelease() {return publicReads.read('latest-release', 3600000, ()=>query('get_latest_release'));}
  static getCurrentLang() {return i18next.language === 'en' ? 'en_US' : 'zh_TW';}
  static getCurrentSummonerMatches(begIndex,endIndex) {return query('get_current_summoner_matches',{begIndex,endIndex});}
  static getPlayerMatches(puuid, count = 5, assertCurrent = () => {}) {
    assertCurrent();
    return playerQuery('get_player_matches',{puuid,count},Infinity,load => historyRequest(load,assertCurrent));
  }
  static getLivePlayers() {return query('get_live_players');}
  static getEncounterGame(gameId, assertCurrent = () => {}) {
    assertCurrent();
    return playerQuery('get_history_game',{gameId:decimalId(gameId)},Infinity,load => historyRequest(load,assertCurrent));
  }
  static async getHistoryGame(gameId) {return query('get_history_game',{gameId:decimalId(gameId)});}
  static async getHistoryGames(ids, signal, assertCurrent = () => {}) {
    const result=[];
    for(const id of [...new Set(ids)]) {
      if (signal?.aborted) throw new Error('History refresh was cancelled');
      assertCurrent();
      result.push(await this.getHistoryGame(id));
      if (signal?.aborted) throw new Error('History refresh was cancelled');
      assertCurrent();
    }
    return result;
  }
  static getLobbyCommsMembers() {return query('get_lobby_members');}
  static async getLobbyCommsMembersPuuids() {return Object.keys((await this.getLobbyCommsMembers()).players ?? {});}
}
export default ApiUtils;
