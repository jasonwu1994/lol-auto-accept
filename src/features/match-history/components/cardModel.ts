import { useMemo } from 'react'
import { toFrames } from '../upstream/data-adapter/match-history/frames'
import { toBasicInfo } from '../upstream/data-adapter/match-history/match-basic'
import { toParticipants } from '../upstream/data-adapter/match-history/participants'
import { toTeams } from '../upstream/data-adapter/match-history/teams'
import type { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '../upstream/data-adapter/wrapper'

/** Upstream `provideMatchCard` computed state, as a memoized hook. */
export function useCardModel(summary: LcuOrSgpGameSummary, details: LcuOrSgpGameDetails | null | undefined, puuid: string | undefined) {
  return useMemo(() => {
    const basicInfo = toBasicInfo(summary)
    const participants = toParticipants(summary, basicInfo)
    const teams = toTeams(summary, basicInfo, participants)
    const frames = details ? toFrames(details) : []
    const participant = participants.find(p => p.puuid === puuid) ?? null
    const team = participant ? teams.teamStatMap[participant.teamIdentifier] ?? null : null
    return { summary, details, puuid, basicInfo, participants, teams, frames, participant, team }
  }, [summary, details, puuid])
}

export type CardModel = ReturnType<typeof useCardModel>

export type WinStyle = 'win' | 'loss' | 'neutral'

/** Upstream `useWinResultStyleType`. */
export function winStyleOf(model: CardModel): WinStyle {
  const { team, basicInfo } = model
  if (!team) return 'neutral'
  if (basicInfo.gameMode === 'PRACTICETOOL' || team.winResult === 'remake' || team.winResult === 'abort') return 'neutral'
  return team.winResult === 'win' ? 'win' : 'loss'
}

export const cardBorderClass = (style: WinStyle) =>
  style === 'win' ? 'border-blue-600/20 dark:border-blue-300/20' : style === 'loss' ? 'border-red-600/20 dark:border-red-300/20' : 'border-black/20 dark:border-white/20'

/** Upstream `getTeamColor` and the fixed 16-colour player palette. */
export const playerColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#FF6B9D', '#C9CBCF', '#54C6EB', '#FFB84D', '#C5A3FF', '#4ECDC4', '#95E1D3', '#FF8A80', '#81C784', '#64B5F6']
export function teamColor(teamIdentifier?: string) {
  if (!teamIdentifier) return '#9CA3AF'
  if (teamIdentifier === 'TEAM-100') return '#3B82F6'
  if (teamIdentifier === 'TEAM-200') return '#EF4444'
  if (teamIdentifier.startsWith('CHERRY-')) {
    const id = Number(teamIdentifier.split('-')[1])
    if (!Number.isNaN(id)) return playerColors[(id - 1) % playerColors.length]
  }
  return '#9CA3AF'
}

/** League client post-game colours: the owner's team teal, enemies red, the owner gold. */
export const RELATION_COLORS = { ally: '#1BA9BD', enemy: '#EC2040', self: '#DCBC44' } as const
/** Ally / enemy colour relative to the game's owner; plain team colours when the owner is not in the game. */
export function relationColor(teamIdentifier: string | undefined, ownerTeam: string | undefined) {
  if (!ownerTeam) return teamColor(teamIdentifier)
  return teamIdentifier === ownerTeam ? RELATION_COLORS.ally : RELATION_COLORS.enemy
}

export const damageTextClass = (type: string) =>
  type === 'magic' ? 'text-[#5b9fd7] dark:text-[#6fb0e6]' : type === 'true' ? 'text-[#a8a8a8] dark:text-white' : 'text-[#e07856] dark:text-[#f08a6a]'

const CHINESE = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六']
export function ordinal(n: number, language: string, simplified = false) {
  if (language !== 'en') return simplified ? CHINESE[n - 1] || ' ? ' : `第${CHINESE[n - 1] || ' ? '}名`
  const suffix = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0])
}

/** Upstream `useGameResultName`. */
export function gameResultName(t: (key: string, options?: Record<string, unknown>) => string, language: string, placement: number | null, result: string, isSurrender = false) {
  if (placement !== null && placement !== 0) return ordinal(placement, language)
  if (isSurrender && result !== 'remake') return t('matchCard.result.surrender')
  return t(`matchCard.result.${result}`, { defaultValue: result })
}
