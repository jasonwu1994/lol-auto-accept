import { useSyncExternalStore } from 'react'
import { matchHistoryApi, type MatchHistoryApi } from '../api'
import type { GameDataKind } from '../contracts'

/**
 * Client game data for one AuthScope (names and icon paths in the client's locale),
 * plus Tencent's augment tooltips. Loaded on demand, kept until the scope changes.
 */
export interface ItemData {
  id: number
  name: string
  description: string
  iconPath: string
  price: number
  priceTotal: number
  from: number[]
  to: number[]
}
export interface SpellData {
  id: number
  name: string
  description: string
  iconPath: string
  cooldown?: number
  summonerLevel?: number
}
export interface PerkData {
  id: number
  name: string
  iconPath: string
  shortDesc?: string
  longDesc?: string
  endOfGameStatDescs?: string[]
}
export interface PerkStyleData {
  id: number
  name: string
  iconPath: string
  tooltip?: string
}
export interface QueueData {
  id: number
  name: string
  shortName?: string
  description?: string
  gameMode?: string
}
export interface MapData {
  id: number
  name: string
  mapStringId?: string
}
export interface AugmentData {
  id: number
  nameTRA: string
  augmentSmallIconPath?: string
  rarity?: string
}
export interface ChampionData {
  id: number
  name: string
  alias?: string
  squarePortraitPath?: string
}
export interface MutatorData {
  MapNameBase?: string
  Mutators?: Array<{ Mutator?: { ExpandedMutator?: string }; MapNameOverride?: string }>
}

export interface GameDataState {
  scope: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: Record<number, ItemData>
  spells: Record<number, SpellData>
  perks: Record<number, PerkData>
  perkstyles: Record<number, PerkStyleData>
  queues: Record<number, QueueData>
  maps: Record<number, MapData>
  augments: Record<number, AugmentData>
  champions: Record<number, ChampionData>
  mutators: Record<number, MutatorData>
  augmentTooltips: Record<number, string>
  augmentTextAge: number | null
  /** Live client queues (`/lol-game-queues`): map and mode for the mode icons. */
  gameQueues: Record<number, { id: number; mapId?: number; gameMode?: string; name?: string }>
  /** `${mapId}_${gameMode}` → game-select icon path (upstream QueueSelect). */
  modeIcons: Record<string, string>
  failed: GameDataKind[]
}

const empty = (scope: string | null): GameDataState => ({
  scope,
  status: 'idle',
  items: {},
  spells: {},
  perks: {},
  perkstyles: {},
  queues: {},
  maps: {},
  augments: {},
  champions: {},
  mutators: {},
  augmentTooltips: {},
  augmentTextAge: null,
  gameQueues: {},
  modeIcons: {},
  failed: []
})

/** First `game-select-icon-hover` per map and mode, as upstream picks it. */
export function modeIconMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [mapId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    for (const item of list as Array<{ gameMode?: string; assets?: Record<string, string> }>) {
      const key = `${mapId}_${item?.gameMode}`
      const icon = item?.assets?.['game-select-icon-hover']
      if (out[key] || !icon) continue
      out[key] = icon.startsWith('/') ? icon : `/${icon}`
    }
  }
  return out
}

const byId = <T extends { id: number }>(list: unknown): Record<number, T> => {
  const values = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list) : []
  const out: Record<number, T> = {}
  for (const value of values as T[]) if (value && typeof value.id === 'number') out[value.id] = value
  return out
}

const AUGMENT_TEXT_RETRY_MS = 30_000

export class GameDataStore {
  private state = empty(null)
  private listeners = new Set<() => void>()
  private loading: Promise<void> | null = null
  private augmentText: Promise<void> | null = null

  constructor(private readonly api: MatchHistoryApi = matchHistoryApi) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.state

  private set(patch: Partial<GameDataState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }

  ensure(scope: string | null) {
    if (!scope) {
      if (this.state.scope !== null) this.set(empty(null))
      return
    }
    if (this.state.scope === scope && this.state.status !== 'idle' && this.state.status !== 'error') return
    if (this.state.scope !== scope) this.set(empty(scope))
    this.ensureAugmentText()
    this.loading = this.load(scope)
  }

