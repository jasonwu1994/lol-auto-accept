import React, {useEffect} from 'react';
import {Button} from 'antd';
import Layout from "./components/Layout";
import {connect} from "react-redux";
import {showTeammateRankedType} from "./redux/reducers/ConfigReducer"
import ApiUtils from "./api/api-utils";
import {gamePhaseToAppState} from "./redux/reducers/GameReducer";
import {addSummoner} from "./components/ARAM";
import store from './redux/store'
import {useTranslation} from 'react-i18next';

const {ipcRenderer} = window.require('electron');

const App = (props) => {
  const {t, i18n} = useTranslation();

  useEffect(() => {
    ipcRenderer.on('auth', async (event, data) => {
      console.log('Received message [auth]:', data);
      props.changeAuth(data)
      let phase = ''
      await ApiUtils.getGameflowPhase()
        .then(response => {
          // console.log(response.data)
          phase = response.data
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
    const handleEvent = (event, data) => {
      console.log('Received message [set-config]:', data);
      if (data) {
        console.log('changeConfig ', data);
        props.changeConfig(data)
        i18n.changeLanguage(data.language)
        return
      }
      ipcRenderer.send('set-config', store.getState().ConfigReducer);
    }
    ipcRenderer.on('set-config', handleEvent);
    return () => {
      ipcRenderer.removeListener('set-config', handleEvent);
    }
  }, []);


  useEffect(() => {
    const handleEvent = (event, data) => {
      console.log('Received message [get-config] ', store.getState().ConfigReducer);
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
    for (const queueType of queueTypes) {
      ApiUtils.postConversations(queueType.label);
      for (const element of response.myTeam) {
        if (element.summonerId === 0) continue
        const s = await getRankedStatsSummary(element.summonerId, queueType.type);
        console.log("s=", s);
        ApiUtils.postConversations(s);
      }
    }
  }

  async function getRankedStatsSummary(summonerId, queueType) {
    let summoner = await ApiUtils.getSummonersById(summonerId)
    let rankStats = await ApiUtils.getRankedStats(summonerId)
    console.log("rankStats: ", rankStats)
    let queue = rankStats.queues.find(q => q.queueType === queueType);
    console.log("queue: ", queue)
    if (queue) {
      return `${summoner[0].displayName} ${queue.tier} ${queue.division} ${queue.leaguePoints} ${queue.miniSeriesProgress} wins:${queue.wins}`;
    } else {
      return '';
    }
  }

  return (
    <Layout>
      {
        ApiUtils.checkIsDev() &&
        <>
          <Button onClick={async () => {
            let res = await ApiUtils.getSummonersById(100529833)
            console.log(res)
          }
          }>test</Button>

          <Button onClick={() => {
            console.log("store ", store.getState())
          }}>
            config
          </Button>
        </>
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
  }
}
export default connect(mapStateToProps, mapDispatchToProp)(App);