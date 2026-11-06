import React from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import {Switch, InputNumber, Slider} from '../common/Controls';
import {useTranslation} from 'react-i18next';


function RecentTeammates(props) {
  const {t} = useTranslation();
  const count = typeof props.recentTeammateCheckGameCount === 'number' ? props.recentTeammateCheckGameCount : 5;
  const onChange = newValue => {
    if (typeof newValue === 'number') props.changeRecentTeammateCheckGameCount(newValue);
  };
  const hiddenCount = props.hiddenPlayerHistoryGameCount ?? 5;
  const onHiddenCountChange = value => {
    if (typeof value === 'number') props.changeHiddenPlayerHistoryGameCount(value);
  };

  return (
    <>
      <section className="panel panel-stack" aria-labelledby="recent-encounters-title">
        <h2 id="recent-encounters-title" className="panel-title">{t('menu.recentPlayers')}</h2>
        <div className="setting-row"><label htmlFor="recent-teammate-stats-btn">
          {t('main.displayRecentTeammate')}
          </label><Switch aria-label={t('main.displayRecentTeammate')} id="recent-teammate-stats-btn" checked={props.isShowRecentTeammate}
                  onChange={checked => {
                    props.changeIsShowRecentTeammate(checked)
                  }}/></div>
        <div className="setting-field">
          <span className="setting-field-head">
            <span id="recent-teammate-count-label">{t('main.recentTeammateGameCount')}</span>
            <InputNumber size="small" min={1} max={20} style={{width: 64}}
                         aria-labelledby="recent-teammate-count-label"
                         value={props.recentTeammateCheckGameCount}
                         onChange={onChange}
                         disabled={!props.isShowRecentTeammate}/>
          </span>
          <Slider min={1} max={20} style={{margin: '4px 6px'}}
                  aria-labelledby="recent-teammate-count-label"
                  onChange={onChange}
                  disabled={!props.isShowRecentTeammate}
                  value={count}/>
        </div>
      </section>
      <section className="panel panel-stack" aria-labelledby="hidden-player-history-title">
        <h2 id="hidden-player-history-title" className="panel-title">{t('main.hiddenPlayerHistoryTitle')}</h2>
        <div className="setting-row"><label htmlFor="hidden-player-history-btn">
          {t('main.hiddenPlayerHistory')}
          </label><Switch aria-label={t('main.hiddenPlayerHistory')} id="hidden-player-history-btn" checked={props.isCheckHiddenPlayerHistory}
            onChange={checked => props.changeIsCheckHiddenPlayerHistory(checked)}/></div>
        <div className="setting-field">
          <span className="setting-field-head">
            <span id="hidden-player-history-count-label">{t('main.recentTeammateGameCount')}</span>
            <InputNumber size="small" min={1} max={10} style={{width:64}}
              aria-labelledby="hidden-player-history-count-label" value={hiddenCount}
              onChange={onHiddenCountChange} disabled={!props.isCheckHiddenPlayerHistory}/>
          </span>
          <Slider min={1} max={10} style={{margin:'4px 6px'}}
            aria-labelledby="hidden-player-history-count-label" value={hiddenCount}
            onChange={onHiddenCountChange} disabled={!props.isCheckHiddenPlayerHistory}/>
        </div>
      </section>
    </>
  )
}

const mapStateToProps = (state) => {
  return {
    isShowRecentTeammate: state.ConfigReducer.isShowRecentTeammate,
    recentTeammateCheckGameCount: state.ConfigReducer.recentTeammateCheckGameCount,
    isCheckHiddenPlayerHistory: state.ConfigReducer.isCheckHiddenPlayerHistory,
    hiddenPlayerHistoryGameCount: state.ConfigReducer.hiddenPlayerHistoryGameCount,
  }
}

const mapDispatchToProp = {
  changeIsCheckHiddenPlayerHistory(data) {return {type:'change-isCheckHiddenPlayerHistory',data};},
  changeHiddenPlayerHistoryGameCount(data) {return {type:'change-hiddenPlayerHistoryGameCount',data};},
  changeIsShowRecentTeammate(data) {
    return {
      type: "change-isShowRecentTeammate",
      data
    }
  },
  changeRecentTeammateCheckGameCount(data) {
    return {
      type: "change-recentTeammateCheckGameCount",
      data
    }
  },
}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(RecentTeammates))
