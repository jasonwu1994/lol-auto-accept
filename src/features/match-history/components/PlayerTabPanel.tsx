import {
  ArrowUpOutlined,
  CloseOutlined,
  CopyOutlined,
  FilterOutlined,
  LeftOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  ReloadOutlined,
  RightOutlined,
  StepBackwardOutlined
} from '@ant-design/icons'
import { Button, toast } from '@heroui/react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { desktop } from '../../../desktop/tauri'
import { profileIconPath } from '../assets/gameData'
import { errorCode, type MatchHistoryError } from '../contracts'
import { analyzeGames } from '../upstream/data-adapter/analysis/player'
import { analyzeRelationship } from '../upstream/data-adapter/analysis/relationship'
import { toBasicInfo } from '../upstream/data-adapter/match-history/match-basic'
import { toParticipants } from '../upstream/data-adapter/match-history/participants'
import type { LcuOrSgpGameSummary } from '../upstream/data-adapter/wrapper'
import { createInitParamCollectFilterState, createInitParamCollectSettings } from '../upstream/player-tab/data/match-history-init-param-collect'
import { hasPredicate, hasSimplePredicate, toFilterState, toPredicate, clearPredicate, clearSimplePredicate } from '../upstream/player-tab/filters/filter-state'
import { MATCH_HISTORY_COLLECTION_PAGE_SIZES, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE, MATCH_HISTORY_REGULAR_PAGE_SIZES } from '../upstream/player-tab/page-size-options'
import type { Mastery } from '../upstream/types/league-client/champion-mastery'
import type { RankedEntry } from '../upstream/types/league-client/ranked'
import { lifecycle } from '../state/lifecycle'
import { CHAMPION_MASTERY_TOP_COUNT, gameKey, type TabRuntime } from '../state/runtime'
import { tabsActions, type PlayerTab, type TabView } from '../state/tabs'
import { FilterModal } from './FilterModal'
import { FavoriteButton } from './PlayerSearch'
import { savedPlayers, toSavedPlayer } from '../state/saved'
import { HeroSelect } from './HeroSelect'
import { HeroTabs } from './HeroTabs'
import { medalImage, RankedTable, unranked } from './RankedTable'
import { ALL_SGPTAG_VALUE, QueueSelect } from './QueueSelect'
import { MatchCard, playerLinkHandlers, type PlayerLink } from './MatchCard'
import { formatPlayDate, sortMasteries, type MasterySort } from './mastery'
import { ChampionIcon, formatExtremeNumber, GameImage, Spinner, Tip, useMh } from './primitives'

const rankedLarge = import.meta.glob('../assets/ranked/large/*.png', { eager: true, import: 'default' }) as Record<string, string>
const rankedImage = (tier: string) => rankedLarge[`../assets/ranked/large/${tier.toLowerCase()}.png`] ?? rankedLarge['../assets/ranked/large/unranked.png']

export const PLAYER_TAB_WIDE_MIN_WIDTH = 1280
/** Per-tab scroll offsets; kept outside Redux so scrolling does not re-render the page. */
const scrollPositions = new Map<string, number>()
const RECENTLY_PLAYED_PLAYER_THRESHOLD = 2
const ENCOUNTERED_GAMES_PAGE_SIZE = 10

/**
 * Scrolls `element` to the top with an ease-out animation. Done by hand rather than
 * `scrollTo({ behavior: 'smooth' })`, which WebView2 skips when Windows animations are
 * off. A wheel, touch or key press during the animation hands control back.
 */
function scrollToTop(element: HTMLElement) {
  const start = element.scrollTop
  if (start <= 0) return
  const duration = Math.min(700, 300 + start / 20)
  const began = performance.now()
  let frame = 0
  const stop = () => {
    cancelAnimationFrame(frame)
    element.removeEventListener('wheel', stop)
    element.removeEventListener('touchstart', stop)
    element.removeEventListener('keydown', stop)
  }
  element.addEventListener('wheel', stop, { passive: true })
  element.addEventListener('touchstart', stop, { passive: true })
  element.addEventListener('keydown', stop)
  const step = (now: number) => {
    const progress = Math.min(1, (now - began) / duration)
    element.scrollTop = start * (1 - progress) ** 3
    if (progress < 1) frame = requestAnimationFrame(step)
    else stop()
  }
  frame = requestAnimationFrame(step)
}

export function useRuntime(tab: PlayerTab, scope: string) {
  const runtime = lifecycle.registry.get(tab.id, tab, scope)
  const data = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return { runtime, data }
}

/* ------------------------------------------------------------ header */

