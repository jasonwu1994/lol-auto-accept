import { matchHistoryApi, type MatchHistoryApi } from '../api'
import { errorCode, type MatchHistoryContextDto } from '../contracts'
import { RuntimeRegistry, sharedRepository, TabRuntime } from './runtime'
import { tabsActions, type TabsState } from './tabs'

export interface ContextState {
  status: 'idle' | 'loading' | 'ready' | 'disconnected' | 'error'
  /** Scope the backend confirmed; tabs and runtimes only exist for this scope. */
  scope: string | null
  context: MatchHistoryContextDto | null
  error: string | null
}

export interface SnapshotLike {
  connection?: string
  connectionGeneration?: number
  phase?: string
  currentSummoner?: { puuid?: string } | null
  gameflowSession?: {
    gameData?: { teamOne?: Array<{ puuid?: string }>; teamTwo?: Array<{ puuid?: string }> }
  } | null
}

interface StoreLike {
  dispatch: (action: unknown) => unknown
  getState: () => { MatchHistoryReducer: TabsState; ConfigReducer?: { matchHistory?: { refreshAfterGame?: boolean; pageSize?: number } } }
  subscribe: (listener: () => void) => () => void
}

const CLOSED = new Set(['Disconnected', 'Discovering', 'Reconnecting', 'ShuttingDown'])
const END_PHASES = new Set(['PreEndOfGame', 'EndOfGame'])
const CONTEXT_RETRIES = 10
const CONTEXT_RETRY_MS = 1000

/**
 * Owns the match-history AuthScope (connection generation + account). A gameflow
 * phase change is not an account change, so reading tabs survive champion select
 * and games; disconnects and account switches clear every tab, runtime and cache.
 */
export class MatchHistoryLifecycle {
  private state: ContextState = { status: 'idle', scope: null, context: null, error: null }
  private listeners = new Set<() => void>()
  private store: StoreLike | null = null
  private observedKey: string | null = null
  private phase: string | null = null
  private gamePlayers = new Set<string>()
  private request = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined = undefined
  readonly registry: RuntimeRegistry

  constructor(private readonly api: MatchHistoryApi = matchHistoryApi) {
    this.registry = new RuntimeRegistry(
      (_, ref, scope) => new TabRuntime({ api: this.api, ref, scope, sgp: () => this.sgpUsable(ref.platformId) })
    )
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  /** SGP reads only target the connected client's own server. */
  private sgpUsable(platformId: string) {
    const context = this.state.context
    return !!context?.capabilities?.sgp?.available && context.platformId === platformId
  }

  private set(patch: Partial<ContextState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }

  attach(store: StoreLike) {
    this.store = store
    // Closing a tab in the UI disposes its runtime (and its queued work). Most actions
    // (snapshots, settings) leave the tab list untouched, so only a new list is scanned.
    let tabs: unknown = null
    store.subscribe(() => {
      const current = store.getState().MatchHistoryReducer.tabs
      if (current === tabs) return
      tabs = current
      this.registry.retain(new Set(current.map(tab => tab.id)))
    })
  }

  private clear(scope: string | null) {
    this.registry.disposeAll()
    sharedRepository.clear()
    this.store?.dispatch(tabsActions.reset(scope))
  }

  observe(snapshot: SnapshotLike) {
    const connection = snapshot.connection ?? 'Disconnected'
    const generation = snapshot.connectionGeneration ?? 0
    const puuid = snapshot.currentSummoner?.puuid
    if (snapshot.gameflowSession?.gameData) {
      const { teamOne = [], teamTwo = [] } = snapshot.gameflowSession.gameData
      const players = [...teamOne, ...teamTwo].map(player => player.puuid).filter((id): id is string => !!id)
      if (players.length) this.gamePlayers = new Set(players)
    }
    if (CLOSED.has(connection)) {
      if (this.observedKey !== null || this.state.status !== 'disconnected') {
        this.observedKey = null
        this.request++
        clearTimeout(this.retryTimer)
        this.clear(null)
        this.set({ status: 'disconnected', scope: null, context: null, error: null })
      }
      this.phase = null
      return
    }
    if (connection === 'Connected' && puuid) {
      const key = `${generation}:${puuid}`
      if (key !== this.observedKey) {
        this.observedKey = key
        if (this.state.scope !== null && this.state.scope !== key) this.clear(null)
        void this.load(key)
      }
      this.observePhase(snapshot.phase ?? 'None')
    }
    // 'Connecting' on the same generation is a re-read after a phase change: keep everything.
  }

  private observePhase(phase: string) {
    const previous = this.phase
    this.phase = phase
    if (!previous || END_PHASES.has(previous) || !END_PHASES.has(phase)) return
    const config = this.store?.getState().ConfigReducer?.matchHistory
    if (config?.refreshAfterGame === false) return
    const tabs = this.store?.getState().MatchHistoryReducer.tabs ?? []
    for (const tab of tabs) {
      if (this.gamePlayers.has(tab.puuid)) void this.registry.peek(tab.id)?.refreshAfterGame(config?.pageSize ?? 20)
    }
  }

  async load(expected: string, attempt = 0) {
    const request = ++this.request
    clearTimeout(this.retryTimer)
    this.set({ status: 'loading', error: null })
    // The snapshot already says this account is connected, so a context that is not
    // ready yet (or still reports the previous scope) is a short race: ask again a few
    // times instead of showing "not connected" until the next account change.
    const again = () => {
      if (attempt < CONTEXT_RETRIES) this.retryTimer = setTimeout(() => request === this.request && void this.load(expected, attempt + 1), CONTEXT_RETRY_MS)
      else this.set({ status: 'error', error: 'ContextUnavailable' })
    }
    try {
      const context = await this.api.context()
      if (request !== this.request) return
      if (!context.connected || !context.scope || context.scope !== expected) {
        again()
        return
      }
      if (this.state.scope !== context.scope) this.clear(context.scope)
      this.set({ status: 'ready', scope: context.scope, context, error: null })
    } catch (error) {
      if (request !== this.request) return
      const code = errorCode(error)
      if (code === 'StaleSession' || code === 'Disconnected') again()
      else this.set({ status: 'error', error: code })
    }
  }

  retry() {
    if (this.observedKey) void this.load(this.observedKey)
  }
}

export const lifecycle = new MatchHistoryLifecycle()
