import {
  Predicate,
  all,
  allies,
  and,
  anyone,
  assistsBetween,
  csBetween,
  damageDealtToChampionsBetween,
  damageTakenBetween,
  damageToTowersBetween,
  deathsBetween,
  dgrBetween,
  doubleKillsBetween,
  durationBetween,
  enemies,
  everyone,
  game,
  gameCreationInTimeRange,
  goldBetween,
  goldSpentBetween,
  hasAugment,
  hasItem,
  hasPerk,
  hasPerkStyle,
  hasPlayer,
  hasSpell,
  healBetween,
  isAbort,
  isChampion,
  isGameMode,
  isLoss,
  isMap,
  isMatchedGame,
  isPosition,
  isPveGame,
  isQueue,
  isRemake,
  isWin,
  kdaBetween,
  killParticipationBetween,
  killsBetween,
  levelBetween,
  magicDamageDealtToChampionsBetween,
  magicDamageTakenBetween,
  not,
  or,
  pentaKillsBetween,
  physicalDamageDealtToChampionsBetween,
  physicalDamageTakenBetween,
  player,
  quadraKillsBetween,
  soloKillsBetween,
  timeCCingOthersBetween,
  tripleKillsBetween,
  trueDamageDealtToChampionsBetween,
  trueDamageTakenBetween,
  visionScoreBetween
} from '../../data-adapter/predicates/combinators'

import { CombinatorNode, isNodeArg } from './combinator-nodes'
import { getCombinatorProvideScope } from './combinator-specs'

export const COMBINATOR_MAP = {
  game: game,
  and: and,
  or: or,
  not: not,
  isQueue: isQueue,
  isGameMode: isGameMode,
  isMap: isMap,
  isAbort: isAbort,
  isRemake: isRemake,
  hasAugment: hasAugment,
  hasPerk: hasPerk,
  hasPerkStyle: hasPerkStyle,
  enemies: enemies,
  allies: allies,
  all: all,
  player: player,
  hasPlayer: hasPlayer,
  anyone: anyone,
  everyone: everyone,
  hasSpell: hasSpell,
  isPosition: isPosition,
  hasItem: hasItem,
  isChampion: isChampion,
  durationBetween: durationBetween,
  kdaBetween: kdaBetween,
  killsBetween: killsBetween,
  deathsBetween: deathsBetween,
  assistsBetween: assistsBetween,
  goldBetween: goldBetween,
  levelBetween: levelBetween,
  csBetween: csBetween,
  killParticipationBetween: killParticipationBetween,
  damageDealtToChampionsBetween: damageDealtToChampionsBetween,
  physicalDamageDealtToChampionsBetween: physicalDamageDealtToChampionsBetween,
  magicDamageDealtToChampionsBetween: magicDamageDealtToChampionsBetween,
  trueDamageDealtToChampionsBetween: trueDamageDealtToChampionsBetween,
  damageTakenBetween: damageTakenBetween,
  physicalDamageTakenBetween: physicalDamageTakenBetween,
  magicDamageTakenBetween: magicDamageTakenBetween,
  trueDamageTakenBetween: trueDamageTakenBetween,
  goldSpentBetween: goldSpentBetween,
  damageToTowersBetween: damageToTowersBetween,
  healBetween: healBetween,
  visionScoreBetween: visionScoreBetween,
  timeCCingOthersBetween: timeCCingOthersBetween,
  dgrBetween: dgrBetween,
  soloKillsBetween: soloKillsBetween,
  doubleKillsBetween: doubleKillsBetween,
  tripleKillsBetween: tripleKillsBetween,
  quadraKillsBetween: quadraKillsBetween,
  pentaKillsBetween: pentaKillsBetween,
  isWin: isWin,
  isLoss: isLoss,
  isMatchedGame: isMatchedGame,
  isPveGame: isPveGame,
  gameCreationInTimeRange: gameCreationInTimeRange
}

export function toPredicate(rootId: string, nodeMap: Record<string, CombinatorNode>) {
  const root = nodeMap[rootId]
  if (!root) {
    throw new Error(`Root node not found: ${rootId}`)
  }
  const fn = (COMBINATOR_MAP as Record<string, unknown>)[root.type] as (...args: any[]) => Predicate<unknown>
  if (!fn) {
    throw new Error(`Unknown predicate type: ${root.type}`)
  }
  let hasNullNodeArg = false // 對於未完成的子節點，傾向於讓其直接強制真，符合直覺
  const mappedArgs: unknown[] = []
  for (const arg of root.args) {
    if (isNodeArg(arg)) {
      if (arg.value) {
        mappedArgs.push(toPredicate(arg.value, nodeMap))
        continue
      }
      hasNullNodeArg = true
      break
    } else {
      mappedArgs.push(arg.value)
    }
  }
  if (hasNullNodeArg) {
    return (_: unknown) => true
  }
  return fn(...mappedArgs)
}

/**
 * 尋找最近所屬的 scope，跳過 null 節點
 */
export function getScope(rootId: string, nodeMap: Record<string, CombinatorNode>) {
  const root = nodeMap[rootId]
  if (!root) {
    throw new Error(`Root node not found: ${rootId}`)
  }
  let current: string | null = root.id
  while (current) {
    const node: CombinatorNode | undefined = nodeMap[current]
    if (!node) {
      throw new Error(`Node not found: ${current}`)
    }
    const provideScope = getCombinatorProvideScope(node.type)
    if (provideScope !== null) {
      return provideScope
    }
    current = node.parentId
  }
  throw new Error(`No scope found for node: ${rootId}`)
}
