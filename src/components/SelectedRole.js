import React from 'react';
import {connect} from "react-redux";
import {Image} from "antd";
import ApiUtils from "../api/api-utils";
import {useTranslation} from 'react-i18next';
import useSummonerName from '../hooks/useSummonerName';
import ChampionImage from "./common/ChampionImage";

function SelectedRole(props) {
  const {t} = useTranslation();

  return (
    <div>
      {props?.gameflowSession?.gameData?.teamOne?.some(obj => obj.selectedRole !== undefined) &&
        <Team title={t('common.teamOne')} team={props.gameflowSession.gameData.teamOne}/>
      }
      {props?.gameflowSession?.gameData?.teamTwo?.some(obj => obj.selectedRole !== undefined) &&
        <Team title={t('common.teamTwo')} team={props.gameflowSession.gameData.teamTwo}/>
      }
    </div>
  );
}

const TeamMember = ({player}) => {
  const summonerName = useSummonerName(player.puuid);
  const championName = ApiUtils.getChampionNameById(player.championId);
  const str = `${championName} ${summonerName || ''} ${player.selectedRole}`;

  return (
    <div key={player.puuid} style={{fontSize: "18px"}}>
      <ChampionImage width={30} height={30} championId={player.championId}/>
      {str}
    </div>
  );
};

const Team = ({title, team}) => {
  return (
    <>
      <h2>{title}</h2>
      {
        team.map((player, playerIndex) => {
          return <TeamMember key={player.puuid} player={player}/>
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

export default connect(mapStateToProps)(SelectedRole)