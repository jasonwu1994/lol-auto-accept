import {normalizeDesignTheme} from '../../styles/designThemes';
import {DEFAULT_NAV_ORDER} from '../../components/common/navigationOrder';

const ConfigReducer = (prevState = {
  isAutoAccept: true,
  isShowRecentTeammate: true,
  recentTeammateCheckGameCount: 20,
  isCheckHiddenPlayerHistory: true,
  hiddenPlayerHistoryGameCount: 5,
  isShowTeammateRanked: true,
  showTeammateRankedType: showTeammateRankedType.BOTH,
  isHovercard: false,
  hovercardTierType: tierType.CHALLENGER,
  hovercardRankedType: rankedType.SOLO,
  language: language.zh,
  isDarkMode: globalThis.__LOL_INITIAL_DARK_MODE__ !== false,
  appearanceMode: globalThis.__LOL_INITIAL_APPEARANCE_MODE__ ?? null,
  designTheme: normalizeDesignTheme(globalThis.__LOL_INITIAL_DESIGN_THEME__),
  schemaVersion: 1,
  alwaysOnTop: false,
  isAutoAramTopmost: false,
  windowSize: null,
  windowPosition: null,
  navOrder: [...DEFAULT_NAV_ORDER]
}, action) => {
  let newState = {...prevState}
  switch (action.type) {
    case 'change-appearanceMode': return ['light','dark','system'].includes(action.data) ? {...prevState,appearanceMode:action.data,isDarkMode:action.data === 'system' ? prevState.isDarkMode : action.data === 'dark'} : prevState;
    case 'change-designTheme': return {...prevState,designTheme:normalizeDesignTheme(action.data)};
    case 'change-isAutoAramTopmost': return {...prevState,isAutoAramTopmost:action.data};
    case 'change-navOrder': return {...prevState,navOrder:action.data};
    case 'change-isCheckHiddenPlayerHistory': return {...prevState,isCheckHiddenPlayerHistory:action.data};
    case 'change-hiddenPlayerHistoryGameCount': return {...prevState,hiddenPlayerHistoryGameCount:action.data};
    case 'change-alwaysOnTop': return {...prevState,alwaysOnTop:action.data};
    case "change-isAutoAccept":
      newState.isAutoAccept = action.data
      return newState
    case "change-isShowRecentTeammate":
      newState.isShowRecentTeammate = action.data
      return newState
    case "change-recentTeammateCheckGameCount":
      newState.recentTeammateCheckGameCount = action.data
      return newState
    case "change-isShowTeammateRanked":
      newState.isShowTeammateRanked = action.data
      return newState
    case "change-showTeammateRankedType":
      newState.showTeammateRankedType = action.data
      return newState
    case "change-isHovercard":
      newState.isHovercard = action.data
      return newState
    case "change-hovercardTierType":
      newState.hovercardTierType = action.data
      return newState
    case "change-hovercardRankedType":
      newState.hovercardRankedType = action.data
      return newState
    case "change-config":
      newState = action.data
      return newState
    case "change-language":
      newState.language = action.data
      return newState
    case "change-isDarkMode":
      newState.isDarkMode = action.data
      newState.appearanceMode = action.data ? 'dark' : 'light'
      return newState
    default:
      return prevState
  }
}

export const rankedType = Object.freeze({
  SOLO: "RANKED_SOLO_5x5",
  FLEX_SR: "RANKED_FLEX_SR",
  FLEX_TT: "RANKED_FLEX_TT",
  TFT: "RANKED_TFT",
  TFT_DOUBLE_UP: "RANKED_TFT_DOUBLE_UP",
  TFT_TURBO: "RANKED_TFT_TURBO",
});

export const showTeammateRankedType = Object.freeze({
  SOLO: rankedType.SOLO,
  FLEX: rankedType.FLEX_SR,
  BOTH: "RANKED_BOTH",
});

export const tierType = Object.freeze({
  IRON: "Iron",
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
  DIAMOND: "Diamond",
  MASTER: "Master",
  GRANDMASTER: "Grandmaster",
  CHALLENGER: "Challenger"
})

export const language = Object.freeze({
  zh: "zh",
  en: "en"
})

export const themeType = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system"
})

export default ConfigReducer
