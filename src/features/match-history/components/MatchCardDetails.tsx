import { RobotOutlined, TagsOutlined, UserOutlined } from '@ant-design/icons'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type WheelEvent } from 'react'
import { computePlayerTags } from '../analysis/tags'
import { markupText, RiotText } from '../assets/markup'
import type { ReplayMetadata } from '../contracts'
import { computeSingleAkariScore, type AkariScore } from '../upstream/data-adapter/analysis/player'
import { computeSingleSummary } from '../upstream/data-adapter/analysis/player/single/summary'
import { EMPTY_PUUID } from '../upstream/constants/common'
import { MAPPED_RENDER_GROUP_OPTIONS, RENDER_GROUP_DISPLAY_ORDER, RENDER_GROUPS } from '../upstream/match-card/groups'
import type { RenderGroupOptions } from '../upstream/match-card/types'
import { cardBorderClass, gameResultName, RELATION_COLORS, relationColor, teamColor, winStyleOf, type CardModel } from './cardModel'
import { DamageBar } from './charts'
import { HeroTabs } from './HeroTabs'
import { MatchCardBuildsTab, ParticipantNavigator, sortedParticipants } from './MatchCardBuilds'
import { MatchCardEventsTab, MatchCardTimelineTab } from './MatchCardTimeline'
import { ManyTags, playerLinkHandlers, type PlayerLink } from './MatchCard'
import {
  AugmentGroup,
  ChampionIcon,
  formatExtremeNumber,
  formatSeconds,
  ItemDisplay,
  PerkDisplay,
  PerkstyleDisplay,
  PositionIcon,
  Spinner,
  SpellDisplay,
  Tip,
  useMh
} from './primitives'
import { RadarChart, StatsBarChart, type StatsBarEntry } from './charts'

type T = (key: string, options?: Record<string, unknown>) => string

/* ------------------------------------------------------------ objective icons */

const ICONS: Record<string, { viewBox: string; d: string[] }> = {
  tower: { viewBox: '0 0 16 16', d: ['m12 8-2 8H6L4 8l4 4zM8 0l4 4-1.003 1.002L11 5h3l-6 6-6-6h2.999L4 4zm0 2.4L6.4 4 8 5.6 9.6 4z'] },
  inhibitor: { viewBox: '0 0 16 16', d: ['M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14m0-1A6 6 0 1 0 8 2a6 6 0 0 0 0 12', 'm8 4 4 4-4 4-4-4z'] },
  dragon: { viewBox: '0 0 16 16', d: ['M8 0 6 4 3 1v4H0l3 3v3l4 5h2l4-5V8l3-3h-3V1l-3 3zm1 11 1-2 2-1-1 2zM4 8l1 2 2 1-1-2z'] },
  baron: { viewBox: '0 0 16 16', d: ['M9 10a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0m0 4a1 1 0 1 1 2 0 1 1 0 0 1-2 0m-2-2a1 1 0 1 1 2 0 1 1 0 0 1-2 0m5-10 2 4-1 1H9L8 4 7 5H5L4 4l2-4-6 4 2 4 3 8 1-1h4l1 1 3-8 2-4z'] },
  voidGrub: { viewBox: '0 0 16 16', d: ['M8 1 6.333 2.42s-.87.798-1.151.798H3.928c-.928 0-2.261.978-2.557 2.68-.074.429-.098 1.282.56 2.168L1 8.812s1.333.71 1.667 2.131C3 12.363 5.088 13.704 6.9 14.088l1.08.881V15L8 14.985l.019.015v-.031l1.08-.881c1.813-.384 3.901-1.724 4.234-3.145.334-1.42 1.667-2.13 1.667-2.13l-.931-.747c.658-.886.637-1.726.56-2.169-.296-1.701-1.629-2.68-2.557-2.68h-1.254c-.28 0-1.151-.797-1.151-.797zm.149 3.245a.2.2 0 0 0-.298 0L5.434 6.93a.2.2 0 0 0 .021.29c.275.228.818.687 1.007.914.21.255-1.316 1.405-1.862 1.804a.202.202 0 0 0-.026.304l1.84 1.88a.2.2 0 0 0 .285 0l1.158-1.183a.2.2 0 0 1 .286 0L9.3 12.122a.2.2 0 0 0 .286 0l1.84-1.88a.202.202 0 0 0-.026-.304c-.546-.399-2.073-1.549-1.862-1.804.189-.227.732-.686 1.007-.913a.2.2 0 0 0 .021-.29z'] },
  riftHerald: { viewBox: '0 0 16 17', d: ['M14.286 11.387c1.219.552 1.714 1.599 1.714 1.599-1.155 2.232-2.581 2.351-2.755 2.357h-.018c.345-.39 1.059-3.956 1.059-3.956m-12.572 0s.713 3.565 1.058 3.956c0 0-1.541.023-2.772-2.357 0 0 .494-1.047 1.714-1.6M11.238 1s4.44 2.576 3.75 7.845c0 0-2.048.345-2.163 1.886 0 0-.85 3.382-4.762 3.52H7.930c-3.910-.138-4.762-3.520-4.762-3.520-.115-1.541-2.163-1.886-2.163-1.886C.314 3.576 4.754 1 4.754 1c-1.157 3.41.03 4.182.152 4.25l.01.006c1.090-.805 2.125-1.095 3.032-1.120q.024-.004.048-.002l.048-.002c.907.029 1.942.319 3.033 1.124 0 0 1.380-.667.160-4.256m-.127 7.638c.023-2.830-3.040-2.588-3.163-2.578-.123-.010-3.186-.252-3.163 2.578 0 0 .023 3.393 3.094 3.680h.138c3.070-.287 3.094-3.680 3.094-3.680M7.993 7.073c.571 0 1.034.940 1.034 2.102 0 1.160-.463 2.100-1.034 2.100-.570 0-1.034-.940-1.034-2.100s.463-2.102 1.034-2.102'] },
  atakhan: { viewBox: '0 0 16 16', d: ['M8 0 6.476 3.048l.508 2.54L8 7.11l1.016-1.524.508-2.54zM6.476 5.587l-.508-2.031-2.031-1.524v2.031L2.413 5.587v1.016h1.016L4.952 5.08z', 'M4.444 6.095 8 8.127l3.556-2.032 1.015 1.016.508 1.524.508-1.524L16 6.603l-3.429 6.095-1.015 2.54-1.016-1.016v-1.524l-1.524 1.016H6.984L5.46 12.698v1.524l-1.016 1.016-1.015-2.54L0 6.603l2.413.508.508 1.524.508-1.524zm2.032 3.556.508 1.524-2.032-1.016-.508-1.524zm3.048 0-.508 1.524 2.032-1.016.508-1.524z', 'm9.524 5.587.508-2.031 2.031-1.524v2.031l1.524 1.524v1.016h-1.016L11.048 5.08z'] }
}

