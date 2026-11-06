import React, {useState} from 'react';
import {Button, Switch, RankedChoice, message} from './common/Controls';
import {CheckOutlined, CloseOutlined, PoweroffOutlined} from '@ant-design/icons';
import ApiUtils from "../api/api-utils";
import {connect} from "react-redux";
import {showTeammateRankedType} from "../redux/reducers/ConfigReducer";
import withErrorBoundary from "./error/withErrorBoundary";
import Hovercard from "./main/Hovercard";
import RecentTeammates from "./main/RecentTeammates";
import {useTranslation} from 'react-i18next';

import {desktop, perform} from '../desktop/tauri';

const phaseSteps = [
  {key: 'none', phases: ['None']},
  {key: 'lobby', phases: ['Lobby']},
  {key: 'matchmaking', phases: ['Matchmaking']},
  {key: 'readyCheck', phases: ['ReadyCheck']},
  {key: 'champSelect', phases: ['ChampSelect']},
  {key: 'inGame', phases: ['GameStart', 'InProgress', 'PreEndOfGame', 'EndOfGame']},
];

export function phaseStepIndex(connected, gamePhase) {
  if (!connected) return -1;
  return phaseSteps.findIndex(step => step.phases.includes(gamePhase));
}

function PhaseSteps({connected, gamePhase}) {
  const {t} = useTranslation();
  const current = phaseStepIndex(connected, gamePhase);
  return <ol className="phase-steps" aria-label={t('main.phaseSteps.label')}>
    {phaseSteps.map((step, index) => <li key={step.key}
      className={index < current ? 'done' : index === current ? 'current' : undefined}
      aria-current={index === current ? 'step' : undefined}>
      {t(`main.phaseSteps.${step.key}`)}
    </li>)}
  </ol>;
}

function Main(props) {
  const [killLoLLoading, setKillLoLLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const {t} = useTranslation();
  const connected = props.connection === 'Connected';

  const terminate = async () => {
    setKillLoLLoading(true);
    try {
      const results = await desktop.invoke('terminate_league_processes');
      const failed = results.filter(result => !result.terminated);
      messageApi.open({type:failed.length?'error':'success',content:failed.length ? failed.map(result=>`${result.name}: ${t('common.operationFailed')}`).join(', ') : t('main.closedProcessesCount',{count:results.length})});
    } catch (error) {messageApi.error(error.message ?? String(error));}
    finally {setKillLoLLoading(false);}
  };
  return (
    <>
      {contextHolder}
      <section className="panel status-panel" aria-label={t('main.currentStatus')}>
        <div className="status-head">
          <div className="status-text">
            <span className="status-connection">
              <span className={connected ? 'status-dot connected' : 'status-dot'} aria-hidden="true"/>
              {t(connected ? 'main.connection.connected' : 'main.connection.disconnected')}
            </span>
            <h1 className="status-title">{props.appState}</h1>
          </div>
          <div className="auto-accept-toggle"><label htmlFor="auto-accept-btn">
            <span className="auto-accept-toggle-text">
              <strong>{t('main.autoAccept')}</strong>
              <span>{t('main.autoAcceptDescription')}</span>
            </span>
            </label><Switch aria-label={t('main.autoAccept')} id="auto-accept-btn" checked={props.isAutoAccept} onChange={checked => {
              props.changeIsAutoAccept(checked)
            }}/></div>
        </div>
        <PhaseSteps connected={connected} gamePhase={props.gamePhase}/>
      </section>

      <div className="action-row">
        <Button type="primary" icon={<CheckOutlined/>} onClick={() => {
          perform(ApiUtils.postAcceptMatchmaking(props.sessionIdentity))
        }}>
          {t('main.acceptMatchmaking')}
        </Button>
        <Button icon={<CloseOutlined/>} onClick={() => {
          props.changeIsAutoAccept(false)
          perform(ApiUtils.postDeclineMatchmaking(props.sessionIdentity))
        }}>
          {t('main.declineMatchmaking')}
        </Button>
        <Button className="action-row-end" danger icon={<PoweroffOutlined/>} loading={killLoLLoading} onClick={() => {
          terminate();
        }}>
          {t('main.forceKillLoL')}
        </Button>
      </div>

      <div className="panel-grid">
        <section className="panel panel-stack" aria-labelledby="champ-select-title">
          <h2 id="champ-select-title" className="panel-title">{t('main.champSelectAssist')}</h2>
          <div className="setting-row"><label htmlFor="auto-aram-topmost-btn">
            {t('main.autoAramTopmost')}
            </label><Switch aria-label={t('main.autoAramTopmost')} id="auto-aram-topmost-btn" checked={props.isAutoAramTopmost}
              onChange={checked => props.changeIsAutoAramTopmost(checked)}/></div>
          <span className="setting-field">{t('main.autoAramTopmostDescription')}</span>
          <div className="panel-divider"/>
          <div className="setting-row"><label htmlFor="teammate-ranked-stats-btn">
            {t('main.displayTeammateScore')}
            </label><Switch aria-label={t('main.displayTeammateScore')} id="teammate-ranked-stats-btn" checked={props.isShowTeammateRanked}
                    onChange={checked => {
                      props.changeIsShowTeammateRanked(checked)
                    }}/></div>
          <RankedChoice value={props.showTeammateRankedType}
                     disabled={!props.isShowTeammateRanked}
                     aria-label={t('main.teammateRankedTypeLabel')}
                     options={[
                       {value: showTeammateRankedType.SOLO, label: t('main.showTeammateRankedType.soloDuo')},
                       {value: showTeammateRankedType.FLEX, label: t('main.showTeammateRankedType.flex')},
                       {value: showTeammateRankedType.BOTH, label: t('main.rankedChoiceBoth')},
                     ]}
                     onChange={value => {
                       props.changeShowTeammateRankedType(value)
                     }}/>
        </section>

        <Hovercard/>
        <RecentTeammates/>
      </div>
    </>
  )
}

const mapStateToProps = (state) => {
  return {
    sessionIdentity: state.GameReducer.sessionIdentity,
    gamePhase: state.GameReducer.gamePhase,
    connection: state.AuthReducer.connection,
    isAutoAccept: state.ConfigReducer.isAutoAccept,
    isAutoAramTopmost: state.ConfigReducer.isAutoAramTopmost,
    isShowTeammateRanked: state.ConfigReducer.isShowTeammateRanked,
    showTeammateRankedType: state.ConfigReducer.showTeammateRankedType,
    appState: state.GameReducer.appState,
    appStateKey: state.GameReducer.appStateKey,
  }
}

const mapDispatchToProp = {
  changeIsAutoAramTopmost(data) {return {type:'change-isAutoAramTopmost',data};},
  changeIsAutoAccept(data) {
    return {
      type: "change-isAutoAccept",
      data
    }
  },
  changeIsShowTeammateRanked(data) {
    return {
      type: "change-isShowTeammateRanked",
      data
    }
  },
  changeShowTeammateRankedType(data) {
    return {
      type: "change-showTeammateRankedType",
      data
    }
  },
  changeAppState(data) {
    return {
      type: "change-appState",
      data
    }
  },
}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(Main))
