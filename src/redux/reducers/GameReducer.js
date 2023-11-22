import {translate} from '../../i18n/i18n';

const GameReducer = (prevState = {
  gameflowSession: {},
  champSelectSession: {},
  chatRoomId: '',
  appState: translate('main.appStates.lolNotOpen'),
  appStateKey: 'main.appStates.lolNotOpen',
  gamePhase: '',
  myTeam: [],
}, action) => {
  let newState = {...prevState}
  switch (action.type) {
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
  }
}


export default GameReducer