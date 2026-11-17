import type { Participant } from '../types/league-client/match-history'
import type { SgpParticipantLol } from '../types/sgp/match-history'
import type { ReactNode } from 'react'

export type RenderGroupOptions = {
  key:
    | keyof SgpParticipantLol
    | keyof Participant['stats']
    | keyof SgpParticipantLol['challenges']
    | (string & {})

  /** 是否忽略這個欄位 */
  hide?: boolean

  /** 各自渲染方式：數字、文字、自訂 */
  render?:
    | 'float'
    | 'akari-score'
    | 'integer'
    | 'text'
    | 'compat'
    | 'boolean'
    | 'game-time'
    | 'percentage'
    | 'position'
    | 'selectedRole'
    | 'auto'
    | ((value: any) => ReactNode)
}

export type RenderGroup = {
  group: string
  items: RenderGroupOptions[]
}
