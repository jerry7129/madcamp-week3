import { settleBet } from './settlement'
import type { Bet, Result } from './types'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const result: Result = { start: 'LEFT', lines: 3, end: 'RIGHT' }

const examples: { name: string; bet: Bet; expectWin: boolean }[] = [
  {
    name: 'SINGLE start only (win)',
    bet: { type: 'SINGLE', picks: { start: 'LEFT' }, stake: 1000 },
    expectWin: true,
  },
  {
    name: 'SINGLE mini combo (start+end win)',
    bet: { type: 'SINGLE', picks: { start: 'LEFT', end: 'RIGHT' }, stake: 1000 },
    expectWin: true,
  },
  {
    name: 'SINGLE mini combo (start+end lose)',
    bet: { type: 'SINGLE', picks: { start: 'LEFT', end: 'LEFT' }, stake: 1000 },
    expectWin: false,
  },
  {
    name: 'COMBO3 win',
    bet: {
      type: 'COMBO3',
      picks: { start: 'LEFT', lines: 3, end: 'RIGHT' },
      stake: 1000,
    },
    expectWin: true,
  },
  {
    name: 'COMBO3 lose',
    bet: {
      type: 'COMBO3',
      picks: { start: 'LEFT', lines: 4, end: 'RIGHT' },
      stake: 1000,
    },
    expectWin: false,
  },
]

const invalidBets: Bet[] = [
  { type: 'COMBO3', picks: { start: 'LEFT' }, stake: 1000 }, // missing picks
  { type: 'SINGLE', picks: { lines: 5 as any }, stake: 1000 }, // invalid lines
  { type: 'SINGLE', picks: { end: 'RIGHT' }, stake: 50 }, // below min stake
]

examples.forEach((item) => {
  const settlement = settleBet(item.bet, result)
  assert(settlement.win === item.expectWin, `${item.name} failed`)
  console.log(item.name, settlement)
})

invalidBets.forEach((bet, index) => {
  try {
    settleBet(bet, result)
    throw new Error(`Invalid bet ${index} should have failed`)
  } catch (error) {
    console.log(`Invalid bet ${index} rejected:`, (error as Error).message)
  }
})
