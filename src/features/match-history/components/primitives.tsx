import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { assetUrl } from '../api'
import { championIconPath, resources, useGameData, type Resources } from '../assets/gameData'
import { RiotText } from '../assets/markup'

export function useMh() {
  const { t, i18n } = useTranslation('mh')
  const data = useGameData()
  const language = i18n.language === 'en' ? 'en' : 'zh'
  const res = useMemo(() => resources(data, t as never, language), [data, t, language])
  return { t, data, res, language, locale: language === 'en' ? 'en-US' : 'zh-TW' }
}

export type { Resources }

/* ---------------------------------------------------------------- tooltip */

interface TipProps {
  content: ReactNode
  children: ReactElement<Record<string, unknown>>
  delay?: number
  placement?: 'top' | 'bottom' | 'right'
  className?: string
  /** Click toggles instead of hover (popover-style panels). */
  trigger?: 'hover' | 'click'
  show?: boolean
  onShowChange?: (show: boolean) => void
  /**
   * Position against this element instead of the trigger: the panel sits to its right,
   * top-aligned, so every tip sharing it opens in the same place.
   */
  anchorTo?: () => HTMLElement | null
  /** Tips in one group replace each other at once while the pointer moves between triggers. */
  group?: string
}

/** Open tip per group (its close function) and when a group's last tip closed. */
const openInGroup = new Map<string, () => void>()
const groupClosedAt = new Map<string, number>()

/**
 * Hover / focus popover rendered in a portal. Keyboard users get it on focus; Escape
 * closes it. It never captures clicks on the trigger.
 */
export function Tip({ content, children, delay = 150, placement = 'top', className, trigger = 'hover', show, onShowChange, anchorTo, group }: TipProps) {
  const [openState, setOpenState] = useState(false)
  const open = show ?? openState
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value)
      onShowChange?.(value)
    },
    [onShowChange]
  )
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = useId()

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const box = panel.current.getBoundingClientRect()
    const margin = 6
    const fixed = anchorTo?.()
    if (fixed) {
      const rect = fixed.getBoundingClientRect()
      const top = Math.max(4, Math.min(rect.top, window.innerHeight - box.height - 4))
      const left = Math.min(Math.max(4, rect.right + margin), window.innerWidth - box.width - 4)
      setStyle({ top, left, visibility: 'visible' })
      return
    }
    const rect = anchor.current.getBoundingClientRect()
    let top = placement === 'bottom' ? rect.bottom + margin : rect.top - box.height - margin
    let left = placement === 'right' ? rect.right + margin : rect.left + rect.width / 2 - box.width / 2
    if (placement === 'right') top = rect.top + rect.height / 2 - box.height / 2
    if (top < 4) top = rect.bottom + margin
    if (top + box.height > window.innerHeight - 4) top = Math.max(4, rect.top - box.height - margin)
    left = Math.min(Math.max(4, left), window.innerWidth - box.width - 4)
    setStyle({ top, left, visibility: 'visible' })
  }, [open, placement, content, anchorTo])

  useEffect(() => {
    if (!open || !group) return
    const close = () => setOpen(false)
    openInGroup.get(group)?.()
    openInGroup.set(group, close)
    return () => {
      if (openInGroup.get(group) !== close) return
      openInGroup.delete(group)
      groupClosedAt.set(group, Date.now())
    }
  }, [open, group, setOpen])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    const outside = (event: PointerEvent) => {
      if (trigger !== 'click') return
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('keydown', close)
    window.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('pointerdown', outside)
    }
  }, [open, setOpen, trigger])

  useEffect(() => () => clearTimeout(timer.current), [])

  const props = children.props as Record<string, (event: unknown) => void>
  const enter = () => {
    clearTimeout(timer.current)
    // Moving straight from one grouped trigger to the next swaps the tip without a delay.
    const swap = !!group && (openInGroup.has(group) || Date.now() - (groupClosedAt.get(group) ?? 0) < 300)
    timer.current = setTimeout(() => setOpen(true), swap ? 0 : delay)
  }
  const leave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 80)
  }
  const handlers =
    trigger === 'hover'
      ? {
          onMouseEnter: (event: unknown) => (props.onMouseEnter?.(event), enter()),
          onMouseLeave: (event: unknown) => (props.onMouseLeave?.(event), leave()),
          onFocus: (event: unknown) => (props.onFocus?.(event), setOpen(true)),
          onBlur: (event: unknown) => (props.onBlur?.(event), setOpen(false))
        }
      : { onClick: (event: unknown) => (props.onClick?.(event), setOpen(!open)) }

  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          anchor.current = node
        },
        'aria-describedby': open && trigger === 'hover' ? id : undefined,
        'aria-expanded': trigger === 'click' ? open : undefined,
        ...handlers
      })}
      {open &&
        content !== null &&
        content !== undefined &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role={trigger === 'hover' ? 'tooltip' : 'dialog'}
            className={`match-history-portal mh-tip ${className ?? ''}`}
            style={style}
            onMouseEnter={trigger === 'hover' ? () => clearTimeout(timer.current) : undefined}
            onMouseLeave={trigger === 'hover' ? leave : undefined}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  )
}

