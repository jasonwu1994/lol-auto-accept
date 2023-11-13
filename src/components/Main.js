import React, {useState, useEffect} from 'react';
import {Button, Space, Switch, Radio, Row, Col, message, Image} from "antd";
import ApiUtils from "../api/api-utils";
import {connect} from "react-redux";
import {showTeammateRankedType} from "../redux/reducers/ConfigReducer";
import withErrorBoundary from "./error/withErrorBoundary";
import Hovercard from "./main/Hovercard";
import {useTranslation} from 'react-i18next';
import languageChange from '../resources/language-change.png'
import {language} from "../redux/reducers/ConfigReducer";

const {ipcRenderer} = window.require('electron');

function Main(props) {
  const [killLoLLoading, setKillLoLLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const {t, i18n} = useTranslation();

  // Histats
  useEffect(() => {
    window._Hasync = window._Hasync || [];
    window._Hasync.push(['Histats.start', '1,4818979,4,0,0,0,00010000']);
    window._Hasync.push(['Histats.fasi', '1']);
    window._Hasync.push(['Histats.track_hits', '']);

    const hs = document.createElement('script');
    hs.type = 'text/javascript';
    hs.async = true;
    hs.src = 'https://s10.histats.com/js15_as.js';
    const head = document.getElementsByTagName('head')[0];
    const body = document.getElementsByTagName('body')[0];
    (head || body).appendChild(hs);

    return () => {
      (head || body).removeChild(hs);
    };
  }, []);

  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [kill-lol-ack]:', data);
      setKillLoLLoading(false)
      let s = '';
      if (data.length === 0) {
        s = t('main.appStates.lolNotOpen');
      } else {
        s = (
          <>
            {t('main.closedProcessesCount', {count: data.length})}
            {data.map((p, index) => (
              <React.Fragment key={index}>
                <br/>
                {p.imageName} {p.pid}
              </React.Fragment>
            ))}
          </>
        );
      }
      messageApi.open({
        type: 'success',
        content: s,
      });
    }
    ipcRenderer.on('kill-lol-ack', handleEvent);
    return () => {
      ipcRenderer.removeListener('kill-lol-ack', handleEvent);
    }
  }, []);
  return (
    <div>
      {contextHolder}
      <Space direction="vertical" style={{display: 'flex'}}>
        <Row>
          <Col span="21">
            <h2>{props.appState}</h2>
          </Col>
          <Col span="1">
            <Image width={40} height={40} style={{userSelect: "none"}} preview={false}
                   src={languageChange}
                   onClick={() => {
                     if (i18n.language === language.en) {
                       i18n.changeLanguage(language.zh)
                     } else {
                       i18n.changeLanguage(language.en)
                     }
                     props.changeLanguage(i18n.language)
                   }}
            />
          </Col>
        </Row>
        <Space wrap>
          <Button type="primary" size="middle" onClick={() => {
            ApiUtils.postAcceptMatchmaking()
          }
          }>
            {t('main.acceptMatchmaking')}
          </Button>
          <Button type="primary" size="middle" onClick={() => {
            props.changeIsAutoAccept(false)
            ApiUtils.postDeclineMatchmaking()
          }}>
            {t('main.declineMatchmaking')}
          </Button>
          <Button type="primary" size="middle" loading={killLoLLoading} onClick={() => {
            ipcRenderer.send('kill-lol', '');
            setKillLoLLoading(true);
          }}>
            {t('main.forceKillLoL')}
          </Button>
        </Space>
        <Space wrap>
          <label htmlFor="auto-accept-btn"
                 style={{userSelect: "none", fontSize: 16}}>{t('main.autoAccept')}</label>
          <Switch id="auto-accept-btn" checked={props.isAutoAccept} onChange={(checked, event) => {
            console.log(checked, event)
            props.changeIsAutoAccept(checked)
          }}></Switch>
        </Space>

        <Space>
          <label htmlFor="teammate-ranked-stats-btn"
                 style={{userSelect: "none", fontSize: 16}}>{t('main.displayTeammateScore')}</label>
          <Switch id="teammate-ranked-stats-btn" checked={props.isShowTeammateRanked}
                  onChange={(checked, event) => {
                    // console.log(checked, event)
                    props.changeIsShowTeammateRanked(checked)
                  }}></Switch>
        </Space>
        <Row>
          <Col span="20" offset="2">
            <Radio.Group value={props.showTeammateRankedType} buttonStyle="solid"
                         style={{userSelect: "none"}}
                         disabled={!props.isShowTeammateRanked}
                         onChange={(event) => {
                           // console.log(event)
                           props.changeShowTeammateRankedType(event.target.value)
                         }}>
              <Radio.Button
                value={showTeammateRankedType.SOLO}>{t('main.showTeammateRankedType.soloDuo')}</Radio.Button>
              <Radio.Button
                value={showTeammateRankedType.FLEX}>{t('main.showTeammateRankedType.flex')}</Radio.Button>
              <Radio.Button
                value={showTeammateRankedType.BOTH}>{t('main.showTeammateRankedType.both')}</Radio.Button>
            </Radio.Group>
          </Col>
        </Row>

        <Hovercard/>

      </Space>
    </div>
  )
}

const mapStateToProps = (state) => {
  return {
    isAutoAccept: state.ConfigReducer.isAutoAccept,
    isShowTeammateRanked: state.ConfigReducer.isShowTeammateRanked,
    showTeammateRankedType: state.ConfigReducer.showTeammateRankedType,
    appState: state.GameReducer.appState
  }
}

const mapDispatchToProp = {
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
  changeLanguage(data) {
    return {
      type: "change-language",
      data
    }
  }
}

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(Main))