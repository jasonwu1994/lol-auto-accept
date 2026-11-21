import type { MatchHistoryApi } from '../api'
import { type CollectionCountDto, errorCode, type PlayerRef, type ProfileDto, type RawGame, type ReplayMetadata } from '../contracts'
import type { Predicate } from '../upstream/data-adapter/predicates/combinators'
import type { LcuGameSummary, LcuOrSgpGameDetails, LcuOrSgpGameSummary, SgpGameSummary } from '../upstream/data-adapter/wrapper'
import type { Mastery, PlayerChampionMastery } from '../upstream/types/league-client/champion-mastery'
import type { Game } from '../upstream/types/league-client/match-history'
import type { RankedStats } from '../upstream/types/league-client/ranked'
import {
  MATCH_HISTORY_COLLECTION_MAX_SCAN_COUNT,
  MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE
} from '../upstream/player-tab/page-size-options'
import { createRepository, type Repository, TaskQueue } from './repository'

export const PROFILE_TTL = 120_000
export const RANKED_TTL = 30_000
export const PAGE_TTL = 30_000
export const CHAMPION_MASTERY_TOP_COUNT = 8

export type Status = 'idle' | 'loading' | 'ready' | 'error'

export interface Resource<T> {
  status: Status
  data: T | null
  error: string | null
  loadedAt: number
}

const idle = <T>(): Resource<T> => ({ status: 'idle', data: null, error: null, loadedAt: 0 })

export interface PageQuery {
  startIndex: number
  count: number
  /** SGP queue tag (`ranked`, `normal`, `q_<id>`); undefined = all modes. */
  tag?: string
}

export type HistorySource = 'lcu' | 'sgp'

/** SGP errors after which the tab falls back to LCU (when no queue tag is needed). */
const SGP_FALLBACK = new Set(['SgpUnavailable', 'SgpUnauthorized', 'SgpTokenNotReady', 'Unsupported', 'RateLimited', 'InvalidInput'])
// Replay downloads: poll once a second for up to 10 minutes; the client may report
// "download" for the first few polls after accepting the request.
/** Newest games read on refresh. Two cover the usual single new game; SGP answers 2 in ~0.9 s against ~1.7 s for 20. */
const REFRESH_PROBE_COUNT = 2
const REPLAY_POLL_MS = 1000
const REPLAY_MAX_POLLS = 600
const REPLAY_START_POLLS = 3
const REPLAY_PENDING = new Set(['checking', 'found', 'downloading'])

export interface CollectSettings {
  countPerIteration: number
  expectedCount: number
  maxIteration: number
}

export interface TabPage {
  games: LcuOrSgpGameSummary[]
  query: PageQuery
  source: HistorySource
  loadedAt: number
  isCollect: boolean
  collectSettings?: CollectSettings
  scanned?: number
  /** Raw summaries the client returned but whose complete game could not be read. */
  incomplete: string[]
  /** The list ends with the player's oldest game (fewer games than asked for). */
  exhausted?: boolean
  /** Shown from the disk cache; the newest games are being checked. */
  fromCache?: boolean
}

export interface CollectState {
  iteration: number
  settings: CollectSettings
  stopping: boolean
}

export interface TabData {
  profile: Resource<ProfileDto>
  ranked: Resource<RankedStats>
  mastery: Resource<PlayerChampionMastery>
  /** SGP only (upstream has no LCU source); stays idle when SGP is not usable. */
  collection: Resource<CollectionCountDto[]>
  page: TabPage | null
  pageStatus: Status
  pageError: string | null
  details: Record<string, LcuOrSgpGameDetails>
  detailsLoading: Record<string, boolean>
  detailsError: Record<string, string>
  replays: Record<string, ReplayMetadata>
  collect: CollectState | null
  /** Game key the list should scroll to and open (the game that just ended); cleared once shown. */
  focus: string | null
}

export const gameKey = (summary: { gameId: number }) => String(summary.gameId)

/** Backend IDs are decimal strings; upstream adapters expect numbers. LoL game IDs are safe integers. */
export function toLcuSummary(raw: RawGame): LcuGameSummary | null {
  const id = typeof raw.gameId === 'string' ? Number(raw.gameId) : raw.gameId
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { source: 'lcu', gameId: id, data: { ...(raw as unknown as Game), gameId: id } }
}

