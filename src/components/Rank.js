import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import {Image, Tabs} from 'antd';
import withErrorBoundary from "./error/withErrorBoundary";
import ApiUtils from "../api/api-utils";
import {showTeammateRankedType} from "../redux/reducers/ConfigReducer";
import {useTranslation} from 'react-i18next';


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
        team.map((player, playerIndex) => {
          let queue = player.rankedStats.queues.find(q => q.queueType === queueType);
          let str = `${ApiUtils.getChampionNameById(player.championId)} ${player.summonerInternalName} ${queue.tier} ${queue.division} ${queue.leaguePoints} ${queue.miniSeriesProgress} wins:${queue.wins}`;
          return (
            <div key={player.puuid} style={{fontSize: "18px"}}>
              <Image width={30} height={30} style={{userSelect: "none"}} preview={false}
                     src={`https://cdn.communitydragon.org/latest/champion/${player.championId}/square`}
                     fallback="data:image/png;base64,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"
              />
              {str}
            </div>
          )
        })
      }
    </>
  )
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
