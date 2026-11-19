import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { gameData } from './assets/gameData'
import type { PlayerLabel, SavedPlayer } from './contracts'
import { lifecycle } from './state/lifecycle'
import { DEFAULT_VIEW, queueTag, tabsActions, type TabsState, type TimeRange } from './state/tabs'
import { PlayerRow, PlayerSearch } from './components/PlayerSearch'
import { savedPlayers, useSavedPlayers } from './state/saved'
import { PlayerTabPanel } from './components/PlayerTabPanel'
import { PlayerTabStrip } from './components/PlayerTabStrip'
import { ClockProvider, Spinner, useMh } from './components/primitives'
import { DisconnectOutlined } from '@ant-design/icons'
import type { PlayerLink } from './components/MatchCard'
import './match-history.css'

interface RootState {
  MatchHistoryReducer: TabsState
  ConfigReducer: { matchHistory?: { pageSize?: number; keepSearchHistory?: boolean; defaultQueue?: string; defaultTimeRange?: TimeRange; showPractice?: boolean; showIrregularGames?: boolean } }
}

function useTabLoading(state: TabsState) {
  // Tab strip spinner: subscribe to each tab runtime's page status.
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = state.tabs.map(tab => lifecycle.registry.peek(tab.id)?.subscribe(listener))
      return () => stops.forEach(stop => stop?.())
    },
    [state.tabs]
  )
  const snapshot = () =>
    state.tabs
      .map(tab => {
        const data = lifecycle.registry.peek(tab.id)?.getSnapshot()
        return data && (data.pageStatus === 'loading' || data.profile.status === 'loading') ? '1' : '0'
      })
      .join('')
  const key = useSyncExternalStore(subscribe, snapshot, snapshot)
  return useMemo(() => Object.fromEntries(state.tabs.map((tab, index) => [tab.id, key[index] === '1'])), [key, state.tabs])
}

/** A player picked while the client was closed; opened once it connects on the same server. */
let pendingOpen: SavedPlayer | null = null

function OfflineHome({ keepHistory, pending, onPick }: { keepHistory: boolean; pending: SavedPlayer | null; onPick: (player: SavedPlayer) => void }) {
  const { t } = useMh()
  const saved = useSavedPlayers()
  const account = saved.account
  return (
    <div className="mh-offline mh-scroll">
      <div className="mh-offline-inner">
        <div className="mh-offline-banner">
          <DisconnectOutlined className="text-lg" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-base font-bold">{t('playerTabs.shell.disconnectedTitle')}</div>
            <div className="text-sm text-black/60 dark:text-white/60">{t('playerTabs.shell.offlineHint')}</div>
          </div>
        </div>
        {pending && (
          <div className="mh-offline-pending" role="status">
            {t('playerTabs.shell.pendingOpen', { name: pending.tagLine ? `${pending.gameName}#${pending.tagLine}` : pending.gameName })}
          </div>
        )}
        {account && (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-black/60 dark:text-white/60">{t('playerTabs.shell.myAccount')}</div>
            <PlayerRow player={account} platformId={null} onOpen={onPick} sub={<span className="mh-server-chip">{account.platformId}</span>} />
          </div>
        )}
        <PlayerSearch scope={null} platformId={account?.platformId ?? null} keepHistory={keepHistory} onOpen={onPick} />
      </div>
    </div>
  )
}

