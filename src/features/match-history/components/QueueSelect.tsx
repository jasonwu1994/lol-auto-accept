// Upstream widgets/match-history-pagination/QueueSelect.vue + useSgpTagOptions: the
// SGP queue tag selector with each queue's map/mode icon, drawn as the app's select.
import { HeroSelect, type HeroSelectGroup } from './HeroSelect'
import { GameImage, useMh } from './primitives'

export const ALL_SGPTAG_VALUE = 'all'

export function QueueSelect({ value, queues, disabled, onChange }: {
  value: string
  queues: number[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t, data, res } = useMh()

  // Upstream: unknown queue or no queue → Summoner's Rift classic icon.
  const icon = (queueId?: number) => {
    const queue = queueId ? data.gameQueues[queueId] : undefined
    const path = (queue && data.modeIcons[`${queue.mapId}_${queue.gameMode}`]) || data.modeIcons['11_CLASSIC']
    return <GameImage path={path} size={20} className="shrink-0 rounded" />
  }
  const groups: HeroSelectGroup[] = [
    {
      label: t('common.sgpMatchHistoryTags.groupGeneral'),
      options: [
        { value: ALL_SGPTAG_VALUE, label: t('common.sgpMatchHistoryTags.all') },
        { value: 'ranked', label: t('common.sgpMatchHistoryTags.ranked') },
        { value: 'normal', label: t('common.sgpMatchHistoryTags.normal') }
      ].map(option => ({ ...option, icon: icon() }))
    },
    {
      label: t('common.sgpMatchHistoryTags.groupGameModes'),
      options: queues.map(id => ({ value: `q_${id}`, label: data.gameQueues[id]?.name || res.queueName(id), icon: icon(id) }))
    }
  ]

  return <HeroSelect value={value} groups={groups} disabled={disabled} label={t('playerTabs.profile.queue')} className="w-full @[480px]:w-56" onChange={onChange} />
}
