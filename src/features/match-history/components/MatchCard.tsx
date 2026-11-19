import { CrownFilled, RightOutlined, RobotOutlined } from '@ant-design/icons'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { computePlayerTags, type PlayerTag } from '../analysis/tags'
import type { ReplayMetadata } from '../contracts'
import { EMPTY_PUUID } from '../upstream/constants/common'
import { getCherryWinningTeamCount } from '../upstream/data-adapter/match-history/cherry'
import type { LcuOrSgpGameDetails, LcuOrSgpGameSummary } from '../upstream/data-adapter/wrapper'
import { cardBorderClass, gameResultName, useCardModel, winStyleOf, type CardModel } from './cardModel'
import { MatchCardDetails } from './MatchCardDetails'
import {
  AugmentGroup,
  ChampionIcon,
  formatExtremeNumber,
  formatFullTime,
  formatRelativeTime,
  formatSeconds,
  ItemDisplay,
  PerkDisplay,
  PerkstyleDisplay,
  PositionIcon,
  SpellDisplay,
  Tip,
  useMh,
  useNow
} from './primitives'
import { RadarChart } from './charts'

export const MATCH_CARD_COLLAPSED_HEIGHT_PX = 116

export interface PlayerLink {
  (puuid: string, activate?: boolean, label?: { gameName?: string; tagLine?: string; profileIconId?: number }): void
}

export interface MatchCardProps {
  summary: LcuOrSgpGameSummary
  details?: LcuOrSgpGameDetails | null
  puuid: string
  expanded: boolean
  onToggle: () => void
  detailTab?: string
  onDetailTab: (tab: string) => void
  loadingDetails?: boolean
  detailsError?: string
  replay?: ReplayMetadata
  onReplay: (action: 'download' | 'watch') => void
  onLoadDetails: () => void
  onOpenPlayer: PlayerLink
}

/** Middle click opens the player in the background, like upstream. */
export function playerLinkHandlers(open: PlayerLink, puuid: string, label: { gameName?: string; tagLine?: string }) {
  const valid = !!puuid && puuid !== EMPTY_PUUID
  return {
    role: valid ? 'link' : undefined,
    tabIndex: valid ? 0 : undefined,
    onClick: valid ? () => open(puuid, true, label) : undefined,
    onKeyDown: valid ? (event: { key: string; preventDefault(): void }) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), open(puuid, true, label)) : undefined,
    onMouseDown: (event: MouseEvent) => event.button === 1 && event.preventDefault(),
    onMouseUp: valid ? (event: MouseEvent) => event.button === 1 && open(puuid, false, label) : undefined
  }
}

