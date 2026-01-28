import { MULTIPLIERS } from './constants'
import { Bet, Matched, Result, Settlement } from './types'
import { validateBet, validateResult } from './validation'

const matchPick = (pick: string | number | undefined, actual: string | number) =>
  pick !== undefined && pick === actual

const buildMatched = (bet: Bet, result: Result): Matched => ({
  start: matchPick(bet.picks.start, result.start),
  lines: matchPick(bet.picks.lines, result.lines),
  end: matchPick(bet.picks.end, result.end),
})

const computeSingleMultiplier = (bet: Bet) => {
  let multiplier = 1
  if (bet.picks.start !== undefined) multiplier *= MULTIPLIERS.start
  if (bet.picks.lines !== undefined) multiplier *= MULTIPLIERS.lines
  if (bet.picks.end !== undefined) multiplier *= MULTIPLIERS.end
  return multiplier
}

const isAllPicksMatched = (bet: Bet, result: Result) => {
  const checks = []
  if (bet.picks.start !== undefined) checks.push(bet.picks.start === result.start)
  if (bet.picks.lines !== undefined) checks.push(bet.picks.lines === result.lines)
  if (bet.picks.end !== undefined) checks.push(bet.picks.end === result.end)
  return checks.every(Boolean)
}

export const settleBet = (bet: Bet, result: Result): Settlement => {
  const betValidation = validateBet(bet)
  if (!betValidation.ok) {
    throw new Error(`Invalid bet: ${betValidation.errors.join(', ')}`)
  }
  const resultValidation = validateResult(result)
  if (!resultValidation.ok) {
    throw new Error(`Invalid result: ${resultValidation.errors.join(', ')}`)
  }

  const matched = buildMatched(bet, result)
  const win = isAllPicksMatched(bet, result)
  const multiplier =
    bet.type === 'COMBO3' ? MULTIPLIERS.combo3 : computeSingleMultiplier(bet)
  const payout = win ? bet.stake * multiplier : 0

  return { win, multiplier, payout, matched }
}
