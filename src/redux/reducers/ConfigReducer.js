const ConfigReducer = (prevState = {
  isAutoAccept: true,
  isShowTeammateRanked: true,
  showTeammateRankedType: showTeammateRankedType.BOTH,
  isHovercard: true,
  hovercardTierType: tierType.CHALLENGER,
  hovercardRankedType: rankedType.SOLO,
  language: language.zh
}, action) => {
  let newState = {...prevState}
  switch (action.type) {
    case "change-isAutoAccept":
      newState.isAutoAccept = action.data
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

export default ConfigReducer