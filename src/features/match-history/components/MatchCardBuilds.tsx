// Upstream match-card/tabs/MatchCardBuildsTab.vue: skill order and item purchases per
// player, from SGP details events.
import { ArrowUpOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useMemo, useRef, useState } from 'react'
import type { MatchParticipant } from '../upstream/data-adapter/match-history/participants'
import { teamColor, type CardModel } from './cardModel'
import { winResultTagClass } from './MatchCardDetails'
import { ChampionIcon, ItemDisplay, Tip, useMh } from './primitives'
import { SKILL_KEY_CLASS } from './VictimDamageDetails'

/** Upstream SKILL_SLOT_TRANSLATIONS (timeline skill slots are 1-based). */
const SKILL_SLOT_KEYS: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' }
const ANVIL_ITEM_IDS = [6032, 220000]
/** Upstream puts a separator between purchases more than 30 s apart. */
const PURCHASE_GAP_MS = 30_000

export interface SkillStep {
  skillSlot: number
  timestamp: number
  evolve: boolean
  /** Champion level the point was spent at; evolutions have none. */
  displayLevel?: number
}

export type PurchaseStep = { type: 'item'; itemId: number; timestamp: number } | { type: 'spacer' }

interface RawEvent {
  type: string
  participantId?: number
  skillSlot?: number
  levelUpType?: string
  itemId?: number
  timestamp: number
}

export function buildsData(frames: ReadonlyArray<{ events: readonly unknown[] }>, participantIds: readonly number[]) {
  const skills: Record<number, SkillStep[]> = {}
  const items: Record<number, PurchaseStep[]> = {}
  const anvils: Record<number, number> = {}
  const lastPurchase: Record<number, number> = Object.fromEntries(participantIds.map(id => [id, 0]))
  for (const event of frames.flatMap(frame => frame.events) as RawEvent[]) {
    const id = event.participantId
    if (!id) continue
    if (event.type === 'SKILL_LEVEL_UP') {
      ;(skills[id] ??= []).push({ skillSlot: event.skillSlot ?? 0, timestamp: event.timestamp, evolve: event.levelUpType === 'EVOLVE' })
    } else if (event.type === 'ITEM_PURCHASED') {
      const list = (items[id] ??= [])
      if (lastPurchase[id] && event.timestamp - lastPurchase[id] > PURCHASE_GAP_MS) list.push({ type: 'spacer' })
      lastPurchase[id] = event.timestamp
      list.push({ type: 'item', itemId: event.itemId ?? 0, timestamp: event.timestamp })
      if (ANVIL_ITEM_IDS.includes(event.itemId ?? 0)) anvils[id] = (anvils[id] ?? 0) + 1
    }
  }
  for (const list of Object.values(skills)) {
    let level = 0
    for (const step of list) if (!step.evolve) step.displayLevel = ++level
  }
  return { skills, items, anvils }
}

const pad = (value: number) => String(value).padStart(2, '0')
/** Upstream `formatMilliseconds`: mm:ss, or hh:mm:ss past an hour. */
export function formatGameTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

const participantName = (p: MatchParticipant) => (p.tagLine ? `${p.gameName} #${p.tagLine}` : p.gameName)

