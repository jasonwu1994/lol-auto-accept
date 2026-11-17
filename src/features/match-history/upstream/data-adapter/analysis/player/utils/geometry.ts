import { SUMMONER_SPELL_SMITE_ID } from '../../../../constants/summoner-spells'

import { MatchParticipant } from '../../../match-history/participants'
import { BLUE_SIDE_CAMPS, CampCoord, RED_SIDE_CAMPS } from '../constants'
import type { CampSide, GankLane, JungleCamp } from '../types/helpers'

/** 找到座標最近的營地，用於首清判斷 */
export function detectStartCamp(x: number, y: number): { camp: JungleCamp; side: CampSide } {
  const camps = [...BLUE_SIDE_CAMPS, ...RED_SIDE_CAMPS]
  let minDist = Infinity
  let nearest: CampCoord = camps[0]
  for (const c of camps) {
    const dx = x - c.x
    const dy = y - c.y
    const dist = dx * dx + dy * dy
    if (dist < minDist) {
      minDist = dist
      nearest = c
    }
  }
  return { camp: nearest.camp, side: nearest.side }
}

/** 地圖三分區分類（用於位置熱力聚合，任何座標都會被歸到 top/mid/bot 之一） */
export function classifyMapZone(x: number, y: number): GankLane {
  if (x < 5000 && y > 9000) return 'top'
  if (x > 9000 && y < 5000) return 'bot'

  const distFromDiag = Math.abs(y - x)
  if (distFromDiag <= 3500) return 'mid'

  return y > x ? 'top' : 'bot'
}

/** Gank 路線分類（比 classifyMapZone 更嚴格；非典型位置回傳 null） */
export function classifyGankLane(x: number, y: number): GankLane | null {
  if (x < 5000 && y > 9000) return 'top'
  if (x > 9000 && y < 5000) return 'bot'

  const distFromDiag = Math.abs(y - x)
  const midPoint = (x + y) / 2
  if (distFromDiag < 4000 && midPoint > 3000 && midPoint < 12000) return 'mid'

  return null
}

export function isJunglerParticipant(p: MatchParticipant): boolean {
  return p.position === 'JUNGLE' || p.spells.includes(SUMMONER_SPELL_SMITE_ID)
}

/** 從對局中找到敵方打野的 participantId 集合（優先按 position，回落到懲戒） */
export function getEnemyJunglerParticipantIds(
  self: MatchParticipant,
  allParticipants: MatchParticipant[]
): number[] {
  const enemies = allParticipants.filter((p) => p.teamId !== self.teamId)
  const byPosition = enemies.filter((p) => p.position === 'JUNGLE')
  if (byPosition.length) return byPosition.map((p) => p.participantId)

  const bySmite = enemies.filter((p) => p.spells.includes(SUMMONER_SPELL_SMITE_ID))
  if (bySmite.length) return bySmite.map((p) => p.participantId)

  return []
}
