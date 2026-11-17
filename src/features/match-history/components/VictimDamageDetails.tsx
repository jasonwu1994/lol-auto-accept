// Upstream match-card/widgets/VictimDamageDetails.vue: who damaged the victim of a
// kill (and whom the victim damaged), per source and per skill slot.
import { FireOutlined } from '@ant-design/icons'
import type { MatchParticipant } from '../upstream/data-adapter/match-history/participants'
import type { DamageDetail, DetailedChampionKillEvent } from '../upstream/types/sgp/match-history'
import { damageTextClass, teamColor } from './cardModel'
import { DamageBar } from './charts'
import { ObjectiveIcon } from './MatchCardDetails'
import { ChampionIcon, formatExtremeNumber, Tip, useMh } from './primitives'

export interface Damage {
  physicalDamage: number
  magicDamage: number
  trueDamage: number
}

type DamageType = 'champion' | 'tower' | 'minion' | 'monster' | 'other'
type Slot = 'basic' | 'p' | 'q' | 'w' | 'e' | 'r' | 'other'

export interface DamageSourceEntry {
  type: DamageType
  name: string
  /** 0 for non-champion sources. */
  participantId: number
  damageDetails: Record<Slot, Damage | null>
  totalPhysicalDamage: number
  totalMagicDamage: number
  totalTrueDamage: number
}

const TYPE_MAP: Record<string, DamageType> = { MINION: 'minion', MONSTER: 'monster', TOWER: 'tower' }
/** Upstream SpellSlot: passive is 63, Q–R are 0–3. */
const SLOT_BY_SPELL: Record<number, Slot> = { 63: 'p', 0: 'q', 1: 'w', 2: 'e', 3: 'r' }
const CHERRY_SHOPKEEPER_NAME = 'Cherry_Shopkeeper'

const total = (damage: Damage) => damage.physicalDamage + damage.magicDamage + damage.trueDamage
const entryTotal = (entry: DamageSourceEntry) => entry.totalPhysicalDamage + entry.totalMagicDamage + entry.totalTrueDamage

function collect(damage: DamageDetail[]) {
  const map = new Map<string, DamageSourceEntry>()
  for (const cur of damage) {
    const type: DamageType = cur.participantId ? 'champion' : TYPE_MAP[cur.type] || 'other'
    // Upstream: participant 0 covers many non-champion sources, grouped by type.
    const key = type === 'champion' ? `champion:${cur.participantId}` : type
    let entry = map.get(key)
    if (!entry) {
      entry = {
        type,
        name: cur.name,
        participantId: cur.participantId,
        damageDetails: { basic: null, p: null, q: null, w: null, e: null, r: null, other: null },
        totalPhysicalDamage: 0,
        totalMagicDamage: 0,
        totalTrueDamage: 0
      }
      map.set(key, entry)
    }
    const slot: Slot = cur.basic ? 'basic' : SLOT_BY_SPELL[cur.spellSlot] ?? 'other'
    const bucket = (entry.damageDetails[slot] ??= { physicalDamage: 0, magicDamage: 0, trueDamage: 0 })
    bucket.physicalDamage += cur.physicalDamage
    bucket.magicDamage += cur.magicDamage
    bucket.trueDamage += cur.trueDamage
    entry.totalPhysicalDamage += cur.physicalDamage
    entry.totalMagicDamage += cur.magicDamage
    entry.totalTrueDamage += cur.trueDamage
  }
  const sorted = [...map.values()].sort((a, b) => entryTotal(b) - entryTotal(a))
  return { sorted, max: sorted.reduce((max, entry) => Math.max(max, entryTotal(entry)), 0) }
}

const sum = (entries: DamageSourceEntry[], key: 'totalPhysicalDamage' | 'totalMagicDamage' | 'totalTrueDamage') => entries.reduce((acc, entry) => acc + entry[key], 0)
const totals = (entries: DamageSourceEntry[]): Damage => ({
  physicalDamage: sum(entries, 'totalPhysicalDamage'),
  magicDamage: sum(entries, 'totalMagicDamage'),
  trueDamage: sum(entries, 'totalTrueDamage')
})

