import { desktop } from '../../desktop/tauri'
import type {
  AugmentTextDto,
  CachedPageDto,
  CollectionCountDto,
  GameDataKind,
  MatchHistoryContextDto,
  PageDto,
  ProfileDto,
  RawGame,
  RawTimeline,
  ReplayMetadata,
  ReplayStateDto,
  SavedPlayer,
  SavedPlayerAction,
  SavedPlayersDto
} from './contracts'
import type { RankedStats } from './upstream/types/league-client/ranked'
import type { Mastery, PlayerChampionMastery } from './upstream/types/league-client/champion-mastery'
import type { SummonerInfo } from './upstream/types/league-client/summoner'
import type { SgpGameDetailsLol, SgpMatchHistoryLol } from './upstream/types/sgp/match-history'

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/** Named match-history commands only; the UI never builds client URLs. */
export function createMatchHistoryApi(invoke: Invoke) {
  return {
    context: () => invoke<MatchHistoryContextDto>('get_match_history_context'),
    profile: (scope: string, puuid: string) => invoke<ProfileDto>('get_match_history_profile', { scope, puuid }),
    ranked: (scope: string, puuid: string) => invoke<RankedStats>('get_match_history_ranked', { scope, puuid }),
    masteryTop: (scope: string, puuid: string, count: number) =>
      invoke<PlayerChampionMastery>('get_match_history_mastery_top', { scope, puuid, count }),
    mastery: (scope: string, puuid: string) => invoke<Mastery[]>('get_match_history_mastery', { scope, puuid }),
    page: (scope: string, puuid: string, begIndex: number, endIndex: number) =>
      invoke<PageDto>('get_match_history_page', { scope, puuid, begIndex, endIndex }),
    sgpPage: (scope: string, puuid: string, startIndex: number, count: number, tag?: string) =>
      invoke<SgpMatchHistoryLol>('get_match_history_sgp_page', { scope, puuid, startIndex, count, tag: tag ?? null }),
    sgpDetails: (scope: string, gameId: string) =>
      invoke<SgpGameDetailsLol>('get_match_history_sgp_details', { scope, gameId }),
    /** The player's newest games as last saved on disk, or null when they are not all cached. */
    cachedPage: (scope: string, puuid: string, source: 'lcu' | 'sgp', tag: string | undefined, count: number) =>
      invoke<CachedPageDto | null>('get_match_history_cached_page', { scope, puuid, source, tag: tag ?? null, count }),
    saveCachedPage: (scope: string, puuid: string, source: 'lcu' | 'sgp', tag: string | undefined, gameIds: string[], complete: boolean) =>
      invoke<void>('save_match_history_cached_page', { scope, puuid, source, tag: tag ?? null, gameIds, complete }),
    collection: (scope: string, puuid: string) =>
      invoke<CollectionCountDto[]>('get_match_history_collection', { scope, puuid }),
    game: (scope: string, gameId: string) => invoke<RawGame>('get_match_history_game', { scope, gameId }),
    timeline: (scope: string, gameId: string) => invoke<RawTimeline>('get_match_history_timeline', { scope, gameId }),
    search: (scope: string, gameName: string, tagLine: string) =>
      invoke<SummonerInfo[]>('search_match_history_players', { scope, gameName, tagLine }),
    gameData: <T = unknown>(scope: string, kind: GameDataKind) => invoke<T>('get_match_history_game_data', { scope, kind }),
    augmentText: () => invoke<AugmentTextDto>('get_match_history_augment_text'),
    replayState: (scope: string, gameId: string) => invoke<ReplayStateDto>('get_match_replay_state', { scope, gameId }),
    createReplayMetadata: (
      scope: string,
      gameId: string,
      meta: { gameVersion?: string; gameType?: string; queueId?: number; gameEnd?: number }
    ) => invoke<ReplayMetadata>('create_match_replay_metadata', { scope, gameId, meta }),
    replayAction: (scope: string, gameId: string, action: 'download' | 'watch') =>
      invoke<ReplayMetadata>('run_match_replay_action', { scope, gameId, action }),
    /** Saved players live on this computer and work while the client is closed. */
    saved: () => invoke<SavedPlayersDto>('get_match_history_saved'),
    updateSaved: (action: SavedPlayerAction, item?: SavedPlayer, index?: number) =>
      invoke<SavedPlayersDto>('update_match_history_saved', { action, item: item ?? null, index: index ?? null })
  }
}

export type MatchHistoryApi = ReturnType<typeof createMatchHistoryApi>

export const matchHistoryApi = createMatchHistoryApi((command, args) => desktop.invoke(command, args))

/** URL for a `/lol-game-data/assets/...` path served by the backend `lolasset` protocol. */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path || !path.startsWith('/lol-game-data/assets/')) return undefined
  // Dev-only fixture preview hook (dev/preview.tsx); never set in the desktop app.
  const preview = import.meta.env.DEV ? (globalThis as { __MH_PREVIEW_ASSET__?: (path: string) => string }).__MH_PREVIEW_ASSET__ : undefined
  if (preview) return preview(path)
  const encoded = path.replace(/ /g, '%20')
  const windows = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)
  return windows ? `http://lolasset.localhost${encoded}` : `lolasset://localhost${encoded}`
}
