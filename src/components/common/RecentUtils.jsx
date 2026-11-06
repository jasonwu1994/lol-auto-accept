import {trackEvent} from '../../analytics/client';
import {decimalId} from '../../desktop/identifiers';
import {desktop} from '../../desktop/tauri';
import ApiUtils from "../../api/api-utils";
import {currentPlayers} from './currentPlayers';
import DatabaseUtils from '../../components/common/DatabaseUtils';

// Retry only the idempotent recent-history refresh, never game actions.
export async function retryRecentRefresh(refresh, signal) {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) return;
    try {return await refresh();}
    catch (error) {
      if (signal.aborted) return;
      if (attempt === 2) throw error;
      await new Promise(resolve => {
        const finish = () => {clearTimeout(timer); signal.removeEventListener('abort', finish); resolve();};
        const timer = setTimeout(finish, attempt === 0 ? 2000 : 4000);
        signal.addEventListener('abort', finish, {once:true});
      });
    }
  }
}

export function recentPlayersQueryKey(session, identity, count, ownerPuuid) {
  const puuids = [...new Set(Object.values(currentPlayers(session)).flat().map(player => player.puuid).filter(Boolean))].sort();
  return JSON.stringify([identity?.connectionGeneration, ownerPuuid ?? '', session?.gameData?.gameId, puuids, count]);
}

const emptyRecent = {loading: true, games: [], error: null};

export function createRecentMatchStore() {
  let key;
  let snapshot = emptyRecent;
  let controller;
  const listeners = new Set();
  return {
    read() {return snapshot;},
    subscribe(expected, load, listener) {
      listeners.add(listener);
      if (expected == null) {
        controller?.abort(); key = null;
        if (snapshot.loading) snapshot = {...snapshot, loading:false};
        return () => listeners.delete(listener);
      }
      if (key !== expected) {
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        key = expected;
        snapshot = {...snapshot, loading:true, error:null};
        const publish = value => {
          if (signal.aborted || key !== expected) return;
          snapshot = value;
          listeners.forEach(notify => notify());
        };
        retryRecentRefresh(() => load(signal), signal)
          .then(games => {if(!signal.aborted && key===expected)trackEvent('lookup_completed',{feature:'recent',result:'success',result_count:games?.length??0});publish({loading: false, games: games ?? [], error: null});})
          .catch(error => publish({...snapshot, loading:false, error}));
      }
      // Navigation retains the single match result, including an empty result.
      return () => listeners.delete(listener);
    }
  };
}

export const recentMatchStore = createRecentMatchStore();

export async function loadRecentMatch(queryKey, signal) {
  const [, ownerPuuid, currentGameId, playersPuuids, count] = JSON.parse(queryKey);
  const assertCurrent = () => {
    const current = desktop.snapshot();
    if (signal.aborted || current?.config?.recentTeammateCheckGameCount !== count || recentPlayersQueryKey(current?.gameflowSession, current, count, current?.currentSummoner?.puuid) !== queryKey) {
      throw new Error('Match changed during recent-player lookup');
    }
  };
  assertCurrent();
  if (!playersPuuids.length) return [];
  // One extra game is kept: once the current game has finished it appears in the history and is
  // excluded below, and the configured number of earlier games must still be available.
  await RecentUtils.syncRecentGames(0, count, signal, assertCurrent);
  assertCurrent();
  const groups = await RecentUtils.getCategorizePuuids(playersPuuids);
  assertCurrent();
  if (ownerPuuid && groups.ownerPuuid !== ownerPuuid) throw new Error('Account changed during recent-player lookup');
  const games = await DatabaseUtils.getAllGamesByOwnerPuuid(groups.ownerPuuid, count + 1);
  assertCurrent();
  return RecentUtils.filterRecentParticipantsByPuuids(groups, games, count, currentGameId);
}

