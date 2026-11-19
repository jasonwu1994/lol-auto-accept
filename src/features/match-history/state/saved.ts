import { useSyncExternalStore } from 'react'
import { matchHistoryApi, type MatchHistoryApi } from '../api'
import { errorCode, type PlayerLabel, type SavedPlayer, type SavedPlayerAction, type SavedPlayersDto } from '../contracts'

export interface SavedState extends SavedPlayersDto {
  status: 'idle' | 'loading' | 'ready' | 'error'
}

export const sameSavedPlayer = (a: { platformId: string; puuid: string }, b: { platformId: string; puuid: string }) =>
  a.platformId === b.platformId && a.puuid === b.puuid

/** A saved entry from a tab's identity and the best label known for it. */
export function toSavedPlayer(platformId: string, puuid: string, label: PlayerLabel): SavedPlayer | null {
  if (!platformId || !puuid || !label.gameName) return null
  return { platformId, puuid, gameName: label.gameName, tagLine: label.tagLine ?? '', profileIconId: label.profileIconId ?? null }
}

/**
 * Players kept on this computer: the last signed-in account, favorites and recent
 * searches. Independent of the client connection, so the page can list them (and
 * the header star can show) while League is closed.
 */
export class SavedPlayers {
  private state: SavedState = { status: 'idle', account: null, favorites: [], searchHistory: [] }
  private listeners = new Set<() => void>()
  private loading: Promise<void> | null = null

  constructor(private readonly api: MatchHistoryApi = matchHistoryApi) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<SavedState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }

  /** Loads once; later calls reuse the result. `force` re-reads (e.g. after sign-in saved the account). */
  load(force = false): Promise<void> {
    if (this.loading && !force) return this.loading
    if (this.state.status === 'idle') this.set({ status: 'loading' })
    this.loading = this.api.saved().then(
      saved => this.set({ status: 'ready', ...normalize(saved) }),
      () => {
        if (this.state.status !== 'ready') this.set({ status: 'error' })
      }
    )
    return this.loading
  }

  isFavorite(ref: { platformId: string; puuid: string }) {
    return this.state.favorites.some(item => sameSavedPlayer(item, ref))
  }

  /** Applies a change; resolves to an error code, or null on success. */
  async update(action: SavedPlayerAction, item?: SavedPlayer, index?: number): Promise<string | null> {
    try {
      const saved = await this.api.updateSaved(action, item, index)
      this.set({ status: 'ready', ...normalize(saved) })
      return null
    } catch (error) {
      return errorCode(error)
    }
  }

  toggleFavorite(item: SavedPlayer) {
    return this.update(this.isFavorite(item) ? 'favoriteRemove' : 'favoriteAdd', item)
  }

  /**
   * A tab loaded fresh names or icon for a player: update the saved copies when they
   * differ. Players that are not saved anywhere cost no request.
   */
  refreshLabels(item: SavedPlayer) {
    const { account, favorites, searchHistory } = this.state
    const stale = [account, ...favorites, ...searchHistory].some(
      saved =>
        saved &&
        sameSavedPlayer(saved, item) &&
        (saved.gameName !== item.gameName || saved.tagLine !== item.tagLine || (saved.profileIconId ?? null) !== (item.profileIconId ?? null))
    )
    if (stale) void this.update('refreshLabels', item)
  }
}

function normalize(saved: SavedPlayersDto): SavedPlayersDto {
  return { account: saved?.account ?? null, favorites: saved?.favorites ?? [], searchHistory: saved?.searchHistory ?? [] }
}

export const savedPlayers = new SavedPlayers()

export function useSavedPlayers() {
  return useSyncExternalStore(savedPlayers.subscribe, savedPlayers.getSnapshot, savedPlayers.getSnapshot)
}
