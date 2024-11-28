import {useEffect} from 'react';
import {connect} from "react-redux";
import ApiUtils from "../api/api-utils";
import RecentUtils from '../components/common/RecentUtils';
import DatabaseUtils from '../components/common/DatabaseUtils';
import withErrorBoundary from "../components/error/withErrorBoundary";

const RecentTeammatesService = (props) => {

  useEffect(() => {
    const fetchMatches = async () => {
      if (props.gamePhase !== 'ChampSelect') return;
      if (props.isShowRecentTeammate !== true) return;

      await sleep(3000)

      let results = await RecentUtils.syncRecentGames(0, props.recentTeammateCheckGameCount - 1)
      // console.log("RecentTeammatesService syncRecentGames:",results)

      let myTeamPuuids = RecentUtils.mapPlayersToPuuids(props.champSelectSession.myTeam);
      let excludeMyTeamPuuids = await RecentUtils.getCategorizePuuids(myTeamPuuids);
      // console.log("RecentTeammatesService excludeMyTeamPuuids:", excludeMyTeamPuuids);

      const existingGames = await DatabaseUtils.getAllGamesByOwnerPuuid(excludeMyTeamPuuids.ownerPuuid);

      let finalResult = RecentUtils.filterParticipantsByPuuids(excludeMyTeamPuuids, existingGames)
      // console.log("RecentTeammatesService finalResult:", finalResult);

      let conversationString = mapParticipantsToConversationSting(finalResult);
      console.log("RecentTeammatesService conversationString:", conversationString)
      ApiUtils.postConversations(conversationString)
    };
    fetchMatches();
  }, [props.gamePhase]);

  return null;
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 接收已經篩選好的遊戲資料陣列轉成"顯示在對話框的字串"
function mapParticipantsToConversationSting(games) {
  let result = "";

  games.forEach((game, index) => {
    const gameCreationDate = new Date(game.gameCreationDate).toLocaleString();
    // 將"/"替換為"|"，
    const formattedDate = gameCreationDate.replace(/\//g, '|');
    // 第一行輸出遊戲的序號，從 1 開始
    result += `Game ${game.gameIndex + 1} ${formattedDate}\n`;

    // 遍歷該遊戲的 participants
    game.participants.forEach(participant => {
      const {championId, stats, player} = participant;

      // 格式化每個 participant 的字串
      const participantString = `${player.gameName ?? ''} ${ApiUtils.getChampionNameById(championId) ?? ''} ${stats.kills ?? ''}|${stats.deaths ?? ''}|${stats.assists ?? ''} Dmg:${stats.totalDamageDealtToChampions ?? ''} ${stats.win ? "Win" : "Lose"}`;

      // 添加到結果中，並換行
      result += `${participantString}\n`;
    });
  });

  return result.trim(); // 去除最後多餘的換行符
}

/**
 * 移除 ISO 時間字串中的毫秒部分
 * @param {string} isoString - 輸入的 ISO 時間字串
 * @returns {string} - 去除毫秒部分後的字串
 */
function removeMilliseconds(isoString) {
  return isoString.replace(/\.\d+([A-Z])$/, "$1");
}

const mapStateToProps = (state) => {
  return {
    gamePhase: state.GameReducer.gamePhase,
    champSelectSession: state.GameReducer.champSelectSession,
    lobbyMembers: state.GameReducer.lobbyMembers,
    isShowRecentTeammate: state.ConfigReducer.isShowRecentTeammate,
    recentTeammateCheckGameCount: state.ConfigReducer.recentTeammateCheckGameCount,
  }
}

const mapDispatchToProp = {
  changeMyTeam(data) {
    return {
      type: "change-myTeam",
      data
    }
  },
  changeGamePhase(data) {
    return {
      type: "change-gamePhase",
      data
    }
  },
  changeLobbyMembers(data) {
    return {
      type: "change-lobby-members",
      data
    }
  }
}
export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(RecentTeammatesService));