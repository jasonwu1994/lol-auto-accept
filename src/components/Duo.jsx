import {formatPremadeGroup, groupCurrentTeam} from './common/premade';
import {readRetainedIdentity, resolvePlayerIdentity} from './common/playerIdentity';
import useCurrentRoster from '../hooks/useCurrentRoster';
import PlayerTable from './common/PlayerTable';
import React, {useEffect, useState} from 'react';
import {connect, useStore} from 'react-redux';
import Team from './Team';
import withErrorBoundary from './error/withErrorBoundary';
import {useTranslation} from 'react-i18next';
import {message} from './common/Controls';
import ApiUtils from '../api/api-utils';
import {desktop} from '../desktop/tauri';
import {idleEvidence, loadDuoEncounters, prepareDuoRoster} from './common/duoEncounters';

export async function copyPremadeGroup(group, t) {
  const players = await Promise.all(group.map(async player => {
    const identity = readRetainedIdentity(player) ?? await resolvePlayerIdentity(player,
      puuid => ApiUtils.getSummonerByPuuidFromCache(puuid),
      id => ApiUtils.getSummonersById(id));
    return {...player, name: identity.name || t('common.unknown'),
      championName: player.championId > 0 ? ApiUtils.getChampionNameById(player.championId) : t('common.unknown')};
  }));
  await desktop.invoke('write_clipboard', {text: formatPremadeGroup(players, t)});
}

let retainedDuo = null;

function Duo(props) {
  const store = useStore();
  const {t} = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();
  const baseRoster = useCurrentRoster();
  const historyEnabled = props.isCheckHiddenPlayerHistory ?? true;
  const historyCount = props.hiddenPlayerHistoryGameCount ?? 5;
  const canRefresh = props.gameflowIsLive !== false && ['ChampSelect','GameStart','InProgress','PreEndOfGame'].includes(props.gamePhase);
  const rosterKey = JSON.stringify([props.gameflowSession?.gameData?.gameId, baseRoster, historyEnabled, historyCount]);
  const requestKey = JSON.stringify([props.sessionIdentity, props.gamePhase, props.gameflowSession?.gameData?.gameId, baseRoster, historyEnabled, historyCount]);
  const [result, setResult] = useState(() => retainedDuo);
  useEffect(() => {
    if (!canRefresh) return;
    if (!Object.values(baseRoster).some(team => team.length)) return;
    let active = true;
    let timer;
    const identity = props.sessionIdentity;
    const assertCurrent = () => {
      const current = desktop.session();
      if (current.connectionGeneration !== identity?.connectionGeneration || current.sessionKey !== identity?.sessionKey) throw new Error('Client session changed');
      const config = store.getState().ConfigReducer;
      if (historyEnabled && (!config.isCheckHiddenPlayerHistory || config.hiddenPlayerHistoryGameCount !== historyCount)) throw new Error('History settings changed');
    };
    const load = (attempt = 0) => {
      loadDuoEncounters(`${requestKey}:${attempt}`, baseRoster, props.gameflowSession?.gameData?.gameId, ApiUtils, assertCurrent,
        ['GameStart','InProgress','PreEndOfGame'].includes(props.gamePhase), historyCount, historyEnabled)
        .then(value => {
          if (!active) return;
          retainedDuo = {key:requestKey, rosterKey, ...value};
          setResult(retainedDuo);
          if (attempt < 2 && Object.values(value.evidence).some(item => ['unknownTeam','error','partial'].includes(item.status))) {
            timer = setTimeout(() => load(attempt + 1), 2500);
          }
        })
        .catch(() => {if (active && retainedDuo?.rosterKey !== rosterKey) {retainedDuo = {key:requestKey, rosterKey, roster:prepareDuoRoster(baseRoster, [], [], historyEnabled), evidence:{}, failed:true};setResult(retainedDuo);}});
    };
    load();
    return () => {active = false; clearTimeout(timer);};
  }, [requestKey, canRefresh]);
  const current = !canRefresh || result?.rosterKey === rosterKey ? result : null;
  const roster = current?.roster ?? prepareDuoRoster(baseRoster, [], [], historyEnabled);
  // Without a live game no lookup runs, so settle every player instead of waiting forever.
  const evidence = !historyEnabled ? {} : canRefresh ? current?.evidence ?? {} : idleEvidence(roster, current?.evidence);
  const duoList = Object.fromEntries(Object.entries(roster).map(([key, players]) => [key, groupCurrentTeam(players, evidence)]));
  const incomplete = duoList.unassigned.length > 0;
  const copyGroup = async group => {
    try {
      await copyPremadeGroup(group, t);
      messageApi.success(t('common.copy_success'));
    } catch {
      messageApi.error(t('common.copy_failure'));
    }
  };
  return <div>
    {contextHolder}
    <PlayerTable>
      {duoList.teamOne.length > 0 && <Team title={t('common.teamOne')} team={duoList.teamOne} side="teamOne" incomplete={incomplete} onCopyGroup={copyGroup} evidence={evidence} historyFailed={current?.failed} historyCount={historyCount}/>}
      {duoList.teamTwo.length > 0 && <Team title={t('common.teamTwo')} team={duoList.teamTwo} side="teamTwo" incomplete={incomplete} onCopyGroup={copyGroup} evidence={evidence} historyFailed={current?.failed} historyCount={historyCount}/>}
      {incomplete && <Team title={t('common.unknownTeam')} team={duoList.unassigned} onCopyGroup={copyGroup} evidence={evidence} historyFailed={current?.failed} historyCount={historyCount}/>}
    </PlayerTable>
  </div>;
}

const mapStateToProps = state => ({gameflowIsLive:state.GameReducer.gameflowIsLive,gameflowSession: state.GameReducer.gameflowSession, sessionIdentity: state.GameReducer.sessionIdentity, gamePhase:state.GameReducer.gamePhase,
  isCheckHiddenPlayerHistory:state.ConfigReducer.isCheckHiddenPlayerHistory, hiddenPlayerHistoryGameCount:state.ConfigReducer.hiddenPlayerHistoryGameCount});
export default connect(mapStateToProps)(withErrorBoundary(Duo));
