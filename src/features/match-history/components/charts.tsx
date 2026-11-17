import { useSyncExternalStore } from 'react'
import { noZero } from '../upstream/data-adapter/utils'
import type { CardModel } from './cardModel'
import { ChampionIcon, useMh } from './primitives'

/** Light / dark detection from the app's own theme attribute. */
export function useIsDark() {
  return useSyncExternalStore(
    listener => {
      const observer = new MutationObserver(listener)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => observer.disconnect()
    },
    () => document.documentElement.dataset.theme === 'dark',
    () => true
  )
}

/** Upstream RadarChart colours. */
function radarColors(dark: boolean) {
  return dark
    ? { player: { background: 'rgba(248,113,113,0.18)', border: 'rgba(252,165,165,0.95)', point: '#f87171' }, team: { background: 'rgba(148,163,184,0.18)', border: 'rgba(203,213,225,0.9)', point: '#cbd5f1' }, label: '#e2e8f0', grid: 'rgba(226,232,240,0.16)', angle: 'rgba(226,232,240,0.18)' }
    : { player: { background: 'rgba(255,99,132,0.16)', border: 'rgba(220,38,38,0.9)', point: '#ef4444' }, team: { background: 'rgba(148,163,184,0.18)', border: 'rgba(71,85,105,0.9)', point: '#475569' }, label: '#111827', grid: 'rgba(15,23,42,0.08)', angle: 'rgba(15,23,42,0.12)' }
}

/** Upstream radar metrics: each value is a ratio to the best player in the game. */
export function radarSeries(model: CardModel, puuid: string | undefined) {
  const participant = model.participants.find(p => p.puuid === puuid)
  const team = participant ? model.teams.teamStatMap[participant.teamIdentifier] : null
  if (!participant || !team) return null
  const all = model.teams.allTeamStats
  const size = model.participants.filter(p => p.teamIdentifier === team.teamIdentifier).length || 1
  return {
    participant,
    values: {
      damage: participant.totalDamageDealtToChampions,
      taken: participant.totalDamageTaken,
      gold: participant.goldEarned,
      cs: participant.cs,
      kda: participant.kda,
      kp: participant.killParticipation,
      heal: participant.totalHeal
    },
    player: [
      participant.totalDamageDealtToChampions / noZero(all.maxDamageDealtToChampions),
      participant.totalDamageTaken / noZero(all.maxDamageTaken),
      participant.goldEarned / noZero(all.maxGoldEarned),
      participant.cs / noZero(all.maxCs),
      participant.kda / noZero(all.maxKda),
      participant.killParticipation / noZero(all.maxKillParticipation),
      participant.totalHeal / noZero(all.maxHeal)
    ],
    team: [
      team.totalDamageDealtToChampions / size / noZero(all.maxDamageDealtToChampions),
      team.totalDamageTaken / size / noZero(all.maxDamageTaken),
      team.totalGoldEarned / size / noZero(all.maxGoldEarned),
      // Upstream divides by maxCs without noZero here; a zero max yields NaN, drawn at the centre.
      team.totalCs / size / all.maxCs,
      team.totalKda / size / noZero(all.maxKda),
      team.totalKillParticipation / size / noZero(all.maxKillParticipation),
      team.totalHeal / size / noZero(all.maxHeal)
    ]
  }
}

