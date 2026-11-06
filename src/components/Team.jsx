import useChampionData from '../hooks/useChampionData';
import React from 'react';
import apiUtils from '../api/api-utils';
import {useTranslation} from 'react-i18next';
import ChampionImage from './common/ChampionImage';
import {PlayerIdentity, PlayerSectionTitle} from './common/PlayerTable';
import DuoHistory from './common/DuoHistory';

const Team = ({title, team, incomplete = false, side, onCopyGroup, evidence = {}, historyFailed, historyCount = 5}) => {
  const {t} = useTranslation();
  const maxCount = incomplete ? `(${t('common.premade.unknown')})` : getMaxCount(team, t);
  return <tbody>
    <PlayerSectionTitle columns={5} team={side}>{title}{maxCount}</PlayerSectionTitle>
    {team.map((group, groupIndex) => <React.Fragment key={`group-${groupIndex}`}>
      {group.map((player, playerIndex) => <TeamMember key={player.puuid} player={player}
        groupStart={groupIndex > 0 && playerIndex === 0}
        group={group} firstInGroup={playerIndex === 0}
        evidence={evidence[player.puuid] ?? (historyFailed ? {status:'error', rows:[]} : undefined)}
        historyCount={historyCount}
        onCopy={onCopyGroup ? () => onCopyGroup(group) : undefined}/>)}
    </React.Fragment>)}
  </tbody>;
};

const TeamMember = ({player, onCopy, groupStart, group, firstInGroup, evidence, historyCount}) => {
  useChampionData();
  const {t} = useTranslation();
  const unknown = group.some(member => member.groupUnknown);
  const label = unknown ? 'unknown' : ['solo', 'duo', 'trio', 'quad', 'quint'][group.length - 1] ?? 'unknown';
  const premade = !unknown && group.length > 1;
  return <tr className={groupStart ? 'player-group-start' : undefined}>
    {firstInGroup && <th scope="row" rowSpan={group.length} className={`player-premade-cell${premade ? ' is-premade' : ''}`}>
      <span className="player-premade-label" title={player.soloFallback ? t('common.encounters.soloFallback') : undefined}>{t(`common.premade.${label}`)}</span>
    </th>}
    <td><ChampionImage width={30} height={30} championId={player.championId}/></td>
    <td>{onCopy ? <button type="button" className="player-copy-name" title={t('common.copyPremade')} onClick={onCopy}>
      {apiUtils.getChampionNameById(player.championId)}
    </button> : apiUtils.getChampionNameById(player.championId)}</td>
    <td>{onCopy ? <button type="button" className="player-copy-name" title={t('common.copyPremade')} onClick={onCopy}>
      <PlayerIdentity player={player}/>
    </button> : <PlayerIdentity player={player}/>}<DuoHistory player={player} evidence={evidence} gameCount={historyCount}/></td>
    <td>{player.selectedPosition || '—'}</td>
  </tr>;
};

function getMaxCount(inputArray, t) {
  if (inputArray.some(group => group.some(player => player.groupUnknown))) return `(${t('common.premade.unknown')})`;
  const maxCount = inputArray.reduce((max, group) => Math.max(max, group.length), 0);
  const labels = ['solo', 'duo', 'trio', 'quad', 'quint'];
  return labels[maxCount - 1] ? `(${t(`common.premade.${labels[maxCount - 1]}`)})` : '';
}

export default Team;