export function toSgpSummary(raw: SgpGameSummary['data']): SgpGameSummary | null {
  const id = raw?.json?.gameId
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { source: 'sgp', gameId: id, data: raw }
}

export type SharedRepository = Repository<LcuGameSummary, LcuOrSgpGameDetails>

export const sharedRepository: SharedRepository = createRepository()

export interface RuntimeOptions {
  api: MatchHistoryApi
  scope: string
  ref: PlayerRef
  repository?: SharedRepository
  now?: () => number
  replays?: boolean
  /** Whether same-server SGP reads are usable for this tab (checked on every load). */
  sgp?: () => boolean
}

/**
 * Data for one player tab. Every async result is published only if the runtime is
 * still alive and its request revision is still the latest, so slow responses never
 * overwrite a newer query, another player or another account.
 */
export class TabRuntime {
  private data: TabData = {
    profile: idle(),
    ranked: idle(),
    mastery: idle(),
    collection: idle(),
    page: null,
    pageStatus: 'idle',
    pageError: null,
    details: {},
    detailsLoading: {},
    detailsError: {},
    replays: {},
    collect: null,
    focus: null
  }
  private listeners = new Set<() => void>()
  private pageRevision = 0
  /** The last regular page asked for, queue tag included, so refreshes repeat it exactly. */
  private lastQuery: PageQuery | null = null
  private disposed = false
  private readonly api: MatchHistoryApi
  private readonly repository: SharedRepository
  private readonly now: () => number
  private readonly detailsQueue = new TaskQueue(5)
  private readonly replayQueue = new TaskQueue(5)
  private replayPolls = new Map<string, ReturnType<typeof setTimeout>>()
  readonly scope: string
  readonly ref: PlayerRef
  replaysEnabled: boolean

  constructor(options: RuntimeOptions) {
    this.api = options.api
    this.scope = options.scope
    this.ref = options.ref
    this.repository = options.repository ?? sharedRepository
    this.now = options.now ?? Date.now
    this.replaysEnabled = options.replays ?? true
    this.sgpEnabled = options.sgp ?? (() => false)
  }

  private readonly sgpEnabled: () => boolean
  /** Set after an SGP failure; this tab then reads LCU until it is reopened. */
  private sgpFailed = false

