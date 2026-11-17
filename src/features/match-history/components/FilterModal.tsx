import { useMemo, useState } from 'react'
import { profileIconPath, type ChampionData } from '../assets/gameData'
import type { analyzeRelationship } from '../upstream/data-adapter/analysis/relationship'
import { clearSimplePredicate, type SimpleTimeRangeFilter, type SimpleWinLossFilter } from '../upstream/player-tab/filters/filter-state'
import type { TabFilters } from '../state/tabs'
import { HeroSelect } from './HeroSelect'
import { Modal } from './PlayerTabPanel'
import { ChampionIcon, GameImage, PositionIcon, useMh } from './primitives'

const TIME_RANGES: SimpleTimeRangeFilter[] = ['all', 'last3Hours', 'last12Hours', 'last24Hours', 'last3Days', 'last7Days', 'last30Days']
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export function FilterModal({ filters, relationship, champions, busy, onClose, onApply, onCollect }: {
  filters: TabFilters
  puuid: string
  relationship: ReturnType<typeof analyzeRelationship>
  champions: Record<number, ChampionData>
  busy: boolean
  onClose: () => void
  onApply: (filters: TabFilters) => void
  onCollect: (filters: TabFilters, expectedCount: number) => void
}) {
  const { t, res } = useMh()
  // This app keeps only the simple page filter (no advanced condition tree).
  const [draft, setDraft] = useState<TabFilters>({ ...filters, mode: 'simple' })
  const [query, setQuery] = useState('')
  const [expected, setExpected] = useState(100)
  const simple = draft.simple
  const setSimple = (patch: Partial<typeof simple>) => setDraft({ ...draft, simple: { ...simple, ...patch } })
  const championList = useMemo(
    () => Object.values(champions).filter(c => c.id > 0 && (!query || c.name.toLowerCase().includes(query.toLowerCase()) || c.alias?.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)),
    [champions, query]
  )
  const summoners = Object.values(relationship).sort((a, b) => b.games.length - a.games.length)
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value])
  const chip = (active: boolean) => `mh-chip ${active ? 'active' : ''}`
  return (
    <Modal onClose={onClose} label={t('playerTabs.matchHistory.filters.title')}>
      <div className="flex h-187.5 max-h-[90vh] min-h-[60vh] w-225 max-w-[92vw] flex-col rounded bg-neutral-100/95 p-4 text-sm dark:bg-neutral-900/95">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="m-0 text-base font-semibold">{t('playerTabs.matchHistory.filters.pageFilter')}</h2>
          <button type="button" className="mh-button ml-auto px-2 py-1 text-xs" onClick={() => setDraft({ ...draft, simple: clearSimplePredicate(draft.simple) })}>
            {t('playerTabs.matchHistory.filters.resetAll')}
          </button>
        </div>
        <div className="mh-scroll min-h-0 flex-1 overflow-auto pr-1">
          <div className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t('playerTabs.matchHistory.filters.winLoss')}</legend>
                <div className="flex gap-2">
                  {(['all', 'win', 'loss'] as SimpleWinLossFilter[]).map(value => (
                    <button key={value} type="button" className={chip(simple.winLoss === value)} aria-pressed={simple.winLoss === value} onClick={() => setSimple({ winLoss: value })}>
                      {t(`playerTabs.matchHistory.filters.${value}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t('playerTabs.matchHistory.filters.timeRange')}</legend>
                <div className="flex flex-wrap gap-2">
                  {TIME_RANGES.map(value => (
                    <button key={value} type="button" className={chip(simple.timeRange === value)} aria-pressed={simple.timeRange === value} onClick={() => setSimple({ timeRange: value })}>
                      {t(`playerTabs.matchHistory.timeRange.${value}`, { defaultValue: value })}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t('playerTabs.matchHistory.filters.position')}</legend>
                <div className="flex gap-2">
                  {POSITIONS.map(position => (
                    <button key={position} type="button" className={chip(simple.positions.includes(position))} aria-pressed={simple.positions.includes(position)} title={t(`common.positions.${position}`)} onClick={() => setSimple({ positions: toggle(simple.positions, position) })}>
                      <PositionIcon position={position} size={16} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t('playerTabs.matchHistory.filters.champions')}</legend>
                {simple.championIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {simple.championIds.map(id => (
                      <button key={id} type="button" className={chip(true)} onClick={() => setSimple({ championIds: simple.championIds.filter(item => item !== id) })}>
                        <ChampionIcon championId={id} className="size-4 rounded" /> {res.championName(id)} ×
                      </button>
                    ))}
                  </div>
                )}
                <input className="mh-input w-64" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('playerTabs.championMastery.search')} aria-label={t('playerTabs.matchHistory.filters.champions')} />
                <div className="mh-scroll grid max-h-40 grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-1 overflow-auto">
                  {championList.map(champion => (
                    <button key={champion.id} type="button" title={champion.name} aria-pressed={simple.championIds.includes(champion.id)} className={`rounded border-0 bg-transparent p-0.5 ${simple.championIds.includes(champion.id) ? 'ring-2 ring-[var(--mh-accent)]' : 'opacity-80 hover:opacity-100'}`} onClick={() => setSimple({ championIds: toggle(simple.championIds, champion.id) })}>
                      <ChampionIcon championId={champion.id} className="size-7 rounded" />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold text-black/60 dark:text-white/60">{t('playerTabs.matchHistory.filters.summoners')} · {t('playerTabs.matchHistory.filters.pageSummoners')}</legend>
                <div className="mh-scroll flex max-h-48 flex-col gap-1 overflow-auto">
                  {summoners.map(player => (
                    <label key={player.targetPuuid} className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={simple.summonerPuuids.includes(player.targetPuuid)}
                        onChange={() =>
                          setSimple({
                            summonerPuuids: toggle(simple.summonerPuuids, player.targetPuuid),
                            cachedSummoners: { ...simple.cachedSummoners, [player.targetPuuid]: { puuid: player.targetPuuid, profileIconId: player.targetProfileIconId, gameName: player.targetGameName, tagLine: player.targetTagLine } }
                          })
                        }
                      />
                      <GameImage path={profileIconPath(player.targetProfileIconId)} className="size-4 rounded-sm" />
                      <span className="truncate">{player.targetGameName}#{player.targetTagLine}</span>
                      <span className="ml-auto text-black/50 dark:text-white/50">{player.games.length}</span>
                    </label>
                  ))}
                  {summoners.length === 0 && <span className="text-xs text-black/50 dark:text-white/50">{t('matchCard.common.noData')}</span>}
                </div>
              </fieldset>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="flex items-center gap-2 text-xs">
            {t('playerTabs.matchHistory.collectMode.expectedCountLabel')}
            <HeroSelect
              className="w-24"
              value={String(expected)}
              label={t('playerTabs.matchHistory.collectMode.expectedCountLabel')}
              options={[20, 50, 100, 200, 300, 500, 750, 1000].map(value => ({ value: String(value), label: String(value) }))}
              onChange={value => setExpected(Number(value))}
            />
          </div>
          <button type="button" className="mh-button px-2 py-1 text-xs" disabled={busy} title={t('playerTabs.matchHistory.collectMode.tooltipDescription')} onClick={() => onCollect(draft, expected)}>
            {t('playerTabs.matchHistory.collectMode.openSettings')}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" className="mh-button px-3 py-1" onClick={onClose}>{t('playerTabs.matchHistory.collectMode.cancel')}</button>
            <button type="button" className="mh-button primary px-3 py-1" onClick={() => onApply(draft)}>{t('common.confirm')}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
