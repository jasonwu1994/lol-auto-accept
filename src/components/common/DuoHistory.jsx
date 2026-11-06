import React from 'react';
import {useTranslation} from 'react-i18next';
import ApiUtils from '../../api/api-utils';

export default function DuoHistory({player, evidence, gameCount = 5}) {
  const {t} = useTranslation();
  if (!player.needsHistory) return null;
  if (!evidence) return <span className="encounter-note">{t('common.encounters.loading', {count:gameCount})}</span>;
  if (evidence.status === 'skipped') return null;
  return <span className="encounter-list" aria-label={t('common.encounters.label', {count:gameCount})}>
    {evidence.rows.map(row => <span className="encounter-game" key={`${row.index}-${row.gameId}`}>
      <span className="encounter-index" title={t('common.encounters.game', {count: row.index})}>{row.index}.</span>
      {row.encounters.map(other => <span key={other.puuid} className={`encounter-${other.relation}`}
        title={t(`common.encounters.${other.relation}Description`, {count:row.index})}
        aria-label={`${ApiUtils.getChampionNameById(other.championId)}：${t(`common.encounters.${other.relation}`)}`}>
        {ApiUtils.getChampionNameById(other.championId)}
      </span>)}
    </span>)}
    {evidence.status === 'loaded' && !evidence.rows.length && <span className="encounter-note">{t('common.encounters.none', {count:evidence.checked})}</span>}
    {['partial','error','unknownTeam'].includes(evidence.status) && <span className="encounter-note">{t(`common.encounters.${evidence.status}`)}</span>}
  </span>;
}
