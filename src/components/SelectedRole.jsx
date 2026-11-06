import useChampionData from '../hooks/useChampionData';
import React from 'react';
import {connect} from "react-redux";
import ApiUtils from "../api/api-utils";
import {useTranslation} from 'react-i18next';
import PlayerTable, {PlayerIdentity, PlayerSectionTitle} from './common/PlayerTable';
import useCurrentRoster from '../hooks/useCurrentRoster';
import ChampionImage from "./common/ChampionImage";

function SelectedRole(props) {
  const {t} = useTranslation();
  const roster = useCurrentRoster();
  return <div>
    <PlayerTable>
      {Object.entries(roster).map(([key, team]) => team.length > 0 && <tbody key={key}>
        <PlayerSectionTitle team={key}>{t(key === 'unassigned' ? 'common.unknownTeam' : `common.${key}`)}</PlayerSectionTitle>
        {team.map(player => <TeamMember key={player.puuid} player={player}/>)}
      </tbody>)}
    </PlayerTable>
  </div>;
}

const TeamMember = ({player}) => {
  const {t} = useTranslation();
  useChampionData();
  return <tr>
    <td><ChampionImage width={30} height={30} championId={player.championId}/></td>
    <td>{ApiUtils.getChampionNameById(player.championId)}</td>
    <td><PlayerIdentity player={player}/></td>
    <td>{player.selectedRole ?? t('common.unknown')}</td>
  </tr>;
};

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession
  }
}

export default connect(mapStateToProps)(SelectedRole)
