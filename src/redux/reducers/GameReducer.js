import {translate} from '../../i18n/i18n';

const GameReducer = (prevState = {
  gameflowSession: {},
  champSelectSession: {},
  chatRoomId: '',
  appState: translate('main.appStates.lolNotOpen'),
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
      newState.appState = action.data
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
      return translate('gamePhases.none')
    case 'Lobby':
      return translate('gamePhases.lobby')
    case 'Matchmaking':
      return translate('gamePhases.matchmaking')
    case 'ReadyCheck':
      return translate('gamePhases.readyCheck')
    case 'ChampSelect':
      return translate('gamePhases.champSelect')
    case 'GameStart':
      return translate('gamePhases.gameStart')
    case 'InProgress':
      return translate('gamePhases.inProgress')
    case 'PreEndOfGame':
      return translate('gamePhases.preEndOfGame')
    case 'EndOfGame':
      return translate('gamePhases.endOfGame')
  }
}


export default GameReducer