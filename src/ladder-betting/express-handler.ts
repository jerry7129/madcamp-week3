import { settleBet } from './settlement'
import { validateBet, validateResult } from './validation'
import type { Bet, Result } from './types'

export const ladderBetHandler = (req: any, res: any) => {
  const bet: Bet = req?.body?.bet ?? req?.body
  const result: Result = req?.body?.result

  const betValidation = validateBet(bet)
  const resultValidation = validateResult(result)
  const errors = [...betValidation.errors, ...resultValidation.errors]

  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors })
  }

  try {
    const settlement = settleBet(bet, result)
    return res.json({
      ok: true,
      settlement,
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      error: error?.message || 'Settlement failed',
    })
  }
}

// Express example:
// import express from 'express'
// const app = express()
// app.use(express.json())
// app.post('/api/ladder/bet', ladderBetHandler)
