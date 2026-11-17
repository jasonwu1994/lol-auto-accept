import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { PlayerLabel, PlayerRef } from '../contracts'
import {
  createEmptySimpleState,
  createEmptyState,
  type MatchHistoryFilterMode,
  type MatchHistoryFilterState,
  type SimpleMatchHistoryFilterState
} from '../upstream/player-tab/filters/filter-state'

/** Structured, reversible tab key. PUUIDs and platform IDs never contain `|`. */
export function tabKey(ref: PlayerRef): string {
  return `${ref.platformId}|${ref.puuid}`
}

export function parseTabKey(key: string): PlayerRef | null {
  const [platformId, puuid, rest] = key.split('|')
  return platformId !== undefined && puuid && rest === undefined ? { platformId, puuid } : null
}

export type TimeRange = 'all' | '24h' | '3d' | '7d' | '30d'

/** Everything a tab restores when it is shown again. Kept per tab, never shared. */
export interface TabView {
  startIndex: number
  pageSize: number
  queue: string
  timeRange: TimeRange
  showPractice: boolean
  showIrregular: boolean
  /** Upstream page filters (simple form or advanced combinator tree), per tab. */
  filters: TabFilters
  expanded: string[]
  detailTabs: Record<string, string>
  scrollTop: number
  sidebarOpen: boolean
  masteryModal: boolean
  /** Champion mastery list order (pane and dialog). */
  masterySort: 'points' | 'recent'
}

export interface TabFilters {
  mode: MatchHistoryFilterMode
  simple: SimpleMatchHistoryFilterState
  advanced: MatchHistoryFilterState
}

export const createFilters = (): TabFilters => ({ mode: 'simple', simple: createEmptySimpleState(), advanced: createEmptyState() })

export interface PlayerTab extends PlayerRef {
  id: string
  label: PlayerLabel
  isSelf: boolean
  view: TabView
}

export interface TabsState {
  /** AuthScope these tabs belong to; tabs from another scope are never shown. */
  scope: string | null
  tabs: PlayerTab[]
  activeId: string | null
  /** The user closed every tab during this page visit; do not reopen self until they leave. */
  selfSuppressed: boolean
}

export interface ViewDefaults {
  pageSize: number
  queue: string
  timeRange: TimeRange
  showPractice: boolean
  showIrregular: boolean
}

export const DEFAULT_VIEW: ViewDefaults = {
  pageSize: 20,
  queue: 'all',
  timeRange: 'all',
  showPractice: false,
  showIrregular: false
}

/** Settings keep a queue as its ID (`450`); the queue selector and SGP use `q_450`. */
export function queueTag(defaultQueue?: string) {
  return defaultQueue && /^\d+$/.test(defaultQueue) ? `q_${defaultQueue}` : 'all'
}

export function createView(defaults: ViewDefaults = DEFAULT_VIEW): TabView {
  return {
    startIndex: 0,
    pageSize: defaults.pageSize,
    queue: defaults.queue,
    timeRange: defaults.timeRange,
    showPractice: defaults.showPractice,
    showIrregular: defaults.showIrregular,
    filters: createFilters(),
    expanded: [],
    detailTabs: {},
    scrollTop: 0,
    sidebarOpen: false,
    masteryModal: false,
    masterySort: 'points'
  }
}

export const initialTabsState: TabsState = { scope: null, tabs: [], activeId: null, selfSuppressed: false }

export interface OpenTabPayload extends PlayerRef {
  label?: PlayerLabel
  isSelf?: boolean
  /** Upstream `setCurrent`; a tab is always activated when it is the first. */
  activate?: boolean
  defaults?: ViewDefaults
}

export function openTab(state: TabsState, payload: OpenTabPayload): TabsState {
  const id = tabKey(payload)
  const existing = state.tabs.find(tab => tab.id === id)
  if (existing) {
    // Re-opening never duplicates or resets the tab; it only focuses it.
    return payload.activate === false ? state : { ...state, activeId: id }
  }
  const tab: PlayerTab = {
    id,
    platformId: payload.platformId,
    puuid: payload.puuid,
    label: payload.label ?? {},
    isSelf: payload.isSelf ?? false,
    view: createView(payload.defaults)
  }
  return {
    ...state,
    tabs: [...state.tabs, tab],
    activeId: payload.activate !== false || state.tabs.length === 0 ? id : state.activeId,
    selfSuppressed: false
  }
}

export function activateTab(state: TabsState, id: string): TabsState {
  return state.tabs.some(tab => tab.id === id) && state.activeId !== id ? { ...state, activeId: id } : state
}

