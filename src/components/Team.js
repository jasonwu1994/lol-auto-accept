import React from 'react';
import apiUtils from "../api/api-utils";
import {Divider, Image} from "antd";
import {useTranslation} from 'react-i18next';
import useSummonerName from '../hooks/useSummonerName';
import ChampionImage from "./common/ChampionImage";

const Team = ({title, team}) => {
  const {t} = useTranslation();
  const maxCount = getMaxCount(team, t);

  return (
    <>
      <h2>{title}{maxCount}</h2>
      {team.map((group, groupIndex) => (
        <React.Fragment key={`group-${groupIndex}`}>
          {group.map(player => (
            <TeamMember key={player.puuid} player={player}/>
          ))}
          {groupIndex < team.length - 1 && <Divider style={{margin: 5, borderWidth: 3}}/>}
        </React.Fragment>
      ))}
    </>
  );
}

const TeamMember = ({player}) => {
  const summonerName = useSummonerName(player.puuid);
  const championName = apiUtils.getChampionNameById(player.championId);
  const str = `${championName} ${summonerName || ''} ${player.selectedPosition ?? ''}`;

  return (
    <div key={player.puuid} style={{fontSize: "18px"}}>
      <ChampionImage width={30} height={30} championId={player.championId}/>
      {str}
    </div>
  );
};

function getMaxCount(inputArray, t) {
  const maxObjectCount = inputArray.reduce((maxCount, currentArray) => {
    return Math.max(maxCount, currentArray.length);
  }, 0);
  switch (maxObjectCount) {
    case 5:
      return "(" + t('common.premade.quint') + ")"
    case 4:
      return "(" + t('common.premade.quad') + ")"
    case 3:
      return "(" + t('common.premade.trio') + ")"
    case 2:
      return "(" + t('common.premade.duo') + ")"
    case 1:
      return "(" + t('common.premade.solo') + ")"
    default:
      return ""
  }
}

export default Team