export function RadarChart({ model, puuid }: { model: CardModel; puuid?: string }) {
  const { t } = useMh()
  const dark = useIsDark()
  const series = radarSeries(model, puuid)
  if (!series) return null
  const colors = radarColors(dark)
  const labels = [
    t('matchCard.radar.damage', { value: series.values.damage.toLocaleString() }),
    t('matchCard.radar.taken', { value: series.values.taken.toLocaleString() }),
    t('matchCard.radar.gold', { value: series.values.gold.toLocaleString() }),
    t('matchCard.radar.cs', { value: series.values.cs.toLocaleString() }),
    t('matchCard.radar.kda', { value: series.values.kda.toFixed(2) }),
    t('matchCard.radar.kp', { value: (series.values.kp * 100).toFixed(0) }),
    t('matchCard.radar.heal', { value: series.values.heal.toLocaleString() })
  ]
  // Wider than tall: the side labels ("金幣 (22,648)") need ~100px beyond the grid.
  const width = 460
  const size = 320
  const cx = width / 2
  const center = size / 2
  const radius = 100
  const angle = (index: number) => -Math.PI / 2 + (index * 2 * Math.PI) / labels.length
  const point = (index: number, value: number) => {
    const r = radius * Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1)
    return [cx + r * Math.cos(angle(index)), center + r * Math.sin(angle(index))] as const
  }
  const polygon = (values: number[]) => values.map((value, index) => point(index, value).join(',')).join(' ')
  const name = `${series.participant.gameName}${series.participant.tagLine ? ` #${series.participant.tagLine}` : ''}`
  return (
    <div className="h-80 w-115 max-w-full" role="img" aria-label={labels.join(', ')}>
      <svg viewBox={`0 0 ${width} ${size}`} width="100%" height="100%" overflow="visible">
        {[0.2, 0.4, 0.6, 0.8, 1].map(level => (
          <polygon key={level} points={polygon(labels.map(() => level))} fill="none" stroke={colors.grid} />
        ))}
        {labels.map((_, index) => {
          const [x, y] = point(index, 1)
          return <line key={index} x1={cx} y1={center} x2={x} y2={y} stroke={colors.angle} />
        })}
        <polygon points={polygon(series.team)} fill={colors.team.background} stroke={colors.team.border} strokeWidth={2} />
        <polygon points={polygon(series.player)} fill={colors.player.background} stroke={colors.player.border} strokeWidth={2} />
        {series.player.map((value, index) => {
          const [x, y] = point(index, value)
          return <circle key={index} cx={x} cy={y} r={3} fill={colors.player.point} stroke="#fff" />
        })}
        {labels.map((label, index) => {
          const [x, y] = point(index, 1.22)
          return (
            <text key={index} x={x} y={y} fill={colors.label} fontSize={11} textAnchor={Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'} dominantBaseline="middle">
              {label}
            </text>
          )
        })}
        <g fontSize={11} fill={colors.label}>
          <rect x={8} y={size - 30} width={10} height={10} fill={colors.player.background} stroke={colors.player.border} />
          <text x={22} y={size - 21}>{name}</text>
          <rect x={8} y={size - 15} width={10} height={10} fill={colors.team.background} stroke={colors.team.border} />
          <text x={22} y={size - 6}>{t('matchCard.radar.teamAvg')}</text>
        </g>
      </svg>
    </div>
  )
}

/** Upstream DamageBar: physical / magic / true segments scaled to a baseline. */
export function DamageBar({ physical = 0, magic = 0, trueDamage = 0, baseline = 1, width = 52, height = 6, radius = 3 }: { physical?: number; magic?: number; trueDamage?: number; baseline?: number; width?: number; height?: number; radius?: number }) {
  const base = baseline || 1
  const parts = [
    { type: 'physical', width: (physical / base) * width },
    { type: 'magic', width: (magic / base) * width },
    { type: 'true', width: (trueDamage / base) * width }
  ]
  let x = 0
  return (
    <svg width={width} height={height} className="mh-damage-bar" style={{ borderRadius: radius }}>
      <rect x={0} y={0} width={width} height={height} className="bg" />
      {parts.map(part => {
        const rect = <rect key={part.type} x={x} y={0} height={height} width={Math.max(part.width, 0)} className={`${part.type}-damage`} />
        x += part.width
        return rect
      })}
    </svg>
  )
}

/**
 * Evenly spaced axis ticks (steps of 1, 2 or 5 × 10^n) covering zero and the data, so
 * bar lengths stay proportional to the values.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  let lo = Math.min(0, Number.isFinite(min) ? min : 0)
  let hi = Math.max(0, Number.isFinite(max) ? max : 0)
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / target
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const digits = Math.max(0, -Math.floor(Math.log10(step)))
  const ticks: number[] = []
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(digits)))
  return ticks
}

export interface StatsBarEntry {
  championId: number
  name: string
  value: number
  /** Bar colour (ally / enemy). */
  color: string
  /** Icon ring colour (gold for the owner). */
  ring: string
  /** Starts a new team block. */
  gap?: boolean
}