/** `stacked` puts the medal above the text, as in the ranked dialog. */
function RankedCard({ entry, wide, stacked = false }: { entry: RankedEntry; wide: boolean; stacked?: boolean }) {
  const { t } = useMh()
  const ranked = !unranked(entry.tier)
  const tierName = (tier: string, division?: string) => (unranked(tier) ? t('playerTabs.ranked.unranked') : `${t(`common.tiers.${tier}`, { defaultValue: tier })}${unranked(division) ? '' : ` ${division}`}`)
  const total = (entry.wins ?? 0) + (entry.losses ?? 0)
  const highest = unranked(entry.highestTier) ? '' : entry.highestTier
  const title = (
    <div className={`flex min-w-0 items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${stacked ? '' : 'absolute top-0 left-0 box-border w-full px-2 py-1'}`}>
      <span className="min-w-0 truncate">{t(`common.queueTypes.${entry.queueType}`, { defaultValue: entry.queueType })}</span>
      {ranked && typeof entry.losses === 'number' && entry.losses !== 0 && (
        <span className="shrink-0 rounded bg-black/8 px-1.5 py-px text-[10px] leading-4 whitespace-nowrap text-gray-600 dark:bg-white/10 dark:text-gray-300">
          {t('playerTabs.ranked.winRate')} {total > 0 ? (((entry.wins ?? 0) / total) * 100).toFixed(1) : '0.0'}%
        </span>
      )}
    </div>
  )
  const record = ranked ? `${entry.wins} ${t('playerTabs.ranked.win')}${entry.losses ? ` ${entry.losses} ${t('playerTabs.ranked.lose')}` : ''} ${entry.leaguePoints} ${t('playerTabs.ranked.leaguePoint')}` : '—'
  const best = (
    <div className={`flex items-center text-[10px] ${highest ? 'text-gray-500 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
      <span className="mr-0.5">{t('playerTabs.ranked.highest')}</span>
      <div className="flex items-center">
        {highest && medalImage(highest) && <img src={medalImage(highest)} className="mr-0.5 h-4 w-4" alt="" />}
        <span>{tierName(entry.highestTier, entry.highestDivision)}</span>
      </div>
    </div>
  )
  const medal = rankedImage(ranked ? entry.tier : 'UNRANKED')

  if (stacked) {
    return (
      <div className="mh-panel flex w-60 flex-col items-center px-3 pt-1 pb-3 text-center">
        {/* Uncropped: the higher tiers' wings reach the top of the art. */}
        <img className="-mb-2 h-32 w-32 object-contain" src={medal} alt="" />
        {title}
        <span className="mt-0.5 text-base font-bold text-gray-900 dark:text-gray-100">{tierName(entry.tier, entry.division)}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{record}</span>
        <div className="mt-0.5">{best}</div>
      </div>
    )
  }

  return (
    <div className={`mh-panel relative flex h-27 items-center justify-center ${wide ? 'w-60' : 'w-36'}`}>
      {title}
      <div className="relative top-1 flex w-full items-center justify-center gap-2">
        {wide && (
          <div className="relative h-12 w-16">
            <img className="absolute top-1/2 left-1/2 h-[144%] w-[144%] -translate-x-1/2 -translate-y-1/2 object-contain" src={medal} alt="" />
          </div>
        )}
        <div className="flex min-w-16 flex-col items-center text-center">
          <span className="text-base font-bold text-gray-900 dark:text-gray-100">{tierName(entry.tier, entry.division)}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{record}</span>
          {best}
        </div>
      </div>
    </div>
  )
}

function RankedPane({ data, wide }: { data: TabRuntime['getSnapshot'] extends () => infer R ? R : never; wide: boolean }) {
  const { t } = useMh()
  const [showAll, setShowAll] = useState(false)
  const stats = data.ranked.data
  const entries = (['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'] as const)
    .map(type => stats?.queueMap?.[type] || stats?.queues?.find(entry => entry.queueType === type))
    .filter((entry): entry is RankedEntry => Boolean(entry))
  if (!entries.length) {
    if (data.ranked.status === 'loading') return <div className={`mh-panel flex h-27 items-center justify-center ${wide ? 'w-60' : 'w-36'}`}><Spinner /></div>
    if (data.ranked.status === 'error') return <div className={`mh-panel flex h-27 items-center justify-center px-2 text-center text-xs text-gray-500 ${wide ? 'w-60' : 'w-36'}`}>{t('playerTabs.profile.failedToLoadRankedStats', { reason: data.ranked.error })}</div>
    return null
  }
  return (
    <div className="relative flex gap-4">
      {entries.map(entry => <RankedCard key={entry.queueType} entry={entry} wide={wide} />)}
      {entries.length > 1 && (
        <div className="absolute right-0 bottom-0 translate-x-1/2 translate-y-1/3">
          <button type="button" className="mh-button mh-icon-only size-7" title={t('playerTabs.profile.rankedMore')} aria-label={t('playerTabs.profile.rankedMore')} onClick={() => setShowAll(true)}>
            <MoreOutlined />
          </button>
        </div>
      )}
      {showAll && (
        <Modal onClose={() => setShowAll(false)} label={t('playerTabs.profile.rankedMore')}>
          <div className="mh-ranked-modal flex flex-col items-center p-4">
            <div className="mb-4 grid grid-cols-2 gap-4">{entries.map(entry => <RankedCard key={entry.queueType} entry={entry} wide stacked />)}</div>
            <RankedTable queues={stats?.queues ?? []} />
          </div>
        </Modal>
      )}
    </div>
  )
}

export function Modal({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
      previous?.focus?.()
    }
  }, [onClose])
  // Portal to the page root: an ancestor with backdrop-filter (the sidebar drawer)
  // would otherwise become the fixed-position box and squeeze the dialog into it.
  return createPortal(
    <div className="match-history-portal mh-modal-backdrop" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div ref={panel} className="mh-modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body
  )
}

/** Sidebar drawer that slides in from the left and slides back out before unmounting. */
function Drawer({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
      return
    }
    // Fallback when animationend never arrives (e.g. the window is hidden).
    const timer = setTimeout(() => setMounted(false), 320)
    return () => clearTimeout(timer)
  }, [open])
  if (!mounted) return null
  return (
    <div
      className={`mh-drawer-backdrop ${open ? 'open' : 'closing'}`}
      onPointerDown={event => event.target === event.currentTarget && onClose()}
      onAnimationEnd={event => event.target === event.currentTarget && !open && setMounted(false)}
    >
      <div className="mh-drawer mh-scroll" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

function PlayerHeader({ tab, runtime, data, wide }: { tab: PlayerTab; runtime: TabRuntime; data: ReturnType<TabRuntime['getSnapshot']>; wide: boolean }) {
  const { t } = useMh()
  const [copied, setCopied] = useState(false)
  const summoner = data.profile.data?.summoner
  const gameName = summoner?.gameName ?? tab.label.gameName
  const tagLine = summoner?.tagLine ?? tab.label.tagLine
  const loading = data.profile.status === 'loading' || data.ranked.status === 'loading' || data.pageStatus === 'loading'
  const iconId = summoner?.profileIconId ?? tab.label.profileIconId
  const saved = useMemo(() => toSavedPlayer(tab.platformId, tab.puuid, { gameName, tagLine, profileIconId: iconId }), [tab.platformId, tab.puuid, gameName, tagLine, iconId])
  // Fresh names or icon from the client update the saved copies (favorites, recent searches).
  useEffect(() => {
    if (summoner && saved) savedPlayers.refreshLabels(saved)
  }, [summoner, saved])
  const copy = async () => {
    if (!gameName) return
    await desktop.invoke('write_clipboard', { text: `${gameName}#${tagLine}` })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex flex-wrap items-center gap-y-3">
      <div className="flex h-16 min-w-40 flex-1">
        <div className="relative size-16 shrink-0">
          <GameImage path={profileIconPath(summoner?.profileIconId ?? tab.label.profileIconId)} className="size-full rounded" />
          {summoner && <div className="absolute -right-1 -bottom-1 rounded px-1 py-0.5 text-[10px] dark:bg-black/40 dark:text-white">{summoner.summonerLevel}</div>}
        </div>
        <div className="ml-3 flex min-w-0 flex-col gap-1 self-center">
          <div className="flex items-center gap-1">
            <span className={`truncate font-bold text-black dark:text-white ${gameName && gameName.length >= 16 ? 'text-sm' : 'text-xl'}`}>{gameName || '—'}</span>
            {gameName && (
              <Tip content={copied ? t('playerTabs.shell.copiedToClipboard') : `${gameName}#${tagLine}`}>
                <button type="button" className="mh-icon-button" aria-label={t('playerTabs.profile.copyName')} onClick={copy}>
                  <CopyOutlined />
                </button>
              </Tip>
            )}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{tagLine ? `#${tagLine}` : '—'}</div>
          {data.profile.status === 'error' && <div className="text-xs text-red-600 dark:text-red-300">{t('playerTabs.profile.failedToLoadSummoner', { reason: data.profile.error })}</div>}
        </div>
      </div>
      <RankedPane data={data} wide={wide} />
      <div className="ml-auto flex justify-end gap-2 pl-4">
        <FavoriteButton player={saved} size="lg" />
        <button type="button" className="mh-button mh-icon-only size-9" aria-label={t('playerTabs.profile.refreshPage')} title={t('playerTabs.profile.refreshPage')} onClick={() => void runtime.refresh().then(error => (error ? toast.danger(t('playerTabs.profile.refreshFailed', { reason: error })) : toast.success(t('playerTabs.profile.refreshed'))))} disabled={loading}>
          {loading ? <Spinner size={14} /> : <ReloadOutlined />}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ sidebar */

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mh-panel px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-base font-bold text-gray-900 dark:text-white">{title}</div>
        {extra}
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="text-xs text-gray-700 dark:text-gray-400">{label}</span>
      <span className="ml-auto text-right text-[13px] text-gray-900 dark:text-white">{children}</span>
    </div>
  )
}

type Analysis = NonNullable<ReturnType<typeof analyzeGames>>

function SummaryPane({ analysis, data, count, onCollectChampion, collecting }: { analysis: Analysis; data: ReturnType<TabRuntime['getSnapshot']>; count: number; onCollectChampion: (championId: number) => void; collecting: boolean }) {
  const { t, res } = useMh()
  const firstPage = !data.page || data.page.query.startIndex === 0
  const all = analysis.winLoss.all
  const streak = firstPage ? (all.winningStreak >= 2 ? { win: true, count: all.winningStreak } : all.losingStreak >= 2 ? { win: false, count: all.losingStreak } : null) : null
  const champions = Object.values(analysis.champions)
    .filter(c => c.winLoss.all.count >= 1)
    .sort((a, b) => (a.winLoss.all.count !== b.winLoss.all.count ? b.winLoss.all.count - a.winLoss.all.count : b.winLoss.all.wins - a.winLoss.all.wins))
  const mastery = Object.fromEntries((data.mastery.data?.masteries ?? []).map(m => [m.championId, m]))
  const score = analysis.akariScore
  return (
    <Section title={t('playerTabs.summary.title')} extra={<span className="text-[11px] text-gray-500 dark:text-gray-400">{t('playerTabs.summary.sampleSize', { count })}</span>}>
      <div className="flex flex-col gap-1">
        <Row label={t('playerTabs.summary.akariScore')}>
          {score ? (
            <Tip content={<AkariScoreDetails score={score} />}>
              <span tabIndex={0} className="cursor-default tabular-nums">{score.total.toFixed(2)}</span>
            </Tip>
          ) : (
            <span className="opacity-60">{t('playerTabs.summary.na')}</span>
          )}
        </Row>
        <Row label={t('playerTabs.summary.avgKda')}>
          <Tip content={`${analysis.summary.kills} / ${analysis.summary.deaths} / ${analysis.summary.assists}`}>
            <span tabIndex={0} className="cursor-default">{analysis.summary.avgKda.toFixed(2)}</span>
          </Tip>
        </Row>
        <Row label={t('playerTabs.summary.avgKp')}>{(analysis.summary.avgKillParticipation * 100).toFixed()}%</Row>
        <Row label={t('playerTabs.summary.avgDmg')}>{(analysis.summary.avgChampionDamagePercentageOfTeam * 100).toFixed()}%</Row>
        <Row label={t('playerTabs.summary.avgDmgTaken')}>{(analysis.summary.avgDamageTakenPercentageOfTeam * 100).toFixed()}%</Row>
        <Row label={t('playerTabs.summary.avgGold')}>{(analysis.summary.avgGoldPercentageOfTeam * 100).toFixed()}%</Row>
        <Row label={t('playerTabs.summary.avgCsPerMinute')}>{t('playerTabs.summary.perMinuteValue', { value: analysis.summary.avgCsPerMinute.toFixed(1) })}</Row>
        {(all.activeSessionWins > 0 || all.activeSessionLosses > 0) && firstPage && (
          <Row label={t('playerTabs.summary.activeSession')}>
            {all.activeSessionWins} {t('playerTabs.summary.winShort')} {all.activeSessionLosses} {t('playerTabs.summary.lossShort')} ({((all.activeSessionWins / (all.activeSessionWins + all.activeSessionLosses)) * 100).toFixed()}%)
          </Row>
        )}
        <Row label={t('playerTabs.summary.winLose')}>
          {all.wins} {t('playerTabs.summary.winShort')} {all.losses} {t('playerTabs.summary.lossShort')} ({(all.winRate * 100).toFixed()}%)
          {streak && (
            <span className="ml-1 inline-flex max-w-55 flex-wrap items-center justify-end gap-1">
              <span className={`rounded px-1 py-0.5 text-[12px] leading-none ${streak.win ? 'border border-emerald-500/45 bg-emerald-500/12 font-semibold text-emerald-700 dark:border-emerald-300/55 dark:bg-emerald-300/15 dark:text-emerald-300' : 'border border-red-500/45 bg-red-500/12 font-semibold text-red-700 dark:border-red-300/55 dark:bg-red-300/15 dark:text-red-300'}`}>
                {t(streak.win ? 'playerTabs.summary.winningStreak' : 'playerTabs.summary.losingStreak', { count: streak.count })}
              </span>
            </span>
          )}
        </Row>
        {(analysis.teamSide.blueSideCount > 0 || analysis.teamSide.redSideCount > 0) && (
          <Row label={t('playerTabs.summary.teamSides')}>
            <span className="flex items-center">
              <span className="mr-1 size-3 rounded-full bg-blue-500" />
              <span>{analysis.teamSide.blueSideCount}</span>
              <span className="mx-2 text-xs text-gray-700 dark:text-gray-400">/</span>
              <span className="mr-1 size-3 rounded-full bg-red-400" />
              <span>{analysis.teamSide.redSideCount}</span>
            </span>
          </Row>
        )}
        {champions.length > 0 && (
          <div className="flex w-full items-center gap-2">
            <span className="text-xs text-gray-700 dark:text-gray-400">{t('playerTabs.summary.champions')}</span>
            <div className="ml-auto flex max-w-27.5 flex-wrap justify-end gap-0.5">
              {champions.map(c => (
                <Tip
                  key={c.championId}
                  placement="right"
                  delay={200}
                  content={
                    <div className="min-w-48 text-xs">
                      <div className="mb-2 flex items-center gap-2">
                        <ChampionIcon championId={c.championId} className="size-6 rounded" />
                        <span className="font-bold">{res.championName(c.championId)}</span>
                      </div>
                      <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                        <span className="text-black/60 dark:text-white/60">{t('playerTabs.summary.winLose')}</span>
                        <span className="text-right">{c.winLoss.all.wins} {t('playerTabs.summary.winShort')} {c.winLoss.all.losses} {t('playerTabs.summary.lossShort')} ({(c.winLoss.all.winRate * 100).toFixed()}%)</span>
                        <span className="text-black/60 dark:text-white/60">{t('playerTabs.summary.avgKda')}</span>
                        <span className="text-right">{c.summary.avgKda.toFixed(2)}</span>
                        {c.akariScore && (<><span className="text-black/60 dark:text-white/60">{t('playerTabs.summary.akariScore')}</span><span className="text-right">{c.akariScore.total.toFixed(2)}</span></>)}
                        {mastery[c.championId] && (<><span className="text-black/60 dark:text-white/60">{t('playerTabs.championMastery.pointsLabel')}</span><span className="text-right">{mastery[c.championId].championPoints.toLocaleString()}</span></>)}
                      </div>
                      <button type="button" className="mh-button mt-2 w-full px-2 py-1" disabled={collecting} onClick={() => onCollectChampion(c.championId)}>
                        {t('playerTabs.summary.collectChampionMatches', { champion: res.championName(c.championId) })}
                      </button>
                    </div>
                  }
                >
                  <div tabIndex={0} className="relative h-5 w-5 cursor-default rounded transition-[filter]">
                    <ChampionIcon championId={c.championId} className="h-full w-full" />
                    <div className="absolute -right-0.5 -bottom-1 rounded-sm bg-black/60 px-0.5 text-[10px] text-gray-200">{c.winLoss.all.count}</div>
                  </div>
                </Tip>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

function AkariScoreDetails({ score }: { score: NonNullable<Analysis['akariScore']> }) {
  const { t } = useMh()
  const entries = Object.entries(score).filter(([key, value]) => key !== 'total' && typeof value === 'number') as Array<[string, number]>
  return (
    <div className="min-w-48 text-xs">
      <div className="mb-1 font-bold">{t('akariScore.title')}: {score.total.toFixed(2)}</div>
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-black/60 dark:text-white/60">{t(`akariScore.${key}`, { defaultValue: key })}</span>
            <span className="text-right tabular-nums">{value.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-black/50 dark:text-white/50">{t('akariScore.notOfficial')}</div>
    </div>
  )
}

type MasteryItem = Mastery & { lastPlayTime?: number }

/** Full mastery list, read once per tab and shared by the pane and the dialog. */
function useAllMastery(enabled: boolean) {
  const tab = useActiveTabContext()
  const [state, setState] = useState<{ items: MasteryItem[] | null; error: string | null }>({ items: null, error: null })
  useEffect(() => {
    if (!enabled) return
    let alive = true
    tab.runtime.loadAllMastery().then(
      list => alive && setState({ items: list, error: null }),
      reason => alive && setState({ items: null, error: (reason as { code?: string })?.code ?? 'Io' })
    )
    return () => {
      alive = false
    }
  }, [enabled, tab.runtime])
  return state
}

function MasterySortSwitch({ value, onChange }: { value: MasterySort; onChange: (value: MasterySort) => void }) {
  const { t } = useMh()
  const options: Array<{ value: MasterySort; label: string }> = [
    { value: 'points', label: t('playerTabs.championMastery.sortPoints') },
    { value: 'recent', label: t('playerTabs.championMastery.sortRecent') }
  ]
  return <HeroTabs size="sm" className="shrink-0" items={options} value={value} label={t('playerTabs.championMastery.sortBy')} onChange={onChange} />
}

/** Upstream ChampionMasteryPane popover. */
function MasteryDetails({ mastery }: { mastery: MasteryItem }) {
  const { t, res, locale } = useMh()
  const row = (label: string, value: React.ReactNode) => (
    <>
      <div className="text-black/60 dark:text-white/60">{label}</div>
      <div className="text-right text-black/85 tabular-nums dark:text-white/85">{value}</div>
    </>
  )
  return (
    <div className="min-w-42 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <ChampionIcon championId={mastery.championId} className="size-6 rounded" />
        <div className="text-xs font-bold text-black/80 dark:text-white/80">{res.championName(mastery.championId)}</div>
      </div>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        {row(t('playerTabs.championMastery.levelLabel'), t('playerTabs.championMastery.level', { level: mastery.championLevel }))}
        {row(t('playerTabs.championMastery.pointsLabel'), formatExtremeNumber(mastery.championPoints, locale))}
        {mastery.highestGrade && row(t('playerTabs.championMastery.highestGradeLabel'), mastery.highestGrade)}
        {!!mastery.championSeasonMilestone && row(t('playerTabs.championMastery.seasonMilestoneLabel'), mastery.championSeasonMilestone)}
        {!!mastery.lastPlayTime && row(t('playerTabs.championMastery.lastPlayTimeLabel'), formatPlayDate(mastery.lastPlayTime))}
      </div>
    </div>
  )
}

function MasteryPane({ data, open, onOpen, sort, onSort }: {
  data: ReturnType<TabRuntime['getSnapshot']>
  open: boolean
  onOpen: (open: boolean) => void
  sort: MasterySort
  onSort: (sort: MasterySort) => void
}) {
  const { t, res, locale } = useMh()
  const mastery = data.mastery.data
  // The top list is ordered by points; "last played" needs every champion.
  const all = useAllMastery(sort === 'recent' && !!mastery?.masteries?.length)
  if (data.mastery.status === 'idle' || (data.mastery.status === 'ready' && !mastery?.masteries?.length)) return null
  const top = mastery?.masteries ?? []
  const recent = sort === 'recent'
  const masteries: MasteryItem[] = recent ? sortMasteries(all.items ?? [], 'recent').slice(0, CHAMPION_MASTERY_TOP_COUNT) : sortMasteries(top, 'points')
  const loading = data.mastery.status === 'loading' || (recent && !all.items && !all.error)
  const error = data.mastery.status === 'error' ? data.mastery.error : recent ? all.error : null
  return (
    <Section
      title={t('playerTabs.championMastery.title')}
      extra={top.length > 0 && <button type="button" className="mh-button px-2 py-0.5 text-xs" onClick={() => onOpen(true)}>{t('playerTabs.championMastery.viewAll')}</button>}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{mastery && t('playerTabs.championMastery.score', { score: mastery.score })}</div>
        {top.length > 0 && <MasterySortSwitch value={sort} onChange={onSort} />}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="mh-skeleton h-7" />)}</div>
      ) : error ? (
        <div className="text-xs text-gray-500">{t('playerTabs.championMastery.loadFailed', { reason: error })}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {masteries.map(m => (
            <Tip key={m.championId} delay={50} placement="right" content={<MasteryDetails mastery={m} />}>
              <div tabIndex={0} className="grid cursor-default grid-cols-[28px_minmax(0,1fr)_76px] items-center gap-2 rounded-sm">
                <ChampionIcon championId={m.championId} className="h-7 w-7 shrink-0 rounded" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-gray-900 dark:text-white">{res.championName(m.championId)}</div>
                  <div className="truncate text-[10px] text-gray-500 tabular-nums dark:text-gray-400">
                    {t('playerTabs.championMastery.level', { level: m.championLevel })}
                    {!!m.lastPlayTime && (
                      <>
                        {' · '}
                        <span className={recent ? 'text-gray-700 dark:text-gray-200' : ''}>{formatPlayDate(m.lastPlayTime)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">{t('playerTabs.championMastery.pointsLabel')}</div>
                  <div className="text-[11px] text-gray-700 tabular-nums dark:text-gray-200">{formatExtremeNumber(m.championPoints, locale)}</div>
                </div>
              </div>
            </Tip>
          ))}
        </div>
      )}
      {open && <MasteryModal score={mastery?.score} sort={sort} onSort={onSort} onClose={() => onOpen(false)} />}
    </Section>
  )
}

/** Upstream ChampionMasteryModal, with a points / last played sort. */
function MasteryModal({ score, sort, onSort, onClose }: { score?: number; sort: MasterySort; onSort: (sort: MasterySort) => void; onClose: () => void }) {
  const { t, res, locale } = useMh()
  const { items, error } = useAllMastery(true)
  const [query, setQuery] = useState('')
  const sorted = useMemo(() => sortMasteries(items ?? [], sort), [items, sort])
  const pattern = query.trim().toLowerCase()
  const filtered = pattern ? sorted.filter(item => res.championName(item.championId).toLowerCase().includes(pattern) || String(item.championId) === pattern) : sorted
  const meta = (m: MasteryItem) =>
    [
      m.highestGrade && t('playerTabs.championMastery.highestGrade', { grade: m.highestGrade }),
      m.championSeasonMilestone && t('playerTabs.championMastery.seasonMilestone', { milestone: m.championSeasonMilestone })
    ]
      .filter(Boolean)
      .join(' · ')
  const secondary = (m: MasteryItem) =>
    [
      m.lastPlayTime && t('playerTabs.championMastery.lastPlayTime', { time: formatPlayDate(m.lastPlayTime) }),
      t('playerTabs.championMastery.progress', {
        since: formatExtremeNumber(m.championPointsSinceLastLevel ?? 0, locale),
        // Past the last level the client reports a negative remainder.
        until: formatExtremeNumber(Math.max(0, m.championPointsUntilNextLevel ?? 0), locale)
      }),
      m.tokensEarned && t('playerTabs.championMastery.tokensEarned', { count: m.tokensEarned })
    ]
      .filter(Boolean)
      .join(' · ')
  const summary = [
    score !== undefined && t('playerTabs.championMastery.score', { score }),
    items?.length && t('playerTabs.championMastery.filteredChampions', { count: filtered.length, total: items.length })
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Modal onClose={onClose} label={t('playerTabs.championMastery.modalTitle')}>
      <div className="flex h-[82vh] max-h-190 min-h-100 w-[min(700px,92vw)] flex-col rounded-lg bg-neutral-100/95 p-4 shadow-xl dark:bg-neutral-900/95">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 dark:text-white">{t('playerTabs.championMastery.modalTitle')}</div>
            {summary && <div className="text-xs text-gray-500 dark:text-gray-400">{summary}</div>}
          </div>
          <div className="flex items-center gap-2">
            <MasterySortSwitch value={sort} onChange={onSort} />
            <button type="button" className="mh-button size-7" aria-label={t('common.close')} onClick={onClose}>
              <CloseOutlined />
            </button>
          </div>
        </div>
        <input
          className="mh-input mb-3"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('playerTabs.championMastery.search')}
          aria-label={t('playerTabs.championMastery.search')}
        />
        {error ? (
          <div className="flex h-80 items-center justify-center text-sm text-red-600 dark:text-red-300">{t('playerTabs.championMastery.loadFailed', { reason: error })}</div>
        ) : !items ? (
          <div className="flex h-80 items-center justify-center">
            <Spinner />
          </div>
        ) : !filtered.length ? (
          <div className="flex h-80 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            {items.length ? t('playerTabs.championMastery.noFilterResult') : t('playerTabs.championMastery.noData')}
          </div>
        ) : (
          <div className="mh-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            {filtered.map(m => (
              <div key={m.championId} className="flex h-14 items-center gap-2.5">
                <ChampionIcon championId={m.championId} className="size-8 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                    <div className="truncate font-bold text-gray-900 dark:text-white">{res.championName(m.championId)}</div>
                    {meta(m) && <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{meta(m)}</div>}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-500 tabular-nums dark:text-gray-400">{secondary(m)}</div>
                </div>
                <div className="w-34 shrink-0 text-right">
                  <div className="text-[11px] font-semibold text-gray-800 tabular-nums dark:text-gray-100">{t('playerTabs.championMastery.level', { level: m.championLevel })}</div>
                  <div className="text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
                    {t('playerTabs.championMastery.points', { points: formatExtremeNumber(m.championPoints, locale) })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function RecentlyPlayers({ side, relationship, open }: { side: 'ally' | 'enemy'; relationship: ReturnType<typeof analyzeRelationship>; open: PlayerLink }) {
  const { t } = useMh()
  const opponent = side === 'enemy'
  const players = Object.values(relationship)
    .map(a => ({ ...a, games: a.games.filter(g => g.isOpponent === opponent) }))
    .filter(a => a.games.length >= RECENTLY_PLAYED_PLAYER_THRESHOLD)
    .map(a => ({ ...a, win: a.games.filter(g => (opponent ? !g.win : g.win)).length, lose: a.games.filter(g => (opponent ? g.win : !g.win)).length }))
    .sort((a, b) => (a.games.length !== b.games.length ? b.games.length - a.games.length : b.win - a.win))
  if (!players.length) return null
  return (
    <Section title={opponent ? t('playerTabs.recentPlayers.opponentsTitle') : t('playerTabs.recentPlayers.teammatesTitle')}>
      <div className="flex flex-col gap-1">
        {players.map(p => (
          <div key={p.targetPuuid} className="flex items-center">
            <GameImage path={profileIconPath(p.targetProfileIconId)} className="size-4.5 rounded-sm" />
            <div className="group flex cursor-pointer items-end" {...playerLinkHandlers(open, p.targetPuuid, { gameName: p.targetGameName, tagLine: p.targetTagLine })}>
              <span className="ml-1 max-w-30 truncate text-xs text-gray-900 transition-all group-hover:brightness-125 dark:text-white">{p.targetGameName}</span>
              <span className="ml-0.5 text-[11px] text-gray-500 transition-all group-hover:brightness-125 dark:text-gray-400">#{p.targetTagLine}</span>
            </div>
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{p.win} {t('playerTabs.recentPlayers.win')} {p.lose} {t('playerTabs.recentPlayers.lose')}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

/** Upstream PlayerChallenges item order; the IDs are the collection challenges. */
const COLLECTION_ITEMS: Array<[number, string]> = [
  [505001, 'champions'],
  [510001, 'championSkins'],
  [510011, 'chromaSkins'],
  [504003, 'wardSkins'],
  [504002, 'summonerIcons'],
  [504004, 'emotes']
]

/** Upstream PlayerChallenges (收藏): SGP challenge values, hidden when there are none. */
function CollectionBlock({ data }: { data: ReturnType<TabRuntime['getSnapshot']> }) {
  const { t, locale } = useMh()
  const values = new Map((data.collection.data ?? []).map(item => [item.id, item.currentValue]))
  const items = COLLECTION_ITEMS.filter(([id]) => values.has(id))
  if (!items.length) return null
  return (
    <Section title={t('playerTabs.challenges.titleAssets')}>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([id, key]) => (
          <div key={id} className="flex flex-col">
            <div className="text-xs text-black/60 dark:text-white/60">{t(`playerTabs.challenges.${key}`)}</div>
            <div className="text-lg font-bold text-black dark:text-white">{values.get(id)!.toLocaleString(locale)}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function EncounteredGames({ tab, me }: { tab: PlayerTab; me?: string }) {
  const { t, res, locale } = useMh()
  const [games, setGames] = useState<LcuOrSgpGameSummary[] | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (tab.isSelf || !me) return
    let alive = true
    desktop
      .invoke<Array<{ data: unknown }>>('history_list_games', { ownerPuuid: me, limit: 1000 })
      .then(rows => {
        if (!alive) return
        const list: LcuOrSgpGameSummary[] = []
        for (const row of rows) {
          const raw = row.data as { gameId: string | number }
          const id = Number(raw?.gameId)
          if (!Number.isSafeInteger(id)) continue
          const summary = { source: 'lcu', gameId: id, data: { ...(raw as object), gameId: id } } as LcuOrSgpGameSummary
          try {
            if (toParticipants(summary, toBasicInfo(summary)).some(p => p.puuid === tab.puuid)) list.push(summary)
          } catch {
            /* malformed local record */
          }
        }
        setGames(list)
      })
      .catch(reason => alive && setError((reason as { code?: string })?.code ?? 'Io'))
    return () => {
      alive = false
    }
  }, [tab.isSelf, tab.puuid, me])
  if (tab.isSelf || !me) return null
  const pages = Math.max(1, Math.ceil((games?.length ?? 0) / ENCOUNTERED_GAMES_PAGE_SIZE))
  const visible = (games ?? []).slice(page * ENCOUNTERED_GAMES_PAGE_SIZE, (page + 1) * ENCOUNTERED_GAMES_PAGE_SIZE)
  return (
    <Section title={t('playerTabs.encounteredGames.title')}>
      <div className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">{t('playerTabs.encounteredGames.localOnly')}</div>
      {error ? (
        <div className="text-xs">{t('playerTabs.profile.failedToLoadEncounteredGames', { reason: error })}</div>
      ) : !games ? (
        <Spinner />
      ) : games.length === 0 ? (
        <div className="text-xs text-gray-500">{t('playerTabs.encounteredGames.empty')}</div>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map(game => {
            const basic = toBasicInfo(game)
            const participants = toParticipants(game, basic)
            const self = participants.find(p => p.puuid === me)
            const target = participants.find(p => p.puuid === tab.puuid)
            if (!self || !target) return null
            const ally = self.teamIdentifier === target.teamIdentifier
            return (
              <div key={gameKey(game)} className="flex items-center gap-1 text-xs">
                <ChampionIcon championId={self.championId} className="size-4 rounded" />
                <span className={ally ? 'text-blue-600 dark:text-blue-300' : 'text-red-600 dark:text-red-300'}>{ally ? t('playerTabs.encounteredGames.ally') : t('playerTabs.encounteredGames.enemy')}</span>
                <ChampionIcon championId={target.championId} className="size-4 rounded" />
                <span className="truncate">{res.queueName(basic.queueId)}</span>
                <span className={`ml-auto ${self.win ? 'text-blue-600 dark:text-blue-300' : 'text-red-600 dark:text-red-300'}`}>{t(`matchCard.result.${self.winResult}`)}</span>
                <span className="text-gray-500">{new Date(basic.gameCreation).toLocaleDateString(locale)}</span>
              </div>
            )
          })}
          {pages > 1 && (
            <div className="mt-1 flex items-center justify-center gap-2 text-xs">
              <button type="button" className="mh-icon-button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t('playerTabs.profile.prevPage')}><LeftOutlined /></button>
              {page + 1} / {pages}
              <button type="button" className="mh-icon-button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label={t('playerTabs.profile.nextPage')}><RightOutlined /></button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------ pagination */

function Pagination({ view, data, busy, onPage, onPageSize, onFilter, onClearFilters, filterActive, floating, queues, onQueue }: {
  view: TabView
  /** SGP queue tags; null when this tab reads LCU (no server-side queue filter). */
  queues: number[] | null
  onQueue: (tag: string) => void
  data: ReturnType<TabRuntime['getSnapshot']>
  busy: boolean
  onPage: (startIndex: number) => void
  onPageSize: (size: number) => void
  onFilter: () => void
  onClearFilters: () => void
  filterActive: boolean
  floating?: boolean
}) {
  const { t } = useMh()
  const [goto, setGoto] = useState<string | null>(null)
  const page = data.page
  const collect = page?.isCollect
  const count = page?.query.count ?? view.pageSize
  const current = Math.floor((page?.query.startIndex ?? view.startIndex) / count) + 1
  const sizes = [...MATCH_HISTORY_REGULAR_PAGE_SIZES, ...MATCH_HISTORY_COLLECTION_PAGE_SIZES]
  const shell = `mh-pagination mh-panel flex flex-col gap-3 px-4 py-3 transition-colors @[480px]:ml-auto @[480px]:w-fit @[480px]:flex-row @[480px]:items-center @[480px]:gap-2 @[480px]:px-2 @[480px]:py-1.5 ${floating ? 'floating' : ''}`
  if (collect) {
    return (
      <div className={shell}>
        <div className="text-xs text-black/70 dark:text-white/70">
          {t('playerTabs.matchHistory.collectMode.summary', { collected: page.games.length, scanned: page.scanned ?? 0 })}
        </div>
        <button type="button" className="mh-button px-2 py-1 text-xs" disabled={busy} onClick={onFilter}><FilterOutlined /> {t('playerTabs.matchHistory.filters.title')}</button>
        <button type="button" className="mh-button px-2 py-1 text-xs" disabled={busy} onClick={() => { onClearFilters(); onPage(0) }}>{t('playerTabs.matchHistory.collectMode.exit')}</button>
      </div>
    )
  }
  return (
    <div className={shell}>
      {queues && (
        <div className="flex flex-col gap-2 @[480px]:block">
          <div className="text-xs text-black/60 @[480px]:hidden dark:text-white/60" title={t('playerTabs.profile.sgpQueueOnlyTooltip')}>{t('playerTabs.profile.queue')}</div>
          <QueueSelect value={page?.query.tag ?? ALL_SGPTAG_VALUE} queues={queues} disabled={busy} onChange={onQueue} />
        </div>
      )}
      <div className="flex flex-col gap-2 @[480px]:block">
        <div className="text-xs text-black/60 @[480px]:hidden dark:text-white/60">{t('playerTabs.matchHistory.pagination')}</div>
        <div className="flex items-center gap-1">
          <HeroSelect
            className="mr-2 w-40"
            disabled={busy}
            value={String(count)}
            label={t('playerTabs.matchHistory.pagination')}
            options={sizes.map(size => ({
              value: String(size),
              label: `${size > MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE ? `${t('playerTabs.matchHistory.collectMode.pageSizeOptionTag')} · ` : ''}${t('playerTabs.profile.itemPerPage', { count: size })}`
            }))}
            onChange={value => onPageSize(Number(value))}
          />
          <button type="button" className="mh-round-button" disabled={current <= 1 || busy} title={t('playerTabs.profile.prevPage')} aria-label={t('playerTabs.profile.prevPage')} onClick={() => onPage((current - 2) * count)}>
            <LeftOutlined />
          </button>
          <Tip
            trigger="click"
            show={goto !== null}
            onShowChange={show => setGoto(show ? String(current) : null)}
            content={
              <div className="flex flex-col gap-2 p-1">
                <div className="text-xs text-black/60 dark:text-white/60">{t('playerTabs.profile.goToPage')}</div>
                <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); const value = Math.max(1, Math.floor(Number(goto) || 1)); setGoto(null); onPage((value - 1) * count) }}>
                  <input className="mh-input w-28" type="number" min={1} value={goto ?? ''} onChange={event => setGoto(event.target.value)} disabled={busy} />
                  <button type="submit" className="mh-round-button" disabled={busy} aria-label={t('playerTabs.profile.goToPage')}><RightOutlined /></button>
                  <button type="button" className="mh-round-button" disabled={busy || current <= 1} title={t('playerTabs.profile.firstPage')} aria-label={t('playerTabs.profile.firstPage')} onClick={() => { setGoto(null); onPage(0) }}><StepBackwardOutlined /></button>
                </form>
              </div>
            }
          >
            <button type="button" className="min-w-6 cursor-pointer border-0 bg-transparent text-center text-sm text-black dark:text-white/80" disabled={busy}>{current}</button>
          </Tip>
          <button type="button" className="mh-round-button" disabled={busy} title={t('playerTabs.profile.nextPage')} aria-label={t('playerTabs.profile.nextPage')} onClick={() => onPage(current * count)}>
            <RightOutlined />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs text-black/60 @[480px]:hidden dark:text-white/60">{t('playerTabs.matchHistory.filters.title')}</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" className={`mh-button h-8 text-sm ${filterActive ? 'active' : ''}`} disabled={busy} onClick={onFilter}>
            <FilterOutlined /> {t('playerTabs.matchHistory.filters.pageFilter')}
          </button>
          {filterActive && <button type="button" className="mh-button h-8 text-sm" disabled={busy} onClick={onClearFilters}>{t('playerTabs.profile.clearFilters')}</button>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ panel */

const ActiveTabContext = createContext<{ runtime: TabRuntime } | null>(null)
const useActiveTabContext = () => useContext(ActiveTabContext)!

export function PlayerTabPanel({ tab, scope, me, onOpenPlayer, visible }: { tab: PlayerTab; scope: string; me?: string; onOpenPlayer: PlayerLink; visible: boolean }) {
  const { t, data: gameData } = useMh()
  const dispatch = useDispatch()
  const { runtime, data } = useRuntime(tab, scope)
  const view = tab.view
  const setView = useCallback((patch: Partial<TabView>) => dispatch(tabsActions.view({ id: tab.id, patch })), [dispatch, tab.id])
  const scroller = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [stuck, setStuck] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const wide = width >= PLAYER_TAB_WIDE_MIN_WIDTH
  const busy = data.pageStatus === 'loading' || !!data.collect
  const context = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot).context
  // Upstream shows the queue selector only while the tab reads SGP.
  const sgp = (data.page?.source ?? runtime.source) === 'sgp'
  const queues = sgp ? (context?.capabilities?.sgp?.queues ?? []) : null
  const tag = sgp && view.queue !== ALL_SGPTAG_VALUE ? view.queue : undefined

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  // Initial loads for this player; repeated shows reuse what is already loaded.
  useEffect(() => {
    void runtime.loadProfile()
    void runtime.loadRanked()
    void runtime.loadMastery()
    void runtime.loadCollection()
  }, [runtime])
  useEffect(() => {
    if (data.page?.isCollect || data.collect) return
    void runtime.loadPage({ startIndex: view.startIndex, count: Math.min(view.pageSize, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE), tag })
  }, [runtime, view.startIndex, view.pageSize, tag, data.page?.isCollect, data.collect])

  // A renamed player keeps the same tab; only the label follows.
  useEffect(() => {
    const summoner = data.profile.data?.summoner
    if (summoner) dispatch(tabsActions.label({ id: tab.id, label: { gameName: summoner.gameName, tagLine: summoner.tagLine, profileIconId: summoner.profileIconId } }))
  }, [data.profile.data, dispatch, tab.id])

  // Restore this tab's scroll position when it becomes visible again.
  useLayoutEffect(() => {
    if (visible && scroller.current) scroller.current.scrollTop = scrollPositions.get(tab.id) ?? 0
  }, [visible, tab.id])
  useEffect(() => () => void scrollPositions.delete(tab.id), [tab.id])

  useEffect(() => {
    const element = sentinel.current
    if (!element || !scroller.current) return
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { root: scroller.current })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const filters = view.filters
  const predicate = useMemo(() => {
    const state = filters.mode === 'simple' ? toFilterState(filters.simple, tab.puuid, { enablePosition: true }) : filters.advanced
    try {
      return toPredicate(state)
    } catch {
      return () => true
    }
  }, [filters, tab.puuid])
  const filterActive = filters.mode === 'simple' ? hasSimplePredicate(filters.simple, { enablePosition: true }) : hasPredicate(filters.advanced)
  const games = data.page?.games ?? []
  const filtered = useMemo(() => (data.page?.isCollect ? games : games.filter(game => predicate(game))), [games, predicate, data.page?.isCollect])
  const analysis = useMemo(
    () => analyzeGames(filtered.map(game => ({ gameId: game.gameId, summary: game, details: data.details[gameKey(game)] })), tab.puuid),
    [filtered, data.details, tab.puuid]
  )
  const relationship = useMemo(() => analyzeRelationship(filtered, tab.puuid), [filtered, tab.puuid])

  const clearFilters = () => setView({ filters: filters.mode === 'simple' ? { ...filters, simple: clearSimplePredicate(filters.simple) } : { ...filters, advanced: clearPredicate(filters.advanced) } })
  const onPage = (startIndex: number) => {
    const count = Math.min(data.page?.query.count ?? view.pageSize, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE)
    setView({ startIndex: Math.max(0, startIndex), pageSize: count })
    if (data.page?.isCollect) void runtime.loadPage({ startIndex: Math.max(0, startIndex), count, tag }, { force: true })
  }
  const onQueue = (value: string) => {
    setView({ queue: value, startIndex: 0 })
    if (data.page?.isCollect) {
      const count = Math.min(data.page.query.count, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE)
      void runtime.loadPage({ startIndex: 0, count, tag: value === ALL_SGPTAG_VALUE ? undefined : value }, { force: true })
    }
  }
  const onPageSize = (size: number) => {
    if (size <= MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE) {
      setView({ startIndex: 0, pageSize: size })
      if (data.page?.isCollect) void runtime.loadPage({ startIndex: 0, count: size, tag }, { force: true })
    } else {
      void runtime.loadByPageSize(size, predicate)
    }
  }
  const collectChampion = (championId: number) => {
    const params = { collectByChampionId: championId, expectedCount: view.pageSize }
    const state = createInitParamCollectFilterState(params, tab.puuid)
    if (!state) return
    const settings = createInitParamCollectSettings(params)
    void runtime.collect(settings, toPredicate(state))
  }
  const openLink: PlayerLink = onOpenPlayer
  const expanded = new Set(view.expanded)
  const pagination = (floating?: boolean) => (
    <div className="@container">
      <Pagination view={view} data={data} busy={busy} floating={floating} onPage={onPage} onPageSize={onPageSize} onFilter={() => setFilterOpen(true)} onClearFilters={clearFilters} filterActive={filterActive} queues={queues} onQueue={onQueue} />
    </div>
  )
  const sidebar = (
    <div className="flex flex-col gap-2">
      {wide && pagination()}
      {analysis && <SummaryPane analysis={analysis} data={data} count={filtered.length} onCollectChampion={collectChampion} collecting={busy} />}
      <MasteryPane data={data} open={view.masteryModal} onOpen={open => setView({ masteryModal: open })} sort={view.masterySort ?? 'points'} onSort={masterySort => setView({ masterySort })} />
      <RecentlyPlayers side="ally" relationship={relationship} open={openLink} />
      <RecentlyPlayers side="enemy" relationship={relationship} open={openLink} />
      <CollectionBlock data={data} />
      <EncounteredGames tab={tab} me={me} />
    </div>
  )
  return (
    <ActiveTabContext.Provider value={{ runtime }}>
      <div className="relative h-full" hidden={!visible}>
        <div ref={scroller} className="mh-scroll h-full overflow-auto" onScroll={event => visible && scrollPositions.set(tab.id, (event.currentTarget as HTMLDivElement).scrollTop)}>
          <div ref={container} className="@container w-full">
            {/* Unlike upstream's fixed 764/1248px caps, the list grows with the window so names fit. */}
            <div className="mx-auto box-border w-full pt-10 pb-4">
              <div className="mb-6 min-h-28 px-4"><PlayerHeader tab={tab} runtime={runtime} data={data} wide={wide} /></div>
              <div className="box-border px-4">
                <div ref={sentinel} className="h-0 w-full" />
                <div className={`grid grid-cols-1 items-start gap-3 ${wide ? 'grid-cols-[300px_minmax(0,1fr)]' : ''}`}>
                  {wide && <div className="sticky top-2 w-75">{sidebar}</div>}
                  <div className="min-w-0">
                    {!wide && (
                      <div className="sticky top-2 z-10 mb-2 flex min-w-0 items-start gap-2">
                        <button type="button" className="mh-round-button shrink-0" aria-label={t('playerTabs.matchHistory.sidebar.open')} title={t('playerTabs.matchHistory.sidebar.open')} onClick={() => setView({ sidebarOpen: true })}>
                          <MenuUnfoldOutlined />
                        </button>
                        <div className="min-w-0 flex-1">{pagination(stuck)}</div>
                      </div>
                    )}
                    {data.pageStatus === 'error' && (
                      <div className="mb-2 flex items-center justify-between gap-2 rounded bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                        {t('playerTabs.profile.failedToLoadMatchHistoryContent', { reason: data.pageError })}
                        <button type="button" className="mh-button px-2 py-0.5" onClick={() => void runtime.loadPage({ startIndex: view.startIndex, count: Math.min(view.pageSize, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE), tag }, { force: true })}>
                          {t('matchCard.common.refresh')}
                        </button>
                      </div>
                    )}
                    {data.page && data.page.incomplete.length > 0 && (
                      <div className="mb-2 rounded bg-amber-500/10 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                        {t('playerTabs.profile.incompleteGames', { count: data.page.incomplete.length })}
                      </div>
                    )}
                    {busy && (!data.page || filtered.length === 0) ? (
                      <div className="flex h-50 items-center justify-center mh-panel">
                        <div className="flex items-center gap-2"><Spinner /><span className="text-sm text-black/80 dark:text-white/60">{t('playerTabs.profile.loading')}</span></div>
                      </div>
                    ) : data.page ? (
                      <>
                        {filtered.length === 0 && (
                          <div className="flex h-50 flex-col items-center justify-center gap-2 mh-panel">
                            <span className="text-sm text-black/80 dark:text-white/60">{filterActive ? t('playerTabs.profile.noFilteredMatchHistory') : t('playerTabs.profile.noMatchHistory')}</span>
                            {filterActive && !data.page.isCollect && <button type="button" className="mh-button px-2 py-1 text-xs" onClick={clearFilters}>{t('playerTabs.profile.clearFilters')}</button>}
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          {filtered.map(game => {
                            const id = gameKey(game)
                            return (
                              <MatchCard
                                key={`${game.source}:${id}`}
                                summary={game}
                                details={data.details[id]}
                                puuid={tab.puuid}
                                expanded={expanded.has(id)}
                                onToggle={() => dispatch(tabsActions.expand({ id: tab.id, gameId: id }))}
                                detailTab={view.detailTabs[id]}
                                onDetailTab={detail => setView({ detailTabs: { ...view.detailTabs, [id]: detail } })}
                                loadingDetails={data.detailsLoading[id]}
                                detailsError={data.detailsError[id]}
                                replay={data.replays[id]}
                                onReplay={action => {
                                  // App-wide toasts: failures and a successful watch (as upstream), and a finished download.
                                  runtime.replayAction(id, action).then(
                                    () => toast.success(t(action === 'watch' ? 'playerTabs.profile.operationSuccessTitle' : 'playerTabs.profile.replayDownloaded')),
                                    error => {
                                      const reason =
                                        errorCode(error) === 'ReplayUnavailable'
                                          ? t('matchCard.replay.unavailable')
                                          : ((error as Partial<MatchHistoryError> | undefined)?.message ?? errorCode(error))
                                      toast.danger(t(action === 'watch' ? 'playerTabs.profile.failedToLaunchReplay' : 'playerTabs.profile.failedToDownloadReplay', { reason }))
                                    }
                                  )
                                }}
                                onLoadDetails={() => void runtime.loadDetails(id)}
                                onOpenPlayer={openLink}
                              />
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-50 flex-col items-center justify-center gap-2 mh-panel">
                        <span className="text-sm text-black/80 dark:text-white/60">{t('playerTabs.profile.noMatchHistory')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {data.collect && (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded bg-neutral-200/95 px-4 py-2 text-xs shadow-lg dark:bg-neutral-800/95">
            <Spinner size={14} />
            {t('playerTabs.matchHistory.collectMode.progress', { collected: data.page?.games.length ?? 0, expected: data.collect.settings.expectedCount, scanned: data.page?.scanned ?? 0 })}
            <button type="button" className="mh-button px-2 py-0.5" onClick={() => runtime.stopCollect()}>{t('playerTabs.matchHistory.collectMode.stop')}</button>
          </div>
        )}
        {stuck && (
          <Button
            isIconOnly
            variant="primary"
            className="mh-back-top absolute right-8 bottom-8 z-10"
            aria-label={t('playerTabs.shell.scrollToTop')}
            onPress={() => scroller.current && scrollToTop(scroller.current)}
          >
            <ArrowUpOutlined />
          </Button>
        )}
        {!wide && (
          <Drawer open={view.sidebarOpen} label={t('playerTabs.matchHistory.sidebar.open')} onClose={() => setView({ sidebarOpen: false })}>
            {sidebar}
          </Drawer>
        )}
        {filterOpen && (
          <FilterModal
            filters={filters}
            puuid={tab.puuid}
            relationship={relationship}
            champions={gameData.champions}
            busy={busy}
            onClose={() => setFilterOpen(false)}
            onApply={next => {
              setView({ filters: next })
              setFilterOpen(false)
            }}
            onCollect={(next, expected) => {
              setView({ filters: next })
              setFilterOpen(false)
              const state = next.mode === 'simple' ? toFilterState(next.simple, tab.puuid, { enablePosition: true }) : next.advanced
              const step = Math.min(data.page?.query.count ?? view.pageSize, MATCH_HISTORY_MAX_REGULAR_PAGE_SIZE)
              void runtime.collect({ countPerIteration: step, expectedCount: expected, maxIteration: Math.ceil(1000 / step) }, toPredicate(state))
            }}
          />
        )}
      </div>
    </ActiveTabContext.Provider>
  )
}
