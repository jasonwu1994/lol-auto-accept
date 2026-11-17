import { toFrames } from '../../../match-history/frames'
import type { MatchBasicInfo } from '../../../match-history/match-basic'
import type { MatchParticipant } from '../../../match-history/participants'
import type { LcuOrSgpGameDetails } from '../../../wrapper'
import type { SingleDetailsAnalysis } from '../types/single'
import { isJunglerParticipant } from '../utils/geometry'
import { computeSingleEarlyDeathsWithEnemyJungler } from './early-deaths'
import { computeSingleJungle } from './jungle'
import { computeSingleObjectives } from './objectives'

/**
 * 單場 details 分析：從 timeline/frames 中提取所有 summary 無法獲得的指標
 *
 * - `objectives`：團隊野怪目標，任意模式下均計算
 * - `earlyDeathsWithEnemyJunglerInvolved`：僅在峽谷經典匹配且玩家非打野、敵方有打野時有效
 * - `jungle`：僅在玩家是打野（position=JUNGLE 或攜帶懲戒）且地圖為召喚峽谷時有效
 */
export function computeSingleDetails(
  details: LcuOrSgpGameDetails,
  basic: MatchBasicInfo,
  participant: MatchParticipant,
  allParticipants: MatchParticipant[]
): SingleDetailsAnalysis {
  const frames = toFrames(details)

  const objectives = computeSingleObjectives(frames, participant)
  const earlyDeathsWithEnemyJunglerInvolved = computeSingleEarlyDeathsWithEnemyJungler(
    frames,
    basic,
    participant,
    allParticipants
  )
  const jungle =
    basic.mapId === 11 && isJunglerParticipant(participant)
      ? computeSingleJungle(frames, participant)
      : null

  return {
    objectives,
    earlyDeathsWithEnemyJunglerInvolved,
    jungle
  }
}
