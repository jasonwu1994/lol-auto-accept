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

function ChampionsPick(props) {
  useChampionData();
  const [pickableChampIds, setPickableChampIds] = useState(null);
  const [swappingChampion, setSwappingChampion] = useState(null);
  const swapPending = useRef(false);
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
  const pickableKey = JSON.stringify([
    generation, sessionKey, props.gamePhase, benchEnabled,
    [...new Set([...props.myTeam, ...(props.champSelectSession?.benchChampions ?? [])]
      .map(player => player.championId).filter(id => id > 0))].sort((a, b) => a - b)
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const canSwap = championId => canAct && benchEnabled &&
    benchChampions.includes(championId) && pickableChampIds?.key === pickableKey &&
    pickableChampIds.ids.includes(championId);

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
      {benchEnabled && benchChampions.length > 0 &&
        <section aria-label={t('aram.benchTitle')} style={{marginBottom: 16}}>
          <h3>{t('aram.benchTitle')}</h3>
          <Space wrap>
            {benchChampions.map(championId => {
              const champion = ApiUtils.getChampionNameById(championId);
              const label = t('aram.swapChampion', {champion});
              return <Button key={championId} aria-label={label}
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
        selection={{keys:selectedRowKeys, onChange:select,
          name:record => ApiUtils.getChampionNameById(record.championId),
          disabled:record => !canAct || !benchEnabled || record.isSelf || pickableChampIds?.key !== pickableKey || !pickableChampIds.ids.includes(record.championId)}}
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
