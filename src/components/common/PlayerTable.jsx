import React from 'react';
import {useTranslation} from 'react-i18next';
import {usePlayerIdentity} from '../../hooks/useSummonerName';
import './PlayerTable.css';

export default function PlayerTable({children}) {
  const {t} = useTranslation();
  if (React.Children.toArray(children).length === 0) return null;
  return <div className="player-table-scroll" tabIndex={0} role="region" aria-label={t('common.playerList')}>
    <table className="player-table">{children}</table>
  </div>;
}

export function PlayerSectionTitle({children, columns = 4, team}) {
  return <tr><th className="player-section-title" colSpan={columns}>
    <h2 className={team ? `player-team-${team}` : undefined}>{team && <span className="player-team-chip" aria-hidden="true"/>}{children}</h2>
  </th></tr>;
}

export function PlayerIdentity({player}) {
  const {t} = useTranslation();
  const {name, recovered, loading} = usePlayerIdentity(player);
  return <>
    <span>{name || (loading ? t('common.loading') : t('common.unknown'))}</span>
    {recovered && <span className="player-name-recovered" title={t('common.recoveredNameDescription')}>{t('common.recoveredName')}</span>}
  </>;
}
