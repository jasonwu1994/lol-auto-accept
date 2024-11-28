import React, {useEffect, useState} from 'react';
import {connect} from "react-redux";
import RecentUtils from '../components/common/RecentUtils';
import withErrorBoundary from "./error/withErrorBoundary";
import {useTranslation} from 'react-i18next';
import DatabaseUtils from "./common/DatabaseUtils";
import apiUtils from "../api/api-utils";
import ChampionImage from "./common/ChampionImage";

function RecentPlayers(props) {
  const [recentGames, setRecentGames] = useState([]);
  const {t} = useTranslation();

  useEffect(() => {
    const fetchMatches = async () => {
      // 檢查teamOne和teamTwo是否至少有一個存在
      const teamOne = props.gameflowSession?.gameData?.teamOne;
      const teamTwo = props.gameflowSession?.gameData?.teamTwo;
      if (!teamOne && !teamTwo) return;  // 若兩個隊伍都沒有資料，則直接返回

      const startTime = Date.now();

      // 只要teamOne或teamTwo有資料，就進行處理
      const playersPuuids = [
        ...(teamOne ? RecentUtils.mapPlayersToPuuids(teamOne) : []),
        ...(teamTwo ? RecentUtils.mapPlayersToPuuids(teamTwo) : [])
      ];
      console.log("RecentPlayers Combined playersPuuids:", playersPuuids);

      let results = await RecentUtils.syncRecentGames(0, props.recentTeammateCheckGameCount - 1)
      console.log("RecentPlayers:", results)

      let excludeMyTeamPuuids = await RecentUtils.getCategorizePuuids(playersPuuids);
      console.log("RecentPlayers excludeMyTeamPuuids:", excludeMyTeamPuuids);

      const existingGames = await DatabaseUtils.getAllGamesByOwnerPuuid(excludeMyTeamPuuids.ownerPuuid);

      let finalResult = RecentUtils.filterParticipantsByPuuids(excludeMyTeamPuuids, existingGames)
      console.log("RecentPlayers:", finalResult);
      setRecentGames(finalResult)

      // 記錄結束時間
      const endTime = Date.now();
      const elapsedTime = endTime - startTime;

      console.log(`函數執行時間: ${elapsedTime} 毫秒`);
    };
    fetchMatches();
    // setRecentGames(recentPlayersData)
  }, [props.gameflowSession]);

  return (
    <div>
      {recentGames.map((game, index) => {
        const gameCreationDate = new Date(game.gameCreationDate).toLocaleString();
        const teams = game.teams || [];
        const participants = game.participants || [];

        // 顯示每場比賽
        return (
          <div key={game.gameId} style={{marginBottom: '20px'}}>
            <h2>Game {game.gameIndex + 1} ({gameCreationDate})</h2>

            {/* 檢查藍方和紅方隊伍是否存在 */}
            {teams.map(team => {
              const teamName = team.teamId === 100 ? t('common.teamOne') : t('common.teamTwo');
              const teamWin = team.win === 'Win' ? 'Win' : 'Lose';

              // 過濾出該隊伍的參與者
              const teamParticipants = participants.filter(p => p.teamId === team.teamId);

              // 如果該隊伍有參與者，顯示該隊伍
              if (teamParticipants.length > 0) {
                return (
                  <div key={team.teamId}>
                    <h2>{teamName} {teamWin}</h2>
                    <div key={team.teamId} style={{display: 'block'}}>
                      {teamParticipants.map(participant => {
                        const {player} = participant;
                        return (
                          <TeamMember key={player.puuid} participant={participant}/>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // 如果該隊伍沒有參與者，就返回 null，不顯示紅方或藍方
              return null;
            })}
          </div>
        );
      })}
    </div>
  );
}

const TeamMember = ({participant}) => {
  const {player, championId, stats} = participant;
  const championName = apiUtils.getChampionNameById(championId);
  const str = `${championName ?? ''} ${player.gameName ?? ''} ${stats.kills ?? ''}/${stats.deaths ?? ''}/${stats.assists ?? ''} Dmg:${stats.totalDamageDealtToChampions ?? ''} ${stats.win ? "Win" : "Lose"}`;
  return (
    <div key={player.puuid} style={{fontSize: "18px"}}>
      <ChampionImage width={30} height={30} championId={championId}/>
      {str}
    </div>
  );
};

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession,
    isShowRecentTeammate: state.ConfigReducer.isShowRecentTeammate,
    recentTeammateCheckGameCount: state.ConfigReducer.recentTeammateCheckGameCount,
  }
}

export default connect(mapStateToProps)(withErrorBoundary(RecentPlayers))