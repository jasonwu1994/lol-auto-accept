// Upstream renderer-shared/components/RankedTable.vue: every ranked queue with its
// current, previous-season and all-time tiers, each tier with its medal icon.
import type { RankedEntry } from '../upstream/types/league-client/ranked'
import { useMh } from './primitives'

const rankedMedal = import.meta.glob('../assets/ranked/medal/*.png', { eager: true, import: 'default' }) as Record<string, string>
export const medalImage = (tier?: string | null) => (tier ? rankedMedal[`../assets/ranked/medal/${tier.toLowerCase()}.png`] : undefined)

export const unranked = (tier?: string | null) => !tier || tier === 'NA' || tier === 'NONE'

const QUEUE_TYPE_ORDER: Record<string, number> = {
  RANKED_SOLO_5x5: 1,
  RANKED_FLEX_SR: 2,
  RANKED_TFT: 3,
  RANKED_TFT_TURBO: 4,
  RANKED_TFT_DOUBLE_UP: 5
}

/** Solo/duo, flex, then the TFT queues; the rest keep the server's order. */
export function sortRankedQueues(queues: RankedEntry[]) {
  return queues
    .filter(entry => entry.queueType)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (QUEUE_TYPE_ORDER[a.entry.queueType] ?? Number.MAX_SAFE_INTEGER) - (QUEUE_TYPE_ORDER[b.entry.queueType] ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ entry }) => entry)
}

export type RankedTierKind = 'current' | 'previousSeasonEnd' | 'previousSeasonHighest' | 'highest'

export function rankedTier(entry: RankedEntry, kind: RankedTierKind): { tier?: string; division?: string } {
  switch (kind) {
    case 'current':
      return { tier: entry.tier, division: entry.division }
    case 'previousSeasonEnd':
      return { tier: entry.previousSeasonEndTier, division: entry.previousSeasonEndDivision }
    case 'previousSeasonHighest':
      return { tier: entry.previousSeasonHighestTier, division: entry.previousSeasonHighestDivision }
    case 'highest':
      return { tier: entry.highestTier, division: entry.highestDivision }
  }
}

const PLACEHOLDER = '—'

export function RankedTable({ queues }: { queues: RankedEntry[] }) {
  const { t } = useMh()
  const tierName = (tier: string, division?: string) => {
    const name = t(`common.tiers.${tier}`, { defaultValue: tier })
    return !division || division === 'NA' ? name : `${name} ${division}`
  }
  const tierCell = (entry: RankedEntry, kind: RankedTierKind) => {
    const { tier, division } = rankedTier(entry, kind)
    if (unranked(tier)) return <td className="mh-ranked-cell mh-ranked-empty">{PLACEHOLDER}</td>
    const medal = medalImage(tier)
    return (
      <td className="mh-ranked-cell">
        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
          {medal && <img src={medal} alt="" className="h-4 w-4 shrink-0" />}
          {tierName(tier!, division)}
        </div>
      </td>
    )
  }
  // Upstream shows points, wins and losses only for a queue the player is placed in.
  const numberCell = (entry: RankedEntry, value: number | undefined) =>
    unranked(entry.tier) ? <td className="mh-ranked-cell mh-ranked-empty">{PLACEHOLDER}</td> : <td className="mh-ranked-cell">{value ?? 0}</td>
  const headers = ['queueType', 'tier', 'leaguePoints', 'wins', 'losses', 'previousSeasonEndTier', 'previousSeasonHighestTier', 'highestTier']

  return (
    <div className="mh-ranked-table mh-panel w-fit max-w-full overflow-x-auto text-xs">
      <table className="min-w-max border-collapse">
        <thead>
          <tr>
            {headers.map(key => <th key={key} className="mh-ranked-cell">{t(`ranked.table.${key}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {sortRankedQueues(queues).map(entry => (
            <tr key={entry.queueType}>
              <td className="mh-ranked-cell mh-ranked-queue">{t(`common.queueTypes.${entry.queueType}`, { defaultValue: entry.queueType })}</td>
              {tierCell(entry, 'current')}
              {numberCell(entry, entry.leaguePoints)}
              {numberCell(entry, entry.wins)}
              {numberCell(entry, entry.losses)}
              {tierCell(entry, 'previousSeasonEnd')}
              {tierCell(entry, 'previousSeasonHighest')}
              {tierCell(entry, 'highest')}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