export function recentTeams(game) {
  const groups = new Map();
  for (const participant of game.participants ?? []) {
    const id = participant.teamId === 100 || participant.teamId === 200 ? participant.teamId : 'unknown';
    if (!groups.has(id)) groups.set(id, {teamId:id, win:(game.teams ?? []).find(team => team.teamId === id)?.win, participants:[]});
    groups.get(id).participants.push(participant);
  }
  return [...groups.values()];
}

export function recentTeamResult(win) {return win === 'Win' ? 'Win' : win === 'Fail' || win === 'Lose' ? 'Lose' : '—';}

class RecentUtils {

  static syncRevision = 0;
  static async syncRecentGames(startIndex = 0, endIndex = 9, signal, assertScope = () => {}) {
    const revision=++this.syncRevision;
    const intent=desktop.session();
    const assertIntent=()=>{
      assertScope();
      const current=desktop.session();
      if(signal?.aborted || revision!==this.syncRevision || current.connectionGeneration!==intent.connectionGeneration || current.sessionKey!==intent.sessionKey) throw Error('History refresh was superseded');
    };
    const ownerPuuid=await ApiUtils.getCurrentSummonerPuuid();
    assertIntent();
    const assertCurrent=async()=>{
      assertIntent();
      const owner=await ApiUtils.getCurrentSummonerPuuid();
      assertIntent();
      if(owner!==ownerPuuid)throw Error('Account changed during history refresh');
    };
    const matches=await ApiUtils.getCurrentSummonerMatches(startIndex,endIndex);
    assertIntent();
    const gameIds=RecentUtils.mapMatchesToGameIds(matches);
    const existing=await DatabaseUtils.getExistingGameIds(ownerPuuid,gameIds);
    assertIntent();
    const present=new Set(existing);
    const games=await ApiUtils.getHistoryGames([...new Set(gameIds.filter(id=>!present.has(id)))],signal,assertIntent);
    await assertCurrent();
    const result=await DatabaseUtils.saveGames(RecentUtils.mapGamesToDBFormat(games,ownerPuuid));
    await assertCurrent();
    await DatabaseUtils.trimGamesByOwnerPuuid(ownerPuuid,endIndex+1);
    return result;
  }

  static mapPlayersToPuuids(players) {
    if (!Array.isArray(players)) {
      console.error("Invalid input: players must be an array");
      return [];
    }
    return players.map(player => player.puuid);
  }

  // 取出所有gameIds，返回陣列
  static mapMatchesToGameIds(matches) {
    if (matches?.games?.games) {
      // 使用 map 遍歷每場遊戲，提取 gameId 並轉為字串
      return matches.games.games.map(game => decimalId(game.gameId));
    }
    return [];
  }

  /**
   * 傳入 gameIds，返回 DB 中沒有資料的 gameIds
   * @param {string[]} gameIds - 要檢查的 gameIds 陣列
   * @returns {Promise<string[]>} - 缺少的 gameIds
   */
  static async getMissingGameIdsFromDB(gameIds) {
    const ownerPuuid = await ApiUtils.getCurrentSummonerPuuid();
    const existing = await DatabaseUtils.getExistingGameIds(ownerPuuid,gameIds);
    const ids = new Set(existing);
    return gameIds.map(decimalId).filter(id=>!ids.has(id));
  }

  //把原始game資料轉成DB的格式
  static mapGamesToDBFormat(games, ownerPuuid) {
    return games.map(game => ({
      _id: String(game.gameId),
      timestamp: game.gameCreation,
      ownerPuuid,
      data: game, // 將原始物件存入 data 欄位
    }));
  }

  static async getCategorizePuuids(playersPuuids) {
    let ownerPuuid = await ApiUtils.getCurrentSummonerPuuid();
    let lobbyCommsMembersPuuids = await ApiUtils.getLobbyCommsMembersPuuids();
    return RecentUtils.filterPlayersAndLobbyMembersAndOwnerPuuids(playersPuuids, lobbyCommsMembersPuuids, ownerPuuid)
  }