/* ---------------------------------------------------------------- images */

export function GameImage({
  path,
  size,
  className = '',
  style,
  alt = '',
  title
}: {
  path?: string | null
  size?: number
  className?: string
  style?: CSSProperties
  alt?: string
  title?: string
}) {
  const url = assetUrl(path ?? undefined)
  const [failed, setFailed] = useState<string | null>(null)
  const box: CSSProperties = size ? { width: size, height: size, ...style } : { ...style }
  if (!url || failed === url) {
    return <span className={`mh-img-placeholder inline-block shrink-0 ${className}`} style={box} title={title} aria-hidden={alt ? undefined : true} />
  }
  return <img src={url} alt={alt} title={title} draggable={false} loading="lazy" className={`shrink-0 ${className}`} style={box} onError={() => setFailed(url)} />
}

export function ChampionIcon({ championId, size, className = '', title }: { championId: number; size?: number; className?: string; title?: string }) {
  const { res } = useMh()
  if (!championId) return <span className={`mh-img-placeholder inline-block shrink-0 ${className}`} style={size ? { width: size, height: size } : undefined} />
  return <GameImage path={championIconPath(championId)} size={size} className={className} alt={res.championName(championId)} title={title} />
}

const emptySlot = (size: number, className = '') => (
  <span className={`mh-empty-slot inline-block shrink-0 ${className}`} style={{ width: size, height: size }} />
)

export function ItemDisplay({ itemId, size = 20, isTrinket = false }: { itemId: number; size?: number; isTrinket?: boolean }) {
  const { data, t } = useMh()
  const item = data.items[itemId]
  const shape = isTrinket ? 'rounded-full' : 'rounded-xs'
  if (!itemId || !item?.name) return emptySlot(size, shape)
  const inline = (id: number) => data.items[id]
  return (
    <Tip
      delay={50}
      content={
        <div className="max-h-[50vh] overflow-auto">
          <div className="mb-2 flex items-center">
            <GameImage path={item.iconPath} size={28} className="rounded-xs" />
            <div className="ml-2">
              <div className="mb-1 text-xs leading-none font-bold">
                {item.name} <span className="font-normal text-black/50 dark:text-white/50">({item.id})</span>
              </div>
              <div className="text-xs leading-none">
                {item.priceTotal} G{' '}
                {item.price !== item.priceTotal ? `(${t('gameAssets.item.combinePrice', { gold: item.price })})` : ''}
              </div>
            </div>
          </div>
          {item.from?.length > 0 && (
            <div className="mh-item-from mb-1 flex max-w-[460px] flex-wrap items-center gap-0.5">
              {item.from.map(id => inline(id) && <GameImage key={id} path={inline(id).iconPath} size={20} className="rounded-xs" title={inline(id).name} />)}
            </div>
          )}
          {item.to?.length > 0 && (
            <div className="mh-item-to mb-2 flex max-w-[460px] flex-wrap items-center gap-0.5">
              {item.to.map(id => inline(id) && <GameImage key={id} path={inline(id).iconPath} size={20} className="rounded-xs" title={inline(id).name} />)}
            </div>
          )}
          <div className="max-w-[320px] text-xs">
            <RiotText text={item.description} />
          </div>
        </div>
      }
    >
      <span tabIndex={0} className="inline-flex outline-none">
        <GameImage path={item.iconPath} size={size} className={shape} alt={item.name} />
      </span>
    </Tip>
  )
}