export function ManyTags({ tags }: { tags: PlayerTag[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(tags.length)
  const [overflowLeft, setOverflowLeft] = useState(0)
  const RESERVED = 44
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const children = Array.from(element.querySelectorAll<HTMLElement>('[data-tag-index]'))
      const width = element.clientWidth
      let count = children.length
      for (let index = 0; index < children.length; index++) {
        const right = children[index].offsetLeft + children[index].offsetWidth
        if (right > width) {
          count = index
          break
        }
      }
      if (count < children.length) {
        while (count > 0 && children[count - 1].offsetLeft + children[count - 1].offsetWidth > width - RESERVED) count--
        setOverflowLeft(count > 0 ? children[count - 1].offsetLeft + children[count - 1].offsetWidth + 4 : 0)
      }
      setVisible(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [tags])
  const tag = (item: PlayerTag, index: number, hidden = false) => {
    const body = (
      <div key={index} data-tag-index={index} className={`mh-tag ${item.color} ${item.textColor} ${hidden ? 'invisible' : ''}`}>
        {item.label}
      </div>
    )
    return item.content && !hidden ? (
      <Tip key={index} content={<span className="text-xs">{item.content}</span>}>
        {body}
      </Tip>
    ) : (
      body
    )
  }
  return (
    <div ref={container} className="relative flex gap-1 overflow-hidden">
      {tags.map((item, index) => tag(item, index, index >= visible))}
      {visible < tags.length && (
        // The hidden tags keep their own details: hovering one inside this card opens it,
        // and the card stays open meanwhile (React counts the nested portal as inside it).
        <Tip content={<div className="flex gap-1">{tags.slice(visible).map((item, index) => tag(item, visible + index))}</div>}>
          <div tabIndex={0} className="absolute shrink-0 rounded-xl bg-black/10 px-2 py-0.5 text-xs transition-colors hover:bg-black/20 dark:bg-white/10 hover:dark:bg-white/20" style={{ left: overflowLeft }}>
            +{Math.min(tags.length - visible, 99)}
          </div>
        </Tip>
      )}
    </div>
  )
}

function PlayerName({ model, player, open }: { model: CardModel; player: CardModel['participants'][number]; open: PlayerLink }) {
  const self = player.puuid === model.puuid
  return (
    <div
      className={`truncate text-xs transition-colors group-hover:text-black dark:group-hover:text-white ${self ? 'font-bold text-black/90 dark:text-white/90' : 'text-black/80 dark:text-white/80'}`}
      {...playerLinkHandlers(open, player.puuid, { gameName: player.gameName, tagLine: player.tagLine })}
    >
      {player.gameName}
    </div>
  )
}

function PlayerList({ model, open }: { model: CardModel; open: PlayerLink }) {
  const { basicInfo, teams, participants } = model
  const bot = (puuid: string) => (!puuid || puuid === EMPTY_PUUID) && <RobotOutlined className="text-black/80 dark:text-white/80" />
  if (basicInfo.isTwoTeam) {
    const identifiers = teams.teamStatsArr.map(team => team.teamIdentifier).slice(0, 2)
    const twoTeams = identifiers.map(id => participants.filter(p => p.teamIdentifier === id).slice(0, 5))
    return (
      <div className="mh-player-list z-2 my-1 flex gap-2">
        {twoTeams.map(team => (
          <div key={team[0]?.teamIdentifier} className="flex min-w-0 flex-1 flex-col justify-between gap-0.5">
            {team.map(player => (
              <div key={player.puuid || player.participantId} className="group flex cursor-pointer items-center gap-1">
                <ChampionIcon championId={player.championId} className="size-4 shrink-0 rounded" />
                {bot(player.puuid)}
                <PlayerName model={model} player={player} open={open} />
              </div>
            ))}
            {Array.from({ length: 5 - team.length }, (_, i) => <div key={i} className="h-4" />)}
          </div>
        ))}
      </div>
    )
  }
  if (basicInfo.isCherrySubteam) {
    const cherryTeams = teams.teamStatsArr
      .slice().sort((a, b) => a.subteamPlacement - b.subteamPlacement)
      .map(team => participants.filter(p => p.teamIdentifier === team.teamIdentifier).slice().sort((a, b) => a.participantId - b.participantId))
    const threePlayer = cherryTeams.some(team => team.length === 3)
    if (!threePlayer) {
      const winning = getCherryWinningTeamCount(teams.teamStatsArr.length)
      const winners = cherryTeams.filter(team => (team[0]?.subteamPlacement ?? 99) <= winning).slice(0, winning)
      return (
        <div className="mh-player-list z-2 my-1 grid grid-flow-col grid-cols-2 grid-rows-2 gap-x-2">
          {winners.map(team => (
            <div key={team[0]?.teamIdentifier} className="flex min-w-0 flex-col justify-center gap-1">
              {team.map(player => (
                <div key={player.puuid || player.participantId} className="group flex cursor-pointer items-center gap-1">
                  <div className="size-4 shrink-0 rounded-full bg-black/10 text-center text-[11px] leading-4 text-black/80 dark:bg-white/10 dark:text-white/80">{player.subteamPlacement}</div>
                  <ChampionIcon championId={player.championId} className="size-4 shrink-0 rounded" />
                  {bot(player.puuid)}
                  <PlayerName model={model} player={player} open={open} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )
    }
    return (
      <div className="mh-player-list z-2 my-3 grid grid-flow-col grid-cols-2 grid-rows-3 content-center gap-x-2 gap-y-1">
        {cherryTeams.map(team => (
          <div key={team[0]?.teamIdentifier} className="flex min-w-0 items-center gap-1">
            <div className="size-4 shrink-0 rounded-full bg-black/10 text-center text-[11px] leading-4 text-black/80 dark:bg-white/10 dark:text-white/80">{team[0]?.subteamPlacement}</div>
            {team.map(player => (
              <Tip key={player.participantId} content={<div className="flex items-center gap-1 text-xs"><span className="font-bold">{player.gameName}</span>{player.tagLine && <span className="text-white/80">#{player.tagLine}</span>}</div>}>
                <div className="relative cursor-pointer transition-[filter] hover:brightness-110" {...playerLinkHandlers(open, player.puuid, { gameName: player.gameName, tagLine: player.tagLine })}>
                  <ChampionIcon championId={player.championId} className={`size-4 shrink-0 rounded ${player.puuid === model.puuid ? 'ring-1 ring-black/60 dark:ring-white/70' : ''}`} />
                  {(!player.puuid || player.puuid === EMPTY_PUUID) && <RobotOutlined className="absolute -right-1 -bottom-1 text-[10px] text-black/80 dark:text-white/80" />}
                </div>
              </Tip>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return null
}

function Overview({ model, expanded, onToggle, open }: { model: CardModel; expanded: boolean; onToggle: () => void; open: PlayerLink }) {
  const { t, res, language, locale } = useMh()
  const now = useNow()
  const { participant, team, basicInfo, teams } = model
  const style = winStyleOf(model)
  const tags = useMemo(
    () => (participant && team ? computePlayerTags({ participant, team, teams, basicInfo }, t as never) : []),
    [participant, team, teams, basicInfo, t]
  )
  if (!participant || !team) {
    return (
      <div className="flex h-[116px] items-center justify-center rounded border border-solid border-black/20 bg-neutral-100/95 text-xs text-black/60 dark:border-white/20 dark:bg-neutral-900/95 dark:text-white/60">
        {t('playerTabs.profile.participantMissing')}
      </div>
    )
  }
  const gameMode = basicInfo.gameMode
  const parts = { augments: gameMode === 'CHERRY' || gameMode === 'KIWI', runes: gameMode !== 'CHERRY' && gameMode !== 'KIWI', cs: gameMode === 'CLASSIC' }
  const primary = participant.perks.styles[0]
  const secondary = participant.perks.styles[1]
  const perks = primary?.selections[0]?.perk && secondary?.style ? { primaryPerkId: primary.selections[0].perk, subPerkStyleId: secondary.style } : null
  const teamDamage = teams.teamStatMap[participant.teamIdentifier]?.totalDamageDealtToChampions || 1
  const championBorder = style === 'win' ? 'border-blue-600/80 dark:border-blue-300/80' : style === 'loss' ? 'border-red-600/80 dark:border-red-300/80' : 'border-black/80 dark:border-white/80'
  const resultColor = style === 'win' ? 'text-blue-600 dark:text-blue-300' : style === 'loss' ? 'text-red-700 dark:text-red-300' : 'text-black/80 dark:text-white'
  const kp = (participant.killParticipation * 100).toFixed(0)
  return (
    <div
      className={`@container relative box-border flex w-full cursor-pointer overflow-hidden rounded border border-solid bg-neutral-100/95 select-none dark:bg-neutral-900/95 ${cardBorderClass(style)}`}
      style={{ height: MATCH_CARD_COLLAPSED_HEIGHT_PX }}
      onClick={event => {
        // Blank space toggles the card; links, buttons and tooltip popups (portals) keep their own action.
        const target = event.target as Element
        if (!event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return
        onToggle()
      }}
    >
      <div className="z-1 flex min-w-0 flex-1 gap-2 px-4 py-1">
        <div className="z-2 my-1 flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex h-12 gap-2">
            <div className="flex w-17.5 shrink-0 items-center">
              <div className="relative">
                <ChampionIcon championId={participant.championId} className={`relative -left-0.5 box-border size-11 rounded-lg border-2 border-solid ${championBorder}`} />
                {participant.subteamPlacement === 1 && (
                  <div className="absolute top-0 left-[calc(50%-2px)] -translate-x-1/2 -translate-y-1/2 text-orange-600 dark:text-yellow-500">
                    <CrownFilled />
                  </div>
                )}
                {participant.position && participant.position.toLowerCase() !== 'invalid' && (
                  <div className="absolute right-0 bottom-0 rounded-sm bg-black/60 p-0.5 text-white/80 dark:bg-black/80">
                    <PositionIcon position={participant.position} size={14} className="block" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex gap-0.5">
                {Boolean(participant.spells[0] || participant.spells[1]) && (
                  <div className="flex flex-col gap-0.5">
                    <SpellDisplay spellId={participant.spells[0]} size={20} />
                    <SpellDisplay spellId={participant.spells[1]} size={20} />
                  </div>
                )}
                {parts.runes && perks && (
                  <div className="flex flex-col gap-0.5">
                    <PerkDisplay perkId={perks.primaryPerkId} size={20} />
                    <PerkstyleDisplay perkstyleId={perks.subPerkStyleId} size={20} />
                  </div>
                )}
              </div>
              {parts.augments && (
                <AugmentGroup augmentIds={participant.augments} size={20} className="hidden grid-cols-3 gap-0.5 @[680px]:grid" />
              )}
              <div className="w-0" />
              <Tip delay={300} content={<RadarChart model={model} puuid={model.puuid} />}>
                <div className="flex gap-2" tabIndex={0}>
                  <div className="min-w-22">
                    <div className="flex items-center justify-center gap-0.5">
                      <div className="text-base font-bold text-black dark:text-white">{participant.kills}</div>
                      <div className="mx-px text-xs text-black/60 dark:text-white/60">/</div>
                      <div className="text-base font-bold text-red-600 dark:text-red-300">{participant.deaths}</div>
                      <div className="mx-px text-xs text-black/60 dark:text-white/60">/</div>
                      <div className="text-base font-bold text-black dark:text-white">{participant.assists}</div>
                    </div>
                    {participant.deaths === 0 && (participant.kills > 0 || participant.assists > 0) ? (
                      <div className="flex justify-center text-xs text-yellow-700 dark:text-yellow-200">
                        {t('matchCard.overview.perfect')} ({kp}%)
                      </div>
                    ) : (
                      <div className="flex justify-center gap-1">
                        <div className="text-xs text-black/80 dark:text-white/80">{participant.kda.toFixed(2)}</div>
                        <div className="text-xs text-black/80 dark:text-white/80">({kp}%)</div>
                      </div>
                    )}
                  </div>
                  <div className="min-w-22">
                    <div className="text-center text-base font-bold">{((participant.totalDamageDealtToChampions / teamDamage) * 100).toFixed(0)}%</div>
                    <div className="flex justify-center gap-1">
                      <div className="text-xs text-black/80 dark:text-white/80">{formatExtremeNumber(participant.totalDamageDealtToChampions, locale)}</div>
                      <div className="text-xs text-black/60 dark:text-white/60">{t('matchCard.overview.damage')}</div>
                    </div>
                  </div>
                  {parts.cs && (
                    <div className="hidden min-w-22 @min-[700px]:block">
                      <div className="text-center text-base font-bold">
                        {formatExtremeNumber(participant.cs, locale)} <span className="text-[11px] font-normal text-black/60 dark:text-white/60">{t('matchCard.overview.cs')}</span>
                      </div>
                      <div className="flex justify-center gap-1">
                        <div className="text-xs text-black/80 dark:text-white/80">{(participant.cs / (basicInfo.gameDuration / 60)).toFixed(1)}</div>
                        <div className="text-xs text-black/60 dark:text-white/60">{t('matchCard.overview.csPerMin')}</div>
                      </div>
                    </div>
                  )}
                </div>
              </Tip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-17.5 shrink-0">
              <div className={`text-sm leading-none font-bold ${resultColor}`}>
                {gameResultName(t as never, language, team.subteamPlacement, team.winResult, team.isSurrender)}
              </div>
            </div>
            <div className="flex gap-0.5">
              {participant.items.slice(0, 6).map((item, index) => <ItemDisplay key={`${item}-${index}`} itemId={item} size={20} />)}
              <ItemDisplay itemId={participant.items[6]} size={20} isTrinket />
              {participant.roleBoundItem ? <ItemDisplay itemId={participant.roleBoundItem} size={20} /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <ManyTags tags={tags} />
            </div>
          </div>
          <div className="flex">
            <div className="text-xs text-black dark:text-white/80">{res.queueName(basicInfo.queueId)}</div>
            <div className="mx-1 text-xs text-black/40 dark:text-white/40">·</div>
            <div className="text-xs text-black/80 dark:text-white/60">{formatSeconds(basicInfo.gameDuration)}</div>
            <div className="mx-1 text-xs text-black/60 dark:text-white/40">·</div>
            <div className="text-xs text-black/80 dark:text-white/60" title={formatFullTime(basicInfo.gameCreation)}>
              {formatRelativeTime(basicInfo.gameCreation, locale, now)}
            </div>
            <div className="mx-1 text-xs text-black/60 dark:text-white/40">·</div>
            <div className="flex-1 truncate text-xs text-black/80 dark:text-white/60">{res.mapName(basicInfo.mapId, basicInfo.gameModeMutators)}</div>
          </div>
        </div>
        <PlayerList model={model} open={open} />
      </div>
      <button
        type="button"
        onClick={event => {
          event.stopPropagation()
          onToggle()
        }}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'matchCard.collapse' : 'matchCard.expand')}
        className="z-1 flex w-8 cursor-pointer items-center justify-center border-t-0 border-r-0 border-b-0 border-l border-solid border-l-black/10 bg-white/20 transition-colors hover:bg-black/5 active:bg-black/5 dark:border-l-white/10 dark:bg-white/5 hover:dark:bg-white/10 active:dark:bg-white/5"
      >
        <RightOutlined className={`text-base text-black/60 transition-transform dark:text-white/60 ${expanded ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      <div className={`absolute top-0 left-0 z-0 h-full w-full ${style === 'win' ? 'mh-shadow-win' : style === 'loss' ? 'mh-shadow-loss' : 'mh-shadow-remake'}`} />
    </div>
  )
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="link"], [role="button"]'

/**
 * Animated height for the expanded area (grid rows 0fr → 1fr). The content stays
 * mounted until the closing transition ends, then unmounts like before.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) setMounted(true)
    else {
      setShown(false)
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setMounted(false)
    }
  }, [open])
  // Once mounted at 0fr, force a style flush so the switch to 1fr animates
  // (no animation-frame wait, which stalls in background windows).
  useLayoutEffect(() => {
    if (!open || !mounted || shown || !box.current) return
    void box.current.offsetHeight
    setShown(true)
  }, [open, mounted, shown])
  if (!mounted) return null
  return (
    <div
      ref={box}
      className={`mh-collapse ${shown ? 'open' : ''}`}
      onTransitionEnd={event => event.target === event.currentTarget && !open && setMounted(false)}
    >
      <div className="mh-collapse-inner">{children}</div>
    </div>
  )
}

export const MatchCard = memo(function MatchCard(props: MatchCardProps) {
  const model = useCardModel(props.summary, props.details, props.puuid)
  const { expanded, details, loadingDetails, detailsError, onLoadDetails } = props
  useEffect(() => {
    if (expanded && !details && !loadingDetails && !detailsError) onLoadDetails()
  }, [expanded, details, loadingDetails, detailsError, onLoadDetails])
  return (
    <div className="mh-card relative w-full" style={{ containIntrinsicSize: `${MATCH_CARD_COLLAPSED_HEIGHT_PX}px` }}>
      <Overview model={model} expanded={expanded} onToggle={props.onToggle} open={props.onOpenPlayer} />
      <Collapse open={expanded}>
        <MatchCardDetails
          model={model}
          tab={props.detailTab}
          onTab={props.onDetailTab}
          loadingDetails={!!loadingDetails}
          detailsError={detailsError}
          replay={props.replay}
          onReplay={props.onReplay}
          onRetryDetails={onLoadDetails}
          open={props.onOpenPlayer}
        />
      </Collapse>
    </div>
  )
})
