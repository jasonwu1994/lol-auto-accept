import React, {useState, useEffect} from 'react';
import {connect} from "react-redux";
import withErrorBoundary from "../error/withErrorBoundary";
import {Col, Radio, Row, Space, Switch} from "antd";
import {rankedType, tierType} from "../../redux/reducers/ConfigReducer";
import ApiUtils from "../../api/api-utils";
import {useTranslation} from 'react-i18next';


function Hovercard(props) {
  const {t} = useTranslation();

  useEffect(() => {
    if (!props.isHovercard) {
      return;
    }
    ApiUtils.putHovercard(props.hovercardRankedType, props.hovercardTierType)
  }, [props.hovercardRankedType, props.hovercardTierType, props.isHovercard]);

  return (
    <div>
      <Space direction="vertical" style={{display: 'flex'}}>
        <Space>
          <label htmlFor="hovercard-btn"
                 style={{userSelect: "none", fontSize: 16}}>{t('main.modifyHovercard')}</label>
          <Switch id="hovercard-btn" checked={props.isHovercard}
                  onChange={(checked, event) => {
                    props.changeIsHovercard(checked)
                  }}></Switch>
        </Space>
        <Row>
          <Col>
            <Radio.Group value={props.hovercardRankedType} buttonStyle="solid"
                         disabled={!props.isHovercard}
                         style={{userSelect: "none"}}
                         onChange={(event) => {
                           props.changeHovercardRankedType(event.target.value)
                         }}>
              <Radio.Button value={rankedType.SOLO}>{t('main.rankedType.soloDuo')}</Radio.Button>
              <Radio.Button value={rankedType.FLEX_SR}>{t('main.rankedType.flexSR')}</Radio.Button>
              <Radio.Button value={rankedType.FLEX_TT}>{t('main.rankedType.flexTT')}</Radio.Button>
              <Radio.Button value={rankedType.TFT}>{t('main.rankedType.tft')}</Radio.Button>
              <Radio.Button value={rankedType.TFT_DOUBLE_UP}>{t('main.rankedType.tftDoubleUp')}</Radio.Button>
              <Radio.Button value={rankedType.TFT_TURBO}>{t('main.rankedType.tftTurbo')}</Radio.Button>
            </Radio.Group>
          </Col>
        </Row>
        <Row>
          <Col>
            <Radio.Group value={props.hovercardTierType} buttonStyle="solid"
                         disabled={!props.isHovercard}
                         style={{userSelect: "none"}}
                         onChange={(event) => {
                           props.changeHovercardTierType(event.target.value)
                         }}>
              <Radio.Button value={tierType.CHALLENGER}>{t('main.tierType.challenger')}</Radio.Button>
              <Radio.Button value={tierType.GRANDMASTER}>{t('main.tierType.grandmaster')}</Radio.Button>
              <Radio.Button value={tierType.MASTER}>{t('main.tierType.master')}</Radio.Button>
              <Radio.Button value={tierType.DIAMOND}>{t('main.tierType.diamond')}</Radio.Button>
              <Radio.Button value={tierType.PLATINUM}>{t('main.tierType.platinum')}</Radio.Button>
              <Radio.Button value={tierType.GOLD}>{t('main.tierType.gold')}</Radio.Button>
              <Radio.Button value={tierType.SILVER}>{t('main.tierType.silver')}</Radio.Button>
              <Radio.Button value={tierType.BRONZE}>{t('main.tierType.bronze')}</Radio.Button>
              <Radio.Button value={tierType.IRON}>{t('main.tierType.iron')}</Radio.Button>
            </Radio.Group>
          </Col>
        </Row>
      </Space>
    </div>
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