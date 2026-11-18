import ChampionTable from '../common/ChampionTable';
import {PlayerIdentity} from '../common/PlayerTable';
import useChampionData from '../../hooks/useChampionData';
import React, {useState, useEffect, useRef} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import ApiUtils from "../../api/api-utils";
import {Button, Space, Switch} from '../common/Controls';
import {useTranslation} from 'react-i18next';
import {trackEvent} from '../GoogleAnalytics';
import ChampionImage from "../common/ChampionImage";

import {desktop,perform,reportError} from '../../desktop/tauri';

function ownPickAction(session) {
  const cell = session?.localPlayerCellId;
  if (!Number.isInteger(cell) || !Array.isArray(session?.actions)) return null;
  return session.actions.flat().find(action => action?.type === 'pick' && action.actorCellId === cell) ?? null;
}

function ChampionsPick(props) {
  useChampionData();
  const [pickableChampIds, setPickableChampIds] = useState(null);
  const [swappingChampion, setSwappingChampion] = useState(null);
  const [pickingChampion, setPickingChampion] = useState(null);
  const [subsetIds, setSubsetIds] = useState(null);
  const [balance, setBalance] = useState(null);
  const swapPending = useRef(false);
  const pickPending = useRef(false);
  const mounted = useRef(true);
  const currentSession = useRef('');
  const canAct = props.gamePhase === 'ChampSelect' && props.champSelectIsLive !== false;
  const selectedRowKeys = props.aramPreferences;
  const select = championIds => canAct && perform(desktop.invoke('set_aram_preferences',{championIds,...props.sessionIdentity}));
  const {t} = useTranslation();


  const generation = props.sessionIdentity?.connectionGeneration;
  const sessionKey = props.sessionIdentity?.sessionKey;
  const benchEnabled = Boolean(props.champSelectSession?.benchEnabled);
  const sessionIdentity = JSON.stringify([generation, sessionKey]);
  currentSession.current = sessionIdentity;
  const benchChampions = [...new Set((props.champSelectSession?.benchChampions ?? [])
    .map(champion => champion.championId).filter(id => Number.isInteger(id) && id > 0))];
  const teammates = props.myTeam.filter(player => player.championId !== 0);
  const timerPhase = props.champSelectSession?.timer?.phase;
  const subsetSession = props.champSelectSession?.allowSubsetChampionPicks === true;
  // In a subset pick session the bench is visible during the pick phase, but the client accepts swaps only afterwards.
  const benchOpen = !subsetSession || (timerPhase !== 'BAN_PICK' && timerPhase !== 'PLANNING');
  const subsetPhase = subsetSession && timerPhase === 'BAN_PICK';
  const ownPick = ownPickAction(props.champSelectSession);
  const pickOpen = subsetPhase && Boolean(ownPick) && ownPick.completed !== true;
  const currentChampion = props.myTeam.find(player => player.isSelf)?.championId || 0;
  const subsetKey = JSON.stringify([generation, sessionKey, subsetPhase]);
  const subsetChampions = subsetPhase && subsetIds?.key === subsetKey ? subsetIds.ids : [];
  const teamChampionIds = new Set(teammates.map(player => player.championId));
  // Your unpicked offered champions land on the bench but stay listed with your champions.
  const shownBench = benchOpen ? benchChampions : benchChampions.filter(id => !subsetChampions.includes(id));
  const busy = pickingChampion !== null || swappingChampion !== null;
  const pickableKey = JSON.stringify([
    generation, sessionKey, props.gamePhase, benchEnabled,
    [...new Set([...props.myTeam, ...(props.champSelectSession?.benchChampions ?? [])]
      .map(player => player.championId).filter(id => id > 0))].sort((a, b) => a - b)
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  // During the pick phase the client already allows swapping back to your own offered champions.
  const canSwap = championId => canAct && benchEnabled && (benchOpen || subsetChampions.includes(championId)) &&
    benchChampions.includes(championId) && pickableChampIds?.key === pickableKey &&
    pickableChampIds.ids.includes(championId);

  // Before the bench opens, a bench champion is queued with the teammate preferences;
  // the first preference still on the bench is swapped as soon as swaps open.
  const togglePreselect = championId => {
    if (!canAct || !benchEnabled) return;
    select(selectedRowKeys.includes(championId)
      ? selectedRowKeys.filter(id => id !== championId)
      : [...selectedRowKeys, championId]);
  };

  // The table only knows teammates' champions; keep queued bench champions and the existing order.
  const selectTeam = keys => {
    const chosen = new Set(keys);
    const kept = selectedRowKeys.filter(id => !teamChampionIds.has(id) || chosen.has(id));
    select([...kept, ...keys.filter(id => !kept.includes(id))]);
  };

  const swapChampion = async championId => {
    if (swapPending.current || !canSwap(championId)) return;
    swapPending.current = true;
    setSwappingChampion(championId);
    const expectedSession = sessionIdentity;
    try {
      await desktop.invoke('swap_bench_champion', {championId, ...props.sessionIdentity});
    } catch (error) {
      if (mounted.current && currentSession.current === expectedSession) reportError(error);
    } finally {
      swapPending.current = false;
      if (mounted.current) setSwappingChampion(null);
    }
  };

  const pickChampion = async championId => {
    if (pickPending.current || !canAct || !pickOpen || !subsetChampions.includes(championId)) return;
    pickPending.current = true;
    setPickingChampion(championId);
    const expectedSession = sessionIdentity;
    try {
      await desktop.invoke('pick_subset_champion', {championId, ...props.sessionIdentity});
    } catch (error) {
      if (mounted.current && currentSession.current === expectedSession) reportError(error);
    } finally {
      pickPending.current = false;
      if (mounted.current) setPickingChampion(null);
    }
  };

  useEffect(() => {
    let active = true;
    // Coalesce bursts of champion swaps/rerolls without reacting to unrelated session fields.
    if (!canAct || !benchEnabled) return;
    let timer;
    const fetchPickable = (attempt = 0) => {
      ApiUtils.getPickableChampionIds().then(response => {
        if (active) setPickableChampIds({key: pickableKey, ids: response.data});
      }).catch(error => {
        if (!active) return;
        if (attempt < 2) timer = setTimeout(() => fetchPickable(attempt + 1), 2000 * (attempt + 1));
        else reportError(error);
      });
    };
    timer = setTimeout(fetchPickable, 150);
    return () => {active = false; clearTimeout(timer);};
  }, [canAct, benchEnabled, pickableKey]);

  useEffect(() => {
    let active = true;
    if (!canAct || !subsetPhase) return;
    let timer;
    const fetchSubset = (attempt = 0) => {
      ApiUtils.getSubsetChampionIds().then(response => {
        const ids = Array.isArray(response.data) ? response.data.filter(id => Number.isInteger(id) && id > 0) : [];
        if (active) setSubsetIds({key: subsetKey, ids: [...new Set(ids)]});
      }).catch(error => {
        if (!active) return;
        if (attempt < 2) timer = setTimeout(() => fetchSubset(attempt + 1), 1000 * (attempt + 1));
        else reportError(error);
      });
    };
    fetchSubset();
    return () => {active = false; clearTimeout(timer);};
  }, [canAct, subsetPhase, subsetKey]);

  useEffect(() => {
    if (!subsetPhase || balance) return;
    let active = true;
    ApiUtils.getChampionsBalanceByCache().then(data => {
      const rows = data?.total_aram_balance;
      if (active && Array.isArray(rows)) setBalance(new Map(rows.map(row => [row.champion_id, row])));
    }).catch(() => {});
    return () => {active = false;};
  }, [subsetPhase, balance]);

  const balanceNote = championId => {
    const row = balance?.get(championId);
    const parts = [['damage_dealt', row?.damage_dealt, true], ['damage_taken', row?.damage_taken, false]]
      .filter(([, value]) => Number.isFinite(value) && value !== 0);
    if (!parts.length) return null;
    return <span className="subset-balance">{parts.map(([key, value, positiveGood]) =>
      <span key={key} className={(value > 0) === positiveGood ? 'balance-good' : 'balance-bad'}>
        {t(`aram.balance.${key}`)} {value > 0 ? `+${value}` : value}%
      </span>)}</span>;
  };

  const columns = [
    {
      title: '',
      dataIndex: 'championId',
      render: (text) => (
        <ChampionImage width={40} height={40} championId={text}/>
      ),
    },
    {
      title: t('aram.champion'),
      dataIndex: 'championName',
      render: (text, record) => {
        const isSelfText = record.isSelf ? "(" + t('aram.isYou') + ")" : "";
        return <span>{ApiUtils.getChampionNameById(record.championId)}{isSelfText}</span>;
      },
    },
    {
      title: t('aram.summoner'),
      dataIndex: 'summonerId',
      render: (text, record) => <PlayerIdentity player={record}/>,
    }
  ];

  return (
    <>
      {subsetChampions.length > 0 &&
        <section aria-label={t('aram.yourChampions')} className="subset-section">
          <div className="pick-section-header">
            <h3>{t('aram.yourChampions')}</h3>
            <span className="pick-section-hint">{pickOpen ? t('aram.pickHint') : t('aram.pickDone')}</span>
          </div>
          <div className="subset-grid">
            {subsetChampions.map(championId => {
              const champion = ApiUtils.getChampionNameById(championId);
              const isCurrent = championId === currentChampion;
              const status = isCurrent ? t(pickOpen ? 'aram.currentChampion' : 'aram.lockedChampion') : null;
              // Before locking, a click picks; afterwards it swaps straight to another of your champions.
              const label = t(pickOpen ? 'aram.pickChampion' : 'aram.swapChampion', {champion});
              return <Button key={championId} aria-label={label}
                aria-pressed={isCurrent} className="subset-card" data-current={isCurrent || undefined}
                disabled={!canAct || busy || (!pickOpen && (isCurrent || !canSwap(championId)))}
                loading={pickingChampion === championId || swappingChampion === championId}
                onClick={() => pickOpen ? pickChampion(championId) : swapChampion(championId)}>
                <ChampionImage width={44} height={44} championId={championId}/>
                {/* The status sits beside the name so picking never adds a line or resizes the card. */}
                <span className="subset-card-text">
                  <span className="subset-card-title">
                    <span className="subset-card-name">{champion}</span>
                    {status && <span className="subset-card-status">{status}</span>}
                  </span>
                  {balanceNote(championId)}
                </span>
              </Button>;
            })}
          </div>
        </section>}
      {benchEnabled && shownBench.length > 0 &&
        <section aria-label={t('aram.benchTitle')} className="bench-section">
          <div className="pick-section-header">
            <h3>{t('aram.benchTitle')}</h3>
            {!benchOpen && <span className="pick-section-hint">{t('aram.benchLocked')}</span>}
          </div>
          <Space wrap>
            {shownBench.map(championId => {
              const champion = ApiUtils.getChampionNameById(championId);
              if (!benchOpen) {
                const preselected = selectedRowKeys.includes(championId);
                const label = t(preselected ? 'aram.unpreselectChampion' : 'aram.preselectChampion', {champion});
                return <Button key={championId} aria-label={label} title={label}
                  aria-pressed={preselected} className="bench-chip" data-preselected={preselected || undefined}
                  disabled={!canAct}
                  onClick={() => togglePreselect(championId)}
                  style={{height: 'auto', padding: 8}}>
                  <Space>
                    <ChampionImage width={40} height={40} championId={championId}/>
                    <span>{champion}</span>
                    {preselected && <span className="bench-chip-tag">{t('aram.preselected')}</span>}
                  </Space>
                </Button>;
              }
              const label = t('aram.swapChampion', {champion});
              return <Button key={championId} aria-label={label} className="bench-chip"
                title={canSwap(championId) ? label : t('aram.benchUnavailable')}
                disabled={swappingChampion !== null || !canSwap(championId)}
                loading={swappingChampion === championId}
                onClick={() => swapChampion(championId)}
                style={{height: 'auto', padding: 8}}>
                <Space>
                  <ChampionImage width={40} height={40} championId={championId}/>
                  <span>{champion}</span>
                </Space>
              </Button>;
            })}
          </Space>
        </section>}
      <Button disabled={!canAct} onClick={() => {
        select([]);
      }
      }>{t('aram.clear')}</Button>
      <Space wrap>
        <label htmlFor="always-on-top-btn"
               style={{userSelect: "none", fontSize: 16, marginLeft: '10px'}}>{t('aram.alwaysOnTop')}</label>
        <Switch aria-label={t('aram.alwaysOnTop')} id="always-on-top-btn" checked={props.alwaysOnTop} onChange={(checked, event) => {
          props.changeAlwaysOnTop(checked);

        }}></Switch>
      </Space>
      {teammates.length > 0 && <ChampionTable label={t('aram.pickTab')}
        rowKey="championId" columns={columns} rows={teammates}
        selection={{keys:selectedRowKeys, onChange:selectTeam,
          name:record => ApiUtils.getChampionNameById(record.championId),
          // Before the bench opens, teammates' champions can be queued in advance.
          disabled:record => !canAct || !benchEnabled || record.isSelf ||
            (benchOpen && (pickableChampIds?.key !== pickableKey || !pickableChampIds.ids.includes(record.championId)))}}
      />}
    </>
  );
}

const mapStateToProps = (state) => {
  return {
    sessionIdentity: state.GameReducer.sessionIdentity,
    champSelectIsLive: state.GameReducer.champSelectIsLive,
    aramPreferences: state.GameReducer.aramPreferences,
    alwaysOnTop: state.ConfigReducer.alwaysOnTop,
    myTeam: state.GameReducer.myTeam,
    champSelectSession: state.GameReducer.champSelectSession,
    gamePhase: state.GameReducer.gamePhase,
    isDarkMode: state.ConfigReducer.isDarkMode
  }
}
const mapDispatchToProp = {
  changeAlwaysOnTop(data) {return {type:'change-alwaysOnTop',data};},
  changeMyTeam(data) {
    return {
      type: "change-myTeam",
      data
    }
  }
}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(ChampionsPick))