export function victimDamageData(event: Pick<DetailedChampionKillEvent, 'victimDamageDealt' | 'victimDamageReceived'>) {
  const received = collect(event.victimDamageReceived || [])
  const dealt = collect(event.victimDamageDealt || [])
  return {
    maxDamageBaseline: Math.max(received.max, dealt.max),
    grouped: [
      { type: 'received' as const, data: received.sorted, totals: totals(received.sorted) },
      { type: 'dealt' as const, data: dealt.sorted, totals: totals(dealt.sorted) }
    ]
  }
}

/** Upstream `getClassBySkillKey`. */
export const SKILL_KEY_CLASS: Record<string, string> = {
  A: 'bg-slate-500/40 border-slate-500 dark:bg-slate-400/20 dark:border-slate-300/60',
  P: 'bg-amber-500/40 border-amber-500 dark:bg-amber-400/20 dark:border-amber-300/60',
  Q: 'bg-sky-500/40 border-sky-500 dark:bg-sky-600/20 dark:border-sky-400/60',
  W: 'bg-emerald-500/40 border-emerald-500 dark:bg-emerald-400/20 dark:border-emerald-400/60',
  E: 'bg-violet-500/40 border-violet-500 dark:bg-violet-400/20 dark:border-violet-400/60',
  R: 'bg-orange-500/40 border-orange-500 dark:bg-orange-400/20 dark:border-orange-400/60',
  '?': 'bg-gray-300/40 border-gray-400 dark:bg-gray-500/20 dark:border-gray-400/60'
}

function mostType(damage: Damage) {
  return [
    { type: 'physical', value: damage.physicalDamage },
    { type: 'magic', value: damage.magicDamage },
    { type: 'true', value: damage.trueDamage }
  ].sort((a, b) => b.value - a.value)[0].type
}

function Split({ damage, locale }: { damage: Damage; locale: string }) {
  return (
    <>
      (<span className={damageTextClass('physical')}>{formatExtremeNumber(damage.physicalDamage, locale)}</span>
      {' / '}
      <span className={damageTextClass('magic')}>{formatExtremeNumber(damage.magicDamage, locale)}</span>
      {' / '}
      <span className={damageTextClass('true')}>{formatExtremeNumber(damage.trueDamage, locale)}</span>)
    </>
  )
}

const ring = 'box-border rounded-full border-2 border-solid'
const plainRing = 'box-border rounded-full border border-solid border-black/40 p-1 dark:border-white/40'

