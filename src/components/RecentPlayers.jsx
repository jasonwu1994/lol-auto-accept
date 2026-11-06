import PlayerTable, {PlayerSectionTitle} from './common/PlayerTable';
import GameDataStatus from './common/GameDataStatus';
import useChampionData from '../hooks/useChampionData';
import React, {useMemo} from 'react';
import {connect} from "react-redux";
import {recentTeams, recentTeamResult} from './common/RecentUtils';
import {currentChampionsByPuuid} from './common/currentPlayers';
import useRecentMatches from '../hooks/useRecentMatches';
import withErrorBoundary from "./error/withErrorBoundary";
import {useTranslation} from 'react-i18next';
import apiUtils from "../api/api-utils";
import ChampionImage from "./common/ChampionImage";

function RecentPlayers(props) {
  const {t} = useTranslation();
  const {games: recentGames, loading, error} = useRecentMatches();
  // What each encountered player is playing in the current game.
  const currentChampions = useMemo(() => currentChampionsByPuuid(props.gameflowSession), [props.gameflowSession]);

  return (
    <div className="page">
      <GameDataStatus loading={loading} error={error}/>
      {recentGames.map((game, index) => {
        const gameCreationDate = new Date(game.gameCreationDate).toLocaleString();
        const teams = recentTeams(game);

        // 顯示每場比賽
        return (
          <div key={game.gameId}>
            <h2 className="player-game-title">Game {game.gameIndex + 1} ({gameCreationDate})</h2>

            <PlayerTable>
              {teams.map(team => {
                const teamParticipants = team.participants;
                if (!teamParticipants.length) return null;
                return <tbody key={team.teamId}>
                  <PlayerSectionTitle columns={7} team={team.teamId === 100 ? 'teamOne' : team.teamId === 200 ? 'teamTwo' : undefined}>{t(team.teamId === 100 ? 'common.teamOne' : team.teamId === 200 ? 'common.teamTwo' : 'common.unknownTeam')} {recentTeamResult(team.win)}</PlayerSectionTitle>
                  {teamParticipants.map(participant => <TeamMember key={participant.player.puuid} participant={participant} currentChampionId={currentChampions.get(participant.player.puuid)}/>)}
                </tbody>;
              })}
            </PlayerTable>
          </div>
        );
      })}
    </div>
  );
}

const TeamMember = ({participant, currentChampionId}) => {
  useChampionData();
  const {t} = useTranslation();
  const {player = {}, championId, stats = {}} = participant;
  const name = player.gameName || player.summonerName || t('common.unknown');
  return <tr>
    <td><ChampionImage width={30} height={30} championId={championId}/></td>
    <td>{apiUtils.getChampionNameById(championId)}</td>
    <td className="recent-now" title={t('common.currentChampionTitle')}>
      <span className="recent-now-content">
        {currentChampionId ? <>
          <span className="recent-now-label">{t('common.currentChampion')}</span>
          <ChampionImage width={22} height={22} championId={currentChampionId}/>
          <span>{apiUtils.getChampionNameById(currentChampionId)}</span>
        </> : <span className="recent-now-label">—</span>}
      </span>
    </td>
    <td>{name}{player.tagLine ? `#${player.tagLine}` : ''}</td>
    <td>{stats.kills ?? '—'}/{stats.deaths ?? '—'}/{stats.assists ?? '—'}</td>
    <td>{t('common.damage')}: {stats.totalDamageDealtToChampions ?? '—'}</td>
    <td className={stats.win === true ? 'player-result-win' : stats.win === false ? 'player-result-lose' : undefined}>{stats.win === true ? 'Win' : stats.win === false ? 'Lose' : '—'}</td>
  </tr>;
};

const mapStateToProps = (state) => {
  return {
    sessionIdentity: state.GameReducer.sessionIdentity,
    gameflowSession: state.GameReducer.gameflowSession,
    isShowRecentTeammate: state.ConfigReducer.isShowRecentTeammate,
    recentTeammateCheckGameCount: state.ConfigReducer.recentTeammateCheckGameCount,
  }
}

export default connect(mapStateToProps)(withErrorBoundary(RecentPlayers))