/**
 * Closing the active tab selects its right neighbour, else the left one. Closing an
 * inactive tab keeps the current one (an intended difference from upstream, which
 * always re-selects by index).
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex(tab => tab.id === id)
  if (index === -1) return state
  const tabs = state.tabs.filter(tab => tab.id !== id)
  let activeId = state.activeId
  if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
  return { ...state, tabs, activeId, selfSuppressed: tabs.length === 0 ? true : state.selfSuppressed }
}

export function closeOtherTabs(state: TabsState, id: string): TabsState {
  if (!state.tabs.some(tab => tab.id === id)) return state
  return { ...state, tabs: state.tabs.filter(tab => tab.id === id), activeId: id }
}

export function closeTabsToTheRight(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex(tab => tab.id === id)
  if (index === -1 || index === state.tabs.length - 1) return state
  const tabs = state.tabs.slice(0, index + 1)
  const activeId = tabs.some(tab => tab.id === state.activeId) ? state.activeId : tabs[tabs.length - 1].id
  return { ...state, tabs, activeId }
}

export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex(tab => tab.id === id)
  if (from === -1) return state
  const tabs = [...state.tabs]
  const [tab] = tabs.splice(from, 1)
  const target = Math.min(Math.max(toIndex, 0), tabs.length)
  if (target === from) return state
  tabs.splice(target, 0, tab)
  return { ...state, tabs }
}

export const canCloseOthers = (state: TabsState, id: string) => state.tabs.some(tab => tab.id !== id)
export const canCloseRight = (state: TabsState, id: string) => {
  const index = state.tabs.findIndex(tab => tab.id === id)
  return index !== -1 && index < state.tabs.length - 1
}

/** Disconnect or account/platform change: everything belonging to the old scope goes. */
export function resetScope(state: TabsState, scope: string | null): TabsState {
  if (state.scope === scope && scope !== null) return state
  return { ...initialTabsState, scope }
}

export function updateView(state: TabsState, id: string, patch: Partial<TabView>): TabsState {
  return {
    ...state,
    tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, view: { ...tab.view, ...patch } } : tab))
  }
}

/** A renamed player keeps the same tab key; only the label changes. */
export function updateLabel(state: TabsState, id: string, label: PlayerLabel): TabsState {
  const tab = state.tabs.find(item => item.id === id)
  if (!tab || JSON.stringify({ ...tab.label, ...label }) === JSON.stringify(tab.label)) return state
  return { ...state, tabs: state.tabs.map(item => (item.id === id ? { ...item, label: { ...item.label, ...label } } : item)) }
}

export function toggleExpanded(state: TabsState, id: string, gameId: string, expanded?: boolean): TabsState {
  const tab = state.tabs.find(item => item.id === id)
  if (!tab) return state
  const has = tab.view.expanded.includes(gameId)
  const next = expanded ?? !has
  if (next === has) return state
  return updateView(state, id, {
    expanded: next ? [...tab.view.expanded, gameId] : tab.view.expanded.filter(item => item !== gameId)
  })
}

const slice = createSlice({
  name: 'matchHistoryTabs',
  initialState: initialTabsState,
  reducers: {
    open: (state, action: PayloadAction<OpenTabPayload>) => openTab(state, action.payload),
    activate: (state, action: PayloadAction<string>) => activateTab(state, action.payload),
    close: (state, action: PayloadAction<string>) => closeTab(state, action.payload),
    closeOthers: (state, action: PayloadAction<string>) => closeOtherTabs(state, action.payload),
    closeRight: (state, action: PayloadAction<string>) => closeTabsToTheRight(state, action.payload),
    move: (state, action: PayloadAction<{ id: string; toIndex: number }>) =>
      moveTab(state, action.payload.id, action.payload.toIndex),
    reset: (state, action: PayloadAction<string | null>) => resetScope(state, action.payload),
    view: (state, action: PayloadAction<{ id: string; patch: Partial<TabView> }>) =>
      updateView(state, action.payload.id, action.payload.patch),
    label: (state, action: PayloadAction<{ id: string; label: PlayerLabel }>) =>
      updateLabel(state, action.payload.id, action.payload.label),
    expand: (state, action: PayloadAction<{ id: string; gameId: string; expanded?: boolean }>) =>
      toggleExpanded(state, action.payload.id, action.payload.gameId, action.payload.expanded),
    /** Leaving the page ends the "closed everything" suppression. */
    leave: state => (state.selfSuppressed ? { ...state, selfSuppressed: false } : state)
  }
})

export const tabsActions = slice.actions
export const MatchHistoryReducer = slice.reducer