export function VictimDamageDetails({ event, participants }: { event: DetailedChampionKillEvent; participants: MatchParticipant[] }) {
  const { t, locale } = useMh()
  const byId = new Map(participants.map(p => [p.participantId, p]))
  const data = victimDamageData(event)
  const victim = byId.get(event.victimId)
  const dealerName = (type: DamageType) => t(`matchCard.eventsTab.victimDamageDetails.damageDealerNames.${type}`)
  return (
    <div className="mh-scroll max-h-[70vh] overflow-y-auto pr-4">
      {data.grouped
        .filter(group => group.data.length > 0)
        .map((group, index) => (
          <div key={group.type}>
            {index !== 0 && <div className="my-2 h-px w-full bg-black/10 dark:bg-white/10" />}
            <div className="mb-3 flex items-end gap-2">
              <div className="flex items-center gap-2">
                <ChampionIcon championId={victim?.championId ?? 0} className="size-4 rounded" />
                <span className="text-sm font-bold text-black dark:text-white">{t(`matchCard.eventsTab.victimDamageDetails.${group.type}`)}</span>
              </div>
              <div>
                <span className="font-bold">{formatExtremeNumber(total(group.totals), locale)}</span> <Split damage={group.totals} locale={locale} />
              </div>
            </div>
            {group.data.map((item, itemIndex) => {
              const all: Array<[string, Damage | null]> = [
                ['A', item.damageDetails.basic],
                ['P', item.damageDetails.p],
                ['Q', item.damageDetails.q],
                ['W', item.damageDetails.w],
                ['E', item.damageDetails.e],
                ['R', item.damageDetails.r],
                ['?', item.damageDetails.other]
              ]
              const slots = all.filter((slot): slot is [string, Damage] => slot[1] !== null)
              return (
                <div key={`${item.type}:${item.participantId}:${itemIndex}`} className="flex items-start gap-3 not-last:mb-2">
                  {item.type === 'champion' ? (
                    <div className="relative shrink-0">
                      {/* Upstream: for dealt damage the victim is the big icon and the target sits in the corner. */}
                      <span className={`${ring} inline-flex size-8`} style={{ borderColor: teamColor(byId.get(group.type === 'received' ? item.participantId : event.victimId)?.teamIdentifier) }}>
                        <ChampionIcon championId={byId.get(group.type === 'received' ? item.participantId : event.victimId)?.championId ?? 0} title={dealerName(item.type)} className="size-full rounded-full" />
                      </span>
                      {group.type === 'dealt' && (
                        <span className={`${ring} absolute right-0 bottom-0 inline-flex size-1/2 translate-x-1/4 translate-y-1/4`} style={{ borderColor: teamColor(byId.get(item.participantId)?.teamIdentifier) }}>
                          <ChampionIcon championId={byId.get(item.participantId)?.championId ?? 0} title={dealerName(item.type)} className="size-full rounded-full" />
                        </span>
                      )}
                    </div>
                  ) : item.type === 'minion' || item.type === 'other' ? (
                    // Minions and other sources have no participant; upstream falls back to the
                    // client's generic champion icon (-1) instead of an empty slot.
                    <span className={`${ring} inline-flex size-8 shrink-0`} style={{ borderColor: teamColor(byId.get(item.participantId)?.teamIdentifier) }}>
                      <ChampionIcon championId={byId.get(item.participantId)?.championId ?? -1} title={dealerName(item.type)} className="size-full rounded-full" />
                    </span>
                  ) : item.type === 'tower' ? (
                    <div title={dealerName('tower')} className="shrink-0">
                      <span className={`${plainRing} inline-flex size-6`}><ObjectiveIcon name="tower" className="size-full" /></span>
                    </div>
                  ) : (
                    <div title={dealerName('monster')} className="shrink-0">
                      <span className={`${plainRing} inline-flex size-6 items-center justify-center`}>
                        {item.name === CHERRY_SHOPKEEPER_NAME ? <FireOutlined className="text-[14px]" /> : <ObjectiveIcon name="dragon" className="size-full" />}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <DamageBar radius={0} height={14} width={160} physical={item.totalPhysicalDamage} magic={item.totalMagicDamage} trueDamage={item.totalTrueDamage} baseline={data.maxDamageBaseline} />
                      <div className="text-xs whitespace-nowrap text-black/80 dark:text-white/80">
                        <span className="font-bold">{formatExtremeNumber(entryTotal(item), locale)}</span>{' '}
                        <Split damage={{ physicalDamage: item.totalPhysicalDamage, magicDamage: item.totalMagicDamage, trueDamage: item.totalTrueDamage }} locale={locale} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {slots.map(([key, damage]) => (
                        <Tip key={key} placement="top" content={<span className="whitespace-nowrap"><Split damage={damage} locale={locale} /></span>}>
                          <div tabIndex={0} className="cursor-default">
                            <div className={`flex size-6 items-center justify-center rounded border border-solid text-xs font-bold ${SKILL_KEY_CLASS[key]}`}>{key}</div>
                            <div className={`text-center text-[10px] ${damageTextClass(mostType(damage))}`}>{formatExtremeNumber(total(damage), locale)}</div>
                          </div>
                        </Tip>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}
