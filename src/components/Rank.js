import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import {Image, Tabs} from 'antd';
import withErrorBoundary from "./error/withErrorBoundary";
import ApiUtils from "../api/api-utils";
import {showTeammateRankedType} from "../redux/reducers/ConfigReducer";
import {useTranslation} from 'react-i18next';
import useSummonerName from '../hooks/useSummonerName';
import ChampionImage from "./common/ChampionImage";

function Rank(props) {
  const [current, setCurrent] = useState('solo');
  const [playerList, setPlayerList] = useState({teamOne: [], teamTwo: []});
  const {t} = useTranslation();

  const items = [
    {
      label: t('main.rankedType.soloDuo'),
      key: 'solo'
    },
    {
      label: t('main.rankedType.flex'),
      key: 'flex'
    },
  ];
  useEffect(() => {
    async function fetchData() {
      if (
        props.gameflowSession?.gameData?.teamOne &&
        props.gameflowSession?.gameData?.teamTwo
      ) {
        // console.log("props.gameflowSession ",props.gameflowSession)
        const [teamOne, teamTwo] = await Promise.all([
          addRankedStatsOnPlayer(props.gameflowSession.gameData.teamOne),
          addRankedStatsOnPlayer(props.gameflowSession.gameData.teamTwo)
        ]);
        setPlayerList({teamOne, teamTwo});
      }
    }

    fetchData()
  }, [props.gameflowSession]);

  return (
    <>
      <Tabs defaultActiveKey="1" items={items} onChange={(key) => {
        setCurrent(key)
      }}/>

      {
        current === 'solo' &&
        <>
          {playerList.teamOne.length !== 0 &&
            <Team title={t('common.teamOne')} team={playerList.teamOne} queueType={showTeammateRankedType.SOLO}/>}
          {playerList.teamTwo.length !== 0 &&
            <Team title={t('common.teamTwo')} team={playerList.teamTwo} queueType={showTeammateRankedType.SOLO}/>}
        </>
      }

      {
        current === 'flex' &&
        <>
          {playerList.teamOne.length !== 0 &&
            <Team title={t('common.teamOne')} team={playerList.teamOne} queueType={showTeammateRankedType.FLEX}/>}
          {playerList.teamTwo.length !== 0 &&
            <Team title={t('common.teamTwo')} team={playerList.teamTwo} queueType={showTeammateRankedType.FLEX}/>}
        </>
      }
    </>
  );
}

async function addRankedStatsOnPlayer(team) {
  console.log("addRankedStatsOnPlayer", team)
  const updatedTeam = await Promise.all(
    team.map(async (player) => {
      const championName = ApiUtils.getChampionNameById(player.championId);
      const rankedStats = await ApiUtils.getRankedStats(player.summonerId);
      return {
        ...player,
        championName,
        rankedStats,
      };
    })
  );
  // console.log(updatedTeam);
  return updatedTeam;
}

const Team = ({title, team, queueType}) => {
  return (
    <>
      <h2>{title}</h2>
      {
        team.map((player, playerIndex) => (
          <Player key={player.puuid} player={player} queueType={queueType}/>
        ))
      }
    </>
  )
};

const Player = ({player, queueType}) => {
  const summonerName = useSummonerName(player.puuid);
  const championName = ApiUtils.getChampionNameById(player.championId);
  const queue = player.rankedStats.queues.find(q => q.queueType === queueType);
  const str = `${championName} ${summonerName || ''} ${queue.tier} ${queue.division} ${queue.leaguePoints} ${queue.miniSeriesProgress} wins:${queue.wins}`;

  return (
    <div style={{fontSize: "18px"}}>
      <ChampionImage width={30} height={30} championId={player.championId}/>
      {str}
    </div>
  );
};

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

const mapDispatchToProp = {
  changeGameflowSession(data) {
    return {
      type: "change-gameflowSession",
      data
    }
  }
}
export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(Rank))