  /**
   * @param {string[]} playersPuuids - 全部玩家的 puuid
   * @param {string[]} lobbyMembersPuuids - 一起多排朋友的 puuid
   * @param {string} ownerPuuid - 玩家自己的 puuid
   * @returns {Object} 每個集合分開，例如全部玩家的puuid集合裡面不會有玩家自己的puuid跟多排朋友的puuid
   */
  static filterPlayersAndLobbyMembersAndOwnerPuuids(playersPuuids, lobbyMembersPuuids, ownerPuuid) {

    // 過濾 playersPuuids，排除 lobbyMembersPuuids 和 ownerPuuid
    const filteredPlayersPuuids = playersPuuids.filter(
      puuid => !lobbyMembersPuuids.includes(puuid) && puuid !== ownerPuuid
    );

    // 過濾 lobbyMembersPuuids，排除 ownerPuuid
    const filteredLobbyMembersPuuids = lobbyMembersPuuids.filter(
      puuid => puuid !== ownerPuuid
    );

    // 返回結果
    return {
      playersPuuids: filteredPlayersPuuids,
      lobbyMembersPuuids: filteredLobbyMembersPuuids,
      ownerPuuid: ownerPuuid,
    };
  }

  // 接收隊友puuid+前幾場遊戲的資料，返回遊戲中有符合的puuid
  // The game being played (or just finished) is not an earlier encounter: it is excluded before
  // the configured window is applied, so the window still covers `count` earlier games.
  static filterRecentParticipantsByPuuids(playersPuuidsObject, games, count, currentGameId) {
    if(!Number.isInteger(count) || count<1 || count>100)throw Error('Invalid recent-game count');
    const current = currentGameId == null || String(currentGameId) === '0' ? null : String(currentGameId);
    const earlier = current ? games.filter(game => String(game._id ?? game.data?.gameId) !== current) : games;
    return this.filterParticipantsByPuuids(playersPuuidsObject,earlier.slice(0,count));
  }

  static filterParticipantsByPuuids(playersPuuidsObject, games) {
    const results = [];
    const {playersPuuids, lobbyMembersPuuids, ownerPuuid} = playersPuuidsObject;


    games.forEach((game, index) => {
      if (!game.data) return; // 確保 game 和 data 存在
      const {data} = game;
      const filteredParticipants = [];
      /**
       * 通用函數：檢查並加入匹配的參與者
       * @param {string[]} puuids - 要匹配的 PUUID 陣列
       */
      const addParticipants = (puuids) => {
        puuids.forEach(puuid => {
          const identity = (data.participantIdentities ?? []).find(identity => identity.player?.puuid === puuid);
          if (identity) {
            const participant = (data.participants ?? []).find(p => p.participantId === identity.participantId);
            if (participant && !filteredParticipants.some(p => p.player.puuid === puuid)) {
              filteredParticipants.push({
                ...participant,
                player: identity.player, // 合併 player 資料
              });
            }
          }
        });
      };
      // 處理 myTeamPuuids.myTeamPuuids
      addParticipants(playersPuuids);
      // 如果有匹配的 myTeamPuuids，補充 lobbyMemberPuuids 和 ownerPuuid
      if (filteredParticipants.length > 0) {
        addParticipants(lobbyMembersPuuids);
        addParticipants([ownerPuuid]);
      }
      // 如果有匹配的參與者，生成結果 JSON
      if (filteredParticipants.length > 0) {
        const {participants, participantIdentities, ...dataWithoutParticipants} = data;  // 使用解構賦值，將participants排除
        results.push({
          ...dataWithoutParticipants,
          participants: filteredParticipants,
          gameIndex: index
        });
      }
    });
    return results;
  }

  /**
   * 移除 ISO 時間字串中的毫秒部分
   * @param {string} isoString - 輸入的 ISO 時間字串
   * @returns {string} - 去除毫秒部分後的字串
   */
  static removeMilliseconds(isoString) {
    return isoString.replace(/\.\d+([A-Z])$/, "$1");
  }

}


export default RecentUtils;
