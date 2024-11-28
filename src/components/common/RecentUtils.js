import ApiUtils from "../../api/api-utils";
import DatabaseUtils from '../../components/common/DatabaseUtils';

class RecentUtils {

  static async syncRecentGames(startIndex = 0, endIndex = 9) {
    try {
      // 獲取最近遊戲摘要的gameId
      let matches = await ApiUtils.getCurrentSummonerMatches(startIndex, endIndex);
      let gameIds = RecentUtils.mapMatchesToGameIds(matches);
      console.log("CurrentSummonerMatches Game IDs:", gameIds);

      // 查詢資料庫中是否已有詳細資料
      let missingGameIds = await RecentUtils.getMissingGameIdsFromDB(gameIds);
      console.log("Missing Game IDs:", missingGameIds);

      // 獲取缺失遊戲的詳細資料
      let gamesData = await ApiUtils.getHistoryGames(missingGameIds);
      console.log("Fetched Games Data:", gamesData);

      // 獲取當前玩家的 puuid
      let ownerPuuid = await ApiUtils.getCurrentSummonerPuuid();

      // 將遊戲資料轉為資料庫格式
      let dbEntityList = RecentUtils.mapGamesToDBFormat(gamesData, ownerPuuid);

      // 儲存資料到資料庫
      let results = await DatabaseUtils.saveGames(dbEntityList);
      console.log("Database Save Results:", results);

      let trimGames = await DatabaseUtils.trimGamesByOwnerPuuid(ownerPuuid, endIndex + 1)
      console.log("trimGames Results:", trimGames);

      return results;
    } catch (err) {
      console.error("同步最近遊戲時發生錯誤:", err);
      throw err;
    }
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
      return matches.games.games.map(game => String(game.gameId));
    }
    return [];
  }

  /**
   * 傳入 gameIds，返回 DB 中沒有資料的 gameIds
   * @param {string[]} gameIds - 要檢查的 gameIds 陣列
   * @returns {Promise<string[]>} - 缺少的 gameIds
   */
  static async getMissingGameIdsFromDB(gameIds) {
    const missingGameIds = [];
    // 一次性獲取所有資料庫中的相關文檔
    const existingDocs = await DatabaseUtils.getAllGames({
      include_docs: false,
      keys: gameIds, // 指定 keys 查詢
    });
    console.log("existingDocs:", existingDocs);
    // 檢查每個 gameId 是否在資料庫中
    existingDocs.rows.forEach(row => {
      // 判斷缺失條件：
      // 1. row.doc === null: 表示文檔缺失
      // 2. row.value.deleted === true: 表示文檔已刪除
      // 3. row.error 存在: 表示查詢錯誤
      const isMissing =
        (row.doc === null) || // 明確的缺失文檔
        (row.value && row.value.deleted === true) || // 被標記為刪除
        (row.error); // 查詢失敗（如文檔不存在）

      if (isMissing) {
        missingGameIds.push(row.key);
      }
    });
    console.log(`資料庫缺少以下 gameId: ${missingGameIds.join(", ")}`);
    return missingGameIds;
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
    console.log("ownerPuuid ", ownerPuuid);
    let lobbyCommsMembersPuuids = await ApiUtils.getLobbyCommsMembersPuuids();
    console.log("lobbyCommsMembersPuuids ", lobbyCommsMembersPuuids);
    return RecentUtils.filterPlayersAndLobbyMembersAndOwnerPuuids(playersPuuids, lobbyCommsMembersPuuids, ownerPuuid)
  }

  /**
   * @param {string[]} playersPuuids - 全部玩家的 puuid
   * @param {string[]} lobbyMembersPuuids - 一起多排朋友的 puuid
   * @param {string} ownerPuuid - 玩家自己的 puuid
   * @returns {Object} 每個集合分開，例如全部玩家的puuid集合裡面不會有玩家自己的puuid跟多排朋友的puuid
   */
  static filterPlayersAndLobbyMembersAndOwnerPuuids(playersPuuids, lobbyMembersPuuids, ownerPuuid) {
    console.log("filterTeamAndLobbyPuuids playersPuuids", playersPuuids)
    console.log("filterTeamAndLobbyPuuids lobbyMembersPuuids", lobbyMembersPuuids)
    console.log("filterTeamAndLobbyPuuids ownerPuuid", ownerPuuid)

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
  static filterParticipantsByPuuids(playersPuuidsObject, games) {
    const results = [];
    const {playersPuuids, lobbyMembersPuuids, ownerPuuid} = playersPuuidsObject;

    console.log(`filterParticipantsByPuuids playersPuuids: ${playersPuuids}`);
    console.log(`filterParticipantsByPuuids lobbyMembersPuuids: ${lobbyMembersPuuids}`);
    console.log(`filterParticipantsByPuuids ownerPuuid: ${ownerPuuid}`);
    console.log("filterParticipantsByPuuids games:", games);

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
          const identity = data.participantIdentities.find(identity => identity.player.puuid === puuid);
          if (identity) {
            const participant = data.participants.find(p => p.participantId === identity.participantId);
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
        console.log("dataWithoutParticipants", dataWithoutParticipants)
        results.push({
          ...dataWithoutParticipants,
          participants: filteredParticipants,
          gameIndex: index
        });
        console.log("results ", results)
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