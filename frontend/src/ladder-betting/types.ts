import { LINE_VALUES, SIDE_VALUES } from './constants'

export type Side = (typeof SIDE_VALUES)[number]
export type Lines = (typeof LINE_VALUES)[number]

export type BetType = 'SINGLE' | 'COMBO3'

export type Picks = Partial<{
  start: Side
  lines: Lines
  end: Side
}>

export type Result = {
  start: Side
  lines: Lines
  end: Side
}

export type Bet = {
  type: BetType
  picks: Picks
  stake: number
}

export type Matched = {
  start: boolean
  lines: boolean
  end: boolean
}

export type Settlement = {
  win: boolean
  multiplier: number
  payout: number
  matched: Matched
}

export type ValidationResult = {
  ok: boolean
  errors: string[]
}
