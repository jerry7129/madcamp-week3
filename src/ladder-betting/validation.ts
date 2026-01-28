import { LINE_VALUES, MIN_STAKE, SIDE_VALUES } from './constants'
import { Bet, Picks, Result, ValidationResult } from './types'

const isSide = (value: unknown): value is (typeof SIDE_VALUES)[number] =>
  SIDE_VALUES.includes(value as (typeof SIDE_VALUES)[number])

const isLines = (value: unknown): value is (typeof LINE_VALUES)[number] =>
  LINE_VALUES.includes(value as (typeof LINE_VALUES)[number])

const hasAnyPick = (picks: Picks) =>
  picks.start !== undefined || picks.lines !== undefined || picks.end !== undefined

export const validateResult = (result: Result): ValidationResult => {
  const errors: string[] = []
  if (!isSide(result?.start)) {
    errors.push('result.start must be LEFT or RIGHT')
  }
  if (!isLines(result?.lines)) {
    errors.push('result.lines must be 3 or 4')
  }
  if (!isSide(result?.end)) {
    errors.push('result.end must be LEFT or RIGHT')
  }
  return { ok: errors.length === 0, errors }
}

export const validateBet = (bet: Bet): ValidationResult => {
  const errors: string[] = []
  if (bet?.type !== 'SINGLE' && bet?.type !== 'COMBO3') {
    errors.push('type must be SINGLE or COMBO3')
  }

  const stake = bet?.stake
  if (!Number.isInteger(stake) || stake < MIN_STAKE) {
    errors.push(`stake must be integer >= ${MIN_STAKE}`)
  }

  const picks = bet?.picks ?? {}
  if (!hasAnyPick(picks)) {
    errors.push('picks must include at least one of start/lines/end')
  }

  if (picks.start !== undefined && !isSide(picks.start)) {
    errors.push('picks.start must be LEFT or RIGHT')
  }
  if (picks.lines !== undefined && !isLines(picks.lines)) {
    errors.push('picks.lines must be 3 or 4')
  }
  if (picks.end !== undefined && !isSide(picks.end)) {
    errors.push('picks.end must be LEFT or RIGHT')
  }

  if (bet?.type === 'COMBO3') {
    if (picks.start === undefined || picks.lines === undefined || picks.end === undefined) {
      errors.push('COMBO3 requires start, lines, and end picks')
    }
  }

  return { ok: errors.length === 0, errors }
}
