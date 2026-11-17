import { CampSide, JungleCamp } from './types/helpers'

/** 打野分析所考察的前 N 分鐘 */
export const ANALYSIS_MINUTES = 14

/** 首清營地看第幾幀（1 = 1 分鐘時的位置） */
export const FIRST_CLEAR_FRAME = 1

/** 擊殺參與相對於時間線位置的權重 */
export const KILL_WEIGHT = 5

/** 早期陣亡分析時間範圍（毫秒） */
export const EARLY_JUNGLE_INVOLVEMENT_LIMIT_MS = 15 * 60 * 1000

/** 活躍 session：最近一場必須在 8h 內才開始累加 */
export const ACTIVE_SESSION_LATEST_WINDOW_MS = 4 * 60 * 60 * 1000

/** 活躍 session：相鄰場次最大間隔 */
export const ACTIVE_SESSION_GAP_MS = 8 * 60 * 60 * 1000

/** Akari KDA 起評分 */
export const AKARI_KDA_BASELINE = 2

/** Akari KDA 分數權重 */
export const AKARI_KDA_WEIGHT = 3 / 7

/** Akari KDA 分數滿分 */
export const AKARI_KDA_MAX_SCORE = 1

/** Akari 勝率基準線 */
export const AKARI_WIN_RATE_BASELINE = 0.5

/** Akari 勝率分數權重 */
export const AKARI_WIN_RATE_WEIGHT = 1

/** Akari 輸出分數權重 */
export const AKARI_DAMAGE_WEIGHT = 3

/** Akari 承傷分數權重 */
export const AKARI_DAMAGE_TAKEN_WEIGHT = 2

/** Akari 治療起評分所需的本隊平均承傷比例 */
export const AKARI_HEALING_MIN_TEAM_AVERAGE_DAMAGE_TAKEN_RATIO = 0.2

/** Akari 多人隊伍治療滿分所需的本隊平均承傷比例 */
export const AKARI_HEALING_FULL_SCORE_TEAM_AVERAGE_DAMAGE_TAKEN_RATIO = 1.4

/** Akari 單人隊伍治療滿分所需的本隊平均承傷比例 */
export const AKARI_HEALING_SOLO_FULL_SCORE_TEAM_AVERAGE_DAMAGE_TAKEN_RATIO = 1

/** Akari 治療分數滿分 */
export const AKARI_HEALING_MAX_SCORE = 2

/** Akari 補刀滿分所需分均補刀 */
export const AKARI_CS_FULL_SCORE_PER_MINUTE = 10

/** Akari 補刀起評分均補刀 */
export const AKARI_CS_MIN_SCORE_PER_MINUTE = 5

/** Akari 補刀分數滿分 */
export const AKARI_CS_MAX_SCORE = 2

/** Akari 經濟分數權重 */
export const AKARI_GOLD_WEIGHT = 2

/** Akari 參團率起評分 */
export const AKARI_PARTICIPATION_MIN_SHARE = 0.3

/** Akari 參團分數滿分 */
export const AKARI_PARTICIPATION_WEIGHT = 2

/** Akari 傷害、承傷、視野滿分所需理應貢獻比 */
export const AKARI_STANDARD_EXPECTED_CONTRIBUTION_FULL_SCORE_RATIO = 2.0

/** Akari 理應貢獻起評分比 */
export const AKARI_EXPECTED_CONTRIBUTION_BASELINE_RATIO = 1.0

/** Akari 經濟滿分所需理應貢獻比 */
export const AKARI_GOLD_EXPECTED_CONTRIBUTION_FULL_SCORE_RATIO = 1.5

/** Akari 視野分數滿分 */
export const AKARI_VISION_MAX_SCORE = 2

/** Akari 總分滿分 */
export const AKARI_MAX_SCORE =
  AKARI_KDA_MAX_SCORE +
  AKARI_WIN_RATE_WEIGHT +
  AKARI_DAMAGE_WEIGHT +
  AKARI_DAMAGE_TAKEN_WEIGHT +
  AKARI_HEALING_MAX_SCORE +
  AKARI_CS_MAX_SCORE +
  AKARI_GOLD_WEIGHT +
  AKARI_PARTICIPATION_WEIGHT +
  AKARI_VISION_MAX_SCORE

/** 聚合 Akari outstanding 閾值 */
export const AGGREGATE_AKARI_OUTSTANDING_THRESHOLD = 6.5

/** 聚合 Akari outstanding 最小樣本數 */
export const AGGREGATE_AKARI_OUTSTANDING_MIN_COUNT = 5

/** 聚合 Akari extraordinary 閾值 */
export const AGGREGATE_AKARI_EXTRAORDINARY_THRESHOLD = 8

/** 聚合 Akari extraordinary 最小樣本數 */
export const AGGREGATE_AKARI_EXTRAORDINARY_MIN_COUNT = 8

export interface CampCoord {
  x: number
  y: number
  camp: JungleCamp
  side: CampSide
}

export const BLUE_SIDE_CAMPS: CampCoord[] = [
  { x: 3830, y: 7880, camp: 'blue', side: 'blue' },
  { x: 3800, y: 6440, camp: 'wolves', side: 'blue' },
  { x: 7760, y: 4010, camp: 'red', side: 'blue' },
  { x: 6970, y: 5460, camp: 'raptors', side: 'blue' }
]

export const RED_SIDE_CAMPS: CampCoord[] = [
  { x: 10990, y: 7000, camp: 'blue', side: 'red' },
  { x: 11020, y: 8440, camp: 'wolves', side: 'red' },
  { x: 7060, y: 10870, camp: 'red', side: 'red' },
  { x: 7850, y: 9420, camp: 'raptors', side: 'red' }
]
