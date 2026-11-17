import { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '../../../wrapper'
import { CampSide, GankPoint, JungleCamp, MinutePositionPoint } from './helpers'

export interface AkariScore {
  kdaScore: number
  winRateScore: number
  dmgScore: number
  dmgTakenScore: number
  healingScore: number
  csScore: number
  goldScore: number
  participationScore: number
  visionScore: number
  total: number
  maxScore: number
  outstanding: boolean
  extraordinary: boolean
}

export interface AkariScoreInput {
  kda: number
  winRate: number
  championDamageRatioToTeamMax: number
  championDamageRatioToExpectedContribution: number
  damageTakenRatioToTeamMax: number
  damageTakenRatioToExpectedContribution: number
  healingRatioToTeamAverageDamageTaken: number
  teamParticipantCount: number
  csPerMinute: number
  goldRatioToTeamMax: number
  goldRatioToExpectedContribution: number
  killParticipation: number
  visionScorePercentageOfTeam: number
  visionScoreRatioToExpectedContribution: number
  count: number
}

export interface GameSummaryWithOptionalDetails {
  gameId: number
  summary: LcuOrSgpGameSummary
  details?: LcuOrSgpGameDetails
}

export interface SingleSummaryAnalysis {
  championDamageRatioToTeamMax: number
  championDamageRatioToExpectedContribution: number
  championDamageRatioToMax: number
  championDamagePercentageOfTeam: number
  championDamagePerMinute: number
  damageTakenRatioToTeamMax: number
  damageTakenRatioToExpectedContribution: number
  damageTakenRatioToMax: number
  damageTakenPercentageOfTeam: number
  healingRatioToTeamAverageDamageTaken: number
  teamParticipantCount: number
  goldRatioToTeamMax: number
  goldRatioToExpectedContribution: number
  goldRatioToMax: number
  goldPercentageOfTeam: number
  csRatioToTeamMax: number
  csRatioToMax: number
  csPercentageOfTeam: number
  csPerMinute: number
  towerDamageRatioToTeamMax: number
  towerDamageRatioToMax: number
  towerDamagePercentageOfTeam: number
  visionScorePercentageOfTeam: number
  visionScoreRatioToExpectedContribution: number
  totalDamageShieldedOnTeammatesRatioToTeamMax: number | null
  totalDamageShieldedOnTeammatesRatioToMax: number | null
  totalDamageShieldedOnTeammatesPercentageOfTeam: number | null
  killDamageEfficiency: number
  kda: number
  win: boolean
  killParticipation: number
  damageGoldEfficiency: number
}

/**
 * 團隊級野怪目標統計（所有玩家通用，與角色無關）
 */
export interface SingleObjectivesAnalysis {
  /** 我方是否拿到首龍；全場無小龍時為 null */
  gotFirstDragon: boolean | null
  /** 我方拿到的小龍數 */
  dragons: number
  /** 玩家本人單殺的小龍數（killer===self 且無助攻） */
  soloDragons: number
  /** 我方首條小龍時間（秒） */
  firstDragonTime: number | null
  voidgrubs: number
  firstVoidgrubTime: number | null
  heralds: number
  firstHeraldTime: number | null
  barons: number
  firstBaronTime: number | null
}

/**
 * 打野專屬：玩家不是打野（無懲戒且非 JUNGLE 位）或非召喚峽谷時整體為 null
 */
export interface SingleJungleAnalysis {
  /** 地圖三分區權重和（前 14 分鐘，時間線位置權重 1 + 擊殺參與權重 5） */
  topZoneWeightSum: number
  midZoneWeightSum: number
  botZoneWeightSum: number
  totalZoneWeightSum: number

  /** 前 14 分鐘 Gank 計數（按線） */
  topGanks: number
  midGanks: number
  botGanks: number

  /** 首清營地，frame[1] 不可用時為 null */
  startCamp: { camp: JungleCamp; side: CampSide } | null

  /** 3 級時檢測到對英雄造成傷害（不一定擊殺） */
  level3GankDetected: boolean
  /** 4 級時檢測到新增英雄傷害（獨立於 3 級抓） */
  level4GankDetected: boolean
  /** 3 分鐘內的擊殺參與位置 */
  level3KillPositions: GankPoint[]
  /** 3-4 分鐘之間的擊殺參與位置 */
  level4KillPositions: GankPoint[]

  /** 前 14 分鐘所有 Gank 類擊殺座標（用於地圖視覺化） */
  gankPositions: GankPoint[]
  /** 前 14 分鐘整分鐘位置點（用於地圖視覺化） */
  minutePositions: MinutePositionPoint[]
}

/**
 * 透過 summary + details 資料計算而來
 */
export interface SingleDetailsAnalysis {
  objectives: SingleObjectivesAnalysis

  earlyDeathsWithEnemyJunglerInvolved: number | null

  jungle: SingleJungleAnalysis | null
}

export interface SingleAnalysis {
  gameId: number

  summary: SingleSummaryAnalysis
  details: SingleDetailsAnalysis | null
  akariScore: AkariScore
}
