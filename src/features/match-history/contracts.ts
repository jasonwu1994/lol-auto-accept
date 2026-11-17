import type { Game, GameTimeline, MatchHistory } from './upstream/types/league-client/match-history'
import type { SummonerInfo, SummonerProfile } from './upstream/types/league-client/summoner'

/** Platform + PUUID. Display names are mutable labels, never identity. */
export interface PlayerRef {
  platformId: string
  puuid: string
}

export interface PlayerLabel {
  gameName?: string
  tagLine?: string
  profileIconId?: number
}

export interface MatchHistoryContextDto {
  connected: boolean
  /** `${connectionGeneration}:${accountPuuid}`; never contains a token. */
  scope?: string
  generation?: number
  me?: SummonerInfo
  platformId?: string
  region?: string
  rsoPlatformId?: string
  locale?: string | null
  gameVersion?: string | null
  capabilities?: {
    lcu: Record<string, boolean>
    /** Same-server SGP reads (challenges, queue tags); never cross-region. */
    sgp: { available: boolean; serverId?: string; queues?: number[]; reason?: string }
  }
}

export interface ProfileDto {
  summoner: SummonerInfo
  profile: SummonerProfile | null
}

/** LCU summaries; `gameId` values are decimal strings after the backend boundary. */
export type PageDto = MatchHistory & { requested: { begIndex: number; endIndex: number } }

export type RawGame = Omit<Game, 'gameId'> & { gameId: string | number }
export type RawTimeline = GameTimeline

export interface ReplayMetadata {
  gameId: number | string
  state: 'checking' | 'found' | 'download' | 'downloading' | 'watch' | 'incompatible' | 'lost' | 'error' | string
  downloadProgress: number
}

export interface ReplayStateDto {
  enabled: boolean
  configuration: Record<string, unknown>
  metadata?: ReplayMetadata
}

/** A collection challenge's current value (upstream PlayerChallenges, the 收藏 block). */
export interface CollectionCountDto {
  id: number
  currentValue: number
}

export interface SearchHistoryItem {
  puuid: string
  platformId: string
  gameName: string
  tagLine: string
  profileIconId?: number | null
  isPinned?: boolean
}

export interface AugmentTextDto {
  entries: Array<{ id: number; tooltip: string; mode?: string }>
  ageSeconds: number
  source: string
}

export type GameDataKind =
  | 'map-assets'
  | 'game-queues'
  | 'items'
  | 'summoner-spells'
  | 'perks'
  | 'perkstyles'
  | 'queues'
  | 'maps'
  | 'cherry-augments'
  | 'champion-summary'
  | 'challenges'
  | 'game-mode-mutators'

export interface MatchHistoryError {
  code: string
  message: string
}

export function errorCode(error: unknown): string {
  return (error as MatchHistoryError | undefined)?.code ?? 'Unknown'
}
