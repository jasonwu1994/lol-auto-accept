import {rosterRecoveryKey} from '../../components/common/currentPlayers';
import {retainDisplay} from '../../desktop/retainedDisplay';
import {translate} from '../../i18n/i18n';

const GameReducer = (prevState = {
  sessionIdentity: {connectionGeneration:0,sessionKey:''},
  aramPreferences: [],
  gameflowSession: {},
  champSelectSession: {},
  chatRoomId: '',
  appState: translate('main.appStates.lolNotOpen'),
  appStateKey: 'main.appStates.lolNotOpen',
  gamePhase: '',
  myTeam: [],
  lobbyMembers: []
}, action) => {
  let newState = {...prevState}
  switch (action.type) {
    case 'change-rosterRecovery': {
      if (!prevState.gameflowIsLive || JSON.stringify(prevState.sessionIdentity) !== action.data.identity || rosterRecoveryKey(prevState.gameflowSession) !== action.data.key) return prevState;
      const old = prevState.rosterRecovery?.key === action.data.key ? prevState.rosterRecovery.players : {};
      return {...prevState, rosterRecovery: {key: action.data.key, players: {...old, ...action.data.players}}};
    }
    case 'change-displaySnapshot': return retainDisplay(prevState,action.data);
    case 'change-sessionIdentity': return {...prevState,sessionIdentity:action.data};
    case 'change-aramPreferences': return {...prevState, aramPreferences:action.data};
    case "change-gameflowSession":
      newState.gameflowSession = action.data
      return newState
    case "change-champSelectSession":
      newState.champSelectSession = action.data
      return newState
    case "change-chatRoomId":
      newState.chatRoomId = action.data
      return newState
    case "change-appState":
      newState.appState = translate(action.data)
      newState.appStateKey = action.data
      return newState
    case "change-myTeam":
      newState.myTeam = action.data
      return newState
    case "change-gamePhase":
      newState.gamePhase = action.data
      return newState
    case "change-lobby-members":
      newState.lobbyMembers = action.data
      return newState
    default:
      return prevState
  }
}

export function gamePhaseToAppState(phase) {
  switch (phase) {
    case 'None':
      return 'gamePhases.none'
    case 'Lobby':
      return 'gamePhases.lobby'
    case 'Matchmaking':
      return 'gamePhases.matchmaking'
    case 'ReadyCheck':
      return 'gamePhases.readyCheck'
    case 'ChampSelect':
      return 'gamePhases.champSelect'
    case 'GameStart':
      return 'gamePhases.gameStart'
    case 'InProgress':
      return 'gamePhases.inProgress'
    case 'PreEndOfGame':
      return 'gamePhases.preEndOfGame'
    case 'EndOfGame':
      return 'gamePhases.endOfGame'
    default: return 'gamePhases.unknown'
  }
}


export default GameReducer