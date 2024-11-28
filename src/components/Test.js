import React from 'react';
import {connect} from "react-redux";
import RecentUtils from '../components/common/RecentUtils';
import withErrorBoundary from "./error/withErrorBoundary";
import {useTranslation} from 'react-i18next';
import DatabaseUtils from "./common/DatabaseUtils";
import {Button} from "antd";
import ApiUtils from "../api/api-utils";
import store from "../redux/store";


function Test(props) {
  const {t} = useTranslation();

  return (
    <div>
      <Button onClick={async () => {
        let res = await RecentUtils.syncRecentGames(0, 30)
        console.log("res:", res)
        let res1 = await DatabaseUtils.getAllGamesByOwnerPuuid('')
        console.log(res1);
      }
      }>test1</Button>
      <Button onClick={async () => {
        props.changeGamePhase("lobby")
      }
      }>test2</Button>
      <Button onClick={async () => {
        props.changeGamePhase("match")
      }
      }>test3</Button>
      <Button onClick={() => {
        console.log("store ", store.getState())
      }}>
        config
      </Button>
    </div>
  );
}

const mapStateToProps = (state) => {
  return {
    gameflowSession: state.GameReducer.gameflowSession,
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

export default connect(mapStateToProps, mapDispatchToProp)(withErrorBoundary(Test))