  private async load(scope: string) {
    this.set({ status: 'loading' })
    const kinds: GameDataKind[] = ['items', 'summoner-spells', 'perks', 'perkstyles', 'queues', 'maps', 'cherry-augments', 'champion-summary', 'game-mode-mutators', 'map-assets', 'game-queues']
    const results = await Promise.allSettled(kinds.map(kind => this.api.gameData(scope, kind)))
    if (this.state.scope !== scope) return
    const value = (index: number) => (results[index].status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<unknown>).value : null)
    const styles = value(3) as { styles?: unknown } | null
    const mutators: Record<number, MutatorData> = {}
    const rawMutators = value(8)
    // The client serves a list of `{ MapId, ... }`; keep an object form working too.
    if (Array.isArray(rawMutators)) {
      for (const entry of rawMutators as Array<MutatorData & { MapId?: number }>) if (typeof entry?.MapId === 'number') mutators[entry.MapId] = entry
    } else if (rawMutators && typeof rawMutators === 'object') {
      for (const [id, entry] of Object.entries(rawMutators as Record<string, MutatorData>)) mutators[Number(id)] = entry
    }
    this.set({
      status: results.every(result => result.status === 'rejected') ? 'error' : 'ready',
      items: byId(value(0)),
      spells: byId(value(1)),
      perks: byId(value(2)),
      perkstyles: byId(styles?.styles ?? styles),
      queues: byId(value(4)),
      maps: byId(value(5)),
      augments: byId(value(6)),
      champions: byId(value(7)),
      mutators,
      modeIcons: modeIconMap(value(9)),
      gameQueues: byId(value(10)),
      failed: kinds.filter((_, index) => results[index].status === 'rejected')
    })
  }

  private ensureAugmentText() {
    if (this.augmentText) return
    this.augmentText = this.api
      .augmentText()
      .then(text => {
        const tooltips: Record<number, string> = {}
        for (const entry of text.entries) tooltips[entry.id] = entry.tooltip
        this.set({ augmentTooltips: tooltips, augmentTextAge: text.ageSeconds })
      })
      .catch(() => {
        // The page renders without augment descriptions meanwhile; try again shortly
        // instead of waiting for the next account or connection change.
        setTimeout(() => {
          this.augmentText = null
          if (this.state.scope) this.ensureAugmentText()
        }, AUGMENT_TEXT_RETRY_MS)
      })
  }
}

export const gameData = new GameDataStore()

export function useGameData() {
  return useSyncExternalStore(gameData.subscribe, gameData.getSnapshot, gameData.getSnapshot)
}

export const championIconPath = (id: number) => `/lol-game-data/assets/v1/champion-icons/${id}.png`
export const profileIconPath = (id: number | undefined) =>
  id === undefined || id === null ? undefined : `/lol-game-data/assets/v1/profile-icons/${id}.jpg`

/** Upstream `resources` accessors with the same fallbacks. */
export function resources(data: GameDataState, t: (key: string, options?: Record<string, unknown>) => string, language: string) {
  return {
    championName(id: number) {
      if (id === -3) return t('common.champions.bravery')
      if (id === -1) return data.champions[id]?.name || t('common.champions.dummy')
      return data.champions[id]?.name || String(id)
    },
    queueName(id: number) {
      return data.queues[id]?.name || String(id)
    },
    mapName(id: number, gameModeMutators?: string[] | null) {
      const mutators = data.mutators[id]
      if (!mutators) return data.maps[id]?.name || String(id)
      const mutator = mutators.Mutators?.find(m =>
        gameModeMutators?.some(g => m.Mutator?.ExpandedMutator?.toLowerCase() === g.toLowerCase())
      )
      return mutator?.MapNameOverride || mutators.MapNameBase || data.maps[id]?.name || String(id)
    },
    perkName(id: number) {
      return data.perks[id]?.name || String(id)
    },
    spellName(id: number) {
      return data.spells[id]?.name || String(id)
    },
    augmentName(id: number) {
      return data.augments[id]?.nameTRA || String(id)
    },
    /**
     * Upstream shows Tencent's text only for its zh-CN UI. The Traditional Chinese UI
     * shows the same (Simplified) Tencent text unchanged; the English UI shows none,
     * since that source has no English description.
     */
    augmentTooltip(id: number) {
      return language === 'en' ? undefined : data.augmentTooltips[id] || undefined
    }
  }
}

export type Resources = ReturnType<typeof resources>