/** Upstream's floating player list beside the runes and builds tabs. */
export function ParticipantNavigator({ participants, onSelect }: { participants: MatchParticipant[]; onSelect: (participantId: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`absolute top-2 right-2 z-10 box-border flex max-h-[calc(100%-1rem)] flex-col overflow-hidden rounded border border-black/10 bg-neutral-100/95 p-1 opacity-45 shadow-lg shadow-black/10 transition-[width,opacity] focus-within:opacity-100 hover:opacity-100 dark:border-white/10 dark:bg-neutral-900/95 dark:shadow-black/30 ${expanded ? 'w-40' : 'w-11'}`}>
      <button type="button" className="mh-icon-button mb-2 self-center" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'collapse' : 'expand'}>
        {expanded ? <RightOutlined /> : <LeftOutlined />}
      </button>
      <div className="mh-scroll min-h-0 space-y-1 overflow-x-hidden overflow-y-auto">
        {participants.map(p => (
          <button key={p.puuid || p.participantId} type="button" title={participantName(p)} onClick={() => onSelect(p.participantId)} className={`box-border flex h-7 w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent p-0 text-left text-black/80 transition-colors hover:bg-black/8 dark:text-white/80 dark:hover:bg-white/10 ${expanded ? 'justify-start px-1' : 'justify-center'}`}>
            <span className="inline-flex shrink-0 rounded-full border-2 border-solid" style={{ borderColor: teamColor(p.teamIdentifier) }}>
              <ChampionIcon championId={p.championId} className="size-6 rounded-full" />
            </span>
            {expanded && <span className="min-w-0 flex-1 truncate text-xs">{participantName(p)}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function sortedParticipants(model: CardModel) {
  const { basicInfo, participants } = model
  return basicInfo.isCherrySubteam
    ? participants.slice().sort((a, b) => a.subteamPlacement - b.subteamPlacement)
    : participants.slice().sort((a, b) => a.teamIdentifier.localeCompare(b.teamIdentifier))
}

function SkillBadge({ step }: { step: SkillStep }) {
  const { t } = useMh()
  const key = SKILL_SLOT_KEYS[step.skillSlot] || 'U'
  const title = step.evolve
    ? `${key} (${t('matchCard.buildsTab.evolved')}) - ${formatGameTime(step.timestamp)}`
    : `${step.displayLevel} - ${key} - ${formatGameTime(step.timestamp)}`
  return (
    <Tip content={title} delay={50}>
      <div tabIndex={0} className="relative">
        {step.evolve ? (
          <div className="relative flex size-6 cursor-default items-center justify-center rounded-full border border-solid border-rose-500 bg-rose-500/60 text-xs font-bold dark:border-rose-400/60 dark:bg-rose-400/60">
            {key}
            <div className="absolute -top-1 -right-1 flex size-3 items-center justify-center rounded-full border border-solid border-white bg-amber-400 text-[8px] text-black shadow-sm dark:border-neutral-900 dark:bg-amber-500">
              <ArrowUpOutlined />
            </div>
          </div>
        ) : (
          <div className={`flex size-6 cursor-default items-center justify-center rounded border border-solid text-xs font-bold ${SKILL_KEY_CLASS[key] ?? SKILL_KEY_CLASS['?']}`}>{key}</div>
        )}
        {step.displayLevel !== undefined && (
          <div className="absolute -right-1 -bottom-1 z-1 min-w-3 rounded bg-black/60 py-0.5 text-center text-[8px] leading-none text-white">{step.displayLevel}</div>
        )}
      </div>
    </Tip>
  )
}

export function MatchCardBuildsTab({ model }: { model: CardModel }) {
  const { t } = useMh()
  const content = useRef<HTMLDivElement>(null)
  const { frames, participants, team } = model
  const players = useMemo(() => sortedParticipants(model), [model])
  const collected = useMemo(() => buildsData(frames as Array<{ events: unknown[] }>, participants.map(p => p.participantId)), [frames, participants])
  const scrollTo = (participantId: number) => {
    const target = content.current?.querySelector<HTMLElement>(`[data-builds-participant-id="${participantId}"]`)
    if (target && content.current) content.current.scrollTo({ top: Math.max(target.offsetTop - 8, 0), behavior: 'smooth' })
  }
  const empty = 'py-1 text-xs text-black/30 italic dark:text-white/30'
  return (
    <div className="relative">
      <div ref={content} className="mh-scroll relative max-h-142 overflow-auto">
        {players.map(p => {
          const skills = collected.skills[p.participantId] ?? []
          const purchases = collected.items[p.participantId] ?? []
          const anvils = collected.anvils[p.participantId] ?? 0
          return (
            <div key={p.puuid || p.participantId} data-builds-participant-id={p.participantId} className="rounded-lg bg-black/3 p-3 pr-12 not-last:mb-2 dark:bg-white/3">
              <div className="mb-1 flex items-center gap-2 select-none">
                <span className="inline-flex shrink-0 rounded-full border-2 border-solid" style={{ borderColor: teamColor(p.teamIdentifier) }}>
                  <ChampionIcon championId={p.championId} className="size-7 rounded-full" />
                </span>
                <div className="min-w-0 truncate text-sm font-medium text-black dark:text-white">{participantName(p)}</div>
                {p.position && p.position.toLowerCase() !== 'invalid' && <div className={winResultTagClass(team?.winResult)}>{t(`matchCard.position.${p.position}`, { defaultValue: p.position })}</div>}
                {anvils > 0 && <div className="rounded bg-black/20 px-1 py-0.5 text-xs text-black/80 dark:bg-white/10 dark:text-white">{t('matchCard.buildsTab.anvils', { count: anvils })}</div>}
              </div>
              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />
              <div className="mb-3">
                <div className="mb-1.5 text-xs text-black/80 dark:text-white/50">{t('matchCard.buildsTab.skillBuild')}</div>
                <div className="flex flex-wrap items-center gap-1">
                  {skills.map((step, index) => <SkillBadge key={index} step={step} />)}
                  {!skills.length && <div className={empty}>{t('matchCard.buildsTab.noSkillUpgrades')}</div>}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs text-black/80 dark:text-white/50">{t('matchCard.buildsTab.itemPurchases')}</div>
                <div className="flex flex-wrap items-start gap-1">
                  {purchases.map((step, index) =>
                    step.type === 'item' ? (
                      <div key={index} className="flex flex-col items-center gap-0.5">
                        <ItemDisplay itemId={step.itemId} size={28} />
                        <div className="text-[9px] whitespace-nowrap text-black/80 tabular-nums dark:text-white/50">{formatGameTime(step.timestamp)}</div>
                      </div>
                    ) : (
                      <div key={index} className="flex h-8 w-7 items-center justify-center text-black/50 dark:text-white/30">→</div>
                    )
                  )}
                  {!purchases.some(step => step.type === 'item') && <div className={empty}>{t('matchCard.buildsTab.noItemPurchases')}</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <ParticipantNavigator participants={players} onSelect={scrollTo} />
    </div>
  )
}
