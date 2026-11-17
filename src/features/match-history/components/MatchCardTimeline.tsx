import { useMemo, useState } from 'react'
import map11 from '../assets/map/11.png'
import map12 from '../assets/map/12.png'
import map21 from '../assets/map/21.png'
import { isSgpChampionKillEvent, isSgpDetailedParticipantFrame } from '../upstream/data-adapter/match-history/frames'
import { isSupportedMap, mapToImagePosition, type MapId } from '../upstream/match-card/game-map'
import { playerColors, teamColor, type CardModel } from './cardModel'
import { useIsDark } from './charts'
import { ObjectiveIcon, winResultTagClass } from './MatchCardDetails'
import type { PlayerLink } from './MatchCard'
import { ChampionIcon, Tip, useMh } from './primitives'
import { VictimDamageDetails } from './VictimDamageDetails'

const pad = (value: number, size = 2) => String(value).padStart(size, '0')
/** Upstream `dayjs.duration(...).format('mm:ss:SSS')` (hours when over an hour). */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return total > 3_600_000 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(millis, 3)}` : `${pad(minutes + hours * 60)}:${pad(seconds)}:${pad(millis, 3)}`
}

export function MapPosition({ mapId = 11, points, size = 350 }: { mapId?: number; points: Array<{ x: number; y: number }>; size?: number }) {
  const image = mapId === 11 ? map11 : mapId === 12 ? map12 : mapId === 21 ? map21 : null
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {points.map((point, index) => {
        const mapped = mapToImagePosition(point.x, point.y, size, size, mapId as MapId)
        return <div key={index} className="absolute z-20 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300" style={{ left: mapped.left, top: mapped.top }} />
      })}
      {image ? <img className="absolute h-full w-full" src={image} alt="" /> : <div className="absolute h-full w-full bg-gray-700" />}
    </div>
  )
}

const SUPPORTED_EVENT_TYPES = ['CHAMPION_KILL', 'CHAMPION_SPECIAL_KILL', 'BUILDING_KILL', 'TURRET_PLATE_DESTROYED']

type AnyEvent = CardModel['frames'][number]['events'][number] & Record<string, any>

function Check({ checked, onChange, children, indeterminate = false }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode; indeterminate?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
      <input type="checkbox" className="mh-checkbox" checked={checked} ref={element => { if (element) element.indeterminate = indeterminate }} onChange={event => onChange(event.target.checked)} />
      {children}
    </label>
  )
}

export function MatchCardEventsTab({ model }: { model: CardModel; open: PlayerLink }) {
  const { t, res } = useMh()
  const { frames, participants, basicInfo, team } = model
  const [filters, setFilters] = useState<string[]>(['CHAMPION_KILL', 'BUILDING_KILL'])
  const [championIds, setChampionIds] = useState<number[]>([])
  const events = useMemo(() => (frames as Array<{ events: unknown[] }>).flatMap(frame => frame.events) as AnyEvent[], [frames])
  const eventTypes = useMemo(() => [...new Set(events.map(event => event.type).filter(type => SUPPORTED_EVENT_TYPES.includes(type)))], [events])
  const byId = useMemo(() => Object.fromEntries(participants.map(p => [p.participantId, p])), [participants])
  const involved = (event: AnyEvent) => [event.killerId, event.victimId, ...(Array.isArray(event.assistingParticipantIds) ? event.assistingParticipantIds : [])].filter(Boolean)
  const filtered = championIds.length === 0 ? events : events.filter(event => involved(event).some(id => championIds.includes(byId[id]?.championId)))
  const options = [...new Map(participants.map(p => [p.championId, { championId: p.championId, label: res.championName(p.championId) }])).values()].slice().sort((a, b) => a.label.localeCompare(b.label))
  const plates = (() => {
    const counts: Record<number, number> = {}
    events.filter(event => event.type === 'TURRET_PLATE_DESTROYED' && event.killerId !== 0).forEach(event => (counts[event.killerId] = (counts[event.killerId] || 0) + 1))
    const list = Object.entries(counts).slice().sort((a, b) => b[1] - a[1]).map(([id, count]) => (byId[Number(id)] ? { championId: byId[Number(id)].championId, count } : null)).filter(Boolean) as Array<{ championId: number; count: number }>
    return list.length ? list : null
  })()
  const last = frames[frames.length - 1]
  const lastEvent = last?.events?.[last.events.length - 1]
  const times = frames.length === 0 ? { first: 0, end: 0 } : { first: frames[0].timestamp, end: lastEvent?.type === 'GAME_END' ? lastEvent.timestamp : last.timestamp }
  const tag = winResultTagClass(team?.winResult)
  const eventName = (type: string) => t(`matchCard.frameEventType.${type}`, { defaultValue: type })
  const lane = (type: string) => t(`matchCard.laneType.${type}`, { defaultValue: type })
  const position = (event: AnyEvent) =>
    isSupportedMap(basicInfo.mapId) && event.position ? (
      <Tip placement="right" content={<MapPosition mapId={basicInfo.mapId} points={[event.position]} />}>
        <div tabIndex={0} className={`${tag} cursor-default`}>{t('matchCard.eventsTab.viewPosition')}</div>
      </Tip>
    ) : null
  const item = (key: string | number, time: number, kind: 'success' | 'warning' | 'default', header: React.ReactNode, body?: React.ReactNode) => (
    <li key={key} className={`mh-timeline-item ${kind}`}>
      <div className="text-sm">{header}</div>
      {body && <div className="mt-1">{body}</div>}
      <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">{formatDuration(time)}</div>
    </li>
  )
  return (
    <div className="flex h-142 w-full gap-4">
      <div className="mh-scroll min-h-0 flex-1 overflow-auto">
        <ol className="mh-timeline pt-2 pl-4">
          {item('start', times.first, 'default', t('matchCard.eventsTab.start'))}
          {filtered.map((event, index) => {
            if (event.type === 'CHAMPION_KILL' && filters.includes('CHAMPION_KILL')) {
              return item(
                index,
                event.timestamp,
                'success',
                <div className="flex items-center gap-2">
                  <div>{eventName(event.type)}</div>
                  {position(event)}
                  {isSgpChampionKillEvent(event) && (
                    <Tip placement="right" content={<VictimDamageDetails event={event} participants={participants} />}>
                      <div tabIndex={0} className={`${tag} cursor-default`}>{t('matchCard.eventsTab.viewVictimDamageDetails')}</div>
                    </Tip>
                  )}
                </div>,
                <div className="flex w-fit items-center gap-2">
                  <div className="flex items-end">
                    <ChampionIcon championId={byId[event.killerId]?.championId ?? 0} className="size-5 rounded not-last:mr-1" />
                    {(event.assistingParticipantIds ?? []).map((id: number) => <ChampionIcon key={id} championId={byId[id]?.championId ?? 0} className="size-3.5 rounded not-last:mr-0.5" />)}
                  </div>
                  <div className="text-sm text-black/80 dark:text-white/80">{t('matchCard.eventsTab.kill')}</div>
                  <ChampionIcon championId={byId[event.victimId]?.championId ?? 0} className="size-5 rounded" />
                </div>
              )
            }
            if (event.type === 'CHAMPION_SPECIAL_KILL' && filters.includes('CHAMPION_SPECIAL_KILL')) {
              return item(
                index,
                event.timestamp,
                'success',
                <div className="flex w-fit items-center gap-2">
                  <ChampionIcon championId={byId[event.killerId]?.championId ?? 0} className="size-5 rounded" />
                  <div>
                    {event.killType === 'KILL_FIRST_BLOOD'
                      ? t('matchCard.eventsTab.firstBlood')
                      : event.killType === 'KILL_MULTI'
                        ? t('matchCard.eventsTab.multiKill', { count: event.multiKillLength })
                        : event.killType === 'KILL_ACE'
                          ? t('matchCard.eventsTab.ace')
                          : event.killType}
                  </div>
                  {position(event)}
                </div>
              )
            }
            if (event.type === 'BUILDING_KILL' && filters.includes('BUILDING_KILL')) {
              return item(
                index,
                event.timestamp,
                'warning',
                t('matchCard.eventsTab.destroyBuilding'),
                <Tip placement="right" content={<MapPosition mapId={basicInfo.mapId} points={[event.position]} />}>
                  <div tabIndex={0} className="flex w-fit cursor-pointer items-center gap-2">
                    <ChampionIcon championId={byId[event.killerId]?.championId ?? 0} className="size-5 rounded" />
                    <div className="text-black/60 dark:text-white/60">{t('matchCard.eventsTab.destroyed')}</div>
                    {event.buildingType === 'TOWER_BUILDING' ? (
                      <>
                        <ObjectiveIcon name="tower" className="size-4" />
                        <div className="font-bold">
                          {event.laneType ? lane(event.laneType) : ''} {event.towerType ? t(`matchCard.towerType.${event.towerType}`, { defaultValue: event.towerType }) : t(`matchCard.buildingType.${event.buildingType}`, { defaultValue: event.buildingType })}
                        </div>
                      </>
                    ) : event.buildingType === 'INHIBITOR_BUILDING' ? (
                      <>
                        <ObjectiveIcon name="inhibitor" className="size-4" />
                        <div className="font-bold">{t(`matchCard.buildingType.${event.buildingType}`)}</div>
                      </>
                    ) : null}
                  </div>
                </Tip>
              )
            }
            if (event.type === 'TURRET_PLATE_DESTROYED' && event.killerId !== 0 && filters.includes('TURRET_PLATE_DESTROYED')) {
              return item(
                index,
                event.timestamp,
                'warning',
                t('matchCard.eventsTab.destroyPlateTitle'),
                <div className="flex w-fit items-center gap-2">
                  <ChampionIcon championId={byId[event.killerId]?.championId ?? 0} className="size-5 rounded" />
                  <div className="text-black/60 dark:text-white/60">{t('matchCard.eventsTab.destroyed')}</div>
                  <div className="font-bold">{event.laneType ? t('matchCard.eventsTab.plateLane', { lane: lane(event.laneType) }) : t('matchCard.eventsTab.plate')}</div>
                </div>
              )
            }
            return null
          })}
          {item('end', times.end, 'default', t('matchCard.eventsTab.end'))}
        </ol>
      </div>
      <div className="mh-scroll w-52 shrink-0 overflow-auto">
        <div className="flex flex-col gap-3">
          <div className="flex w-full flex-col gap-2">
            <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.eventsTab.filters')}</div>
            {eventTypes.map(type => (
              <Check key={type} checked={filters.includes(type)} onChange={on => setFilters(on ? [...filters, type] : filters.filter(item => item !== type))}>
                {eventName(type)}
              </Check>
            ))}
          </div>
          <div className="h-px bg-black/10 dark:bg-white/10" />
          <div className="flex w-full flex-col gap-2">
            <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.eventsTab.filterByChampion')}</div>
            {options.map(option => (
              <Check key={option.championId} checked={championIds.includes(option.championId)} onChange={on => setChampionIds(on ? [...championIds, option.championId] : championIds.filter(id => id !== option.championId))}>
                <span className="flex items-center gap-1.5"><ChampionIcon championId={option.championId} className="size-4 rounded" /><span className="text-sm">{option.label}</span></span>
              </Check>
            ))}
          </div>
          {plates && (
            <>
              <div className="h-px bg-black/10 dark:bg-white/10" />
              <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.eventsTab.plateStats')}</div>
              <div className="flex flex-col gap-1">
                {plates.map(plate => (
                  <div key={plate.championId} className="flex items-center gap-2">
                    <ChampionIcon championId={plate.championId} className="size-5 rounded" />
                    <div className="text-sm text-black/80 dark:text-white/80">{res.championName(plate.championId)}</div>
                    <div className={tag}>{t('matchCard.eventsTab.plateCount', { count: plate.count })}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type Metric = 'gold' | 'cs' | 'exp' | 'damageDealt' | 'damageTaken'

function frameValue(frame: any, metric: Metric): number | null {
  if (!frame) return null
  switch (metric) {
    case 'gold':
      return frame.totalGold
    case 'cs':
      return frame.minionsKilled + (frame.jungleMinionsKilled || 0)
    case 'exp':
      return frame.xp || 0
    case 'damageDealt':
      return isSgpDetailedParticipantFrame(frame) ? frame.damageStats.totalDamageDoneToChampions : null
    case 'damageTaken':
      return isSgpDetailedParticipantFrame(frame) ? frame.damageStats.totalDamageTaken : null
  }
}

function LineChart({ labels, series, unit, xTitle, yTitle }: { labels: string[]; series: Array<{ label: string; color: string; data: number[]; dashed?: boolean; width: number }>; unit: string; xTitle: string; yTitle: string }) {
  const dark = useIsDark()
  const [hover, setHover] = useState<number | null>(null)
  const width = 640
  const height = 420
  const left = 56
  const bottom = 40
  const top = 12
  const right = 12
  const max = Math.max(1, ...series.flatMap(item => item.data))
  const nice = Math.pow(10, Math.floor(Math.log10(max)))
  const yMax = Math.ceil(max / nice) * nice
  const x = (index: number) => left + (labels.length <= 1 ? 0 : (index / (labels.length - 1)) * (width - left - right))
  const y = (value: number) => top + (1 - value / yMax) * (height - top - bottom)
  const grid = dark ? 'rgba(200, 200, 200, 0.2)' : 'rgba(100, 100, 100, 0.2)'
  const text = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'
  const step = Math.max(1, Math.ceil(labels.length / 10))
  return (
    <div className="relative size-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="size-full" onMouseLeave={() => setHover(null)}
        onMouseMove={event => {
          const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((event.clientX - box.left) / box.width) * width
          const index = Math.round(((px - left) / (width - left - right)) * (labels.length - 1))
          setHover(index >= 0 && index < labels.length ? index : null)
        }}>
        {[0, 0.25, 0.5, 0.75, 1].map(level => (
          <g key={level}>
            <line x1={left} x2={width - right} y1={y(yMax * level)} y2={y(yMax * level)} stroke={grid} />
            <text x={left - 6} y={y(yMax * level)} fill={text} fontSize={10} textAnchor="end" dominantBaseline="middle">{Math.round(yMax * level).toLocaleString()}</text>
          </g>
        ))}
        {labels.map((label, index) => index % step === 0 && (
          <g key={index}>
            <line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} stroke={grid} />
            <text x={x(index)} y={height - bottom + 14} fill={text} fontSize={10} textAnchor="middle">{label}</text>
          </g>
        ))}
        <text x={(left + width - right) / 2} y={height - 6} fill={text} fontSize={11} textAnchor="middle">{xTitle}</text>
        <text x={12} y={(top + height - bottom) / 2} fill={text} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${(top + height - bottom) / 2})`}>{yTitle}</text>
        {series.map(item => (
          <polyline key={item.label} fill="none" stroke={item.color} strokeWidth={item.width} strokeDasharray={item.dashed ? '10 2 2 2' : undefined} points={item.data.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} stroke={text} strokeDasharray="2 2" />}
      </svg>
      {hover !== null && (
        <div className="mh-tip pointer-events-none absolute top-2 left-16" style={{ position: 'absolute' }}>
          <div className="mb-1 text-xs font-bold">{labels[hover]}</div>
          {series.map(item => (
            <div key={item.label} className="flex items-center gap-1 text-xs">
              <span className="inline-block size-2 rounded-xs" style={{ backgroundColor: item.color }} />
              {item.label}: {(item.data[hover] ?? 0).toLocaleString()} {unit}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MatchCardTimelineTab({ model }: { model: CardModel }) {
  const { t, res } = useMh()
  const { frames, participants, teams, basicInfo, details } = model
  const sgp = details?.source === 'sgp'
  const [metric, setMetric] = useState<Metric>('gold')
  const [selectedTeams, setSelectedTeams] = useState<string[]>(() => teams.teamStatsArr.map(team => team.teamIdentifier))
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([])
  const teamName = (id: string) => t(`common.teams.${id}`, { defaultValue: id })
  const labels = frames.map(frame => `${Math.floor(frame.timestamp / 60000)}min`)
  const name = (p: (typeof participants)[number]) => `${p.gameName} #${p.tagLine}`
  const playerOptions = participants
    .slice().sort((a, b) => (basicInfo.isCherrySubteam ? a.subteamPlacement - b.subteamPlacement : a.teamIdentifier.localeCompare(b.teamIdentifier)))
    .map(p => ({ value: p.participantId, label: res.championName(p.championId), championId: p.championId, color: playerColors[(p.participantId - 1) % playerColors.length] }))
  const series = [
    ...participants
      .filter(p => selectedPlayers.includes(p.participantId))
      .map(p => ({ label: name(p), color: playerColors[(p.participantId - 1) % playerColors.length], width: 2, data: frames.map(frame => frameValue(frame.participantFrames[String(p.participantId)], metric) ?? 0) })),
    ...teams.teamStatsArr
      .filter(team => selectedTeams.includes(team.teamIdentifier))
      .map(team => {
        const ids = participants.filter(p => p.teamIdentifier === team.teamIdentifier).map(p => p.participantId)
        return {
          label: t('matchCard.diffLineChart.teamAverageSuffix', { name: teamName(team.teamIdentifier) }),
          color: teamColor(team.teamIdentifier),
          width: 3,
          dashed: true,
          data: frames.map(frame => {
            const values = ids.map(id => frameValue(frame.participantFrames[String(id)], metric)).filter((v): v is number => v !== null)
            return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
          })
        }
      })
  ]
  const metrics: Metric[] = sgp ? ['gold', 'cs', 'exp', 'damageDealt', 'damageTaken'] : ['gold', 'cs', 'exp']
  const all = playerOptions.map(p => p.value)
  return (
    <div className="flex h-142 min-h-0 w-full flex-col">
      {/* Upstream offers a second "stats line" view only for SGP details; LCU timelines lack its data. */}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1">
          <LineChart labels={labels} series={series} unit={t(`matchCard.diffLineChart.metric.${metric}.unit`)} xTitle={t('matchCard.diffLineChart.gameTime')} yTitle={t(`matchCard.diffLineChart.metric.${metric}.yAxis`)} />
        </div>
        <div className="mh-scroll w-52 shrink-0 overflow-auto">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2" role="radiogroup">
              <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.diffLineChart.dataType')}</div>
              {metrics.map(item => (
                <label key={item} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="radio" name={`metric-${basicInfo.gameId}`} checked={metric === item} onChange={() => setMetric(item)} />
                  {t(`matchCard.diffLineChart.${item}`)}
                </label>
              ))}
            </div>
            <div className="h-px bg-black/10 dark:bg-white/10" />
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.diffLineChart.teamAverage')}</div>
              {teams.teamStatsArr.map(team => (
                <Check key={team.teamIdentifier} checked={selectedTeams.includes(team.teamIdentifier)} onChange={on => setSelectedTeams(on ? [...selectedTeams, team.teamIdentifier] : selectedTeams.filter(id => id !== team.teamIdentifier))}>
                  {t('matchCard.diffLineChart.teamAverageSuffix', { name: teamName(team.teamIdentifier) })}
                </Check>
              ))}
            </div>
            <div className="h-px bg-black/10 dark:bg-white/10" />
            <div className="flex w-full flex-col gap-2">
              <div className="text-xs font-semibold text-black/60 dark:text-white/60">{t('matchCard.diffLineChart.players')}</div>
              <Check checked={selectedPlayers.length > 0 && selectedPlayers.length === all.length} indeterminate={selectedPlayers.length > 0 && selectedPlayers.length < all.length} onChange={on => setSelectedPlayers(on ? all : [])}>
                {t('matchCard.diffLineChart.selectAll')}
              </Check>
              {playerOptions.map(option => (
                <Check key={option.value} checked={selectedPlayers.includes(option.value)} onChange={on => setSelectedPlayers(on ? [...selectedPlayers, option.value] : selectedPlayers.filter(id => id !== option.value))}>
                  <span className="flex w-44 items-center gap-2">
                    <span className="inline-block size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: option.color }} />
                    <ChampionIcon championId={option.championId} className="size-4 rounded" />
                    <span className="truncate">{option.label}</span>
                  </span>
                </Check>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
