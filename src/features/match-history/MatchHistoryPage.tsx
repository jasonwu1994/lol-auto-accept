import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { gameData } from './assets/gameData'
import type { PlayerLabel } from './contracts'
import { lifecycle } from './state/lifecycle'
import { DEFAULT_VIEW, queueTag, tabsActions, type TabsState, type TimeRange } from './state/tabs'
import { PlayerSearch } from './components/PlayerSearch'
import { PlayerTabPanel } from './components/PlayerTabPanel'
import { PlayerTabStrip } from './components/PlayerTabStrip'
import { ClockProvider, Spinner, useMh } from './components/primitives'
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

export default function MatchHistoryPage() {
  const { t } = useMh()
  const dispatch = useDispatch()
  const context = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot)
  const tabs = useSelector((state: RootState) => state.MatchHistoryReducer)
  const config = useSelector((state: RootState) => state.ConfigReducer.matchHistory) ?? {}
  const [searchOpen, setSearchOpen] = useState(false)
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
    body = (
      <div className="mh-startup">
        <div className="text-base font-bold">{t('playerTabs.shell.disconnectedTitle')}</div>
        <div className="text-sm text-black/60 dark:text-white/60">{t('playerTabs.shell.disconnectedHint')}</div>
      </div>
    )
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
            <div className="mh-search-panel" role="dialog" aria-label={t('playerSearch.title')}>
              <PlayerSearch scope={context.scope!} platformId={platformId} keepHistory={config.keepSearchHistory !== false} onOpen={player => openPlayer(player.puuid, true, player)} autoFocus />
            </div>
          )}
          {tabs.tabs.length === 0 ? (
            <div className="mh-startup">
              <div className="text-base font-bold">{t('playerTabs.shell.noTabs')}</div>
              <button type="button" className="mh-button primary px-3 py-1" onClick={openSelf} disabled={!me?.puuid}>{t('playerTabs.titlebar.viewSelf')}</button>
              <PlayerSearch scope={context.scope!} platformId={platformId} keepHistory={config.keepSearchHistory !== false} onOpen={player => openPlayer(player.puuid, true, player)} />
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