  /** Source the next page load will use (upstream: preferred SGP, LCU fallback). */
  get source(): HistorySource {
    return this.sgpEnabled() && !this.sgpFailed ? 'sgp' : 'lcu'
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.data

  get isDisposed() {
    return this.disposed
  }

  private set(patch: Partial<TabData>) {
    if (this.disposed) return
    this.data = { ...this.data, ...patch }
    this.listeners.forEach(listener => listener())
  }

  private setRecord<K extends 'details' | 'detailsLoading' | 'detailsError' | 'replays'>(
    key: K,
    id: string,
    value: TabData[K][string] | undefined
  ) {
    const next = { ...this.data[key] } as Record<string, unknown>
    if (value === undefined) delete next[id]
    else next[id] = value
    this.set({ [key]: next } as Partial<TabData>)
  }

  dispose() {
    this.disposed = true
    this.pageRevision++
    this.detailsQueue.clear()
    this.replayQueue.clear()
    this.replayPolls.forEach(timer => clearTimeout(timer))
    this.replayPolls.clear()
    this.listeners.clear()
  }

  private async resource<K extends 'profile' | 'ranked' | 'mastery' | 'collection'>(
    key: K,
    ttl: number,
    force: boolean,
    load: () => Promise<TabData[K]['data']>
  ) {
    const current = this.data[key]
    if (current.status === 'loading') return
    if (!force && current.status === 'ready' && this.now() - current.loadedAt < ttl) return
    // Keep the previous value visible while refreshing (local loading only).
    this.set({ [key]: { ...current, status: 'loading', error: null } } as Partial<TabData>)
    try {
      const data = await load()
      this.set({ [key]: { status: 'ready', data, error: null, loadedAt: this.now() } } as Partial<TabData>)
    } catch (error) {
      this.set({ [key]: { ...this.data[key], status: 'error', error: errorCode(error) } } as Partial<TabData>)
    }
  }

  loadProfile(force = false) {
    return this.resource('profile', PROFILE_TTL, force, () => this.api.profile(this.scope, this.ref.puuid))
  }

  loadRanked(force = false) {
    return this.resource('ranked', RANKED_TTL, force, () => this.api.ranked(this.scope, this.ref.puuid))
  }

  loadMastery(force = false) {
    return this.resource('mastery', Infinity, force, () =>
      this.api.masteryTop(this.scope, this.ref.puuid, CHAMPION_MASTERY_TOP_COUNT)
    )
  }

  loadCollection(force = false) {
    if (!this.sgpEnabled()) return Promise.resolve()
    return this.resource('collection', Infinity, force, () => this.api.collection(this.scope, this.ref.puuid))
  }

  private allMastery: Promise<Mastery[]> | null = null
  /** Full mastery list for the "view all" dialog; read once per tab. */
  loadAllMastery() {
    this.allMastery ??= this.api.mastery(this.scope, this.ref.puuid).catch(error => {
      this.allMastery = null
      throw error
    })
    return this.allMastery
  }

  /** Complete LCU game (all participants), cached across tabs; the list entry is the fallback. */
  private async complete(summary: LcuGameSummary): Promise<{ game: LcuGameSummary; complete: boolean }> {
    const key = `lcu:${summary.gameId}`
    const cached = this.repository.games.get(key)
    if (cached) return { game: cached, complete: true }
    try {
      const game = await this.repository.flights.run(`game:${key}`, async () => {
        const raw = await this.api.game(this.scope, String(summary.gameId))
        const value = toLcuSummary(raw)
        if (!value) throw new Error('Invalid game')
        this.repository.games.set(key, value)
        return value
      })
      return { game, complete: true }
    } catch {
      return { game: summary, complete: false }
    }
  }

  private async fetchLcuPage(startIndex: number, count: number) {
    const page = await this.api.page(this.scope, this.ref.puuid, startIndex, startIndex + count - 1)
    const list = (page.games?.games ?? []) as unknown as RawGame[]
    return list.map(toLcuSummary).filter((game): game is LcuGameSummary => game !== null)
  }

  /**
   * SGP first when usable. A failed SGP read without a queue tag falls back to LCU
   * for this tab; with a tag there is no LCU equivalent, so the error is shown.
   */
  private async fetchPage(
    startIndex: number,
    count: number,
    tag: string | undefined
  ): Promise<{ source: HistorySource; games: LcuOrSgpGameSummary[] }> {
    if (this.source === 'sgp') {
      try {
        const data = await this.api.sgpPage(this.scope, this.ref.puuid, startIndex, count, tag)
        const games = (data?.games ?? []).map(toSgpSummary).filter((game): game is SgpGameSummary => game !== null)
        return { source: 'sgp', games }
      } catch (error) {
        if (tag || !SGP_FALLBACK.has(errorCode(error))) throw error
        this.sgpFailed = true
      }
    }
    return { source: 'lcu', games: await this.fetchLcuPage(startIndex, count) }
  }

  private async completeAll(games: LcuOrSgpGameSummary[]) {
    return Promise.all(
      games.map(game => (game.source === 'lcu' ? this.complete(game) : Promise.resolve({ game, complete: true })))
    )
  }

  /** Same query and still fresh: nothing to do (switching tabs never re-requests). */
  isPageCurrent(query: PageQuery, ttl = Infinity) {
    const page = this.data.page
    return (
      !!page &&
      !page.isCollect &&
      page.query.startIndex === query.startIndex &&
      page.query.count === query.count &&
      page.query.tag === query.tag &&
      this.now() - page.loadedAt < ttl
    )
  }

  /**
   * First page of a newly opened tab: show the list saved on disk (finished games never
   * change), then read only the newest games through {@link refreshPage}. Returns false
   * when nothing usable is cached.
   */
  private async restoreCached(query: PageQuery, revision: number): Promise<boolean> {
    const source = this.source
    // LCU has no queue tags; a tagged list is SGP only.
    if (query.startIndex !== 0 || (source === 'lcu' && query.tag)) return false
    let cached
    try {
      cached = await this.api.cachedPage(this.scope, this.ref.puuid, source, query.tag, query.count)
    } catch {
      return false
    }
    if (revision !== this.pageRevision || !cached?.games?.length) return false
    const games: LcuOrSgpGameSummary[] = []
    for (const raw of cached.games) {
      const game = source === 'sgp' ? toSgpSummary(raw as SgpGameSummary['data']) : toLcuSummary(raw as RawGame)
      if (!game) return false
      if (game.source === 'lcu') this.repository.games.set(`lcu:${game.gameId}`, game)
      games.push(game)
    }
    this.set({
      page: { games, query, source, loadedAt: cached.savedAt, isCollect: false, incomplete: [], exhausted: cached.complete, fromCache: true },
      pageStatus: 'ready',
      pageError: null,
      details: {},
      detailsLoading: {},
      detailsError: {}
    })
    return true
  }

  /** Keeps the newest list on disk for the next start (first pages only; best effort). */
  private saveHead(page: TabPage) {
    if (page.isCollect || page.query.startIndex !== 0 || page.games.length === 0) return
    Promise.resolve()
      .then(() => this.api.saveCachedPage(this.scope, this.ref.puuid, page.source, page.query.tag, page.games.map(gameKey), !!page.exhausted))
      .catch(() => {})
  }

  async loadPage(query: PageQuery, options: { force?: boolean } = {}): Promise<void> {
    if (query.count > MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE || query.count < 1 || query.startIndex < 0) {
      throw new Error('Invalid page query')
    }
    if (!options.force && this.isPageCurrent(query, Infinity) && this.data.pageStatus !== 'error') return
    if (!options.force && !this.data.page && !this.data.collect && query.startIndex === 0) {
      const revision = ++this.pageRevision
      this.lastQuery = query
      this.set({ pageStatus: 'loading', pageError: null })
      if (await this.restoreCached(query, revision)) return this.refreshPage(query)
      if (revision !== this.pageRevision) return
    }
    this.lastQuery = query
    if (this.data.collect) this.stopCollect()
    const revision = ++this.pageRevision
    this.detailsQueue.clear()
    this.replayQueue.clear()
    this.set({ pageStatus: 'loading', pageError: null })
    try {
      const listed = await this.fetchPage(query.startIndex, query.count, query.tag)
      if (revision !== this.pageRevision) return
      const completed = await this.completeAll(listed.games)
      if (revision !== this.pageRevision) return
      const games = completed.map(item => item.game)
      // Upstream keeps details only for overlapping games from the same source.
      const details: Record<string, LcuOrSgpGameDetails> = {}
      for (const game of games) {
        const existing = this.data.details[gameKey(game)]
        if (existing && existing.source === game.source) details[gameKey(game)] = existing
      }
      const page: TabPage = {
        games,
        query: listed.source === 'sgp' ? query : { ...query, tag: undefined },
        source: listed.source,
        loadedAt: this.now(),
        isCollect: false,
        incomplete: completed.filter(item => !item.complete).map(item => gameKey(item.game)),
        exhausted: listed.games.length < query.count
      }
      this.saveHead(page)
      this.set({
        page,
        pageStatus: 'ready',
        pageError: null,
        details,
        detailsLoading: {},
        detailsError: {}
      })
      this.prefetchDetails(games, revision)
      this.loadReplays(games, revision)
    } catch (error) {
      if (revision !== this.pageRevision) return
      this.set({ pageStatus: 'error', pageError: errorCode(error) })
    }
  }

  /**
   * Refresh of the first page that reads only the newest games: finished games never change,
   * so the new ones go on top of the current list. When the newest games do not line up with
   * the list (more new games than were read, a different source, a removed game), the whole
   * page is reloaded instead.
   */
  async refreshPage(query: PageQuery): Promise<void> {
    const page = this.data.page
    const top = page?.games[0]
    if (!page || !top || query.startIndex !== 0 || this.data.pageStatus !== 'ready' || !this.isPageCurrent(query)) {
      return this.loadPage(query, { force: true })
    }
    this.lastQuery = query
    const revision = ++this.pageRevision
    this.set({ pageStatus: 'loading', pageError: null })
    try {
      const newest = await this.fetchPage(0, Math.min(REFRESH_PROBE_COUNT, query.count), query.tag)
      if (revision !== this.pageRevision) return
      const current = this.data.page!
      const at = newest.games.findIndex(game => game.gameId === top.gameId)
      const aligned =
        newest.source === current.source &&
        at >= 0 &&
        newest.games.slice(at).every((game, index) => !current.games[index] || current.games[index].gameId === game.gameId)
      if (!aligned) return this.loadPage(query, { force: true })
      const completed = await this.completeAll(newest.games.slice(0, at))
      if (revision !== this.pageRevision) return
      const added = completed.map(item => item.game)
      const games = [...added, ...current.games].slice(0, query.count)
      const kept = new Set(games.map(gameKey))
      const page: TabPage = {
        ...current,
        games,
        loadedAt: this.now(),
        fromCache: false,
        // Games pushed off the end mean older ones exist past this list.
        exhausted: current.exhausted && added.length + current.games.length <= query.count,
        incomplete: [...completed.filter(item => !item.complete).map(item => gameKey(item.game)), ...current.incomplete.filter(key => kept.has(key))]
      }
      if (added.length > 0 || current.fromCache) this.saveHead(page)
      this.set({
        page,
        pageStatus: 'ready',
        pageError: null
      })
      // The new revision dropped queued background reads; queue what is still missing.
      this.prefetchDetails(games, revision)
      this.loadReplays(games.filter(game => !this.data.replays[gameKey(game)]), revision)
    } catch (error) {
      if (revision !== this.pageRevision) return
      this.set({ pageStatus: 'error', pageError: errorCode(error) })
    }
  }

  /**
   * Upstream collect mode: scan pages, keep games matching `predicate`, stop at the
   * expected count, an empty or short page, a page without new game IDs, cancellation,
   * or 1000 scanned games. Each request is trimmed to the remaining scan budget.
   */
  async collect(settings: CollectSettings, predicate: Predicate<LcuOrSgpGameSummary>, tag?: string) {
    if (this.data.collect) return
    // A regular page still loading is superseded: the new revision discards its result.
    const revision = ++this.pageRevision
    this.detailsQueue.clear()
    this.replayQueue.clear()
    const state: CollectState = { iteration: 0, settings, stopping: false }
    const page: TabPage = {
      games: [],
      query: { startIndex: 0, count: settings.countPerIteration, tag },
      source: this.source,
      loadedAt: this.now(),
      isCollect: true,
      collectSettings: settings,
      scanned: 0,
      incomplete: []
    }
    this.set({ collect: state, page, pageStatus: 'loading', pageError: null, details: {}, detailsLoading: {}, detailsError: {}, replays: {} })
    const seen = new Set<number>()
    const alive = () => revision === this.pageRevision && !this.data.collect?.stopping && !this.disposed
    try {
      while (
        alive() &&
        this.data.page!.games.length < settings.expectedCount &&
        state.iteration < settings.maxIteration &&
        (this.data.page!.scanned ?? 0) < MATCH_HISTORY_COLLECTION_MAX_SCAN_COUNT
      ) {
        const scanned = this.data.page!.scanned ?? 0
        const count = Math.min(settings.countPerIteration, MATCH_HISTORY_COLLECTION_MAX_SCAN_COUNT - scanned)
        const start = state.iteration * settings.countPerIteration
        const fetched = await this.fetchPage(start, count, tag)
        const raw = fetched.games
        if (!alive() || raw.length === 0) break
        const fresh = raw.filter(game => !seen.has(game.gameId))
        fresh.forEach(game => seen.add(game.gameId))
        const remaining = Math.max(settings.expectedCount - this.data.page!.games.length, 0)
        const matching = fresh.filter(game => predicate(game)).slice(0, remaining)
        const completed = await this.completeAll(matching)
        if (!alive()) break
        const current = this.data.page!
        const added = completed.map(item => item.game)
        state.iteration++
        this.set({
          page: {
            ...current,
            source: fetched.source,
            query: { ...current.query, tag: fetched.source === 'sgp' ? tag : undefined },
            games: [...current.games, ...added],
            scanned: scanned + raw.length,
            incomplete: [...current.incomplete, ...completed.filter(item => !item.complete).map(item => gameKey(item.game))]
          },
          collect: { ...state }
        })
        this.prefetchDetails(added, revision)
        this.loadReplays(added, revision)
        if (fresh.length === 0 || raw.length < count) break
      }
      if (revision === this.pageRevision) this.set({ pageStatus: 'ready', collect: null })
    } catch (error) {
      if (revision === this.pageRevision) this.set({ pageStatus: 'error', pageError: errorCode(error), collect: null })
    }
  }

  stopCollect() {
    if (!this.data.collect) return
    this.detailsQueue.clear()
    this.replayQueue.clear()
    // Bumping the revision stops the loop and discards any in-flight page.
    this.pageRevision++
    this.set({ collect: null, pageStatus: this.data.page ? 'ready' : 'idle' })
  }

  /** Upstream `loadMatchHistoryByPageSize`: >200 switches to collect mode. */
  loadByPageSize(count: number, predicate: Predicate<LcuOrSgpGameSummary>) {
    const tag = this.data.page?.query.tag
    if (count <= MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE) return this.loadPage({ startIndex: 0, count, tag })
    const step = this.data.page?.query.count ?? 20
    return this.collect(
      {
        countPerIteration: step,
        expectedCount: count,
        maxIteration: Math.ceil(MATCH_HISTORY_COLLECTION_MAX_SCAN_COUNT / step)
      },
      predicate,
      tag
    )
  }

  private async fetchDetails(id: string, source: HistorySource): Promise<LcuOrSgpGameDetails> {
    const key = `${source}:${id}`
    const cached = this.repository.timelines.get(key)
    if (cached) return cached
    return this.repository.flights.run(`timeline:${key}`, async () => {
      const value: LcuOrSgpGameDetails =
        source === 'sgp'
          ? { source: 'sgp', gameId: Number(id), data: await this.api.sgpDetails(this.scope, id) }
          : { source: 'lcu', gameId: Number(id), data: await this.api.timeline(this.scope, id) }
      this.repository.timelines.set(key, value)
      return value
    })
  }

  /** Background timeline reads for the analysis (upstream loads them for every listed game). */
  private prefetchDetails(games: LcuOrSgpGameSummary[], revision: number) {
    for (const game of games) {
      const id = gameKey(game)
      if (this.data.details[id]) continue
      this.detailsQueue
        .add(async () => {
          if (revision !== this.pageRevision || this.disposed || this.data.details[id]) return
          await this.loadDetails(id)
        })
        .catch(() => {})
    }
  }

  /** User-requested (expanded card) timeline read; bypasses the background queue. */
  async loadDetails(id: string) {
    if (this.data.detailsLoading[id] || this.data.details[id]) return
    this.setRecord('detailsLoading', id, true)
    try {
      const game = this.data.page?.games.find(item => gameKey(item) === id)
      if (!game) return
      const details = await this.fetchDetails(id, game.source)
      if (!this.data.page?.games.some(item => gameKey(item) === id && item.source === details.source)) return
      this.setRecord('details', id, details)
      this.setRecord('detailsError', id, undefined)
    } catch (error) {
      this.setRecord('detailsError', id, errorCode(error))
    } finally {
      this.setRecord('detailsLoading', id, undefined)
    }
  }

  private loadReplays(games: LcuOrSgpGameSummary[], revision: number) {
    if (!this.replaysEnabled) return
    for (const game of games) {
      const id = gameKey(game)
      this.replayQueue
        .add(async () => {
          if (revision !== this.pageRevision || this.disposed) return
          // Upstream: SGP games carry their own version and end time.
          const meta =
            game.source === 'sgp'
              ? {
                  gameVersion: game.data.json.gameVersion,
                  gameType: game.data.json.gameType,
                  queueId: game.data.json.queueId,
                  gameEnd: game.data.json.gameEndTimestamp
                }
              : {
                  gameType: game.data.gameType,
                  queueId: game.data.queueId,
                  gameEnd: game.data.gameCreation + game.data.gameDuration * 1000
                }
          try {
            const metadata = await this.api.createReplayMetadata(this.scope, id, meta)
            if (revision === this.pageRevision) this.setRecord('replays', id, metadata)
          } catch (error) {
            // Replays turned off or unsupported for this game: the card shows no replay state.
            if (errorCode(error) === 'StaleSession') throw error
          }
        })
        .catch(() => {})
    }
  }

  /**
   * Watch resolves once the client accepts the request. Download shows as downloading at
   * once and resolves when the replay can be watched; it rejects when the client stops
   * without one. A closed tab stops polling and leaves the promise unsettled.
   */
  async replayAction(id: string, action: 'download' | 'watch'): Promise<ReplayMetadata> {
    const previous = this.data.replays[id]
    if (action === 'download' && previous) this.setRecord('replays', id, { ...previous, state: 'downloading', downloadProgress: 0 })
    let metadata: ReplayMetadata
    try {
      metadata = await this.api.replayAction(this.scope, id, action)
    } catch (error) {
      if (previous) this.setRecord('replays', id, previous)
      throw error
    }
    if (action === 'watch') {
      this.setRecord('replays', id, metadata)
      return metadata
    }
    return this.followDownload(id, metadata, 0)
  }

  private followDownload(id: string, metadata: ReplayMetadata, polls: number): Promise<ReplayMetadata> {
    // The client can still report "download" for a moment after accepting the request.
    const starting = metadata.state === 'download' && polls < REPLAY_START_POLLS
    if (metadata.state === 'watch' || !(starting || REPLAY_PENDING.has(metadata.state))) {
      this.setRecord('replays', id, metadata)
      return metadata.state === 'watch'
        ? Promise.resolve(metadata)
        : Promise.reject({ code: 'ReplayUnavailable', message: metadata.state })
    }
    this.setRecord('replays', id, starting ? { ...metadata, state: 'downloading', downloadProgress: 0 } : metadata)
    if (polls >= REPLAY_MAX_POLLS) return Promise.reject({ code: 'Timeout', message: 'Timeout' })
    return new Promise((resolve, reject) => {
      clearTimeout(this.replayPolls.get(id))
      if (this.disposed) return
      this.replayPolls.set(
        id,
        setTimeout(() => {
          this.replayPolls.delete(id)
          this.api.replayState(this.scope, id).then(state => {
            if (!state.metadata) throw { code: 'ReplayUnavailable', message: 'disabled' }
            return this.followDownload(id, state.metadata, polls + 1)
          }).then(resolve, error => {
            if (this.data.replays[id]?.state === 'downloading') this.setRecord('replays', id, { ...metadata, state: 'download', downloadProgress: 0 })
            reject(error)
          })
        }, REPLAY_POLL_MS)
      )
    })
  }

  /**
   * Manual refresh: mutable player data and the current list; finished games stay cached.
   * Resolves once every load has settled, to the first error code, or null when all succeeded.
   */
  async refresh(): Promise<string | null> {
    const page = this.data.page
    await Promise.all([
      this.loadProfile(true),
      this.loadRanked(true),
      this.loadMastery(true),
      this.loadCollection(true),
      page?.isCollect ? undefined : this.refreshPage(this.lastQuery ?? page?.query ?? { startIndex: 0, count: 20 })
    ])
    const { profile, ranked, mastery, collection, pageError } = this.data
    return pageError ?? [profile, ranked, mastery, collection].find(resource => resource.status === 'error')?.error ?? null
  }

  /**
   * After a game ends: upstream reloads only when the tab shows the first page. When the
   * refresh brings in a newer game, it becomes {@link TabData.focus} so the list opens it.
   */
  async refreshAfterGame(defaultCount: number): Promise<void> {
    if (this.data.page?.isCollect) return
    const query = this.lastQuery ?? { startIndex: 0, count: defaultCount }
    if (query.startIndex !== 0) return
    void this.loadRanked(true)
    const before = this.data.page?.games[0]?.gameId
    await this.refreshPage(query)
    const page = this.data.page
    const top = page?.games[0]
    // Another load (queue, page, manual refresh) replaced this one: its list is not ours to judge.
    if (this.disposed || this.lastQuery !== query || !page || page.isCollect || this.data.pageStatus !== 'ready' || !top) return
    // New only when the previous newest game now sits below it; a vanished one (reload) is not a new game.
    const isNew = before === undefined || page.games.findIndex(game => game.gameId === before) > 0
    if (isNew && top.gameId !== before) this.set({ focus: gameKey(top) })
  }

  /** The list has shown {@link TabData.focus} (or given up on it). */
  clearFocus() {
    if (this.data.focus !== null) this.set({ focus: null })
  }
}

/** Live runtimes by tab id. Closing a tab or changing scope disposes its runtime. */
export class RuntimeRegistry {
  private runtimes = new Map<string, TabRuntime>()
  constructor(private readonly create: (id: string, ref: PlayerRef, scope: string) => TabRuntime) {}
  get(id: string, ref: PlayerRef, scope: string) {
    let runtime = this.runtimes.get(id)
    if (runtime && runtime.scope !== scope) {
      runtime.dispose()
      runtime = undefined
    }
    if (!runtime) {
      runtime = this.create(id, ref, scope)
      this.runtimes.set(id, runtime)
    }
    return runtime
  }
  peek(id: string) {
    return this.runtimes.get(id)
  }
  retain(ids: Set<string>) {
    for (const [id, runtime] of this.runtimes) {
      if (!ids.has(id)) {
        runtime.dispose()
        this.runtimes.delete(id)
      }
    }
  }
  disposeAll() {
    this.retain(new Set())
  }
  forEach(callback: (runtime: TabRuntime, id: string) => void) {
    this.runtimes.forEach(callback)
  }
  get size() {
    return this.runtimes.size
  }
}
