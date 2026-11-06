import React from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import {Select, Switch} from '../common/Controls';
import {rankedType, tierType} from "../../redux/reducers/ConfigReducer";
import {useTranslation} from 'react-i18next';

const rankedOptions = [
  [rankedType.SOLO, 'soloDuo'],
  [rankedType.FLEX_SR, 'flexSR'],
  [rankedType.FLEX_TT, 'flexTT'],
  [rankedType.TFT, 'tft'],
  [rankedType.TFT_DOUBLE_UP, 'tftDoubleUp'],
  [rankedType.TFT_TURBO, 'tftTurbo'],
];

const tierOptions = [
  [tierType.CHALLENGER, 'challenger'],
  [tierType.GRANDMASTER, 'grandmaster'],
  [tierType.MASTER, 'master'],
  [tierType.DIAMOND, 'diamond'],
  [tierType.PLATINUM, 'platinum'],
  [tierType.GOLD, 'gold'],
  [tierType.SILVER, 'silver'],
  [tierType.BRONZE, 'bronze'],
  [tierType.IRON, 'iron'],
];

function Hovercard(props) {
  const {t} = useTranslation();
  const ranked = rankedOptions.map(([value, key]) => ({value, label: t(`main.rankedType.${key}`)}));
  const tiers = tierOptions.map(([value, key]) => ({value, label: <span className={`tier-badge tier-${key}`}>{t(`main.tierType.${key}`)}</span>}));

  return (
    <section className="panel panel-stack" aria-labelledby="hovercard-title">
      <h2 id="hovercard-title" className="panel-title">{t('main.modifyHovercard')}</h2>
      <div className="setting-row"><label htmlFor="hovercard-btn">
        {t('main.enableHovercard')}
        </label><Switch aria-label={t('main.enableHovercard')} id="hovercard-btn" checked={props.isHovercard}
                onChange={checked => {
                  props.changeIsHovercard(checked)
                }}/></div>
      <label className="setting-field" htmlFor="hovercard-ranked-select">
        {t('main.hovercardQueue')}
        <Select aria-label={t('main.hovercardQueue')} id="hovercard-ranked-select" value={props.hovercardRankedType} options={ranked}
                disabled={!props.isHovercard}
                onChange={value => {
                  props.changeHovercardRankedType(value)
                }}/>
      </label>
      <label className="setting-field" htmlFor="hovercard-tier-select">
        {t('main.hovercardTier')}
        <Select aria-label={t('main.hovercardTier')} id="hovercard-tier-select" value={props.hovercardTierType} options={tiers}
                disabled={!props.isHovercard}
                onChange={value => {
                  props.changeHovercardTierType(value)
                }}/>
      </label>
    </section>
  )
}

const mapStateToProps = (state) => {
  return {
    isHovercard: state.ConfigReducer.isHovercard,
    hovercardTierType: state.ConfigReducer.hovercardTierType,
    hovercardRankedType: state.ConfigReducer.hovercardRankedType
  }
}
const mapDispatchToProp = {
  changeIsHovercard(data) {
    return {
      type: "change-isHovercard",
      data
    }
  },
  changeHovercardTierType(data) {
    return {
      type: "change-hovercardTierType",
      data
    }
  },
  changeHovercardRankedType(data) {
    return {
      type: "change-hovercardRankedType",
      data
    }
  },
}
export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(Hovercard))