export function ObjectiveIcon({ name, className = 'size-3.5' }: { name: keyof typeof ICONS; className?: string }) {
  const icon = ICONS[name]
  return (
    <svg viewBox={icon.viewBox} className={className} aria-hidden="true">
      {icon.d.map((d, index) => <path key={index} d={d} fill="currentColor" fillRule="evenodd" />)}
    </svg>
  )
}

/* ------------------------------------------------------------ team table */

function DamageBarWithPopover({ metric = 'dealt', total = 0, teamTotal, physical = 0, magic = 0, trueDamage = 0, baseline = 1 }: { metric?: 'dealt' | 'taken'; total?: number; teamTotal: number; physical?: number; magic?: number; trueDamage?: number; baseline?: number }) {
  const { t, locale } = useMh()
  const share = (value: number, of: number) => (of > 0 ? (value / of) * 100 : 0).toFixed(2)
  const parts = [
    { type: 'physical', value: physical, color: 'bg-[#e07856]' },
    { type: 'magic', value: magic, color: 'bg-[#5b9fd7]' },
    { type: 'true', value: trueDamage, color: 'bg-[#a8a8a8]' }
  ]
  return (
    <Tip
      delay={50}
      content={
        <div className="w-64 text-xs tabular-nums">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-gray-500 dark:text-gray-400">{t(`matchCard.damageMetrics.${metric}.total`)}</div>
              <div className="mt-1 text-base font-bold">{total.toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-gray-500 dark:text-gray-400">{t('matchCard.damageMetrics.teamShare')}</div>
              <div className="mt-1 text-base font-bold">{share(total, teamTotal)}%</div>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{t(`matchCard.damageMetrics.${metric}.teamTotal`, { total: teamTotal.toLocaleString() })}</div>
          <div className="my-3 h-px bg-gray-300 dark:bg-gray-700" />
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-bold">{t(`matchCard.damageMetrics.${metric}.composition`)}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{t('matchCard.damageMetrics.shareOfOwnTotal')}</span>
          </div>
          <div className="mb-2"><DamageBar physical={physical} magic={magic} trueDamage={trueDamage} baseline={total} width={256} height={8} /></div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5">
            {parts.map(part => (
              <div key={part.type} className="contents">
                <div className="flex items-center gap-1.5"><span className={`size-2 shrink-0 rounded-xs ${part.color}`} /><span>{t(`matchCard.damageMetrics.${part.type}`)}</span></div>
                <div className="text-right text-gray-500 dark:text-gray-400">{part.value.toLocaleString()}</div>
                <div className="text-right font-medium">{share(part.value, total)}%</div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex flex-col items-center text-[11px]" tabIndex={0}>
        {/* Team share shown inline (rounded to a whole percent); the popover keeps two decimals. */}
        <div className="whitespace-nowrap">
          {formatExtremeNumber(total || 0, locale)}
          <span className="ml-0.5 text-black/60 dark:text-white/60">({teamTotal > 0 ? Math.round((total / teamTotal) * 100) : 0}%)</span>
        </div>
        <DamageBar physical={physical} magic={magic} trueDamage={trueDamage} baseline={baseline} />
      </div>
    </Tip>
  )
}

/**
 * Overview rows show either each player's name or their match tags. One choice for
 * every card, remembered on this device.
 */
const NAME_MODE_KEY = 'mh.overviewShowTags'
const nameMode = {
  value: (() => {
    try {
      return localStorage.getItem(NAME_MODE_KEY) === '1'
    } catch {
      return false
    }
  })(),
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    nameMode.listeners.add(listener)
    return () => void nameMode.listeners.delete(listener)
  },
  get: () => nameMode.value,
  set(value: boolean) {
    nameMode.value = value
    try {
      localStorage.setItem(NAME_MODE_KEY, value ? '1' : '0')
    } catch {
      // Storage unavailable: the choice lasts until the app closes.
    }
    nameMode.listeners.forEach(listener => listener())
  }
}
const useShowTags = () => useSyncExternalStore(nameMode.subscribe, nameMode.get, nameMode.get)

function PlayerTags({ model, player }: { model: CardModel; player: CardModel['participants'][number] }) {
  const { t } = useMh()
  const { teams, basicInfo } = model
  const team = teams.teamStatMap[player.teamIdentifier]
  const tags = useMemo(() => (team ? computePlayerTags({ participant: player, team, teams, basicInfo }, t as never) : []), [player, team, teams, basicInfo, t])
  if (!tags.length) return <div className="text-xs text-black/40 dark:text-white/40">—</div>
  return <ManyTags tags={tags} />
}

function TeamTable({ model, teamIdentifier, open }: { model: CardModel; teamIdentifier: string; open: PlayerLink }) {
  const showTags = useShowTags()
  const { t, res, language } = useMh()
  const { basicInfo, teams, participants } = model
  const team = teams.teamStatMap[teamIdentifier]
  const players = participants.filter(p => p.teamIdentifier === teamIdentifier)
  const hasRoleBound = players.some(p => p.roleBoundItem)
  const sixAugments = players.some(p => p.augments[5])
  const atakhan = teams.teamStatsArr.some(item => item.teamInfo?.objectives.atakhan && (item.teamInfo.objectives.atakhan.kills || 0) > 0)
  const columns: Array<{ name: string; className: string }> =
    basicInfo.gameMode === 'CHERRY'
      ? [
          { name: 'kda', className: 'basis-26 min-w-26 text-center' },
          { name: 'augments', className: 'basis-30 min-w-30 flex gap-0.5 justify-center' },
          { name: 'damage', className: 'basis-32 min-w-32 flex gap-2 justify-center' },
          { name: 'cs', className: 'hidden @[740px]:block basis-18 min-w-18 text-center' },
          { name: 'gold', className: 'hidden @[700px]:block basis-18 min-w-18 text-xs text-center' },
          { name: 'items', className: 'basis-40 w-40 flex gap-0.5 justify-center' }
        ]
      : basicInfo.gameMode === 'KIWI'
        ? [
            { name: 'kda', className: 'basis-26 min-w-26 text-center' },
            { name: 'augments', className: 'basis-29 min-w-29 flex gap-0.5 justify-center' },
            { name: 'damage', className: 'basis-30 min-w-30 flex gap-2 justify-center' },
            { name: 'cs', className: 'hidden @[740px]:block basis-18 min-w-18 text-center' },
            { name: 'gold', className: 'hidden @[700px]:block basis-18 min-w-18 text-xs text-center' },
            { name: 'items', className: 'basis-40 min-w-40 flex gap-0.5 justify-center' }
          ]
        : [
            { name: 'kda', className: 'basis-26 min-w-26 text-center' },
            { name: 'damage', className: 'basis-32 min-w-32 flex gap-2 justify-center' },
            { name: 'cs', className: 'hidden @[700px]:block basis-18 w-18 text-center' },
            { name: 'gold', className: 'basis-18 min-w-18 text-xs text-center' },
            { name: 'items', className: `${hasRoleBound ? 'basis-45 min-w-45' : 'basis-40 min-w-40'} flex gap-0.5 justify-center` }
          ]
  const tone = {
    border: { win: 'dark:border-blue-200/10 border-blue-600/10', loss: 'dark:border-red-300/10 border-red-700/10' }[team.winResult as 'win' | 'loss'] ?? 'dark:border-white/10 border-black/10',
    header: { win: 'dark:bg-blue-200/10 bg-blue-600/10', loss: 'dark:bg-red-300/10 bg-red-700/10' }[team.winResult as 'win' | 'loss'] ?? 'dark:bg-white/10 bg-black/10'
  }
  const resultColor = team.winResult === 'win' ? 'text-blue-700 dark:text-blue-300' : team.winResult === 'loss' ? 'text-red-700 dark:text-red-300' : 'text-black/80 dark:text-white/80'
  const objectives = team.teamInfo?.objectives
  const objective = (name: keyof typeof ICONS, label: string, kills?: number | null) => (
    <div className="flex items-center gap-1 text-black/60 dark:text-white/60" title={label}>
      <ObjectiveIcon name={name} />
      <span>{kills ?? 0}</span>
    </div>
  )
  return (
    <div className={`@container overflow-hidden rounded border border-solid not-last:mb-2 ${tone.border}`}>
      <div className={`box-border flex h-8 items-center gap-4 p-2 text-xs ${tone.header}`}>
        <div className="flex items-center gap-1">
          <div className={`text-xs font-bold ${resultColor}`}>{gameResultName(t as T, language, team.subteamPlacement, team.winResult, team.isSurrender)}</div>
          <div>{t(`common.teams.${teamIdentifier}`, { defaultValue: teamIdentifier })}</div>
          <button
            type="button"
            className={`mh-name-toggle ml-1 ${showTags ? 'active' : ''}`}
            aria-pressed={showTags}
            title={t(showTags ? 'matchCard.teamTable.showNames' : 'matchCard.teamTable.showTags')}
            onClick={() => nameMode.set(!showTags)}
          >
            {showTags ? <UserOutlined /> : <TagsOutlined />}
            <span>{t(showTags ? 'matchCard.teamTable.showNames' : 'matchCard.teamTable.showTags')}</span>
          </button>
        </div>
        <div className="text-xs text-black/80 dark:text-white/80">{team.totalKills}/{team.totalDeaths}/{team.totalAssists}</div>
        <div className="text-xs text-black/80 dark:text-white/80">{team.totalGoldEarned.toLocaleString()}</div>
        {objectives && (
          <div className="flex gap-2">
            {objective('tower', t('matchCard.teamTable.objectives.tower'), objectives.tower.kills)}
            {objective('inhibitor', t('matchCard.teamTable.objectives.inhibitor'), objectives.inhibitor.kills)}
            {objective('dragon', t('matchCard.teamTable.objectives.dragon'), objectives.dragon.kills)}
            {objective('baron', t('matchCard.teamTable.objectives.baron'), objectives.baron.kills)}
            {objective('voidGrub', t('matchCard.teamTable.objectives.voidGrub'), objectives.horde.kills)}
            {objective('riftHerald', t('matchCard.teamTable.objectives.riftHerald'), objectives.riftHerald.kills)}
            {atakhan && objectives.atakhan && objective('atakhan', t('matchCard.teamTable.objectives.atakhan'), objectives.atakhan.kills)}
          </div>
        )}
        {team.teamInfo && team.teamInfo.bans.length > 0 && (
          <div className="ml-auto flex">
            <div className="mr-1 text-xs text-black/60 dark:text-white/60">{t('matchCard.teamTable.bans')}</div>
            <div className="flex gap-0.5">
              {team.teamInfo.bans.slice(0, 5).map((ban, index) => <ChampionIcon key={`${ban.championId}-${index}`} championId={ban.championId} className="size-4 rounded-xs" />)}
              {team.teamInfo.bans.length > 5 && (
                <Tip content={<div className="flex gap-0.5">{team.teamInfo.bans.slice(5).map((ban, index) => <ChampionIcon key={index} championId={ban.championId} className="size-4 rounded-xs" />)}</div>}>
                  <div tabIndex={0} className="text-xs text-black/60 dark:text-white/60">+{team.teamInfo.bans.length - 5}</div>
                </Tip>
              )}
            </div>
          </div>
        )}
      </div>
      {players.map(player => (
        <div key={player.puuid || player.participantId} className={`box-border flex h-12 items-center border-t border-r-0 border-b-0 border-l-0 border-solid border-t-black/5 px-2 py-1 dark:border-t-white/5 ${player.puuid === model.puuid ? 'bg-black/5 bg-clip-padding dark:bg-white/5' : ''}`}>
          <div className="flex min-w-0 grow-2 basis-52 items-center gap-1">
            <Tip placement="right" content={<RadarChart model={model} puuid={player.puuid} />}>
              <div className="relative size-8 cursor-pointer" tabIndex={0}>
                <ChampionIcon championId={player.championId} className="size-full rounded-full" />
                <div className="absolute right-0 -bottom-1 rounded-full bg-black/70 p-0.5 text-[10px] leading-none text-white/80 dark:bg-black/50">{player.level}</div>
              </div>
            </Tip>
            {Boolean(player.spells[0] || player.spells[1]) && (
              <div className="flex flex-col gap-0.5">
                {player.spells.map((spell, index) => <SpellDisplay key={`${spell}-${index}`} spellId={spell} size={16} />)}
              </div>
            )}
            {Boolean(player.perks.styles[0]?.selections[0]?.perk || player.perks.styles[1]?.selections[0]?.perk) && (
              <div className="-ml-0.5 flex flex-col gap-0.5">
                <PerkDisplay perkId={player.perks.styles[0]?.selections[0]?.perk ?? 0} size={16} />
                <PerkstyleDisplay perkstyleId={player.perks.styles[1]?.style ?? 0} size={16} />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {showTags ? (
                <PlayerTags model={model} player={player} />
              ) : (
              <Tip content={<div className="flex items-center gap-1 text-xs"><span className="font-bold">{player.gameName}</span>{player.tagLine && <span className="text-white/80">#{player.tagLine}</span>}</div>}>
                <div className={`flex cursor-pointer items-center gap-1 text-xs ${player.puuid === model.puuid ? 'font-bold text-black dark:text-white' : ''}`} {...playerLinkHandlers(open, player.puuid, { gameName: player.gameName, tagLine: player.tagLine })}>
                  {(!player.puuid || player.puuid === EMPTY_PUUID) && <RobotOutlined className="text-black/80 dark:text-white/80" />}
                  <div className="truncate">
                    {player.gameName}
                    {player.tagLine && `#${player.tagLine}`}
                  </div>
                </div>
              </Tip>
              )}
              {player.position && player.position.toLowerCase() !== 'invalid' && (
                <div className="flex items-center gap-1 text-[11px] text-black/60 dark:text-white/60">
                  <span>{t(`matchCard.position.${player.position}`, { defaultValue: player.position })}</span>
                </div>
              )}
            </div>
          </div>
          {columns.map(column => {
            if (column.name === 'kda') {
              return (
                <div key="kda" className={`grow ${column.className}`}>
                  <div className="text-xs">{player.kills}/{player.deaths}/{player.assists} ({(player.killParticipation * 100).toFixed(0)}%)</div>
                  <div className="text-[11px] text-black/60 dark:text-white/60">{player.kda.toFixed(2)} KDA</div>
                </div>
              )
            }
            if (column.name === 'augments') {
              return (
                <AugmentGroup key="augments" augmentIds={player.augments.slice(0, sixAugments ? 6 : 5)} size={20} className={`grow ${column.className}`} />
              )
            }
            if (column.name === 'damage') {
              return (
                <div key="damage" className={`grow ${column.className}`}>
                  <DamageBarWithPopover total={player.totalDamageDealtToChampions} teamTotal={team.totalDamageDealtToChampions} physical={player.physicalDamageDealtToChampions} magic={player.magicDamageDealtToChampions} trueDamage={player.trueDamageDealtToChampions} baseline={teams.allTeamStats.maxDamageDealtToChampions} />
                  <DamageBarWithPopover metric="taken" total={player.totalDamageTaken} teamTotal={team.totalDamageTaken} physical={player.physicalDamageTaken} magic={player.magicDamageTaken} trueDamage={player.trueDamageTaken} baseline={teams.allTeamStats.maxDamageTaken} />
                </div>
              )
            }
            if (column.name === 'cs') {
              return (
                <div key="cs" className={`grow ${column.className}`}>
                  <div className="text-xs">{player.cs} {t('matchCard.teamTable.cs')}</div>
                  <div className="text-[11px] text-black/60 dark:text-white/60">{(player.cs / (basicInfo.gameDuration / 60)).toFixed(1)} {t('matchCard.teamTable.perMinuteSuffix')}</div>
                </div>
              )
            }
            if (column.name === 'gold') {
              return (
                <div key="gold" className={`grow ${column.className}`}>
                  <div className="text-xs">{player.goldEarned.toLocaleString()}</div>
                  <div className="text-[11px] text-black/60 dark:text-white/60">{(player.goldEarned / (basicInfo.gameDuration / 60)).toFixed(1)} {t('matchCard.teamTable.perMinuteSuffix')}</div>
                </div>
              )
            }
            return (
              <div key="items" className={`grow ${column.className}`}>
                {player.items.slice(0, 7).map((item, index) => <ItemDisplay key={`${item}-${index}`} itemId={item} size={20} isTrinket={index === player.items.length - 1} />)}
                {hasRoleBound && <ItemDisplay itemId={player.roleBoundItem ?? 0} size={20} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function SummaryTab({ model, open }: { model: CardModel; open: PlayerLink }) {
  const { t } = useMh()
  const { basicInfo, teams } = model
  const sorted = basicInfo.isCherrySubteam
    ? teams.teamStatsArr.slice().sort((a, b) => a.subteamPlacement - b.subteamPlacement)
    : teams.teamStatsArr.slice().sort((a, b) => a.teamIdentifier.localeCompare(b.teamIdentifier))
  return (
    <div>
      {basicInfo.isCherrySubteam && (
        <div className="mb-2 flex justify-end rounded-xs bg-neutral-200 px-2 py-1 dark:bg-neutral-800">
          <div className="flex gap-0.5">
            <div className="mr-1 text-xs text-black/60 dark:text-white/60">{t('matchCard.teamTable.bans')}</div>
            {teams.allTeamStats.bans.slice(0, 32).map((ban, index) => <ChampionIcon key={`${ban.championId}-${index}`} championId={ban.championId} className="size-4 rounded-xs" />)}
          </div>
        </div>
      )}
      {sorted.map(team => <TeamTable key={team.teamIdentifier} model={model} teamIdentifier={team.teamIdentifier} open={open} />)}
    </div>
  )
}

/* ------------------------------------------------------------ details table */

function rawDetails(model: CardModel) {
  const { summary, basicInfo, participants } = model
  const scores: Record<string, AkariScore> = {}
  for (const participant of participants) {
    const teamParticipants = participants.filter(p => p.teamIdentifier === participant.teamIdentifier)
    scores[participant.puuid] = computeSingleAkariScore(computeSingleSummary(basicInfo, participant, teamParticipants, participants))
  }
  if (summary.source === 'sgp') {
    const cherry = summary.data.json.gameMode === 'CHERRY'
    return summary.data.json.participants
      .slice().sort((a, b) => (cherry ? a.subteamPlacement - b.subteamPlacement : a.teamId - b.teamId))
      .map(p => {
        const { challenges, missions: _missions, PlayerBehavior, ...rest } = p as typeof p & { missions?: unknown; PlayerBehavior?: Record<string, unknown> }
        return {
          ...rest,
          ...PlayerBehavior,
          ...challenges,
          damageGoldEfficiency: p.totalDamageDealtToChampions / p.goldEarned,
          akariScore: scores[p.puuid],
          championId: p.championId,
          identity: { puuid: p.puuid, gameName: p.riotIdGameName, tagLine: p.riotIdTagline, teamIdentifier: cherry ? `CHERRY-${p.playerSubteamId}` : `TEAM-${p.teamId}` }
        } as Record<string, any>
      })
  }
  const cherry = summary.data.gameMode === 'CHERRY'
  return summary.data.participants
    .map(p => {
      const identity = summary.data.participantIdentities.find(i => i.participantId === p.participantId)
      if (!identity) return null
      return {
        ...p.stats,
        damageGoldEfficiency: p.stats.totalDamageDealtToChampions / p.stats.goldEarned,
        akariScore: scores[identity.player.puuid],
        championId: p.championId,
        identity: { puuid: identity.player.puuid, gameName: identity.player.gameName, tagLine: identity.player.tagLine, teamIdentifier: cherry ? `CHERRY-${p.teamId}` : `TEAM-${p.teamId}` }
      } as Record<string, any>
    })
    .filter((p): p is Record<string, any> => p !== null)
}

function useValueRenderer() {
  const { t, locale } = useMh()
  const empty = <span className="text-black/50 dark:text-white/50">N/A</span>
  const zero = <span className="text-black/50 dark:text-white/50">0</span>
  const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value)
  const compact = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, notation: 'compact', compactDisplay: 'short' })
  const normalizedPosition = (position: string) => (position === 'NONE' || position === 'UNSELECTED' || position === 'FILL' ? 'ALL' : position)
  const reasonMeta = (reason: string) =>
    ({
      FILL_SECONDARY: { name: t('common.positionAssignmentReason.FILL_SECONDARY'), color: '#82613b' },
      FILL_PRIMARY: { name: t('common.positionAssignmentReason.FILL_PRIMARY'), color: '#5b4694' },
      PRIMARY: { name: t('common.positionAssignmentReason.PRIMARY'), color: '#5b4694' },
      SECONDARY: { name: t('common.positionAssignmentReason.SECONDARY'), color: '#5b4694' },
      AUTOFILL: { name: t('common.positionAssignmentReason.AUTOFILL'), color: '#944646' },
      AUTOFILL_SHORT: { name: t('common.positionAssignmentReason.AUTOFILL_SHORT'), color: '#944646' }
    })[reason] ?? null
  const renderers: Record<string, (value: any) => ReactNode> = {
    float: value => (!isNumber(value) ? empty : value === 0 ? zero : <span title={value.toFixed(2)}>{value.toFixed(2)}</span>),
    'akari-score': (value: AkariScore) => (value && Number.isFinite(value.total) ? <span className="cursor-default tabular-nums" title={value.total.toFixed(2)}>{value.total.toFixed(2)}</span> : empty),
    integer: value => (!isNumber(value) ? empty : value === 0 ? zero : <span title={String(value)}>{Math.floor(value).toLocaleString(locale)}</span>),
    text: value => (value === null || value === undefined || value === '' ? empty : String(value)),
    compat: value => (!isNumber(value) ? empty : value === 0 ? zero : <span title={String(value)}>{compact.format(value)}</span>),
    'game-time': value => (!isNumber(value) ? empty : value === 0 ? zero : <span title={String(value)}>{formatSeconds(value)}</span>),
    boolean: value => (value === null || value === undefined || (typeof value !== 'boolean' && typeof value !== 'number') ? empty : value ? t('matchCard.statKeys.true') : t('matchCard.statKeys.false')),
    percentage: value => (!isNumber(value) ? empty : <span title={`${value * 100}%`}>{`${(value * 100).toFixed(2)}%`}</span>),
    position: value =>
      typeof value !== 'string' || value === '' ? empty : (
        <div className="flex items-center justify-center text-base" title={t(`common.positions.${normalizedPosition(value)}`)}>
          <PositionIcon position={normalizedPosition(value)} />
        </div>
      ),
    selectedRole: value => {
      if (typeof value !== 'string' || value === '') return empty
      const segments = value.split('.')
      if (segments.length !== 4 && segments.length !== 5) return empty
      const [current, assignmentReason, primary, secondary] = segments
      if (current === 'NONE' && assignmentReason === 'NONE' && primary === 'NONE' && (secondary === 'NONE' || secondary === 'UNSELECTED')) return empty
      const reason = assignmentReason === 'AUTOFILL' ? reasonMeta('AUTOFILL_SHORT') : null
      return (
        <div className="flex items-center justify-center gap-0.5 text-base" title={value}>
          {reason && <div className="rounded px-1 py-0.5 text-[11px] leading-2.75 whitespace-nowrap text-white" style={{ backgroundColor: reason.color }}>{reason.name}</div>}
          {current !== 'NONE' && <PositionIcon position={normalizedPosition(current)} />}
          {current !== 'NONE' && primary !== 'NONE' && <div className="mx-0.5 h-3 w-px bg-black/25 dark:bg-white/25" />}
          {primary !== 'NONE' && <PositionIcon position={normalizedPosition(primary)} />}
          {secondary !== 'NONE' && secondary !== 'UNSELECTED' && <PositionIcon position={normalizedPosition(secondary)} />}
        </div>
      )
    },
    auto: value => {
      if (value === null || value === undefined) return empty
      if (typeof value === 'number') return Number.isInteger(value) ? <span title={String(value)}>{value}</span> : <span title={value.toFixed(2)}>{value.toFixed(2)}</span>
      if (typeof value === 'string') return <span title={value}>{value}</span>
      if (typeof value === 'boolean') return value ? t('matchCard.statKeys.true') : t('matchCard.statKeys.false')
      return empty
    }
  }
  return renderers
}

/** The most looked-at stats, repeated at the top of the table (they stay in their own groups too). */
const PINNED_KEYS = ['totalDamageDealtToChampions', 'totalDamageTaken', 'totalHeal', 'totalHealsOnTeammates', 'damageGoldEfficiency']
const PINNED_GROUP = {
  group: 'pinned',
  items: PINNED_KEYS.map(key => {
    const { group: _group, ...options } = MAPPED_RENDER_GROUP_OPTIONS[key]
    return options as RenderGroupOptions
  })
}

const RANKED_KINDS = new Set(['compat', 'integer', 'float', 'percentage', 'akari-score', 'auto'])

/** Which cells hold the row's highest value (ties included); none when every value is the same. */
export function bestCells(cells: unknown[], kind: unknown): boolean[] {
  const none = cells.map(() => false)
  if (typeof kind !== 'string' || !RANKED_KINDS.has(kind)) return none
  const values = cells.map(cell => {
    const value = kind === 'akari-score' ? (cell as AkariScore | undefined)?.total : cell
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
  })
  const numbers = values.filter(value => !Number.isNaN(value))
  if (numbers.length < 2) return none
  const max = Math.max(...numbers)
  if (max <= 0 || max === Math.min(...numbers)) return none
  return values.map(value => value === max)
}

function DetailsTab({ model }: { model: CardModel }) {
  const { t, res } = useMh()
  const [filter, setFilter] = useState('')
  const deferred = useDeferredValue(filter)
  const scroller = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const corner = useRef<HTMLTableCellElement>(null)
  // Every stat chart opens right of the name column, level with the table header, so the
  // eye stays put while moving down the rows.
  const chartAnchor = useCallback(() => corner.current, [])
  const render = useValueRenderer()
  const raw = useMemo(() => rawDetails(model), [model])
  const order = useMemo(() => new Map(RENDER_GROUP_DISPLAY_ORDER.map((group, index) => [group, index])), [])
  const statName = (key: string) => t(`matchCard.statKeys.${key}`, { defaultValue: key })
  const groups = useMemo(() => {
    if (raw.length === 0) return []
    const sorted = raw.slice().sort((a, b) => a.identity.teamIdentifier.localeCompare(b.identity.teamIdentifier))
    const undocumented = { group: 'undocumented', items: Object.keys(sorted[0]).filter(key => !(MAPPED_RENDER_GROUP_OPTIONS as Record<string, unknown>)[key]).map(key => ({ key, render: 'auto' as const, hide: false }) as RenderGroupOptions) }
    const query = deferred.trim()
    return [PINNED_GROUP, ...RENDER_GROUPS, undocumented]
      .slice().sort((a, b) => (order.get(a.group) ?? (a.group === PINNED_GROUP.group ? -1 : Number.MAX_SAFE_INTEGER)) - (order.get(b.group) ?? (b.group === PINNED_GROUP.group ? -1 : Number.MAX_SAFE_INTEGER)))
      .map(group => ({
        group: group.group,
        rows: group.items
          .filter(item => item.hide !== true && sorted[0][item.key] !== undefined)
          .filter(item => !query || item.key.includes(query) || statName(item.key).toLowerCase().includes(query.toLowerCase()))
          .map(item => {
            const kind = item.render || 'text'
            const cells = sorted.map(p => p[item.key])
            return { key: item.key, name: statName(item.key), cells, best: bestCells(cells, kind), render: typeof kind === 'function' ? kind : render[kind], chart: ['compat', 'integer', 'float', 'percentage'].includes(String(item.render)), percent: item.render === 'percentage' }
          })
      }))
      .filter(group => group.rows.length > 0)
  }, [raw, deferred, order, render, t])
  const sorted = useMemo(() => raw.slice().sort((a, b) => a.identity.teamIdentifier.localeCompare(b.identity.teamIdentifier)), [raw])
  const { basicInfo } = model
  const ownerTeam = model.participant?.teamIdentifier
  const isOwner = (p: (typeof sorted)[number]) => !!model.puuid && p.identity.puuid === model.puuid
  const ring = (p: (typeof sorted)[number]) => (isOwner(p) ? RELATION_COLORS.self : relationColor(p.identity.teamIdentifier, ownerTeam))
  // Chart rows: the owner's team first, each team sorted by value (upstream sorts within teams).
  const chartEntries = (cells: unknown[]): StatsBarEntry[] => {
    const rows = sorted.map((p, index) => ({ p, value: typeof cells[index] === 'number' ? (cells[index] as number) : Number.NaN }))
    const teamRank = (team: string) => (team === ownerTeam ? '' : team)
    rows.sort((a, b) => teamRank(a.p.identity.teamIdentifier).localeCompare(teamRank(b.p.identity.teamIdentifier)) || (Number.isFinite(b.value) ? b.value : -Infinity) - (Number.isFinite(a.value) ? a.value : -Infinity))
    return rows.map(({ p, value }, index) => ({
      championId: p.championId,
      name: `${p.identity.gameName} #${p.identity.tagLine}`,
      value,
      color: relationColor(p.identity.teamIdentifier, ownerTeam),
      ring: ring(p),
      gap: index > 0 && rows[index - 1].p.identity.teamIdentifier !== p.identity.teamIdentifier
    }))
  }
  const cellClass = 'border-t-0 border-r-0 border-b border-l-0 border-solid border-b-black/5 dark:border-b-white/5'
  const sticky = `sticky left-0 z-2 w-30 max-w-30 truncate bg-[#e5e5e5] p-2 text-center text-xs font-bold dark:bg-[#1a1a1a] ${cellClass}`
  const created = new Date(basicInfo.gameCreation)
  const pad = (n: number) => String(n).padStart(2, '0')
  // The column under the pointer is marked on the table itself (no re-render of every
  // cell); the stylesheet below lights up the matching cells. The row uses :hover.
  const onPointerOver = (event: { target: EventTarget }) => {
    const column = (event.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col
    if (!table.current) return
    if (column === undefined) delete table.current.dataset.col
    else table.current.dataset.col = column
  }
  const onPointerLeave = () => {
    if (table.current) delete table.current.dataset.col
  }
  const columnRules = sorted.map((_, index) => `.mh-stats-table[data-col="${index}"] [data-col="${index}"]`).join(',')
  const onHeaderWheel = (event: WheelEvent) => {
    if (event.deltaY === 0) return
    scroller.current?.scrollBy({ left: event.deltaY, behavior: 'smooth' })
  }
  return (
    <div ref={scroller} className="mh-scroll max-h-142 overflow-auto rounded border border-solid border-black/5 dark:border-white/5">
      <div className="mb-1 flex items-center gap-4 bg-black/5 px-2 py-1 dark:bg-white/5">
        <div className="text-[11px] text-black/80 dark:text-white/60">
          {t('matchCard.detailsTab.gameId')}: <span className="select-text">{basicInfo.gameId}</span> ({basicInfo.dataSource})
        </div>
        <div className="text-[11px] text-black/80 dark:text-white/60">{`${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())} ${pad(created.getHours())}:${pad(created.getMinutes())}:${pad(created.getSeconds())}`}</div>
        <div className="text-[11px] text-black/80 dark:text-white/60">{t('matchCard.detailsTab.gameVersion')}: <span className="select-text">{basicInfo.gameVersion}</span></div>
      </div>
      {columnRules && <style>{`${columnRules} { box-shadow: inset 0 0 0 999px var(--mh-stat-column-hover); }`}</style>}
      <table ref={table} className="mh-stats-table w-full border-separate [border-spacing:0]" onMouseOver={onPointerOver} onMouseLeave={onPointerLeave}>
        <thead onWheel={onHeaderWheel}>
          <tr>
            <th ref={corner} className={`sticky top-0 left-0 z-10 w-30 max-w-30 bg-[#e5e5e5] p-2 text-left dark:bg-[#1a1a1a] ${cellClass}`}>
              <input className="mh-input w-full" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('matchCard.detailsTab.filterPlaceholder')} aria-label={t('matchCard.detailsTab.filterPlaceholder')} />
            </th>
            {sorted.map((p, index) => (
              <th key={index} data-col={index} className={`sticky top-0 z-1 bg-[#e5e5e5] p-2 text-center dark:bg-[#1a1a1a] ${cellClass}`}>
                <div className="flex items-center justify-center" title={`${p.identity.gameName} #${p.identity.tagLine}`}>
                  <span className="box-border inline-flex size-10 rounded-full border-2 border-solid" style={{ borderColor: ring(p) }}>
                    <ChampionIcon championId={p.championId} className="size-full rounded-full" title={res.championName(p.championId)} />
                  </span>
                  <span className="sr-only">{p.identity.gameName}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        {deferred.trim() && groups.length === 0 ? (
          <tbody>
            <tr><td colSpan={sorted.length + 1} className={`h-16 p-2 text-center text-xs text-black/60 dark:text-white/60 ${cellClass}`}>{t('matchCard.detailsTab.noFilterResult')}</td></tr>
          </tbody>
        ) : (
          groups.map((group, index) => (
            <tbody key={group.group}>
              {index > 0 && <tr><td colSpan={sorted.length + 1} className={`h-4 ${cellClass}`} /></tr>}
              {group.rows.map(row => (
                <tr key={row.key} className="mh-stat-row">
                  {row.chart ? (
                    <Tip placement="right" delay={200} className="mh-chart-tip" group="mh-stat-chart" anchorTo={chartAnchor} content={<StatsBarChart title={row.name} entries={chartEntries(row.cells)} percent={row.percent} />}>
                      <td className={sticky} tabIndex={0}>{row.name}</td>
                    </Tip>
                  ) : (
                    <td className={sticky} title={row.name}>{row.name}</td>
                  )}
                  {row.cells.map((cell, cellIndex) => (
                    <td key={cellIndex} data-col={cellIndex} className={`mh-stat-cell max-w-24 truncate p-2 text-center text-xs ${cellClass} ${isOwner(sorted[cellIndex]) ? 'font-bold' : ''} ${row.best[cellIndex] ? 'mh-stat-max' : ''}`} style={isOwner(sorted[cellIndex]) ? { color: RELATION_COLORS.self } : undefined}>
                      {row.best[cellIndex] ? <span className="mh-stat-best">{row.render(cell)}</span> : row.render(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))
        )}
      </table>
    </div>
  )
}

/* ------------------------------------------------------------ runes */

const perkRing = (style: number) =>
  ({ 8000: 'ring-amber-700/60 dark:ring-amber-500/60', 8100: 'ring-red-700/60 dark:ring-red-500/60', 8200: 'ring-violet-700/60 dark:ring-violet-500/60', 8300: 'ring-cyan-700/60 dark:ring-cyan-500/60', 8400: 'ring-emerald-700/60 dark:ring-emerald-500/60' })[style] ?? 'ring-gray-500/80'
const perkDot = (style: number) =>
  ({ 8000: 'bg-amber-700/80 dark:bg-amber-500/80', 8100: 'bg-red-700/80 dark:bg-red-500/80', 8200: 'bg-violet-700/80 dark:bg-violet-500/80', 8300: 'bg-cyan-700/80 dark:bg-cyan-500/80', 8400: 'bg-emerald-700/80 dark:bg-emerald-500/80' })[style] ?? 'bg-gray-500/80'

export function winResultTagClass(result?: string) {
  const common = 'text-xs px-1 py-0.5 rounded'
  if (result === 'win') return `dark:bg-white/20 bg-blue-700/80 dark:text-white text-white ${common}`
  if (result === 'loss') return `dark:bg-white/20 bg-red-700/80 dark:text-white text-white ${common}`
  return `dark:bg-white/20 bg-black/60 dark:text-white text-white ${common}`
}

function RunesTab({ model }: { model: CardModel }) {
  const { t, data, res } = useMh()
  const content = useRef<HTMLDivElement>(null)
  const { participants, team } = model
  const sorted = sortedParticipants(model)
  const name = (p: (typeof participants)[number]) => (p.tagLine ? `${p.gameName} #${p.tagLine}` : p.gameName)
  const perksOf = (p: (typeof participants)[number]) => ({
    perks: p.perks.styles.flatMap(style =>
      style.selections
        .map(selection => {
          const perk = data.perks[selection.perk]
          if (!perk?.name) return null
          const descriptions = (perk.endOfGameStatDescs ?? []).map(desc =>
            desc.replace(/@eogvar(\d+)@/g, (match, index) => (index === '1' ? String(selection.var1) : index === '2' ? String(selection.var2) : index === '3' ? String(selection.var3) : match))
          )
          return { perkId: selection.perk, styleId: style.style, descriptions }
        })
        .filter((value): value is { perkId: number; styleId: number; descriptions: string[] } => value !== null)
    ),
    statPerks: p.perks.statPerks ? [p.perks.statPerks.offense, p.perks.statPerks.flex, p.perks.statPerks.defense] : null
  })
  const scrollTo = (participantId: number) => {
    const target = content.current?.querySelector<HTMLElement>(`[data-runes-participant-id="${participantId}"]`)
    if (target && content.current) content.current.scrollTo({ top: Math.max(target.offsetTop - 8, 0), behavior: 'smooth' })
  }
  return (
    <div className="relative">
      <div ref={content} className="mh-scroll relative max-h-142 overflow-auto">
        {sorted.map(p => {
          const perks = perksOf(p)
          return (
            <div key={p.puuid || p.participantId} data-runes-participant-id={p.participantId} className="rounded-lg bg-black/3 p-3 pr-12 not-last:mb-2 dark:bg-white/3">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex rounded-full border-2 border-solid" style={{ borderColor: teamColor(p.teamIdentifier) }}><ChampionIcon championId={p.championId} className="size-7 rounded-full" /></span>
                <div className="min-w-0 truncate text-sm font-medium">{name(p)}</div>
                {p.position && p.position.toLowerCase() !== 'invalid' && <div className={winResultTagClass(team?.winResult)}>{t(`matchCard.position.${p.position}`, { defaultValue: p.position })}</div>}
                {perks.statPerks && <div className="ml-2 flex gap-2">{perks.statPerks.map((id, index) => <PerkDisplay key={index} perkId={id} size={16} className={`rounded-full ring-2 ${perkRing(-1)}`} />)}</div>}
              </div>
              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />
              {perks.perks.map(perk => (
                <div key={perk.perkId} className="not-last:mb-4">
                  <div className="flex gap-4">
                    <PerkDisplay perkId={perk.perkId} size={24} className={`rounded-full ring-2 ${perkRing(perk.styleId)}`} />
                    <div>
                      <div className="mb-2 text-sm font-bold text-black dark:text-white">{res.perkName(perk.perkId)}</div>
                      {perk.descriptions.map(desc => (
                        <div key={desc} className="flex flex-wrap items-center text-sm text-black/80 not-last:mb-1 dark:text-white/80">
                          <div className={`mr-2 size-2 rotate-45 rounded-sm ${perkDot(perk.styleId)}`} />
                          <RiotText className="text-sm" text={desc} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <ParticipantNavigator participants={sorted} onSelect={scrollTo} />
    </div>
  )
}

/* ------------------------------------------------------------ shell */

/** Watch: a looping arrow around a play triangle, like the client's replay button. */
function WatchReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M6.7 2.9v3.8h3.8" />
      <path d="M10.2 9.1v5.8l4.7-2.9z" fill="currentColor" />
    </svg>
  )
}

/** Download: an arrow into a tray, clearly apart from the watch icon. */
function DownloadReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v10.5" />
      <path d="M7.5 10 12 14.5 16.5 10" />
      <path d="M5 16.5V19h14v-2.5" />
    </svg>
  )
}

function replayTitle(t: T, replay?: ReplayMetadata) {
  if (!replay) return t('matchCard.replay.label')
  switch (replay.state) {
    case 'download':
      return t('matchCard.replay.download')
    case 'watch':
      return t('matchCard.replay.watch')
    case 'incompatible':
      return t('matchCard.replay.unavailable')
    case 'downloading':
      return t('matchCard.replay.downloading', { progress: replay.downloadProgress })
    case 'checking':
      return t('matchCard.replay.checking')
    default:
      return t('matchCard.replay.label')
  }
}

export function MatchCardDetails({ model, tab, onTab, loadingDetails, detailsError, replay, onReplay, onRetryDetails, open }: {
  model: CardModel
  tab?: string
  onTab: (tab: string) => void
  loadingDetails: boolean
  detailsError?: string
  replay?: ReplayMetadata
  onReplay: (action: 'download' | 'watch') => void
  onRetryDetails: () => void
  open: PlayerLink
}) {
  const { t } = useMh()
  const { participants, basicInfo } = model
  const perksAvailable = participants.some(p => p.perks.styles.some(style => style.selections.some(selection => selection.perk !== 0)))
  const tabs = [
    { label: t('matchCard.tabs.summary'), value: 'summary' },
    { label: t('matchCard.tabs.details'), value: 'details' },
    { label: t('matchCard.tabs.runes'), value: 'runes', show: perksAvailable },
    { label: t('matchCard.tabs.events'), value: 'events' },
    // Upstream shows builds only for SGP data, whose details carry item events per player.
    { label: t('matchCard.tabs.builds'), value: 'builds', show: basicInfo.dataSource === 'sgp' },
    { label: t('matchCard.tabs.timeline'), value: 'timeline' }
  ].filter(item => item.show ?? true)
  const selected = tabs.some(item => item.value === tab) ? tab! : 'summary'
  useEffect(() => {
    if (tab && tab !== selected) onTab(selected)
  }, [tab, selected, onTab])
  // Downloading shows a spinner and takes no clicks (upstream's loading button).
  const replayEnabled = replay && ['download', 'watch'].includes(replay.state)
  const needsDetails = selected === 'events' || selected === 'builds' || selected === 'timeline'
  return (
    <div className={`@container relative mt-1 box-border w-full overflow-hidden rounded border border-solid bg-neutral-100/95 p-2 dark:bg-neutral-900/95 ${cardBorderClass(winStyleOf(model))}`}>
      <div className="mb-2 flex items-center gap-1">
        <HeroTabs className="min-w-0 flex-1" items={tabs} value={selected} label={t('matchCard.tabs.label')} onChange={onTab} />
        {replay && (
          <Tip content={replayTitle(t as T, replay)}>
            <button type="button" className="mh-button h-8 px-2" disabled={!replayEnabled} aria-label={replayTitle(t as T, replay)} onClick={() => onReplay(replay.state === 'watch' ? 'watch' : 'download')}>
              {replay.state === 'downloading' ? <Spinner size={14} /> : replay.state === 'watch' ? <WatchReplayIcon /> : <DownloadReplayIcon />}
            </button>
          </Tip>
        )}
      </div>
      {needsDetails && !model.details ? (
        <div className="flex h-24 items-center justify-center gap-2 text-xs text-black/60 dark:text-white/60">
          {loadingDetails ? (
            <><Spinner /> {t('matchCard.common.loading')}</>
          ) : detailsError ? (
            <>
              {t('matchCard.timelineUnavailable', { code: detailsError })} ({detailsError})
              <button type="button" className="mh-button px-2 py-0.5" onClick={onRetryDetails}>{t('matchCard.common.refresh')}</button>
            </>
          ) : (
            t('matchCard.common.noData')
          )}
        </div>
      ) : selected === 'summary' ? (
        <SummaryTab model={model} open={open} />
      ) : selected === 'details' ? (
        <DetailsTab model={model} />
      ) : selected === 'runes' ? (
        <RunesTab model={model} />
      ) : selected === 'events' ? (
        <MatchCardEventsTab model={model} open={open} />
      ) : selected === 'builds' ? (
        <MatchCardBuildsTab model={model} />
      ) : selected === 'timeline' ? (
        <MatchCardTimelineTab model={model} />
      ) : null}
    </div>
  )
}

export { markupText }