export function SpellDisplay({ spellId, size = 20 }: { spellId: number; size?: number }) {
  const { data, t } = useMh()
  const spell = data.spells[spellId]
  if (!spellId || !spell?.name) return emptySlot(size, 'rounded-xs')
  return (
    <Tip
      content={
        <div className="max-w-[300px]">
          <div className="mb-2 flex items-center">
            <GameImage path={spell.iconPath} size={28} className="rounded-xs" />
            <div className="ml-2">
              <div className="mb-1 text-xs leading-none font-bold">{spell.name}</div>
              {spell.cooldown !== undefined && (
                <div className="text-xs leading-none text-black/60 dark:text-white/60">
                  {t('gameAssets.summonerSpell.cooldown', { time: spell.cooldown })}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs">
            <RiotText text={spell.description} />
          </div>
        </div>
      }
    >
      <span tabIndex={0} className="inline-flex outline-none">
        <GameImage path={spell.iconPath} size={size} className="rounded-xs" alt={spell.name} />
      </span>
    </Tip>
  )
}

export function PerkDisplay({ perkId, size = 20, className = '' }: { perkId: number; size?: number; className?: string }) {
  const { data } = useMh()
  const perk = data.perks[perkId]
  if (!perkId || !perk?.name) return emptySlot(size, 'rounded-full')
  return (
    <Tip
      content={
        <div className="max-w-[300px]">
          <div className="mb-2 flex items-center">
            <GameImage path={perk.iconPath} size={28} />
            <div className="ml-2 text-xs font-bold">{perk.name}</div>
          </div>
          <div className="text-xs">
            <RiotText text={perk.longDesc || perk.shortDesc} />
          </div>
        </div>
      }
    >
      <span tabIndex={0} className={`inline-flex h-fit shrink-0 outline-none ${className}`}>
        <GameImage path={perk.iconPath} size={size} alt={perk.name} />
      </span>
    </Tip>
  )
}

export function PerkstyleDisplay({ perkstyleId, size = 20 }: { perkstyleId: number; size?: number }) {
  const { data } = useMh()
  const style = data.perkstyles[perkstyleId]
  if (!perkstyleId || !style?.name) return emptySlot(size, 'rounded-full')
  return (
    <Tip
      content={
        <div className="max-w-[300px] text-xs">
          <div className="font-bold">{style.name}</div>
          {style.tooltip && <RiotText className="mt-1 block" text={style.tooltip} />}
        </div>
      }
    >
      <span tabIndex={0} className="mh-perkstyle inline-flex items-center justify-center rounded-full outline-none" style={{ width: size, height: size }}>
        <GameImage path={style.iconPath} size={Math.round(size * 0.7)} alt={style.name} />
      </span>
    </Tip>
  )
}

export const augmentRarityClass = (rarity?: string) =>
  rarity === 'kPrismatic' ? 'prismatic' : rarity === 'kGold' ? 'gold' : rarity === 'kSilver' || rarity === 'kEventChoice' ? 'silver' : rarity === 'kBronze' ? 'bronze' : ''

/** A player's augments with one hover card that lists all of them, name and text. */
export function AugmentGroup({ augmentIds, size = 20, className = '' }: { augmentIds: number[]; size?: number; className?: string }) {
  const { data, res } = useMh()
  const known = augmentIds.filter(id => id && data.augments[id]?.nameTRA && data.augments[id]?.augmentSmallIconPath)
  const icons = (
    <div tabIndex={known.length ? 0 : undefined} className={`outline-none ${className}`}>
      {augmentIds.map((id, index) => {
        const augment = data.augments[id]
        if (!known.includes(id)) return <span key={`${id}-${index}`} className="inline-flex">{emptySlot(size, 'mh-augment-empty')}</span>
        return (
          <span key={`${id}-${index}`} className="inline-flex">
            <GameImage path={augment.augmentSmallIconPath} size={size} className={`mh-augment ${augmentRarityClass(augment.rarity)}`} alt={augment.nameTRA} />
          </span>
        )
      })}
    </div>
  )
  if (!known.length) return icons
  return (
    <Tip
      delay={50}
      className="mh-augment-group-tip"
      content={
        <div className="flex w-90 max-w-[calc(100vw-24px)] flex-col gap-3">
          {known.map((id, index) => {
            const augment = data.augments[id]
            const tooltip = res.augmentTooltip(id)
            return (
              <div key={`${id}-${index}`} className="flex gap-2.5">
                <GameImage path={augment.augmentSmallIconPath} size={32} className={`mh-augment shrink-0 ${augmentRarityClass(augment.rarity)}`} />
                <div className="min-w-0">
                  <div className="text-sm font-bold">{augment.nameTRA}</div>
                  {/* Tencent's plain-text tooltip, shown unchanged (including its numbers). */}
                  {tooltip && <div className="mt-0.5 text-xs whitespace-pre-line opacity-80">{tooltip}</div>}
                </div>
              </div>
            )
          })}
        </div>
      }
    >
      {icons}
    </Tip>
  )
}

type IconPart = { d: string; opacity?: number; rotate?: [number, number] }
// Upstream position-icons (translate chains removed; they cancel to the origin).
const POSITION_ICONS: Record<string, IconPart[]> = {
  ALL: [{ d: 'M16.293 17.03c.362.628.147 1.43-.48 1.793-.629.364-1.431.149-1.794-.479l-2.144-3.717-2.144 3.717c-.363.628-1.165.843-1.793.48-.628-.363-.843-1.166-.48-1.793l2.144-3.718h-4.29c-.724 0-1.312-.587-1.312-1.312 0-.727.588-1.314 1.313-1.314h4.289L7.457 6.969c-.362-.627-.147-1.43.48-1.792.629-.364 1.431-.149 1.794.479l2.144 3.717 2.144-3.717c.363-.628 1.165-.843 1.793-.48.628.363.843 1.166.48 1.793l-2.144 3.718h4.29c.725 0 1.312.587 1.312 1.312 0 .727-.587 1.314-1.312 1.314h-4.29l2.145 3.718z' }],
  TOP: [
    { d: 'M19 3l-4 4H7v8l-4 4V3h16z' },
    { d: 'M21 5l-4 4H9v8l-4 4V5h16z', opacity: 0.2, rotate: [13, 13] },
    { d: 'M10 10H14V14H10z', opacity: 0.2 }
  ],
  JUNGLE: [{ d: 'M5.14 2c1.58 1.21 5.58 5.023 6.976 9.953s0 10.047 0 10.047c-2.749-3.164-5.893-5.2-6.18-5.382l-.02-.013C5.45 13.814 3 8.79 3 8.79c3.536.867 4.93 4.279 4.93 4.279C7.558 8.698 5.14 2 5.14 2zm14.976 5.907s-1.243 2.471-1.814 4.604c-.235.878-.285 2.2-.29 3.058v.282c.003.347.01.568.01.568s-1.738 2.397-3.38 3.678c.088-1.601.062-3.435-.208-5.334.928-2.023 2.846-5.454 5.682-6.856zm-2.124-5.331s-2.325 3.052-2.836 6.029c-.11.636-.201 1.194-.284 1.695-.379.584-.73 1.166-1.05 1.733-.033-.125-.06-.25-.095-.375-.302-1.07-.704-2.095-1.16-3.08.053-.146.103-.29.17-.438 0 0 1.814-3.78 5.255-5.564z' }],
  MIDDLE: [
    { d: 'M15 3l-4 4H7v4l-4 4V3h12z', opacity: 0.2 },
    { d: 'M21 9l-4 4h-4v4l-4 4V9h12z', opacity: 0.2, rotate: [15, 15] },
    { d: 'M18 3L21 3 21 6 6 21 3 21 3 18z' }
  ],
  BOTTOM: [
    { d: 'M19 3l-4 4H7v8l-4 4V3h16z', opacity: 0.2 },
    { d: 'M21 5l-4 4H9v8l-4 4V5h16z', rotate: [13, 13] },
    { d: 'M10 10H14V14H10z', opacity: 0.2 }
  ],
  UTILITY: [{ d: 'M12.833 10.833L14.5 17.53v.804L12.833 20h-1.666L9.5 18.333v-.804l1.667-6.696h1.666zM7 7.5L9.5 10l-1.667 4.167-2.5-2.5L6.167 10h-2.5L2 7.5h5zm15 0L20.333 10h-2.5l.834 1.667-2.5 2.5L14.5 10 17 7.5h5zM13.743 5l.757.833v.834l-1.667 2.5h-1.666L9.5 6.667v-.834L10.257 5h3.486z' }]
}
const POSITION_ALIASES: Record<string, string> = { FILL: 'ALL', BOT: 'BOTTOM', ADC: 'BOTTOM', JUG: 'JUNGLE', MID: 'MIDDLE', SUPPORT: 'UTILITY' }

export function PositionIcon({ position, className = '', size = 16 }: { position: string; className?: string; size?: number }) {
  const { t } = useMh()
  const upper = (position || 'ALL').toUpperCase()
  const key = POSITION_ALIASES[upper] ?? (POSITION_ICONS[upper] ? upper : 'ALL')
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={t(`common.positions.${upper}`, { defaultValue: upper })}>
      {POSITION_ICONS[key].map((part, index) => (
        <path key={index} d={part.d} fill="currentColor" opacity={part.opacity} transform={part.rotate ? `rotate(-180 ${part.rotate[0]} ${part.rotate[1]})` : undefined} />
      ))}
    </svg>
  )
}

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <span className={`mh-spinner ${className}`} style={{ width: size, height: size }} role="status" aria-label="loading" />
}

/* ---------------------------------------------------------------- formatting */

export function formatExtremeNumber(value: number, locale: string, threshold = 10_000_000) {
  if (Math.abs(value) < threshold) return value.toLocaleString(locale)
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, notation: 'compact', compactDisplay: 'short' }).format(value)
}

export function formatSeconds(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours === 0 ? `${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
}

/** Upstream: relative time up to 3 days, then `YYYY-MM-DD HH:mm`. */
export function formatRelativeTime(timestamp: number, locale: string, now = Date.now()) {
  const diff = now - timestamp
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  if (diff > 3 * 86_400_000) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (Math.abs(minutes) < 60) return format.format(-Math.max(minutes, 0), 'minute')
  const hours = Math.round(diff / 3_600_000)
  if (hours < 24) return format.format(-hours, 'hour')
  return format.format(-Math.round(diff / 86_400_000), 'day')
}

export function formatFullTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(date.getMilliseconds(), 3)}`
}

/** Minute clock shared by relative timestamps. */
const ClockContext = createContext(0)
export function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
}
export const useNow = () => useContext(ClockContext) || Date.now()
