// Champion mastery list helpers (upstream ChampionMasteryPane / ChampionMasteryModal).
import type { Mastery } from '../upstream/types/league-client/champion-mastery'

export type MasterySort = 'points' | 'recent'

type Sortable = Pick<Mastery, 'championId' | 'championPoints'> & { lastPlayTime?: number }

/** Highest points first, or most recently played first; each breaks ties with the other. */
export function sortMasteries<T extends Sortable>(list: readonly T[], sort: MasterySort): T[] {
  const played = (m: T) => m.lastPlayTime || 0
  const byPoints = (a: T, b: T) => b.championPoints - a.championPoints
  const byRecent = (a: T, b: T) => played(b) - played(a)
  return list.slice().sort((a, b) => (sort === 'recent' ? byRecent(a, b) || byPoints(a, b) : byPoints(a, b) || byRecent(a, b)) || a.championId - b.championId)
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Upstream `dayjs(value).format('YYYY-MM-DD')` in local time; empty when never played. */
export function formatPlayDate(ms: number | undefined) {
  if (!ms) return ''
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