/** Module-level, so the resize listener is attached once rather than on every render. */
function subscribeResize(listener: () => void) {
  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

function useWindowSize() {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1280)
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 800)
  return { width, height }
}

/**
 * Chart geometry at 70% of the League client's post-game chart (≈553px plot, 38px rows,
 * 22px bars, 25px icons), scaled down further only when the window cannot fit it.
 */
export function statsBarLayout(rows: number, viewport: { width: number; height: number }) {
  // Room left for the table's sticky name column, icons, value labels and padding.
  const plot = Math.round(Math.max(280, Math.min(553, viewport.width - 380)))
  // Title, axis and padding take ~110px; team gap ~14px.
  const row = Math.floor(Math.max(26, Math.min(38, (viewport.height - 124) / Math.max(rows, 1))))
  return { plot, row, bar: Math.round(row * 0.58), icon: Math.min(25, row - 6), ticks: Math.max(5, Math.round(plot / 80)) }
}

/** Upstream StatsBarChart: one horizontal bar per player on a linear axis. */
export function StatsBarChart({ title, entries, percent = false }: { title: string; entries: StatsBarEntry[]; percent?: boolean }) {
  const { locale } = useMh()
  const viewport = useWindowSize()
  const layout = statsBarLayout(entries.length, viewport)
  const { plot } = layout
  const scale = percent ? 100 : 1
  const values = entries.map(entry => (Number.isFinite(entry.value) ? entry.value * scale : 0))
  const ticks = niceTicks(Math.min(...values), Math.max(...values), layout.ticks)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const x = (value: number) => ((value - lo) / (hi - lo)) * plot
  const format = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}${percent ? '%' : ''}`
  const gutter = layout.icon + 10
  const line = (tick: number) => (tick === lo ? 'bg-black/30 dark:bg-white/30' : 'bg-black/8 dark:bg-white/8')
  return (
    <div className="px-2 pt-1 pb-0.5" role="img" aria-label={title}>
      <div className="mb-3 text-center text-sm font-bold">{title}</div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0" style={{ left: gutter, width: plot }}>
          {ticks.map(tick => (
            <div key={tick} className={`absolute inset-y-0 w-px ${line(tick)}`} style={{ left: x(tick) }} />
          ))}
        </div>
        {entries.map((entry, index) => {
          const value = values[index]
          const start = x(Math.min(0, value))
          const width = Math.abs(x(value) - x(0))
          return (
            <div key={index} className="relative flex items-center" style={{ height: layout.row, marginTop: entry.gap ? 10 : 0 }}>
              <span className="box-border inline-flex shrink-0 rounded-full border-2 border-solid" style={{ borderColor: entry.ring, width: layout.icon, height: layout.icon }} title={entry.name}>
                <ChampionIcon championId={entry.championId} className="size-full rounded-full" />
              </span>
              <div className="relative h-full" style={{ marginLeft: 10, width: plot + 56 }}>
                <div className="absolute top-1/2 -translate-y-1/2" style={{ left: start, width, height: layout.bar, backgroundColor: entry.color }} />
                <div className="absolute top-1/2 -translate-y-1/2 pl-2 text-xs font-bold whitespace-nowrap tabular-nums" style={{ left: x(Math.max(0, value)) }}>
                  {Number.isFinite(entry.value) ? format(value) : 'N/A'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="relative mt-1 h-5 border-t border-solid border-black/30 dark:border-white/30" style={{ marginLeft: gutter, width: plot }}>
        {ticks.map(tick => (
          <span key={tick} className="absolute top-1 -translate-x-1/2 text-[11px] whitespace-nowrap text-black/50 tabular-nums dark:text-white/50" style={{ left: x(tick) }}>
            {format(tick)}
          </span>
        ))}
      </div>
    </div>
  )
}
