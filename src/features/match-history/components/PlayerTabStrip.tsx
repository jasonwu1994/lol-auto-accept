import { CloseOutlined, ReloadOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { profileIconPath } from '../assets/gameData'
import { canCloseOthers, canCloseRight, type PlayerTab, type TabsState } from '../state/tabs'
import { GameImage, Spinner, useMh } from './primitives'

export interface TabStripActions {
  activate: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeRight: (id: string) => void
  move: (id: string, toIndex: number) => void
  refresh: (id: string) => void
}

interface Drag {
  id: string
  pointerId: number
  startX: number
  offset: number
  from: number
  moved: boolean
}

/**
 * Upstream PlayerTabStrip (titlebar tabs), placed at the top of the page here because
 * this app keeps its own window chrome.
 */
export function PlayerTabStrip({ state, loading, actions, onSearch, onSelf, canOpenSelf, searchOpen }: {
  state: TabsState
  loading: Record<string, boolean>
  actions: TabStripActions
  onSearch: () => void
  onSelf: () => void
  canOpenSelf: boolean
  searchOpen: boolean
}) {
  const { t } = useMh()
  const list = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const justDragged = useRef(0)
  const tabs = state.tabs

  // Keep the active tab visible, like upstream `scrollToTab`.
  useEffect(() => {
    const element = list.current?.querySelector<HTMLElement>(`[data-player-tab-id="${CSS.escape(state.activeId ?? '')}"]`)
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.activeId, tabs.length])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const key = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  useEffect(() => {
    if (menu && !tabs.some(tab => tab.id === menu.id)) setMenu(null)
  }, [menu, tabs])

  const focusTab = (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    actions.activate(tab.id)
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-player-tab-id="${CSS.escape(tab.id)}"]`)?.focus())
  }

  const onKey = (event: KeyboardEvent, index: number, tab: PlayerTab) => {
    if (event.target !== event.currentTarget) return
    const move = event.altKey && event.shiftKey
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = index + (event.key === 'ArrowRight' ? 1 : -1)
      if (move) {
        actions.move(tab.id, next)
        requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-player-tab-id="${CSS.escape(tab.id)}"]`)?.focus())
      } else focusTab((next + tabs.length) % tabs.length)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusTab(event.key === 'Home' ? 0 : tabs.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      actions.activate(tab.id)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      actions.close(tab.id)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setMenu({ id: tab.id, x: rect.left, y: rect.bottom })
    }
  }

  const tabWidth = (id: string) => list.current?.querySelector<HTMLElement>(`[data-player-tab-id="${CSS.escape(id)}"]`)?.offsetWidth ?? 120

  const onPointerDown = (event: PointerEvent, index: number, tab: PlayerTab) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const next = { id: tab.id, pointerId: event.pointerId, startX: event.clientX, offset: 0, from: index, moved: false }
    dragRef.current = next
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const offset = event.clientX - current.startX
    if (!current.moved && Math.abs(offset) < 4) return
    const next = { ...current, offset, moved: true }
    dragRef.current = next
    setDrag(next)
  }
  const onPointerUp = (event: PointerEvent) => {
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!current || current.pointerId !== event.pointerId || !current.moved) return
    justDragged.current = Date.now()
    const step = tabWidth(current.id) + 2
    const target = Math.max(0, Math.min(tabs.length - 1, current.from + Math.round(current.offset / step)))
    if (target !== current.from) actions.move(current.id, target)
  }

  const menuTab = menu && tabs.find(tab => tab.id === menu.id)
  return (
    <div className="mh-tab-bar">
      <div
        ref={list}
        className="mh-tab-list"
        role="tablist"
        aria-label={t('playerTabs.titlebar.tabs')}
        onWheel={event => {
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY * 0.75
          list.current?.scrollBy({ left: delta })
        }}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === state.activeId
          const dragging = drag?.id === tab.id
          return (
            <div
              key={tab.id}
              data-player-tab-id={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`mh-tab ${active ? 'active' : ''} ${dragging ? 'drag-source' : ''}`}
              style={dragging ? { transform: `translateX(${drag.offset}px)` } : undefined}
              title={tab.label.gameName ? `${tab.label.gameName}#${tab.label.tagLine ?? ''}` : undefined}
              onClick={() => Date.now() - justDragged.current > 120 && actions.activate(tab.id)}
              onDoubleClick={() => actions.close(tab.id)}
              onMouseDown={event => event.button === 1 && event.preventDefault()}
              onMouseUp={event => event.button === 1 && actions.close(tab.id)}
              onContextMenu={event => {
                event.preventDefault()
                setMenu({ id: tab.id, x: event.clientX, y: event.clientY })
              }}
              onKeyDown={event => onKey(event, index, tab)}
              onPointerDown={event => onPointerDown(event, index, tab)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                dragRef.current = null
                setDrag(null)
              }}
            >
              {loading[tab.id] ? <Spinner size={12} className="mh-tab-icon" /> : tab.label.profileIconId !== undefined ? <GameImage path={profileIconPath(tab.label.profileIconId)} className="mh-tab-icon" /> : <span className="mh-tab-icon mh-tab-icon-placeholder" />}
              {tab.isSelf && <span className="mh-tab-self">{t('playerTabs.titlebar.self')}</span>}
              {tab.label.gameName ? (
                <span className="mh-tab-name">
                  <span className="mh-tab-game-name">{tab.label.gameName}</span>
                  {tab.label.tagLine && <span className="mh-tab-tag"> #{tab.label.tagLine}</span>}
                </span>
              ) : (
                <span className="mh-tab-placeholder">{t('playerTabs.titlebar.loading')}.</span>
              )}
              <button
                type="button"
                className="mh-tab-close"
                tabIndex={-1}
                aria-label={t('playerTabs.titlebar.close')}
                title={t('playerTabs.titlebar.close')}
                onClick={event => {
                  event.stopPropagation()
                  actions.close(tab.id)
                }}
                onDoubleClick={event => event.stopPropagation()}
              >
                <CloseOutlined />
              </button>
            </div>
          )
        })}
      </div>
      <div className="mh-tab-tools">
        <button type="button" className="mh-icon-button" disabled={!canOpenSelf} aria-label={t('playerTabs.titlebar.viewSelf')} title={t('playerTabs.titlebar.viewSelf')} onClick={onSelf}>
          <UserOutlined />
        </button>
        <button type="button" data-mh-search-toggle className={`mh-icon-button ${searchOpen ? 'active' : ''}`} aria-pressed={searchOpen} aria-label={t('playerSearch.launcherTitle')} title={t('playerSearch.launcherTitle')} onClick={onSearch}>
          <SearchOutlined />
        </button>
      </div>
      {menu &&
        menuTab &&
        createPortal(
          <div className="match-history-portal mh-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            {[
              { key: 'refresh', label: t('playerTabs.titlebar.refresh'), icon: <ReloadOutlined />, disabled: !!loading[menuTab.id], run: () => actions.refresh(menuTab.id) },
              { key: 'divider' },
              { key: 'close', label: t('playerTabs.titlebar.close'), icon: <CloseOutlined />, run: () => actions.close(menuTab.id) },
              { key: 'close-others', label: t('playerTabs.titlebar.closeOthers'), disabled: !canCloseOthers(state, menuTab.id), run: () => actions.closeOthers(menuTab.id) },
              { key: 'close-right', label: t('playerTabs.titlebar.closeToTheRight'), disabled: !canCloseRight(state, menuTab.id), run: () => actions.closeRight(menuTab.id) }
            ].map(item =>
              item.key === 'divider' ? (
                <div key="divider" className="mh-menu-divider" role="separator" />
              ) : (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="mh-menu-item"
                  disabled={item.disabled}
                  autoFocus={item.key === 'refresh'}
                  onClick={() => {
                    item.run?.()
                    setMenu(null)
                  }}
                >
                  <span className="mh-menu-icon">{item.icon}</span>
                  {item.label}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