export default function MatchHistoryPage() {
  const { t } = useMh()
  const dispatch = useDispatch()
  const context = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot)
  const tabs = useSelector((state: RootState) => state.MatchHistoryReducer)
  const config = useSelector((state: RootState) => state.ConfigReducer.matchHistory) ?? {}
  const [searchOpen, setSearchOpen] = useState(false)
  const searchPanel = useRef<HTMLDivElement>(null)
  // A press outside the panel (other than its toggle button, which closes it itself) or Esc closes it.
  useEffect(() => {
    if (!searchOpen) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || searchPanel.current?.contains(target) || target.closest?.('[data-mh-search-toggle]')) return
      setSearchOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [searchOpen])
  const [pending, setPending] = useState<SavedPlayer | null>(pendingOpen)
  const pick = useCallback((player: SavedPlayer | null) => {
    pendingOpen = player
    setPending(player)
  }, [])
  const loading = useTabLoading(tabs)
  // Mount a tab's panel the first time it is shown, then keep it, so entering the page renders one tab instead of every open one.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())
  if (tabs.activeId && !shown.has(tabs.activeId)) setShown(new Set(shown).add(tabs.activeId))
  const ready = context.status === 'ready' && !!context.scope && tabs.scope === context.scope
  const me = context.context?.me
  const platformId = context.context?.platformId ?? ''
  const defaults = useMemo(
    () => ({ ...DEFAULT_VIEW, pageSize: config.pageSize ?? DEFAULT_VIEW.pageSize, queue: queueTag(config.defaultQueue), timeRange: config.defaultTimeRange ?? 'all', showPractice: !!config.showPractice, showIrregular: !!config.showIrregularGames }),
    [config.pageSize, config.defaultQueue, config.defaultTimeRange, config.showPractice, config.showIrregularGames]
  )

  useEffect(() => {
    gameData.ensure(ready ? context.scope : null)
  }, [ready, context.scope])

  // Leaving the page ends "closed every tab" for the next visit.
  useEffect(() => () => void dispatch(tabsActions.leave()), [dispatch])

  const openSelf = useCallback(() => {
    if (!me?.puuid || !platformId) return
    dispatch(tabsActions.open({ platformId, puuid: me.puuid, isSelf: true, label: { gameName: me.gameName, tagLine: me.tagLine, profileIconId: me.profileIconId }, defaults }))
  }, [dispatch, me, platformId, defaults])

  // First visit (or returning with no tabs): open the signed-in player.
  useEffect(() => {
    if (ready && tabs.tabs.length === 0 && !tabs.selfSuppressed) openSelf()
  }, [ready, tabs.tabs.length, tabs.selfSuppressed, openSelf])

  // Saved players load without the client; re-read after sign-in, which saves the account.
  useEffect(() => {
    void savedPlayers.load(!!context.scope)
  }, [context.scope])

  // A player picked while offline opens once the client is ready on the same server.
  useEffect(() => {
    if (!ready || !pending) return
    if (pending.platformId === platformId) {
      const { gameName, tagLine, profileIconId } = pending
      dispatch(tabsActions.open({ platformId, puuid: pending.puuid, isSelf: pending.puuid === me?.puuid, label: { gameName, tagLine, profileIconId: profileIconId ?? undefined }, defaults }))
    }
    pick(null)
  }, [ready, pending, platformId, me?.puuid, defaults, dispatch, pick])

  const openPlayer: PlayerLink = useCallback(
    (puuid, activate = true, label?: PlayerLabel) => {
      if (!ready || !platformId) return
      dispatch(tabsActions.open({ platformId, puuid, isSelf: puuid === me?.puuid, activate, label, defaults }))
      setSearchOpen(false)
    },
    [dispatch, ready, platformId, me?.puuid, defaults]
  )

  const actions = useMemo(
    () => ({
      activate: (id: string) => dispatch(tabsActions.activate(id)),
      close: (id: string) => dispatch(tabsActions.close(id)),
      closeOthers: (id: string) => dispatch(tabsActions.closeOthers(id)),
      closeRight: (id: string) => dispatch(tabsActions.closeRight(id)),
      move: (id: string, toIndex: number) => dispatch(tabsActions.move({ id, toIndex })),
      refresh: (id: string) => lifecycle.registry.peek(id)?.refresh()
    }),
    [dispatch]
  )

  let body
  if (context.status === 'disconnected' || context.status === 'idle') {
    body = <OfflineHome keepHistory={config.keepSearchHistory !== false} pending={pending} onPick={player => pick(player)} />
  } else if (context.status === 'error') {
    body = (
      <div className="mh-startup">
        <div className="text-base font-bold">{t('playerTabs.profile.failedToLoadTitle')}</div>
        <div className="text-sm text-black/60 dark:text-white/60">{context.error}</div>
        <button type="button" className="mh-button px-3 py-1" onClick={() => lifecycle.retry()}>{t('matchCard.common.refresh')}</button>
      </div>
    )
  } else if (!ready) {
    body = (
      <div className="mh-startup">
        <Spinner size={20} />
        <div className="text-sm text-black/60 dark:text-white/60">{t('playerTabs.profile.loading')}</div>
      </div>
    )
  } else {
    body = (
      <>
        <PlayerTabStrip state={tabs} loading={loading} actions={actions} canOpenSelf={!!me?.puuid} onSelf={openSelf} searchOpen={searchOpen} onSearch={() => setSearchOpen(!searchOpen)} />
        <div className="relative min-h-0 flex-1">
          {searchOpen && (
            <div ref={searchPanel} className="mh-search-panel" role="dialog" aria-label={t('playerSearch.launcherTitle')}>
              <PlayerSearch scope={context.scope!} platformId={platformId} keepHistory={config.keepSearchHistory !== false} onOpen={player => openPlayer(player.puuid, true, { gameName: player.gameName, tagLine: player.tagLine, profileIconId: player.profileIconId ?? undefined })} autoFocus />
            </div>
          )}
          {tabs.tabs.length === 0 ? (
            <div className="mh-startup">
              <div className="text-base font-bold">{t('playerTabs.shell.noTabs')}</div>
              <button type="button" className="mh-button primary px-3 py-1" onClick={openSelf} disabled={!me?.puuid}>{t('playerTabs.titlebar.viewSelf')}</button>
              <PlayerSearch scope={context.scope!} platformId={platformId} keepHistory={config.keepSearchHistory !== false} onOpen={player => openPlayer(player.puuid, true, { gameName: player.gameName, tagLine: player.tagLine, profileIconId: player.profileIconId ?? undefined })} />
            </div>
          ) : (
            tabs.tabs.filter(tab => tab.id === tabs.activeId || shown.has(tab.id)).map(tab => (
              <PlayerTabPanel key={tab.id} tab={tab} scope={context.scope!} me={me?.puuid} visible={tab.id === tabs.activeId} onOpenPlayer={openPlayer} />
            ))
          )}
        </div>
      </>
    )
  }

  return (
    <ClockProvider>
      <div className="match-history-root">{body}</div>
    </ClockProvider>
  )
}
