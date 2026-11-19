import { CloseOutlined, HolderOutlined, SearchOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { toast } from '@heroui/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { navDragLayout } from '../../../components/common/navigationOrder'
import { matchHistoryApi } from '../api'
import { profileIconPath } from '../assets/gameData'
import { errorCode, type SavedPlayer } from '../contracts'
import { savedPlayers, useSavedPlayers } from '../state/saved'
import type { SummonerInfo } from '../upstream/types/league-client/summoner'
import { GameImage, Spinner, useMh } from './primitives'

/** Parses `name#tag` (also full-width ＃). Returns null when either part is missing. */
export function parseRiotId(input: string) {
  const [gameName, ...rest] = input.trim().split(/[#＃]/)
  const tagLine = rest.join('#').trim()
  return gameName.trim() && tagLine ? { gameName: gameName.trim(), tagLine } : null
}

export type OpenSavedPlayer = (player: SavedPlayer) => void

export function FavoriteButton({ player, size = 'sm' }: { player: SavedPlayer | null; size?: 'sm' | 'lg' }) {
  const { t } = useMh()
  const saved = useSavedPlayers()
  const [busy, setBusy] = useState(false)
  if (!player) return null
  const on = saved.favorites.some(item => item.platformId === player.platformId && item.puuid === player.puuid)
  const label = on ? t('playerSearch.unfavorite') : t('playerSearch.favorite')
  const toggle = async () => {
    setBusy(true)
    const error = await savedPlayers.toggleFavorite(player)
    setBusy(false)
    if (error === 'LimitReached') toast.danger(t('playerSearch.favoritesFull'))
    else if (error) toast.danger(t('playerSearch.favoriteFailed', { code: error }))
  }
  return (
    <button
      type="button"
      className={size === 'lg' ? `mh-button mh-icon-only size-9 ${on ? 'mh-favorite-on' : ''}` : `mh-icon-button ${on ? 'mh-favorite-on' : ''}`}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={busy}
      onClick={event => {
        event.stopPropagation()
        void toggle()
      }}
    >
      {on ? <StarFilled /> : <StarOutlined />}
    </button>
  )
}

export function PlayerRow({ player, platformId, onOpen, extra, sub, handle, className = '', style }: {
  player: SavedPlayer
  platformId: string | null
  onOpen: OpenSavedPlayer
  extra?: ReactNode
  sub?: ReactNode
  /** Leading drag handle (favorites). */
  handle?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const otherServer = !!platformId && player.platformId !== platformId
  return (
    <div className={`mh-list-item mh-player-row ${className}`} style={style}>
      {handle}
      <button type="button" className="mh-player-row-main" disabled={otherServer} onClick={() => onOpen(player)}>
        <GameImage path={profileIconPath(player.profileIconId ?? undefined)} className="size-8 shrink-0 rounded" />
        <span className="flex min-w-0 flex-col text-left">
          <span className="truncate text-sm font-bold">
            {player.gameName}
            <span className="ml-1 font-normal text-black/60 dark:text-white/60">#{player.tagLine}</span>
          </span>
          {(sub || otherServer) && (
            <span className="truncate text-xs text-black/60 dark:text-white/60">
              {sub}
              {otherServer && <span className="mh-server-chip ml-1">{player.platformId}</span>}
            </span>
          )}
        </span>
      </button>
      {extra}
    </div>
  )
}

/** Same settle time as the app's page-order drag. */
const SETTLE_MS = 240

interface FavoriteDrag {
  key: string
  fromIndex: number
  startY: number
  offset: number
  step: number
  pointerId?: number
  phase: 'dragging' | 'settling'
}

const favoriteKey = (player: SavedPlayer) => `${player.platformId}|${player.puuid}`

/**
 * Favorites in the user's order, reordered the way the app's page list is: hold the
 * handle and the row follows the pointer while the others slide out of its way, then
 * it settles into the gap (arrow keys move one step).
 */
function FavoriteList({ favorites, platformId, onOpen }: { favorites: SavedPlayer[]; platformId: string | null; onOpen: OpenSavedPlayer }) {
  const { t } = useMh()
  const [drag, setDrag] = useState<FavoriteDrag | null>(null)
  // The new order shows at once; the saved list replaces it when the write returns.
  const [optimistic, setOptimistic] = useState<SavedPlayer[] | null>(null)
  const [justSorted, setJustSorted] = useState(false)
  const source = useRef<FavoriteDrag | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const resetFrame = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const list = optimistic ?? favorites
  const layout = drag ? navDragLayout(drag.fromIndex, list.length, drag.offset, drag.step) : null

  useEffect(() => setOptimistic(null), [favorites])
  useEffect(
    () => () => {
      clearTimeout(settleTimer.current)
      cancelAnimationFrame(resetFrame.current)
    },
    []
  )

  const stepOf = (handle: HTMLElement) => {
    const row = handle.closest('.mh-player-row') as HTMLElement | null
    const gap = listRef.current ? parseFloat(getComputedStyle(listRef.current).rowGap || '0') : 0
    return (row?.offsetHeight ?? 0) + (Number.isFinite(gap) ? gap : 0)
  }

  const settle = (cancel = false) => {
    const active = source.current
    if (!active || active.phase !== 'dragging') return
    const target = cancel ? active.fromIndex : navDragLayout(active.fromIndex, list.length, active.offset, active.step).toIndex
    const settling: FavoriteDrag = { ...active, offset: (target - active.fromIndex) * active.step, phase: 'settling' }
    source.current = settling
    setDrag(settling)
    settleTimer.current = setTimeout(() => {
      setJustSorted(true)
      if (target !== active.fromIndex) {
        const next = [...list]
        const [moved] = next.splice(active.fromIndex, 1)
        next.splice(target, 0, moved)
        setOptimistic(next)
        void savedPlayers.update('favoriteMove', moved, target).then(error => {
          if (error) {
            setOptimistic(null)
            toast.danger(t('playerSearch.favoriteFailed', { code: error }))
          }
        })
      }
      source.current = null
      setDrag(null)
      // Rows take their new places without animating back from the drag offsets.
      resetFrame.current = requestAnimationFrame(() => {
        resetFrame.current = requestAnimationFrame(() => setJustSorted(false))
      })
    }, SETTLE_MS)
  }

  const move = (event: React.PointerEvent) => {
    const active = source.current
    if (!active || active.phase !== 'dragging' || active.pointerId !== event.pointerId) return
    const next = { ...active, offset: event.clientY - active.startY }
    source.current = next
    setDrag(next)
  }

  if (list.length === 0) return <div className="px-1 text-xs text-black/50 dark:text-white/50">{t('playerSearch.noFavorites')}</div>
  const sortable = list.length > 1
  return (
    <div ref={listRef} className={`mh-favorite-list${drag ? ' is-dragging' : ''}${justSorted ? ' just-sorted' : ''}`}>
      {list.map((player, index) => {
        const key = favoriteKey(player)
        const phase = drag?.key === key ? drag.phase : null
        const name = player.tagLine ? `${player.gameName}#${player.tagLine}` : player.gameName
        return (
          <PlayerRow
            key={key}
            player={player}
            platformId={platformId}
            onOpen={onOpen}
            className={`mh-favorite-row${phase ? ` is-${phase}` : ''}`}
            style={{ transform: `translate3d(0,${layout?.offsets[index] ?? 0}px,0) scale(${phase === 'dragging' ? 1.02 : 1})` }}
            handle={
              sortable && (
                <button
                  type="button"
                  className="mh-drag-handle"
                  aria-label={t('playerSearch.dragFavorite', { name })}
                  title={t('playerSearch.dragFavorite', { name })}
                  onPointerDown={event => {
                    if (source.current || event.button !== 0) return
                    event.preventDefault()
                    const active: FavoriteDrag = { key, fromIndex: index, startY: event.clientY, offset: 0, step: stepOf(event.currentTarget), pointerId: event.pointerId, phase: 'dragging' }
                    source.current = active
                    setDrag(active)
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={move}
                  onPointerUp={event => {
                    move(event)
                    settle()
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onPointerCancel={() => settle(true)}
                  onLostPointerCapture={() => settle(true)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      settle(true)
                      return
                    }
                    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                    if (!delta || source.current || index + delta < 0 || index + delta >= list.length) return
                    event.preventDefault()
                    const step = stepOf(event.currentTarget)
                    source.current = { key, fromIndex: index, startY: 0, offset: delta * step, step, phase: 'dragging' }
                    settle()
                  }}
                >
                  <HolderOutlined aria-hidden />
                </button>
              )
            }
            extra={<FavoriteButton player={player} />}
          />
        )
      })}
    </div>
  )
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-black/60 dark:text-white/60">
        <span>{title}</span>
        <span className="ml-auto">{extra}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * Riot ID search plus the players saved on this computer (favorites, recent searches).
 * Searching needs the client (`scope`); the saved lists work without it.
 */
export function PlayerSearch({ scope, platformId, keepHistory, onOpen, autoFocus, showFavorites = true }: {
  /** Connected AuthScope; null while the client is closed (search disabled). */
  scope: string | null
  /** Server the search runs on and saved players can be opened on. */
  platformId: string | null
  keepHistory: boolean
  onOpen: OpenSavedPlayer
  autoFocus?: boolean
  showFavorites?: boolean
}) {
  const { t } = useMh()
  const saved = useSavedPlayers()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<SummonerInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const online = !!scope && !!platformId

  useEffect(() => {
    void savedPlayers.load()
  }, [])

  const open = (player: SavedPlayer, fromSearch = false) => {
    onOpen(player)
    if (fromSearch && keepHistory) void savedPlayers.update('searchSave', player)
  }

  const submit = async () => {
    if (!online) return
    const riotId = parseRiotId(input)
    if (!riotId) {
      setStatus('error')
      setError('format')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const found = (await matchHistoryApi.search(scope, riotId.gameName, riotId.tagLine)).filter(item => item?.puuid)
      setResults(found)
      setStatus('done')
    } catch (reason) {
      setResults([])
      setStatus('error')
      setError(errorCode(reason))
    }
  }

  const toSaved = (result: SummonerInfo): SavedPlayer => ({
    puuid: result.puuid,
    platformId: platformId ?? '',
    gameName: result.gameName,
    tagLine: result.tagLine,
    profileIconId: result.profileIconId
  })

  return (
    <div className="mh-search flex w-full max-w-120 flex-col gap-3">
      <form
        className="flex items-center gap-2"
        onSubmit={event => {
          event.preventDefault()
          void submit()
        }}
      >
        {platformId && (
          <span className="mh-server-chip" title={t('playerSearch.serverHint', { server: platformId })}>
            {platformId}
          </span>
        )}
        <input
          className="mh-input min-w-0 flex-1"
          value={input}
          autoFocus={autoFocus && online}
          maxLength={48}
          disabled={!online}
          onChange={event => setInput(event.target.value)}
          placeholder={online ? t('playerSearch.placeholder') : t('playerSearch.offlinePlaceholder')}
          aria-label={t('playerSearch.title')}
        />
        <button type="submit" className="mh-button primary px-3" disabled={!online || status === 'loading'} aria-label={t('playerSearch.search')}>
          {status === 'loading' ? <Spinner size={14} /> : <SearchOutlined />}
        </button>
      </form>
      {status === 'error' && (
        <div className="text-xs text-red-600 dark:text-red-300">
          {error === 'format'
            ? t('playerSearch.formatHint')
            : error === 'Unsupported' || error === 'NotFound'
              ? t('playerSearch.notFound')
              : t('playerSearch.failed', { code: error })}
        </div>
      )}
      {status === 'done' && results.length === 0 && <div className="text-xs text-black/60 dark:text-white/60">{t('playerSearch.notFound')}</div>}
      {results.length > 0 && (
        <div className="flex flex-col gap-1">
          {results.map(result => {
            const player = toSaved(result)
            return (
              <PlayerRow
                key={result.puuid}
                player={player}
                platformId={platformId}
                onOpen={item => open(item, true)}
                sub={`${t('playerSearch.level', { level: result.summonerLevel })}${result.privacy === 'PRIVATE' ? ` · ${t('playerTabs.profilePrivacy.private')}` : ''}`}
                extra={<FavoriteButton player={player} />}
              />
            )
          })}
        </div>
      )}
      {showFavorites && (
        <Section title={t('playerSearch.favorites', { count: saved.favorites.length })}>
          <FavoriteList favorites={saved.favorites} platformId={platformId} onOpen={item => open(item)} />
        </Section>
      )}
      {keepHistory && saved.searchHistory.length > 0 && (
        <Section
          title={t('playerSearch.history')}
          extra={
            <button type="button" className="mh-link-button" onClick={() => void savedPlayers.update('searchClear')}>
              {t('playerSearch.clearHistory')}
            </button>
          }
        >
          {saved.searchHistory.map(player => (
            <PlayerRow
              key={`${player.platformId}|${player.puuid}`}
              player={player}
              platformId={platformId}
              onOpen={item => open(item, true)}
              extra={
                <>
                  <FavoriteButton player={player} />
                  <button type="button" className="mh-icon-button" aria-label={t('playerSearch.remove')} title={t('playerSearch.remove')} onClick={() => void savedPlayers.update('searchDelete', player)}>
                    <CloseOutlined />
                  </button>
                </>
              }
            />
          ))}
        </Section>
      )}
    </div>
  )
}
