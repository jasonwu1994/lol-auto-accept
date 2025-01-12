import React, {useEffect, useRef, useState} from 'react';
import Layout from "./components/Layout";
import {connect} from "react-redux";
import {showTeammateRankedType} from "./redux/reducers/ConfigReducer"
import ApiUtils from "./api/api-utils";
import RecentTeammatesService from './services/recentTeammatesService'
import {gamePhaseToAppState} from "./redux/reducers/GameReducer";
import {addSummoner} from "./components/common/summonerUtils";
import store from './redux/store'
import {useTranslation} from 'react-i18next';
import {trackEvent} from './components/GoogleAnalytics';
import Test from './components/Test'

const _package = require("../package.json");
const {ipcRenderer} = window.require('electron');

const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

const App = (props) => {
  const {t, i18n} = useTranslation();
  const [isInitConfigUpdated, setIsInitConfigUpdated] = useState(false);  // 用於觸發渲染後的動作

  // 解決set-config中props.appStateKey初始化值不會更新的問題
  const appStateKeyRef = useRef(props.appStateKey);
  useEffect(() => {
    appStateKeyRef.current = props.appStateKey;
  }, [props.appStateKey]);

  useEffect(() => {
    ipcRenderer.on('auth', async (event, data) => {
      console.log('Received message [auth]:', data);
      props.changeAuth(data)
      let phase = ''
      await ApiUtils.getGameflowPhase()
        .then(response => {
          // console.log(response.data)
          phase = response.data
          console.log('Received message [auth]: props.changeAppState ', phase);
          props.changeAppState(gamePhaseToAppState(phase))
          props.changeGamePhase(data)
        })
        .catch(error => console.log(error))
      ipcRenderer.send('auth-ack', phase);
    });

    ipcRenderer.on('InProgress', async (event, data) => {
      console.log('Received message [InProgress]:', data);
      props.changeAppState(gamePhaseToAppState("InProgress"))
      props.changeGamePhase(data)
      ApiUtils.getGameflowSession()
        .then(response => {
          console.log("getGameflowSession ", response.data);
          delete response.data.map.assets
          props.changeGameflowSession(response.data)
        })
        .catch(error => console.error(error));
    });
    ipcRenderer.on('GameStart', async (event, data) => {
      console.log('Received message [GameStart]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("GameStart"))
    });
    ipcRenderer.on('PreEndOfGame', async (event, data) => {
      console.log('Received message [PreEndOfGame]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("PreEndOfGame"))
    });
    ipcRenderer.on('EndOfGame', async (event, data) => {
      console.log('Received message [EndOfGame]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("EndOfGame"))
    });
    ipcRenderer.on('None', async (event, data) => {
      console.log('Received message [None]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("None"))
    });
    ipcRenderer.on('Matchmaking', async (event, data) => {
      console.log('Received message [Matchmaking]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("Matchmaking"))
    });

    ipcRenderer.on('lol-connect', async (event, data) => {
      console.log('Received message [lol-connect]:', data);
      props.changeAppState('main.appStates.lolStarting')
    });
    ipcRenderer.on('lol-disconnect', async (event, data) => {
      console.log('Received message [lol-disconnect]:', data);
      props.changeAppState('main.appStates.lolClosed')
    });


    ipcRenderer.on('champ-select-session', async (event, data) => {
      console.log('Received message [champ-select-session]:', data);
      props.changeChampSelectSession(data)
      if (data?.chatDetails?.multiUserChatId) {
        props.changeChatRoomId(data.chatDetails.multiUserChatId);
      }
    });

    ipcRenderer.on('lobby-comms-members', async (event, data) => {
      console.log('Received message [lobby-comms-members]:', data);
      props.changeLobbyMembers(data.players || {})
    });
  }, []);

  //測試用
  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [Lobby]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("Lobby"))
    };
    ipcRenderer.on('Lobby', handleEvent);
    return () => {
      ipcRenderer.removeListener('Lobby', handleEvent);
    }
  }, []);

  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [ReadyCheck]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("ReadyCheck"))
      if (props.isAutoAccept) {
        ApiUtils.postAcceptMatchmaking();
        trackEvent('auto_accept_match')
      }
    }
    ipcRenderer.on('ReadyCheck', handleEvent);
    return () => {
      ipcRenderer.removeListener('ReadyCheck', handleEvent);
    }
  }, [props.isAutoAccept]);

  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [ChampSelect]:', data);
      props.changeGamePhase(data)
      props.changeAppState(gamePhaseToAppState("ChampSelect"))
      ApiUtils.getChampSelectSession()
        .then(response => {
          console.log('getChampSelectSession ', response.data);
          props.changeChampSelectSession(response.data)
          props.changeChatRoomId(response.data.chatDetails.multiUserChatId)
          if (props.isShowTeammateRanked) {
            showTeammateRankedStats(response.data)
          }
        })
        .catch(error => console.error(error));
    }
    ipcRenderer.on('ChampSelect', handleEvent);
    return () => {
      ipcRenderer.removeListener('ChampSelect', handleEvent);
    }
  }, [props.isShowTeammateRanked, props.showTeammateRankedType]);

  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [champ-select-summoners]:', data);
      let myTeam = addSummoner(props.myTeam, data)
      props.changeMyTeam(myTeam)
    }
    ipcRenderer.on('champ-select-summoners', handleEvent);
    return () => {
      ipcRenderer.removeListener('champ-select-summoners', handleEvent);
    }
  }, [props.myTeam]);

  useEffect(() => {
    const currentVersion = _package.version; // 確保這裡能正確獲取到版本號

    const handleEvent = async (event, data) => {
      console.log('Received message [set-config]:', data);
      if (data) {
        console.log('changeConfig ', data);
        console.log('changeConfig appStateKeyRef.current', appStateKeyRef.current);
        props.changeConfig(data)
        i18n.changeLanguage(data.language)
        props.changeAppState(appStateKeyRef.current)
        const eventData = {...data, version: currentVersion};
        trackEvent('app_start', eventData);
      } else {
        trackEvent('app_start', {version: currentVersion});
        ipcRenderer.send('set-config', store.getState().ConfigReducer); // 給預設設定檔
      }
      await sleep(300)
      setIsInitConfigUpdated(true);
    }
    ipcRenderer.on('set-config', handleEvent);
    return () => {
      ipcRenderer.removeListener('set-config', handleEvent);
    }
  }, []);

  // 當狀態更新後，發送 ack 訊息
  useEffect(() => {
    if (isInitConfigUpdated) {
      ipcRenderer.send('init-set-config-ack', true);
    }
  }, [isInitConfigUpdated]);  // 依賴於 isInitConfigUpdated，當其變為 true 時觸發

  useEffect(() => {
    const startTime = Date.now();
    const sendCloseEvent = () => {
      try {
        const endTime = Date.now();
        const durationInSeconds = Math.round((endTime - startTime) / 1000);
        const durationFormatted = formatDuration(durationInSeconds);
        trackEvent('app_close', {duration: durationInSeconds, duration_formatted: durationFormatted});
      } catch (error) {
        console.error('Error sending app_close event:', error);
      }
    };

    const handleEvent = (event, data) => {
      console.log('Received message [get-config] ', store.getState().ConfigReducer);
      sendCloseEvent()
      ipcRenderer.send('set-config', store.getState().ConfigReducer);
    }
    ipcRenderer.on('get-config', handleEvent);
    return () => {
      ipcRenderer.removeListener('get-config', handleEvent);
    }
  }, []);

  useEffect(() => {

  }, []);


  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function showTeammateRankedStats(response) {
    await sleep(3000)
    let queueTypes = [];
    switch (props.showTeammateRankedType) {
      case showTeammateRankedType.SOLO:
        queueTypes.push({type: showTeammateRankedType.SOLO, label: t('main.rankedType.soloDuo')});
        break;
      case showTeammateRankedType.FLEX:
        queueTypes.push({type: showTeammateRankedType.FLEX, label: t('main.rankedType.flex')});
        break;
      case showTeammateRankedType.BOTH:
        queueTypes.push(
          {type: showTeammateRankedType.SOLO, label: t('main.rankedType.soloDuo')},
          {type: showTeammateRankedType.FLEX, label: t('main.rankedType.flex')}
        );
        break;
      default:
        queueTypes.push({type: showTeammateRankedType.SOLO, label: t('main.rankedType.soloDuo')});
    }
    let conversationString = "";
    for (const queueType of queueTypes) {
      conversationString += queueType.label + "\n";
      for (const element of response.myTeam) {
        if (element.summonerId === 0) continue;
        const s = await getRankedStatsSummary(element.summonerId, queueType.type);
        conversationString += s + "\n";
      }
    }
    console.log(`showTeammateRankedStats conversationString:\n${conversationString}`);
    ApiUtils.postConversations(conversationString.trim());
  }

  async function getRankedStatsSummary(summonerId, queueType) {
    let summoner = await ApiUtils.getSummonersById(summonerId)
    let rankStats = await ApiUtils.getRankedStats(summonerId)
    console.log("rankStats: ", rankStats)
    let queue = rankStats.queues.find(q => q.queueType === queueType);
    // console.log("queue: ", queue)
    if (queue) {
      return `${summoner[0].gameName ?? summoner[0].displayName} ${queue.tier} ${queue.division} ${queue.leaguePoints} ${queue.miniSeriesProgress} wins:${queue.wins}`;
    } else {
      return '';
    }
  }

  return (
    <Layout>
      <RecentTeammatesService/>
      {
        ApiUtils.checkIsDev() && <Test/>
      }
    </Layout>
  )
};

