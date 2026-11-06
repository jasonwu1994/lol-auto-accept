import GameDataStatus from './common/GameDataStatus';
import {rankedMatchKey, rankedMatchStore} from './common/rankedLookup';
import useChampionData from '../hooks/useChampionData';
import React, {useState, useSyncExternalStore, useCallback} from 'react';
import {desktop} from '../desktop/tauri';
import {connect} from "react-redux";
import {Tabs} from './common/Controls';
import withErrorBoundary from "./error/withErrorBoundary";
import ApiUtils from "../api/api-utils";
import {showTeammateRankedType} from "../redux/reducers/ConfigReducer";
import {useTranslation} from 'react-i18next';
import PlayerTable, {PlayerIdentity, PlayerSectionTitle} from './common/PlayerTable';
import useCurrentRoster from '../hooks/useCurrentRoster';
import ChampionImage from "./common/ChampionImage";
import {hasPlayerId} from '../desktop/identifiers';

function Rank(props) {
  const [current, setCurrent] = useState('solo');
  const {t} = useTranslation();
  const roster = useCurrentRoster();
  const ids = [...new Set(Object.values(roster).flat().map(player => player.summonerId).filter(hasPlayerId).map(String))].sort();
  const lookupKey = props.gameflowIsLive === false ? null : rankedMatchKey(props.gameflowSession, props.sessionIdentity, desktop.snapshot()?.currentSummoner?.puuid);
  const idsKey = JSON.stringify(ids);
  const subscribe = useCallback(listener => rankedMatchStore.subscribe(lookupKey, JSON.parse(idsKey), id => {
    const current = desktop.snapshot();
    if (rankedMatchKey(current?.gameflowSession, current, current?.currentSummoner?.puuid) !== lookupKey) {
      return Promise.reject(new Error('Match changed'));
    }
    return ApiUtils.getRankedStats(id);
  }, listener), [lookupKey, idsKey]);
  const ranked = useSyncExternalStore(subscribe, () => rankedMatchStore.read(lookupKey), () => rankedMatchStore.read(lookupKey));
  const loading = props.gameflowIsLive !== false && ids.length > 0 && !ranked.loaded;
  const stats = new Map(ranked.players.map(player => [String(player.summonerId), player.rankedStats]));
  const playerList = Object.fromEntries(Object.entries(roster).map(([key, players]) => [key, players.map(player => ({...player, rankedStats: stats.get(String(player.summonerId))}))]));

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
  return (
    <>
      <Tabs activeKey={current} items={items} onChange={(key) => {
        setCurrent(key)
      }}/>
      <GameDataStatus loading={loading}/>

      {<PlayerTable>
        {['teamOne', 'teamTwo', 'unassigned'].map(key => playerList[key].length > 0 &&
          <Team key={key} teamKey={key} title={t(key === 'unassigned' ? 'common.unknownTeam' : `common.${key}`)} team={playerList[key]}
                queueType={current === 'solo' ? showTeammateRankedType.SOLO : showTeammateRankedType.FLEX}/>)}
      </PlayerTable>}
    </>
  );
}

const Team = ({title, team, teamKey, queueType}) => <tbody>
  <PlayerSectionTitle columns={8} team={teamKey}>{title}</PlayerSectionTitle>
  {team.map(player => <Player key={player.puuid} player={player} queueType={queueType}/>)}
</tbody>;

const Player = ({player, queueType}) => {
  const {t} = useTranslation();
  useChampionData();
  const queue = player.rankedStats?.queues?.find(q => q.queueType === queueType);
  return <tr>
    <td><ChampionImage width={30} height={30} championId={player.championId}/></td>
    <td>{ApiUtils.getChampionNameById(player.championId)}</td>
    <td><PlayerIdentity player={player}/></td>
    <td>{queue?.tier ? <span className={`tier-badge tier-${String(queue.tier).toLowerCase()}`}>{queue.tier}</span> : <span className="text-muted">{t('common.unavailable')}</span>}</td>
    <td>{queue?.division || '—'}</td>
    <td>{queue?.leaguePoints ?? '—'} LP</td>
    <td>{queue?.miniSeriesProgress || '—'}</td>
    <td>{t('common.wins')}: {queue?.wins ?? '—'}</td>
  </tr>;
};

const mapStateToProps = (state) => {
  return {
    sessionIdentity: state.GameReducer.sessionIdentity,
    gameflowIsLive: state.GameReducer.gameflowIsLive,
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