const mapStateToProps = (state) => {
  return {
    isAutoAccept: state.ConfigReducer.isAutoAccept,
    isShowTeammateRanked: state.ConfigReducer.isShowTeammateRanked,
    showTeammateRankedType: state.ConfigReducer.showTeammateRankedType,
    appState: state.GameReducer.appState,
    appStateKey: state.GameReducer.appStateKey,
    myTeam: state.GameReducer.myTeam
  }
}

const mapDispatchToProp = {
  changeGameflowSession(data) {
    return {
      type: "change-gameflowSession",
      data
    }
  },
  changeChampSelectSession(data) {
    return {
      type: "change-champSelectSession",
      data
    }
  },
  changeAuth(data) {
    return {
      type: "change-auth",
      data
    }
  },
  changeChatRoomId(data) {
    return {
      type: "change-chatRoomId",
      data
    }
  },
  changeAppState(data) {
    return {
      type: "change-appState",
      data
    }
  },
  changeMyTeam(data) {
    return {
      type: "change-myTeam",
      data
    }
  },
  changeGamePhase(data) {
    return {
      type: "change-gamePhase",
      data
    }
  },
  changeConfig(data) {
    return {
      type: "change-config",
      data
    }
  },
  changeLobbyMembers(data) {
    return {
      type: "change-lobby-members",
      data
    }
  }
}
export default connect(mapStateToProps, mapDispatchToProp)(App);