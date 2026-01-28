import { useEffect, useMemo, useRef, useState } from 'react'
import Section from '../components/Section'
import useCredits from '../hooks/useCredits'
import { MIN_STAKE } from '../ladder-betting/constants'
import { settleBet } from '../ladder-betting/settlement'
import {
  decideMatch,
  fetchMatches,
  fetchMe,
  playOddEvenGame,
  playRpsGame,
  voteMatch,
} from '../api'
import { validateBet } from '../ladder-betting/validation'

const choices = [
  { id: 'scissors', label: '가위', emoji: '✌️' },
  { id: 'rock', label: '바위', emoji: '✊' },
  { id: 'paper', label: '보', emoji: '✋' },
]

const winMap = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
}

const resultMessages = {
  win: '이겼어요! 잘했어요.',
  lose: '졌어요. 다시 도전해봐요.',
  draw: '비겼어요. 한 판 더?',
}

const oddEvenChoices = [
  { id: 'odd', label: '홀' },
  { id: 'even', label: '짝' },
]

const oddEvenMessages = {
  win: '적중! 승리했어요.',
  lose: '아쉽게 틀렸어요.',
}

const ODD_EVEN_MULTIPLIER = 0.9

const suits = ['♠', '♥', '♦', '♣']
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

const buildDeck = () => {
  const deck = []
  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      let value = 0
      if (rank === 'A') value = 1
      else if (!Number.isNaN(Number(rank))) value = Number(rank)
      deck.push({ suit, rank, value })
    })
  })
  return deck
}

const shuffleDeck = (deck) => {
  const next = [...deck]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

const scoreHand = (hand) => {
  const total = hand.reduce((sum, card) => sum + card.value, 0)
  return total % 10
}

const LADDER_ROWS = 7
const LADDER_WIN_RATE = 2
const ladderModes = [
  { id: 'start', label: '출발지 예측' },
  { id: 'lines', label: '가로줄 개수 예측' },
  { id: 'end', label: '도착점 예측' },
]

const ladderBetModes = [
  { id: 'start', label: '출발지' },
  { id: 'lines', label: '가로줄' },
  { id: 'end', label: '도착지' },
]

const ladderSideLabels = {
  left: '왼쪽',
  right: '오른쪽',
}

const predictionDefaults = {
  title: 'VoxLab Invitational',
  schedule: '오늘 21:00',
  teamAName: 'A팀',
  teamBName: 'B팀',
}

const MINIGAME_STORAGE_KEY = 'minigame-state-v1'

const readMinigameState = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(MINIGAME_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const normalizeHistory = (value) => (Array.isArray(value) ? value : [])

const normalizeMatchList = (data) => {
  if (Array.isArray(data)) return data
  return data?.items || data?.matches || data?.list || []
}

const resolveMatchTeam = (match, key) => {
  const team =
    key === 'teamA'
      ? match?.team_a || match?.teamA || match?.team_a_id || match?.teamAId
      : match?.team_b || match?.teamB || match?.team_b_id || match?.teamBId
  if (team && typeof team === 'object') {
    return {
      id: extractNumericId(team, ['id', 'team_id', 'teamId']),
      name: team?.name || team?.title || team?.team_name || team?.teamName || '',
    }
  }
  const id = extractNumericId(team, ['id', 'team_id', 'teamId'])
  return { id, name: '' }
}

const resolveMatchVotes = (match, teamKey) => {
  const directKeys =
    teamKey === 'teamA'
      ? ['team_a_votes', 'teamAVotes', 'team_a_vote', 'teamAVote']
      : ['team_b_votes', 'teamBVotes', 'team_b_vote', 'teamBVote']
  for (const key of directKeys) {
    const value = match?.[key]
    if (Number.isFinite(Number(value))) return Number(value)
  }
  const team =
    teamKey === 'teamA'
      ? match?.team_a || match?.teamA
      : match?.team_b || match?.teamB
  const nestedKeys = ['votes', 'vote_count', 'voteCount', 'count']
  for (const key of nestedKeys) {
    const value = team?.[key]
    if (Number.isFinite(Number(value))) return Number(value)
  }
  return 0
}

const resolveMatchStatus = (match) => {
  const status = String(match?.status || '').toLowerCase()
  if (match?.winner_team_id || match?.winnerTeamId || status.includes('closed')) {
    return 'closed'
  }
  if (status.includes('finish') || status.includes('done')) return 'closed'
  return 'open'
}

const resolveMatchVoted = (match) => {
  if (typeof match?.is_voted === 'boolean') return match.is_voted
  if (typeof match?.isVoted === 'boolean') return match.isVoted
  return false
}

const resolveMatchVotedTeam = (match) => {
  return extractNumericId(match, ['my_vote_team_id', 'myVoteTeamId', 'voted_team_id'])
}

const resolveMatchMeta = (match) => {
  const rawSchedule =
    match?.scheduled_at ||
    match?.scheduledAt ||
    match?.start_time ||
    match?.startTime ||
    match?.created_at ||
    match?.createdAt ||
    predictionDefaults.schedule
  return {
    title: match?.title || predictionDefaults.title,
    schedule: rawSchedule,
  }
}

const extractNumericId = (value, keys = []) => {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractNumericId(item, keys)
      if (found != null) return found
    }
    return null
  }
  if (typeof value === 'object') {
    for (const key of keys) {
      if (value[key] != null) {
        const found = extractNumericId(value[key], keys)
        if (found != null) return found
      }
    }
    for (const key of Object.keys(value)) {
      const found = extractNumericId(value[key], keys)
      if (found != null) return found
    }
  }
  return null
}

const resolveAdminFlag = (me) => {
  if (!me || typeof me !== 'object') return false
  if (typeof me.is_admin === 'boolean') return me.is_admin
  if (typeof me.isAdmin === 'boolean') return me.isAdmin
  if (typeof me.admin === 'boolean') return me.admin
  const role = String(me.role || me.user_role || '').toLowerCase()
  return role === 'admin' || role === 'superuser'
}

const LadderBoard = ({ rungs, startSide, endSide, reveal }) => {
  const containerRef = useRef(null)
  const pathRef = useRef(null)
  const [boardHeight, setBoardHeight] = useState(360)
  const [pathLength, setPathLength] = useState(0)
  const rows = rungs.length
  const width = 260
  const height = boardHeight
  const topMargin = 28
  const bottomMargin = 28
  const leftX = 70
  const rightX = width - 70
  const step = rows > 1 ? (height - topMargin - bottomMargin) / (rows - 1) : 0
  const endY = height - bottomMargin
  const startX = startSide === 'left' ? leftX : rightX
  const endX = endSide === 'left' ? leftX : rightX
  const startMarkerY = topMargin + 6
  const startLabelY = startMarkerY + 18
  const labelY = Math.max(12, topMargin - 10)
  let pathX = startX
  let currentY = topMargin
  let path = `M ${pathX} ${currentY}`
  rungs.forEach((hasRung, index) => {
    const y = topMargin + index * step
    path += ` L ${pathX} ${y}`
    currentY = y
    if (hasRung) {
      pathX = pathX === leftX ? rightX : leftX
      path += ` L ${pathX} ${y}`
    }
  })
  if (currentY < endY) {
    path += ` L ${pathX} ${endY}`
  }

  useEffect(() => {
    if (!containerRef.current) return undefined
    const updateSize = () => {
      const nextHeight = containerRef.current?.clientHeight || 360
      setBoardHeight(nextHeight)
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pathRef.current) return
    const nextLength = pathRef.current.getTotalLength()
    if (Number.isFinite(nextLength)) {
      setPathLength(nextLength)
    }
  }, [path, height])

  return (
    <div className="ladder-board-frame" ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`ladder-board-svg ${reveal ? 'reveal' : ''}`}
        role="img"
        aria-label="사다리 보드"
      >
        <line className="ladder-rail" x1={leftX} y1={topMargin} x2={leftX} y2={endY} />
        <line className="ladder-rail" x1={rightX} y1={topMargin} x2={rightX} y2={endY} />
        {rungs.map((hasRung, index) => {
          const y = topMargin + index * step
          return hasRung ? (
            <line
              key={`rung-${index}`}
              className="ladder-rung-line"
              x1={leftX}
              y1={y}
              x2={rightX}
              y2={y}
            />
          ) : null
        })}
        <path
          ref={pathRef}
          className={`ladder-path ${reveal ? 'reveal' : ''}`}
          d={path}
          style={{
            strokeDasharray: pathLength,
            strokeDashoffset: reveal ? pathLength : 0,
          }}
        />
        <circle className="ladder-start-dot" cx={startX} cy={startMarkerY} r="5" />
        <circle className="ladder-end-dot" cx={endX} cy={endY} r="6" />
        <text className="ladder-label" x={leftX} y={labelY}>
          LEFT
        </text>
        <text className="ladder-label" x={rightX} y={labelY}>
          RIGHT
        </text>
        <text className="ladder-label ladder-start-label" x={startX} y={startLabelY}>
          START
        </text>
        <text className="ladder-label" x={endX} y={height - 10}>
          END
        </text>
      </svg>
    </div>
  )
}

const buildLadderRound = () => {
  const rungCount = Math.random() < 0.5 ? 3 : 4
  const positions = Array.from({ length: LADDER_ROWS }, (_, index) => index)
    .sort(() => Math.random() - 0.5)
    .slice(0, rungCount)
  const rungs = Array.from({ length: LADDER_ROWS }, (_, index) =>
    positions.includes(index),
  )
  const startSide = Math.random() < 0.5 ? 'left' : 'right'
  const endSide = rungs.reduce(
    (side, hasRung) =>
      hasRung ? (side === 'left' ? 'right' : 'left') : side,
    startSide,
  )
  return {
    rungs,
    rungCount,
    startSide,
    endSide,
  }
}

const gameTabs = [
  { id: 'odd-even', label: '홀짝' },
  { id: 'rps', label: '가위바위보' },
  { id: 'ladder', label: '사다리' },
  { id: 'prediction', label: '승부 예측' },
  { id: 'baccarat', label: '바카라' },
]

function MiniGamePage() {
  const storedMinigame = readMinigameState()
  const { credits, addCredits, setCredits } = useCredits()
  const [activeGame, setActiveGame] = useState(
    storedMinigame?.activeGame || 'odd-even',
  )
  const [gameStarted, setGameStarted] = useState(() => ({
    'odd-even': true,
    rps: true,
    ladder: true,
    baccarat: true,
    prediction: true,
  }))
  const [winStreak, setWinStreak] = useState(storedMinigame?.winStreak ?? 0)
  const [playerChoice, setPlayerChoice] = useState(null)
  const [cpuChoice, setCpuChoice] = useState(null)
  const [result, setResult] = useState(null)
  const [score, setScore] = useState(
    storedMinigame?.rpsScore ?? { win: 0, lose: 0, draw: 0 },
  )
  const [history, setHistory] = useState(
    normalizeHistory(storedMinigame?.rpsHistory),
  )
  const [rpsStake, setRpsStake] = useState(String(MIN_STAKE))
  const [rpsLockedStake, setRpsLockedStake] = useState(0)
  const [rpsMessage, setRpsMessage] = useState('')
  const [rpsSettled, setRpsSettled] = useState(false)
  const [rpsRolling, setRpsRolling] = useState(false)
  const [rpsShuffleEmoji, setRpsShuffleEmoji] = useState('❓')
  const [rpsDelta, setRpsDelta] = useState(null)
  const [rpsDebug, setRpsDebug] = useState(null)
  const rpsSettledRef = useRef(false)
  const rpsTimerRef = useRef(null)
  const rpsShuffleTimerRef = useRef(null)
  const [rpsHistoryOpen, setRpsHistoryOpen] = useState(false)
  const [oddEvenChoice, setOddEvenChoice] = useState(null)
  const [oddEvenNumber, setOddEvenNumber] = useState(null)
  const [oddEvenResult, setOddEvenResult] = useState(null)
  const [oddEvenSettled, setOddEvenSettled] = useState(false)
  const [oddEvenStake, setOddEvenStake] = useState(String(MIN_STAKE))
  const [oddEvenLockedStake, setOddEvenLockedStake] = useState(0)
  const [oddEvenMessage, setOddEvenMessage] = useState('')
  const oddEvenSettledRef = useRef(false)
  const [oddEvenRolling, setOddEvenRolling] = useState(false)
  const [oddEvenRollingNumber, setOddEvenRollingNumber] = useState(null)
  const [oddEvenAnimationType, setOddEvenAnimationType] = useState('rolling')
  const [oddEvenDelta, setOddEvenDelta] = useState(null)
  const oddEvenTimerRef = useRef(null)
  const oddEvenRollTimerRef = useRef(null)
  const [oddEvenHistory, setOddEvenHistory] = useState(
    normalizeHistory(storedMinigame?.oddEvenHistory),
  )
  const [oddEvenHistoryOpen, setOddEvenHistoryOpen] = useState(false)
  const [cardPhase, setCardPhase] = useState('idle')
  const [playerHand, setPlayerHand] = useState([])
  const [opponentHand, setOpponentHand] = useState([])
  const [playerScore, setPlayerScore] = useState(null)
  const [opponentScore, setOpponentScore] = useState(null)
  const [cardResult, setCardResult] = useState('')
  const [baccaratRevealed, setBaccaratRevealed] = useState([false, false, false, false])
  const [baccaratDealing, setBaccaratDealing] = useState(false)
  const baccaratTimersRef = useRef([])
  const [baccaratPrediction, setBaccaratPrediction] = useState(null)
  const [baccaratStake, setBaccaratStake] = useState(String(MIN_STAKE))
  const [baccaratMessage, setBaccaratMessage] = useState('')
  const [baccaratOutcome, setBaccaratOutcome] = useState(null)
  const [baccaratHit, setBaccaratHit] = useState(null)
  const [baccaratDelta, setBaccaratDelta] = useState(null)
  const [predictionChoice, setPredictionChoice] = useState(null)
  const [predictionAmount, setPredictionAmount] = useState(
    Number.isFinite(Number(storedMinigame?.predictionAmount))
      ? Math.max(1, Number(storedMinigame?.predictionAmount))
      : 1,
  )
  const [predictionStatus, setPredictionStatus] = useState('open')
  const [predictionMatches, setPredictionMatches] = useState([])
  const [predictionVoted, setPredictionVoted] = useState(false)
  const [predictionVotedTeamId, setPredictionVotedTeamId] = useState(null)
  const [predictionVotes, setPredictionVotes] = useState({
    teamA: 0,
    teamB: 0,
  })
  const [predictionResult, setPredictionResult] = useState(null)
  const [predictionMatchId, setPredictionMatchId] = useState(null)
  const [predictionTeams, setPredictionTeams] = useState({
    teamA: { id: null, name: predictionDefaults.teamAName },
    teamB: { id: null, name: predictionDefaults.teamBName },
  })
  const [predictionMeta, setPredictionMeta] = useState({
    title: predictionDefaults.title,
    schedule: predictionDefaults.schedule,
  })
  const [predictionLoading, setPredictionLoading] = useState(false)
  const [predictionSubmitting, setPredictionSubmitting] = useState(false)
  const [predictionMessage, setPredictionMessage] = useState('')
  const [predictionAdminChoice, setPredictionAdminChoice] = useState('teamA')
  const [predictionIsAdmin, setPredictionIsAdmin] = useState(false)
  const [ladderState, setLadderState] = useState(null)
  const [ladderStarted, setLadderStarted] = useState(false)
  const [ladderStage, setLadderStage] = useState('START')
  const [ladderActiveModes, setLadderActiveModes] = useState([])
  const [ladderSelections, setLadderSelections] = useState({
    start: null,
    lines: null,
    end: null,
  })
  const [ladderStake, setLadderStake] = useState(String(MIN_STAKE))
  const [ladderResult, setLadderResult] = useState(null)
  const [ladderMessage, setLadderMessage] = useState('')
  const [ladderPopup, setLadderPopup] = useState(null)
  const [ladderHistory, setLadderHistory] = useState(
    normalizeHistory(storedMinigame?.ladderHistory),
  )
  const [ladderHistoryOpen, setLadderHistoryOpen] = useState(false)
  const [ladderSelectedPredictions, setLadderSelectedPredictions] = useState([])

  const choiceMap = useMemo(() => {
    return choices.reduce((acc, choice) => {
      acc[choice.id] = choice
      return acc
    }, {})
  }, [])

  const applyOutcome = (outcome) => {
    if (outcome === 'win') {
      setWinStreak((prev) => {
        const next = prev + 1
        addCredits(next * 10)
        return next
      })
      return
    }
    if (outcome === 'lose') {
      setWinStreak(0)
      setCredits((prev) => Math.max(prev - 30, 0))
      return
    }
    if (outcome === 'draw') {
      setWinStreak(0)
    }
  }

  const normalizeRpsChoice = (raw) => {
    if (raw === 0 || raw === 1 || raw === 2) {
      if (raw === 0) return 'rock'
      if (raw === 1) return 'paper'
      return 'scissors'
    }
    if (raw === 1 || raw === 2 || raw === 3) {
      if (raw === 1) return 'rock'
      if (raw === 2) return 'paper'
      return 'scissors'
    }
    if (!raw) return null
    const normalized = String(raw).toLowerCase()
    if (['rock', 'rocks', '바위', 'r'].includes(normalized)) return 'rock'
    if (['paper', '보', 'paperwork', 'p'].includes(normalized)) return 'paper'
    if (['scissors', '가위', 'scissor', 's'].includes(normalized)) return 'scissors'
    return null
  }

  const normalizeOutcome = (raw) => {
    if (raw === 0 || raw === 1 || raw === -1 || raw === 2) {
      if (raw === 1) return 'win'
      if (raw === -1) return 'lose'
      if (raw === 2) return 'draw'
      return 'draw'
    }
    if (!raw) return null
    const normalized = String(raw).toLowerCase()
    if (['w', 'win', 'success', '승', '승리'].some((value) => normalized.includes(value))) {
      return 'win'
    }
    if (['l', 'lose', 'fail', '패', '패배'].some((value) => normalized.includes(value))) {
      return 'lose'
    }
    if (['d', 'draw', 'tie', '무', '무승부'].some((value) => normalized.includes(value))) {
      return 'draw'
    }
    if (['player', 'user', 'me'].some((value) => normalized.includes(value))) {
      return 'win'
    }
    if (['cpu', 'bot', 'computer', 'ai'].some((value) => normalized.includes(value))) {
      return 'lose'
    }
    return null
  }

  const resolveRps = async (choiceId) => {
    if (rpsSettledRef.current) return
    rpsSettledRef.current = true
    setRpsMessage('')
    const stakeValue =
      rpsLockedStake > 0 ? rpsLockedStake : Math.floor(Number(rpsStake))
    let cpuPick = null
    let nextResult = null
    let delta = null
    let nextCredits = null
    let rawResponse = null
    try {
      const response = await playRpsGame({
        bet_amount: stakeValue,
        choice: choiceId,
      })
      rawResponse = response
      setRpsDebug(response)
      const payload =
        (response?.data && typeof response.data === 'object' ? response.data : null) ||
        (response?.payload && typeof response.payload === 'object' ? response.payload : null) ||
        (response?.game && typeof response.game === 'object' ? response.game : null) ||
        (response && typeof response === 'object' ? response : {})
      cpuPick =
        normalizeRpsChoice(
          payload?.cpu_choice ||
            payload?.cpuChoice ||
            payload?.computer_choice ||
            payload?.opponent_choice ||
            payload?.computer ||
            payload?.cpu ||
            payload?.choices?.cpu ||
            payload?.choices?.computer ||
            payload?.server_choice ||
            payload?.serverChoice,
        ) || cpuPick
      nextResult =
        normalizeOutcome(
          payload?.result ||
            payload?.outcome ||
            payload?.status ||
            payload?.message ||
            payload?.result_text ||
            payload?.resultText ||
            payload?.game_result ||
            payload?.gameResult ||
            payload?.winner,
        ) ||
        (typeof payload?.win === 'boolean' ? (payload.win ? 'win' : 'lose') : null) ||
        (typeof payload?.is_win === 'boolean' ? (payload.is_win ? 'win' : 'lose') : null) ||
        (typeof payload?.is_draw === 'boolean' ? (payload.is_draw ? 'draw' : null) : null)
      if (typeof payload?.delta === 'number') delta = payload.delta
      if (typeof payload?.profit === 'number') delta = payload.profit
      if (typeof payload?.payout === 'number') delta = payload.payout - stakeValue
      if (typeof payload?.credit_change === 'number') delta = payload.credit_change
      const creditsCandidate =
        payload?.credits ||
        payload?.credit ||
        payload?.balance ||
        payload?.remaining_credits ||
        payload?.remainingCredits ||
        payload?.current_balance ||
        payload?.currentBalance
      if (typeof creditsCandidate === 'number') nextCredits = creditsCandidate
    } catch (error) {
      setRpsMessage(`결과 처리 실패: ${error.message}`)
    }
    if (!nextResult) {
      rpsSettledRef.current = false
      setRpsSettled(false)
      setRpsMessage((prev) => {
        if (prev) return prev
        const snapshot = rawResponse ? JSON.stringify(rawResponse) : '응답 없음'
        return `게임 결과를 가져오지 못했습니다. (${snapshot})`
      })
      return
    }
    if (delta == null) delta = 0

    setCpuChoice(cpuPick || null)
    setResult(nextResult)
    setRpsDelta(delta)
    if (typeof nextCredits === 'number') {
      setCredits(Math.max(nextCredits, 0))
    } else {
      setCredits((prev) => Math.max(prev + delta, 0))
    }
    setScore((prev) => ({
      ...prev,
      [nextResult]: prev[nextResult] + 1,
    }))
    setHistory((prev) => {
      const nextEntry = {
        id: `${Date.now()}-${choiceId}-${cpuPick}`,
        player: choiceId,
        cpu: cpuPick,
        result: nextResult,
        delta,
      }
      return [nextEntry, ...prev].slice(0, 5)
    })
    setRpsSettled(true)
  }

  const startRps = (choiceId) => {
    if (rpsSettled || rpsSettledRef.current || rpsRolling) return
    const stakeValue = Math.floor(Number(rpsStake))
    if (!Number.isFinite(stakeValue) || stakeValue < MIN_STAKE) {
      setRpsMessage(`베팅 크레딧은 ${MIN_STAKE} 이상이어야 합니다.`)
      return
    }
    if (credits < stakeValue) {
      setRpsMessage('크레딧이 부족합니다.')
      return
    }
    setRpsLockedStake(stakeValue)
    setPlayerChoice(choiceId)
    setCpuChoice(null)
    setResult(null)
    setRpsSettled(false)
    rpsSettledRef.current = false
    setRpsMessage('')
    if (rpsTimerRef.current) {
      clearTimeout(rpsTimerRef.current)
    }
    if (rpsShuffleTimerRef.current) {
      clearInterval(rpsShuffleTimerRef.current)
    }
    setRpsRolling(true)
    setRpsShuffleEmoji('❓')
    rpsShuffleTimerRef.current = setInterval(() => {
      const pick = choices[Math.floor(Math.random() * choices.length)]
      setRpsShuffleEmoji(pick.emoji)
    }, 100)
    const delay = 600 + Math.floor(Math.random() * 600)
    rpsTimerRef.current = setTimeout(() => {
      if (rpsShuffleTimerRef.current) {
        clearInterval(rpsShuffleTimerRef.current)
        rpsShuffleTimerRef.current = null
      }
      setRpsRolling(false)
      resolveRps(choiceId)
    }, delay)
  }

  const resetGame = () => {
    if (rpsTimerRef.current) {
      clearTimeout(rpsTimerRef.current)
      rpsTimerRef.current = null
    }
    if (rpsShuffleTimerRef.current) {
      clearInterval(rpsShuffleTimerRef.current)
      rpsShuffleTimerRef.current = null
    }
    setPlayerChoice(null)
    setCpuChoice(null)
    setResult(null)
    setScore({ win: 0, lose: 0, draw: 0 })
    setHistory([])
    setRpsSettled(false)
    rpsSettledRef.current = false
    setRpsHistoryOpen(false)
    setRpsLockedStake(0)
    setRpsMessage('')
    setRpsRolling(false)
    setRpsShuffleEmoji('❓')
    setRpsDelta(null)
    setRpsDebug(null)
  }

  useEffect(() => {
    return () => {
      if (rpsTimerRef.current) {
        clearTimeout(rpsTimerRef.current)
      }
      if (rpsShuffleTimerRef.current) {
        clearInterval(rpsShuffleTimerRef.current)
      }
    }
  }, [])

  const resetOddEven = () => {
    if (oddEvenTimerRef.current) {
      clearTimeout(oddEvenTimerRef.current)
      oddEvenTimerRef.current = null
    }
    if (oddEvenRollTimerRef.current) {
      clearInterval(oddEvenRollTimerRef.current)
      oddEvenRollTimerRef.current = null
    }
    setOddEvenChoice(null)
    setOddEvenNumber(null)
    setOddEvenResult(null)
    setOddEvenMessage('')
    setOddEvenSettled(false)
    setOddEvenLockedStake(0)
    setOddEvenRolling(false)
    setOddEvenRollingNumber(null)
    setOddEvenAnimationType('rolling')
    setOddEvenDelta(null)
    oddEvenSettledRef.current = false
  }

  const resolveOddEven = async (choiceId) => {
    if (oddEvenSettledRef.current) return
    oddEvenSettledRef.current = true
    const stakeValue =
      oddEvenLockedStake > 0 ? oddEvenLockedStake : Math.floor(Number(oddEvenStake))
    let nextNumber = null
    let nextResult = null
    let delta = null
    let nextCredits = null
    let rawResponse = null
    try {
      const response = await playOddEvenGame({
        bet_amount: stakeValue,
        choice: choiceId,
      })
      rawResponse = response
      const payload =
        (response?.data && typeof response.data === 'object' ? response.data : null) ||
        (response?.payload && typeof response.payload === 'object' ? response.payload : null) ||
        (response?.game && typeof response.game === 'object' ? response.game : null) ||
        (response && typeof response === 'object' ? response : {})
      const numberCandidate =
        payload?.number ??
        payload?.result_number ??
        payload?.resultNumber ??
        payload?.roll ??
        payload?.rolled ??
        payload?.value ??
        payload?.oddeven_number ??
        payload?.odd_even_number ??
        payload?.oddEvenNumber
      const parsedNumber = Number(numberCandidate)
      if (Number.isFinite(parsedNumber)) {
        nextNumber = parsedNumber
      }
      const parityCandidate =
        payload?.parity ?? payload?.odd_even ?? payload?.oddEven ?? payload?.parity_result
      const strictOutcome = (value) => {
        if (value == null) return null
        if (typeof value === 'number') {
          if (value === 1) return 'win'
          if (value === 0 || value === -1) return 'lose'
          if (value === 2) return 'draw'
          return null
        }
        const normalized = String(value).toLowerCase().trim()
        if (['win', 'success', '승', '승리'].includes(normalized)) return 'win'
        if (['lose', 'loss', 'fail', '패', '패배'].includes(normalized)) return 'lose'
        if (['draw', 'tie', '무', '무승부'].includes(normalized)) return 'draw'
        return null
      }
      nextResult =
        strictOutcome(
          payload?.result ||
            payload?.outcome ||
            payload?.result_text ||
            payload?.resultText ||
            payload?.game_result ||
            payload?.gameResult,
        ) ||
        (typeof payload?.win === 'boolean' ? (payload.win ? 'win' : 'lose') : null) ||
        (typeof payload?.is_win === 'boolean' ? (payload.is_win ? 'win' : 'lose') : null)
      if (!nextResult && typeof parityCandidate === 'string') {
        const normalizedParity = parityCandidate.toLowerCase()
        if (normalizedParity === 'odd' || normalizedParity === 'even') {
          nextResult = normalizedParity === choiceId ? 'win' : 'lose'
        }
      }
      if (!nextResult && Number.isFinite(nextNumber)) {
        const parity = nextNumber % 2 === 0 ? 'even' : 'odd'
        nextResult = parity === choiceId ? 'win' : 'lose'
      }
      if (typeof payload?.delta === 'number') delta = payload.delta
      if (typeof payload?.profit === 'number') delta = payload.profit
      if (typeof payload?.payout === 'number') delta = payload.payout - stakeValue
      if (typeof payload?.credit_change === 'number') delta = payload.credit_change
      const creditsCandidate =
        payload?.credits ||
        payload?.credit ||
        payload?.balance ||
        payload?.remaining_credits ||
        payload?.remainingCredits ||
        payload?.current_balance ||
        payload?.currentBalance
      if (typeof creditsCandidate === 'number') nextCredits = creditsCandidate
    } catch (error) {
      setOddEvenMessage(`결과 처리 실패: ${error.message}`)
    }
    if (!nextResult) {
      oddEvenSettledRef.current = false
      setOddEvenSettled(false)
      setOddEvenMessage((prev) => {
        if (prev) return prev
        const snapshot = rawResponse ? JSON.stringify(rawResponse) : '응답 없음'
        return `게임 결과를 가져오지 못했습니다. (${snapshot})`
      })
      return
    }
    if (delta == null) {
      delta =
        nextResult === 'win'
          ? Math.round(stakeValue * ODD_EVEN_MULTIPLIER)
          : -stakeValue
    }
    if (nextNumber == null && Number.isFinite(oddEvenRollingNumber)) {
      nextNumber = oddEvenRollingNumber
    }
    setOddEvenNumber(nextNumber)
    setOddEvenResult(nextResult)
    setOddEvenDelta(delta)
    if (typeof nextCredits === 'number') {
      setCredits(Math.max(nextCredits, 0))
    } else {
      setCredits((prev) => Math.max(prev + delta, 0))
    }
    setOddEvenHistory((prev) => {
      const nextEntry = {
        id: `${Date.now()}-${choiceId}-${nextNumber}`,
        number: nextNumber,
        choice: choiceId,
        result: nextResult,
        stake: stakeValue,
        delta,
      }
      return [nextEntry, ...prev].slice(0, 8)
    })
    setOddEvenSettled(true)
  }

  const startOddEven = (choiceId) => {
    if (oddEvenSettled || oddEvenSettledRef.current || oddEvenRolling) return
    const stakeValue = Math.floor(Number(oddEvenStake))
    if (!Number.isFinite(stakeValue) || stakeValue < MIN_STAKE) {
      setOddEvenMessage(`베팅 크레딧은 ${MIN_STAKE} 이상이어야 합니다.`)
      return
    }
    if (credits < stakeValue) {
      setOddEvenMessage('크레딧이 부족합니다.')
      return
    }
    setOddEvenLockedStake(stakeValue)
    setOddEvenChoice(choiceId)
    setOddEvenNumber(null)
    setOddEvenResult(null)
    setOddEvenMessage('')
    setOddEvenSettled(false)
    setOddEvenDelta(null)
    oddEvenSettledRef.current = false
    if (oddEvenTimerRef.current) {
      clearTimeout(oddEvenTimerRef.current)
    }
    if (oddEvenRollTimerRef.current) {
      clearInterval(oddEvenRollTimerRef.current)
    }
    const animationOptions = ['dice', 'rolling', 'ball']
    const nextAnimation =
      animationOptions[Math.floor(Math.random() * animationOptions.length)]
    const delay = 1000 + Math.floor(Math.random() * 1000)
    setOddEvenAnimationType(nextAnimation)
    setOddEvenRolling(true)
    setOddEvenRollingNumber(Math.floor(Math.random() * 10) + 1)
    oddEvenRollTimerRef.current = setInterval(() => {
      setOddEvenRollingNumber(Math.floor(Math.random() * 10) + 1)
    }, 120)
    oddEvenTimerRef.current = setTimeout(() => {
      if (oddEvenRollTimerRef.current) {
        clearInterval(oddEvenRollTimerRef.current)
        oddEvenRollTimerRef.current = null
      }
      setOddEvenRolling(false)
      resolveOddEven(choiceId)
    }, delay)
  }

  useEffect(() => {
    return () => {
      if (oddEvenTimerRef.current) {
        clearTimeout(oddEvenTimerRef.current)
      }
      if (oddEvenRollTimerRef.current) {
        clearInterval(oddEvenRollTimerRef.current)
      }
    }
  }, [])

  const clearBaccaratTimers = () => {
    baccaratTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    baccaratTimersRef.current = []
  }

  const dealCards = () => {
    if (baccaratDealing) return
    if (!baccaratPrediction) {
      setBaccaratMessage('예측을 선택하세요.')
      return
    }
    const stakeValue = Math.floor(Number(baccaratStake))
    if (!Number.isFinite(stakeValue) || stakeValue < MIN_STAKE) {
      setBaccaratMessage(`베팅 크레딧은 ${MIN_STAKE} 이상이어야 합니다.`)
      return
    }
    if (credits < stakeValue) {
      setBaccaratMessage('크레딧이 부족합니다.')
      return
    }
    setBaccaratMessage('')
    clearBaccaratTimers()
    const deck = shuffleDeck(buildDeck())
    const nextPlayerHand = [deck.pop(), deck.pop()]
    const nextOpponentHand = [deck.pop(), deck.pop()]
    const nextPlayerScore = scoreHand(nextPlayerHand)
    const nextOpponentScore = scoreHand(nextOpponentHand)
    const outcome =
      nextPlayerScore === nextOpponentScore
        ? 'TIE'
        : nextPlayerScore > nextOpponentScore
          ? 'PLAYER'
          : 'BANKER'
    const outcomeLabels = {
      PLAYER: '플레이어 승',
      BANKER: '상대 승',
      TIE: '무승부',
    }
    const hit = baccaratPrediction === outcome
    const delta = hit
      ? Math.round(stakeValue * (outcome === 'TIE' ? 2.0 : 0.9))
      : -stakeValue

    setPlayerHand(nextPlayerHand)
    setOpponentHand(nextOpponentHand)
    setPlayerScore(nextPlayerScore)
    setOpponentScore(nextOpponentScore)
    setCardResult(outcomeLabels[outcome])
    setCardPhase('dealt')
    setBaccaratRevealed([false, false, false, false])
    setBaccaratDealing(true)
    setBaccaratOutcome(outcome)
    setBaccaratHit(hit)
    setBaccaratDelta(delta)
    setCredits((prev) => Math.max(prev + delta, 0))

    const revealOrder = [0, 1, 2, 3]
    revealOrder.forEach((index, step) => {
      const timerId = setTimeout(() => {
        setBaccaratRevealed((prev) => {
          if (!prev[index]) {
            const next = [...prev]
            next[index] = true
            return next
          }
          return prev
        })
        if (step === revealOrder.length - 1) {
          setBaccaratDealing(false)
        }
      }, 120 + step * 150)
      baccaratTimersRef.current.push(timerId)
    })
  }

  const resetCards = () => {
    clearBaccaratTimers()
    setPlayerHand([])
    setOpponentHand([])
    setPlayerScore(null)
    setOpponentScore(null)
    setCardResult('')
    setCardPhase('idle')
    setBaccaratRevealed([false, false, false, false])
    setBaccaratDealing(false)
    setBaccaratPrediction(null)
    setBaccaratStake(String(MIN_STAKE))
    setBaccaratMessage('')
    setBaccaratOutcome(null)
    setBaccaratHit(null)
    setBaccaratDelta(null)
  }

  const totalVotes =
    predictionVotes.teamA + predictionVotes.teamB
  const safeTotalVotes = totalVotes > 0 ? totalVotes : 1
  const predictionReady =
    Boolean(predictionMatchId) &&
    Boolean(predictionTeams.teamA.id) &&
    Boolean(predictionTeams.teamB.id)
  const hasVotedCurrentMatch = Boolean(predictionVoted)
  const showPredictionAdmin = predictionIsAdmin

  const selectableMatches = useMemo(() => {
    const open = predictionMatches.filter(
      (match) => resolveMatchStatus(match) === 'open',
    )
    return open.length > 0 ? open : predictionMatches
  }, [predictionMatches])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let cancelled = false
    const loadAdmin = async () => {
      try {
        const me = await fetchMe()
        if (!cancelled) {
          setPredictionIsAdmin(resolveAdminFlag(me))
        }
      } catch {
        if (!cancelled) {
          setPredictionIsAdmin(false)
        }
      }
    }
    const setupPrediction = async () => {
      setPredictionLoading(true)
      setPredictionMessage('')
      try {
        const matchesResponse = await fetchMatches()
        const matches = normalizeMatchList(matchesResponse)
        const normalized = Array.isArray(matches) ? matches : []
        const openMatches = normalized.filter(
          (item) => resolveMatchStatus(item) === 'open',
        )
        const match = openMatches[0] || normalized[0]
        if (!match) {
          throw new Error('승부 예측 매치가 없습니다.')
        }
        const matchId = extractNumericId(match, ['id', 'match_id', 'matchId'])
        const teamA = resolveMatchTeam(match, 'teamA')
        const teamB = resolveMatchTeam(match, 'teamB')
        const status = resolveMatchStatus(match)
        const teamAVotes = resolveMatchVotes(match, 'teamA')
        const teamBVotes = resolveMatchVotes(match, 'teamB')
        const meta = resolveMatchMeta(match)
        const voted = resolveMatchVoted(match)
        const votedTeamId = resolveMatchVotedTeam(match)
        if (!cancelled) {
          setPredictionMatches(normalized)
          setPredictionMatchId(matchId)
          setPredictionTeams({
            teamA: { id: teamA.id, name: teamA.name || predictionDefaults.teamAName },
            teamB: { id: teamB.id, name: teamB.name || predictionDefaults.teamBName },
          })
          setPredictionMeta(meta)
          setPredictionStatus(status)
          setPredictionVotes({ teamA: teamAVotes, teamB: teamBVotes })
          setPredictionVoted(voted)
          setPredictionVotedTeamId(votedTeamId)
          if (voted) {
            setPredictionChoice(null)
            setPredictionMessage('이미 이 경기에 투표했습니다.')
          }
          if (status === 'closed') {
            const winnerId =
              extractNumericId(match, ['winner_team_id', 'winnerTeamId']) || null
            if (winnerId && winnerId === teamA.id) {
              setPredictionResult(`${teamA.name || predictionDefaults.teamAName} 승`)
            } else if (winnerId && winnerId === teamB.id) {
              setPredictionResult(`${teamB.name || predictionDefaults.teamBName} 승`)
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPredictionMessage(`승부 예측 불러오기 실패: ${error.message}`)
          setPredictionMatches([])
        }
      } finally {
        if (!cancelled) {
          setPredictionLoading(false)
        }
      }
    }
    loadAdmin()
    setupPrediction()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePredictionSubmit = async () => {
    if (!predictionChoice || predictionSubmitting) return
    if (!predictionReady) {
      setPredictionMessage('승부 예측 정보를 준비 중입니다. 잠시 후 다시 시도하세요.')
      return
    }
    if (hasVotedCurrentMatch) {
      setPredictionMessage('이미 이 경기에 투표했습니다.')
      return
    }
    const betAmount = Math.max(1, Math.floor(Number(predictionAmount)))
    if (!Number.isFinite(betAmount)) {
      setPredictionMessage('투표 크레딧을 확인하세요.')
      return
    }
    const teamId =
      predictionChoice === 'teamA' ? predictionTeams.teamA.id : predictionTeams.teamB.id
    if (!teamId) {
      setPredictionMessage('선택한 팀 정보가 없습니다.')
      return
    }
    try {
      setPredictionSubmitting(true)
      setPredictionMessage('')
      await voteMatch({
        match_id: predictionMatchId,
        team_id: teamId,
        bet_amount: betAmount,
      })
      setPredictionMatches((prev) => {
        return prev.map((match) => {
          const id = extractNumericId(match, ['id', 'match_id', 'matchId'])
          if (id !== predictionMatchId) return match
          const teamAId = resolveMatchTeam(match, 'teamA').id
          const teamBId = resolveMatchTeam(match, 'teamB').id
          const nextTeamAVotes =
            resolveMatchVotes(match, 'teamA') + (teamId === teamAId ? betAmount : 0)
          const nextTeamBVotes =
            resolveMatchVotes(match, 'teamB') + (teamId === teamBId ? betAmount : 0)
          return {
            ...match,
            is_voted: true,
            my_vote_team_id: teamId,
            team_a_votes: nextTeamAVotes,
            team_b_votes: nextTeamBVotes,
          }
        })
      })
      setPredictionVotes((prev) => ({
        ...prev,
        [predictionChoice]: prev[predictionChoice] + betAmount,
      }))
      setPredictionVoted(true)
      setPredictionVotedTeamId(teamId)
      setPredictionChoice(null)
      setPredictionMessage('투표가 접수되었습니다.')
    } catch (error) {
      setPredictionMessage(`투표 실패: ${error.message}`)
    } finally {
      setPredictionSubmitting(false)
    }
  }

  const handlePredictionFinalize = async () => {
    if (!predictionReady || predictionSubmitting) return
    const winnerKey = predictionAdminChoice === 'teamA' ? 'teamA' : 'teamB'
    const winnerTeamId = predictionTeams[winnerKey].id
    if (!winnerTeamId) {
      setPredictionMessage('승리 팀 정보를 확인할 수 없습니다.')
      return
    }
    try {
      setPredictionSubmitting(true)
      setPredictionMessage('')
      await decideMatch({
        match_id: predictionMatchId,
        winner_team_id: winnerTeamId,
      })
      setPredictionStatus('closed')
      setPredictionResult(`${predictionTeams[winnerKey].name} 승`)
      setPredictionMessage('결과가 확정되었습니다.')
    } catch (error) {
      setPredictionMessage(`결과 확정 실패: ${error.message}`)
    } finally {
      setPredictionSubmitting(false)
    }
  }

  const startLadderGame = () => {
    setLadderState(null)
    setLadderSelections({
      start: null,
      lines: null,
      end: null,
    })
    setLadderResult(null)
    setLadderMessage('')
    setLadderStarted(true)
    setLadderStage('START')
    setLadderActiveModes([])
    setLadderPopup(null)
    setLadderSelectedPredictions([])
    setGameStarted((prev) => ({ ...prev, ladder: true }))
  }
  const resolveLadder = (overrideState = null) => {
    if (ladderResult) return false
    if (ladderActiveModes.length === 0) {
      setLadderMessage('예측을 하나 이상 선택하세요.')
      return false
    }
    const picks = buildLadderPicks()

    const stakeValue = Math.floor(Number(ladderStake))
    if (!Number.isFinite(stakeValue)) {
      setLadderMessage('베팅 크레딧을 입력하세요.')
      return false
    }
    const bet = {
      type: 'SINGLE',
      picks,
      stake: stakeValue,
    }

    const validation = validateBet(bet)
    if (!validation.ok) {
      setLadderMessage(validation.errors[0] || '베팅 정보를 확인하세요.')
      return false
    }

    if (credits < stakeValue) {
      setLadderMessage('보유 크레딧이 부족합니다.')
      return false
    }

    const roundState = overrideState || ladderState
    if (!roundState) {
      setLadderMessage('사다리 보드를 생성하지 못했습니다. 다시 시도해주세요.')
      return false
    }

    const result = {
      start: roundState.startSide.toUpperCase(),
      lines: roundState.rungCount,
      end: roundState.endSide.toUpperCase(),
    }

    const settlement = settleBet(bet, result)
    const totalDelta = settlement.payout - stakeValue
    const nextCredits = Math.max(credits + totalDelta, 0)

    setCredits(nextCredits)
    setLadderResult(settlement.win ? 'win' : 'lose')
    setLadderMessage('')
    setLadderPopup({
      title: settlement.win ? '베팅 성공!' : '베팅 실패!',
      delta: totalDelta,
      credits: nextCredits,
      matched: settlement.matched,
      picks,
      multiplier: settlement.multiplier,
      payout: settlement.payout,
    })
    setLadderHistory((prev) => {
      const nextEntry = {
        id: `${Date.now()}-${settlement.win ? 'win' : 'lose'}`,
        result: settlement.win ? 'win' : 'lose',
        delta: totalDelta,
        picks,
        stake: stakeValue,
        rungCount: roundState.rungCount,
        startSide: roundState.startSide,
        endSide: roundState.endSide,
        multiplier: settlement.multiplier,
        payout: settlement.payout,
      }
      return [nextEntry, ...prev].slice(0, 6)
    })
    return true
  }

  useEffect(() => {
    setGameStarted((prev) => ({ ...prev, [activeGame]: true }))
    if (activeGame === 'ladder') {
      if (!ladderStarted) {
        startLadderGame()
      }
    }
  }, [activeGame])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload = {
      activeGame,
      winStreak,
      rpsScore: score,
      rpsHistory: history,
      oddEvenHistory,
      ladderHistory,
      predictionAmount,
    }
    localStorage.setItem(MINIGAME_STORAGE_KEY, JSON.stringify(payload))
  }, [
    activeGame,
    winStreak,
    score,
    history,
    oddEvenHistory,
    ladderHistory,
    predictionAmount,
  ])

  useEffect(() => {
    if (!predictionMatchId || predictionMatches.length === 0) return
    const match = predictionMatches.find((item) => {
      const id = extractNumericId(item, ['id', 'match_id', 'matchId'])
      return id === predictionMatchId
    })
    if (!match) return
    const status = resolveMatchStatus(match)
    const teamA = resolveMatchTeam(match, 'teamA')
    const teamB = resolveMatchTeam(match, 'teamB')
    const meta = resolveMatchMeta(match)
    const teamAVotes = resolveMatchVotes(match, 'teamA')
    const teamBVotes = resolveMatchVotes(match, 'teamB')
    const voted = resolveMatchVoted(match)
    const votedTeamId = resolveMatchVotedTeam(match)
    setPredictionTeams({
      teamA: { id: teamA.id, name: teamA.name || predictionDefaults.teamAName },
      teamB: { id: teamB.id, name: teamB.name || predictionDefaults.teamBName },
    })
    setPredictionMeta(meta)
    setPredictionStatus(status)
    setPredictionVotes({ teamA: teamAVotes, teamB: teamBVotes })
    setPredictionVoted(voted)
    setPredictionVotedTeamId(votedTeamId)
    if (voted) {
      setPredictionChoice(null)
      setPredictionMessage('이미 이 경기에 투표했습니다.')
    } else if (predictionMessage === '이미 이 경기에 투표했습니다.') {
      setPredictionMessage('')
    }
    if (status === 'closed') {
      const winnerId =
        extractNumericId(match, ['winner_team_id', 'winnerTeamId']) || null
      if (winnerId && winnerId === teamA.id) {
        setPredictionResult(`${teamA.name || predictionDefaults.teamAName} 승`)
      } else if (winnerId && winnerId === teamB.id) {
        setPredictionResult(`${teamB.name || predictionDefaults.teamBName} 승`)
      }
    } else {
      setPredictionResult(null)
    }
  }, [predictionMatchId, predictionMatches])

  const startGame = (gameId) => {
    if (gameId === 'ladder') {
      startLadderGame()
      return
    }
    if (gameId === 'rps') resetGame()
    if (gameId === 'odd-even') resetOddEven()
    if (gameId === 'baccarat') resetCards()
    if (gameId === 'prediction') setPredictionResult(null)
    setGameStarted((prev) => ({ ...prev, [gameId]: true }))
  }

  const toggleLadderMode = (modeId) => {
    setLadderActiveModes((prev) => {
      const exists = prev.includes(modeId)
      if (exists) {
        setLadderSelections((current) => ({ ...current, [modeId]: null }))
      }
      const next = exists ? prev.filter((id) => id !== modeId) : [...prev, modeId]
      return next
    })
    setLadderMessage('')
  }

  const buildLadderPicks = () => {
    const normalizeSide = (value) => (value ? value.toUpperCase() : undefined)
    return {
      start: ladderActiveModes.includes('start')
        ? normalizeSide(ladderSelections.start)
        : undefined,
      lines: ladderActiveModes.includes('lines') ? ladderSelections.lines : undefined,
      end: ladderActiveModes.includes('end')
        ? normalizeSide(ladderSelections.end)
        : undefined,
    }
  }

  const buildPredictionPayload = (picks) => {
    const entries = []
    if (picks.start) entries.push(`start:${picks.start.toLowerCase()}`)
    if (picks.lines) entries.push(`count:${picks.lines}`)
    if (picks.end) entries.push(`end:${picks.end.toLowerCase()}`)
    return entries
  }

  const buildPredictionSummary = (picks, matched = null) => {
    const rows = [
      {
        id: 'start',
        label: '출발지',
        value: picks.start ? ladderSideLabels[picks.start.toLowerCase()] : null,
        matched: matched ? matched.start : null,
      },
      {
        id: 'lines',
        label: '가로줄 개수',
        value: picks.lines ? `${picks.lines}개` : null,
        matched: matched ? matched.lines : null,
      },
      {
        id: 'end',
        label: '도착지',
        value: picks.end ? ladderSideLabels[picks.end.toLowerCase()] : null,
        matched: matched ? matched.end : null,
      },
    ]
    return rows
  }

  const confirmLadderBet = () => {
    if (ladderStage !== 'START') return
    if (ladderActiveModes.length === 0) {
      setLadderMessage('예측을 하나 이상 선택하세요.')
      return
    }
    const missingSelections = []
    if (ladderActiveModes.includes('start') && !ladderSelections.start) {
      missingSelections.push('출발지')
    }
    if (ladderActiveModes.includes('lines') && !ladderSelections.lines) {
      missingSelections.push('가로줄')
    }
    if (ladderActiveModes.includes('end') && !ladderSelections.end) {
      missingSelections.push('도착지')
    }
    if (missingSelections.length > 0) {
      setLadderMessage(`${missingSelections.join(', ')} 예측을 선택하세요.`)
      return
    }
    const stakeValue = Math.floor(Number(ladderStake))
    if (!Number.isFinite(stakeValue)) {
      setLadderMessage('베팅 크레딧을 입력하세요.')
      return
    }
    const picks = buildLadderPicks()

    const bet = {
      type: 'SINGLE',
      picks,
      stake: stakeValue,
    }

    const validation = validateBet(bet)
    if (!validation.ok) {
      setLadderMessage(validation.errors[0] || '베팅 정보를 확인하세요.')
      return
    }

    if (credits < stakeValue) {
      setLadderMessage('보유 크레딧이 부족합니다.')
      return
    }

    setLadderMessage('')
    setLadderResult(null)
    setLadderPopup(null)
    setLadderSelectedPredictions(buildPredictionPayload(picks))
    const nextRound = buildLadderRound()
    setLadderState(nextRound)
    const settled = resolveLadder(nextRound)
    setLadderStage(settled ? 'RESULT' : 'START')
  }

  const renderGame = () => {
    if (activeGame === 'odd-even') {
      return (
        <Section title="홀짝">
          <>
              <div className="oddeven-board">
                <div className="oddeven-choices">
                  {oddEvenChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={`oddeven-choice ${
                        oddEvenChoice === choice.id ? 'active' : ''
                      }`}
                      onClick={() => startOddEven(choice.id)}
                      disabled={oddEvenSettled || oddEvenRolling}
                    >
                      <span className="oddeven-choice-label">{choice.label}</span>
                      <span className="oddeven-choice-sub">베팅</span>
                    </button>
                  ))}
                </div>
                <p className="oddeven-guide">홀/짝을 선택해 베팅하세요.</p>
              </div>

              <div className="oddeven-bet">
                <label className="inline-field">
                  베팅 크레딧
                  <input
                    type="number"
                    min={MIN_STAKE}
                    value={oddEvenStake}
                    onChange={(event) =>
                      setOddEvenStake(event.target.value)
                    }
                    disabled={oddEvenSettled || oddEvenRolling}
                  />
                </label>
                {!oddEvenResult ? (
                  <span className="muted">
                    성공 시 베팅 크레딧의 {Math.round(ODD_EVEN_MULTIPLIER * 100)}% 지급 · 실패 시 베팅 크레딧 차감
                  </span>
                ) : null}
              </div>

              {oddEvenMessage ? <p className="status">{oddEvenMessage}</p> : null}

              {oddEvenRolling || oddEvenResult ? (
                <div className="oddeven-status">
                  {oddEvenRolling ? (
                    <div className={`oddeven-animation ${oddEvenAnimationType}`}>
                      <div className="oddeven-animation-track" />
                      <div className="oddeven-animation-number">
                        {oddEvenRollingNumber ?? '-'}
                      </div>
                      <span className="oddeven-animation-label">
                        결과 확인 중...
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="oddeven-reveal">
                        <span className="oddeven-reveal-number">
                          {oddEvenNumber}
                        </span>
                        <span className="oddeven-reveal-parity">
                          {oddEvenNumber % 2 === 0 ? '짝' : '홀'}
                        </span>
                      </div>
                      <div className={`oddeven-banner ${oddEvenResult}`}>
                        <strong>{oddEvenMessages[oddEvenResult]}</strong>
                        {oddEvenDelta !== null ? (
                          <span className="oddeven-delta">
                            {oddEvenDelta >= 0 ? '+' : '-'}
                            {Math.abs(oddEvenDelta)} 크레딧
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {oddEvenResult ? (
                <div className="oddeven-history">
                  <h3>결과</h3>
                  <div className="oddeven-history-list">
                    <div className={`oddeven-history-item ${oddEvenResult}`}>
                      <span>{oddEvenNumber}</span>
                      <span className="oddeven-vs">
                        {oddEvenChoice === 'odd' ? '홀' : '짝'}
                      </span>
                      <span>{oddEvenNumber % 2 === 0 ? '짝' : '홀'}</span>
                      <span className="oddeven-badge">
                        {oddEvenMessages[oddEvenResult]}
                      </span>
                    </div>
                  </div>
                  <button className="btn" type="button" onClick={resetOddEven}>
                    다시하기
                  </button>
                  {oddEvenHistory.length > 0 ? (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setOddEvenHistoryOpen(true)}
                    >
                      이전 결과 조회
                    </button>
                  ) : null}
                </div>
              ) : null}

              {oddEvenHistoryOpen ? (
                <div className="oddeven-history-popup">
                  <div className="oddeven-history-card">
                    <div className="oddeven-history-header">
                      <strong>이전 결과</strong>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setOddEvenHistoryOpen(false)}
                      >
                        닫기
                      </button>
                    </div>
                    {oddEvenHistory.length === 0 ? (
                      <p className="muted">이전 결과가 없습니다.</p>
                    ) : (
                      <div className="oddeven-history-list compact">
                        {oddEvenHistory.map((item) => (
                          <div key={item.id} className={`oddeven-history-item ${item.result}`}>
                            <span>{item.number}</span>
                            <span className="oddeven-vs">
                              {item.choice === 'odd' ? '홀' : '짝'}
                            </span>
                            <span>{item.number % 2 === 0 ? '짝' : '홀'}</span>
                            <span className="oddeven-badge">
                              {oddEvenMessages[item.result]}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </>
        </Section>
      )
    }

    if (activeGame === 'rps') {
      const stakeValue =
        rpsLockedStake > 0 ? rpsLockedStake : Math.floor(Number(rpsStake))
      const displayDelta =
        rpsDelta != null
          ? rpsDelta
          : result
            ? result === 'win'
              ? Math.round(stakeValue * 0.9)
              : result === 'lose'
                ? -stakeValue
                : 0
            : 0
      return (
        <Section
          title="가위바위보"
          subtitle="컴퓨터와 한 판 겨뤄보세요."
        >
          <>
              <div className="rps-board rps-flow">
                <div className="rps-panel rps-player">
                  <div className="rps-panel-title">내 선택</div>
                  <div className="rps-panel-card">
                    <div className="rps-choices">
                      {choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className={`rps-choice ${
                            playerChoice === choice.id ? 'active' : ''
                          }`}
                          onClick={() => startRps(choice.id)}
                          disabled={rpsSettled || rpsRolling}
                        >
                          <span className="rps-emoji">{choice.emoji}</span>
                          <span className="rps-label">{choice.label}</span>
                        </button>
                      ))}
                    </div>

                    {!result ? (
                      <div className="rps-bet">
                        <label className="inline-field">
                          베팅 크레딧
                          <input
                            type="number"
                            min={MIN_STAKE}
                            value={rpsStake}
                            onChange={(event) => setRpsStake(event.target.value)}
                            disabled={rpsSettled || Boolean(playerChoice) || rpsRolling}
                          />
                        </label>
                        <span className="muted">
                          성공 시 베팅 크레딧의 90% 지급 · 실패 시 베팅 크레딧 차감
                        </span>
                      </div>
                    ) : null}

                    {result ? (
                      <span className="muted">
                        베팅 크레딧: {rpsLockedStake || Math.floor(Number(rpsStake))}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rps-center">
                  <div className="rps-vs-badge">VS</div>
                </div>

                <div className="rps-panel rps-cpu">
                  <div className="rps-panel-title">컴퓨터</div>
                  <div className="rps-panel-card rps-panel-card--tight">
                    <div className={`rps-flip ${result ? 'is-flipped' : ''}`}>
                      <div className="rps-flip-inner">
                        <div className="rps-flip-face rps-flip-back">
                          <span className="rps-emoji">
                            {rpsRolling ? rpsShuffleEmoji : '❓'}
                          </span>
                          <span className="rps-label">
                            {rpsRolling ? '섞는 중...' : '대기중'}
                          </span>
                        </div>
                        <div className="rps-flip-face rps-flip-front">
                          <span className="rps-emoji">
                            {cpuChoice ? choiceMap[cpuChoice].emoji : '❓'}
                          </span>
                          <span className="rps-label">
                            {cpuChoice ? choiceMap[cpuChoice].label : '대기중'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p className="rps-guide">
                가위/바위/보를 선택하고 베팅한 뒤 공개됩니다.
              </p>

              {rpsMessage ? <p className="status">{rpsMessage}</p> : null}

              {result ? (
                <div className={`rps-outcome result-${result}`}>
                  <div className="rps-outcome-row">
                    <span>내 선택</span>
                    <strong>{choiceMap[playerChoice].label}</strong>
                  </div>
                  <div className="rps-outcome-row">
                    <span>컴퓨터</span>
                    <strong>{cpuChoice ? choiceMap[cpuChoice].label : '-'}</strong>
                  </div>
                  <div className="rps-outcome-result">
                    <strong>{resultMessages[result]}</strong>
                    <span className="rps-outcome-delta">
                      {displayDelta >= 0 ? '+' : '-'}
                      {Math.abs(displayDelta)} 크레딧
                    </span>
                  </div>
                </div>
              ) : null}

              {result ? (
                <>
                  <div className="divider" />
                  <div className="rps-history">
                    <button className="btn" type="button" onClick={resetGame}>
                      다시하기
                    </button>
                    {history.length > 0 ? (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setRpsHistoryOpen(true)}
                      >
                        이전 결과 조회
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}

              {rpsHistoryOpen ? (
                <div className="rps-history-popup">
                  <div className="rps-history-card">
                    <div className="rps-history-header">
                      <strong>이전 결과</strong>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setRpsHistoryOpen(false)}
                      >
                        닫기
                      </button>
                    </div>
                    {history.length === 0 ? (
                      <p className="muted">이전 결과가 없습니다.</p>
                    ) : (
                      <div className="rps-history-list">
                        {history.map((item) => (
                          <div key={item.id} className={`rps-history-item ${item.result}`}>
                            <span>{choiceMap[item.player].label}</span>
                            <span className="rps-vs">vs</span>
                            <span>{choiceMap[item.cpu].label}</span>
                            <span className="rps-badge">{resultMessages[item.result]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </>
        </Section>
      )
    }

    if (activeGame === 'ladder') {
      const ladderPicks = buildLadderPicks()
      const ladderSummary = buildPredictionSummary(
        ladderPicks,
        ladderStage === 'RESULT' ? ladderPopup?.matched : null,
      )
      return (
        <Section
          title="사다리"
          subtitle="예측을 선택하고 한 번에 베팅하세요."
        >
          {ladderStarted ? (
            <div className="ladder-container">

              {ladderStage === 'START' ? (
                <div className="ladder-setup">
                  <div className="ladder-start-card">
                    <div className="ladder-mode-selector">
                      {ladderBetModes.map((mode) => {
                        const isActive = ladderActiveModes.includes(mode.id)
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            className={`ladder-mode-card ${isActive ? 'selected' : ''}`}
                            onClick={() => toggleLadderMode(mode.id)}
                          >
                            <span>{mode.label}</span>
                            <small className="muted">
                              {ladderModes.find((item) => item.id === mode.id)?.label}
                            </small>
                            <span className="ladder-mode-check">{isActive ? '✔' : '+'}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="ladder-selection">
                      {ladderActiveModes.length === 0 ? (
                        <div className="ladder-empty">
                          <strong>예측 모드를 선택하세요.</strong>
                          <span className="muted">1개 이상 선택해야 시작할 수 있습니다.</span>
                        </div>
                      ) : (
                        ladderActiveModes.map((modeId) => {
                          const modeLabel =
                            ladderModes.find((mode) => mode.id === modeId)?.label || ''
                          return (
                            <div key={modeId} className="ladder-option-group">
                              <div className="ladder-option-title">{modeLabel}</div>
                              <div className="ladder-options">
                                {modeId === 'lines'
                                  ? [3, 4].map((count) => (
                                      <button
                                        key={count}
                                        type="button"
                                        className={`ladder-option ${
                                          Number(ladderSelections.lines) === count ? 'active' : ''
                                        }`}
                                        onClick={() =>
                                          setLadderSelections((prev) => ({
                                            ...prev,
                                            lines: count,
                                          }))
                                        }
                                      >
                                        {count}개
                                      </button>
                                    ))
                                  : ['left', 'right'].map((side) => (
                                      <button
                                        key={side}
                                        type="button"
                                        className={`ladder-option ${
                                          ladderSelections[modeId] === side ? 'active' : ''
                                        }`}
                                        onClick={() =>
                                          setLadderSelections((prev) => ({
                                            ...prev,
                                            [modeId]: side,
                                          }))
                                        }
                                      >
                                        {ladderSideLabels[side]}
                                      </button>
                                    ))}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    <div className="ladder-summary">
                      <strong>내 예측</strong>
                      <div className="ladder-summary-list">
                        {ladderSummary.map((row) => (
                          <div
                            key={row.id}
                            className={`ladder-summary-item ${
                              row.value ? 'selected' : 'idle'
                            }`}
                          >
                            <span className="ladder-summary-icon">
                              {row.value ? '✔' : '✖'}
                            </span>
                            <span className="ladder-summary-label">{row.label}</span>
                            <span className="ladder-summary-value">
                              {row.value || '선택 안 함'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ladder-bet">
                      <label className="inline-field">
                        베팅 크레딧
                        <input
                          type="number"
                          min={MIN_STAKE}
                          value={ladderStake}
                          onChange={(event) => setLadderStake(event.target.value)}
                          disabled={ladderStage !== 'START'}
                        />
                      </label>
                      <span className="muted">
                        성공 시 배당 지급 · 실패 시 베팅 크레딧 차감
                      </span>
                    </div>

                    {ladderMessage ? <p className="status">{ladderMessage}</p> : null}

                    <button
                      className="btn primary ladder-cta"
                      type="button"
                      onClick={confirmLadderBet}
                      disabled={ladderStage !== 'START'}
                    >
                      게임 시작
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ladder-result-view">
                  <div className="ladder-summary-card">
                    <div className="ladder-summary-header">
                      <strong>내 예측</strong>
                      <span className="muted">베팅 크레딧 {ladderStake}</span>
                    </div>
                    <div className="ladder-summary-list">
                      {ladderSummary.map((row) => {
                        const status = row.value
                          ? row.matched === null
                            ? 'selected'
                            : row.matched
                              ? 'success'
                              : 'fail'
                          : 'idle'
                        return (
                          <div key={row.id} className={`ladder-summary-item ${status}`}>
                            <span className="ladder-summary-icon">
                              {row.value ? '✔' : '✖'}
                            </span>
                            <span className="ladder-summary-label">{row.label}</span>
                            <span className="ladder-summary-value">
                              {row.value || '선택 안 함'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  {ladderSelectedPredictions.length > 0 ? (
                    <p className="muted ladder-summary-payload">
                      전송 목록: {ladderSelectedPredictions.join(', ')}
                    </p>
                  ) : null}
                  </div>

                  <div className="ladder-stage-card">
                    <div className="ladder-main">
                      <div className="ladder-board-area">
                      {ladderState ? (
                        <LadderBoard
                          rungs={ladderState.rungs}
                          startSide={ladderState.startSide}
                          endSide={ladderState.endSide}
                          reveal
                        />
                      ) : null}
                      {ladderMessage ? (
                        <p className="ladder-inline-message">{ladderMessage}</p>
                      ) : null}
                      </div>

                      <div className="ladder-result-panel">
                      {ladderPopup ? (
                        <div className={`ladder-result-card result-${ladderResult}`}>
                          <strong>{ladderPopup.title}</strong>
                          <p className="ladder-result-delta">
                            {ladderPopup.delta >= 0 ? '+' : '-'}{' '}
                            {Math.abs(ladderPopup.delta)} 크레딧
                          </p>
                          <span className="muted">
                            배당 {ladderPopup.multiplier}배 · 지급 {ladderPopup.payout} 크레딧
                          </span>
                        </div>
                      ) : null}
                      <div className="ladder-result-actions">
                        <button
                          className="btn neutral"
                          type="button"
                          onClick={startLadderGame}
                        >
                          다시하기
                        </button>
                        <button
                          className="btn neutral"
                          type="button"
                          onClick={() => setLadderHistoryOpen(true)}
                          disabled={ladderHistory.length === 0}
                        >
                          이전 결과 조회
                        </button>
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {ladderHistoryOpen ? (
                <div className="ladder-popup">
                  <div className="ladder-popup-card">
                    <div className="ladder-popup-header">
                      <strong>이전 결과</strong>
                      <button
                        className="btn neutral"
                        type="button"
                        onClick={() => setLadderHistoryOpen(false)}
                      >
                        닫기
                      </button>
                    </div>
                    {ladderHistory.length === 0 ? (
                      <p className="muted">이전 결과가 없습니다.</p>
                    ) : (
                      <div className="ladder-history-list">
                        {ladderHistory.map((item) => (
                          <div key={item.id} className={`ladder-history-item ${item.result}`}>
                            <span className="ladder-history-title">
                              {item.result === 'win' ? '성공' : '실패'}
                            </span>
                            <span>
                              {item.delta >= 0 ? '+' : '-'} {Math.abs(item.delta)} 크레딧
                            </span>
                            <span className="muted">
                              배당 {item.multiplier}배 · 지급 {item.payout} 크레딧
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>
      )
    }

    if (activeGame === 'baccarat') {
      const outcomeLabels = {
        PLAYER: '플레이어 승',
        BANKER: '상대 승',
        TIE: '무승부',
      }
      const predictionLabels = {
        PLAYER: '플레이어 승',
        BANKER: '상대 승',
        TIE: '무승부',
      }
      return (
        <Section
          title="바카라"
          subtitle="예측을 선택하고 베팅한 뒤 결과를 확인합니다."
        >
          <>
              <div className="prediction-form">
                <div className="prediction-options">
                  {[
                    { id: 'PLAYER', label: '플레이어 승' },
                    { id: 'BANKER', label: '상대 승' },
                    { id: 'TIE', label: '무승부' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`prediction-option ${
                        baccaratPrediction === option.id ? 'active' : ''
                      }`}
                      onClick={() => setBaccaratPrediction(option.id)}
                      disabled={cardPhase === 'dealt'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="prediction-actions">
                  <label className="inline-field">
                    베팅 크레딧
                    <input
                      type="number"
                      min={MIN_STAKE}
                      value={baccaratStake}
                      onChange={(event) => setBaccaratStake(event.target.value)}
                      disabled={cardPhase === 'dealt'}
                    />
                  </label>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={dealCards}
                    disabled={baccaratDealing}
                  >
                    카드 나누기
                  </button>
                  <button className="btn neutral" type="button" onClick={resetCards}>
                    초기화
                  </button>
                </div>
                {baccaratMessage ? <p className="status">{baccaratMessage}</p> : null}
                <p className="muted">
                  플레이어/상대/무승부를 예측하고 베팅합니다. 예측이 맞아야 승리합니다.
                </p>
              </div>

              <div className="cardgame-board">
                <div className="cardgame-side">
                  <span className="muted">Player</span>
                  <div className="cardgame-hand">
                    {playerHand.length === 0 ? (
                      <span className="muted">대기 중</span>
                    ) : (
                      playerHand.map((card, index) => {
                        const isRevealed = baccaratRevealed[index] || false
                        return (
                          <div key={`p-${index}`} className="cardgame-card">
                            <div className="card-flip">
                              <div className={`card-flip-inner ${isRevealed ? 'revealed' : ''}`}>
                                <div className="card-face card-back" />
                                <div className="card-face card-front">
                                  <span>{card.rank}</span>
                                  <span>{card.suit}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                  <strong className="cardgame-score">{playerScore ?? '-'}</strong>
                </div>
                <div className="cardgame-side">
                  <span className="muted">Opponent</span>
                  <div className="cardgame-hand">
                    {opponentHand.length === 0 ? (
                      <span className="muted">대기 중</span>
                    ) : (
                      opponentHand.map((card, index) => {
                        const isRevealed = baccaratRevealed[index + 2] || false
                        return (
                          <div key={`o-${index}`} className="cardgame-card">
                            <div className="card-flip">
                              <div className={`card-flip-inner ${isRevealed ? 'revealed' : ''}`}>
                                <div className="card-face card-back" />
                                <div className="card-face card-front">
                                  <span>{card.rank}</span>
                                  <span>{card.suit}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                  <strong className="cardgame-score">{opponentScore ?? '-'}</strong>
                </div>
              </div>

              <div
                className={`cardgame-result ${
                  cardPhase === 'dealt' ? 'result-reveal' : ''
                }`}
              >
                <strong>{cardPhase === 'dealt' ? cardResult : '카드를 나눠주세요.'}</strong>
              </div>

              {cardPhase === 'dealt' ? (
                <div className="prediction-result">
                  <strong>결과 요약</strong>
                  <p>결과: {baccaratOutcome ? outcomeLabels[baccaratOutcome] : '-'}</p>
                  <p>
                    내 예측:{' '}
                    {baccaratPrediction ? predictionLabels[baccaratPrediction] : '-'}
                  </p>
                  <p>적중 여부: {baccaratHit ? '성공' : '실패'}</p>
                  <p className="muted">
                    크레딧 변화:{' '}
                    {baccaratDelta != null
                      ? `${baccaratDelta >= 0 ? '+' : '-'}${Math.abs(baccaratDelta)}`
                      : '0'}
                  </p>
                </div>
              ) : null}

              <p className="muted cardgame-rule">
                A=1, 2~9=숫자 그대로, 10/J/Q/K=0. 두 장 합의 10의 자리 제거로
                점수를 계산합니다.
              </p>
          </>
        </Section>
      )
    }

    return (
      <Section
        title="승부 예측"
        subtitle="투표 현황을 확인하고 결과를 기다립니다."
      >
        <>
        <div className="prediction-header">
          <div>
            <h3>{predictionMeta.title}</h3>
            <p className="muted">
              {predictionTeams.teamA.name} vs {predictionTeams.teamB.name}
              {predictionMeta.schedule ? ` · ${predictionMeta.schedule}` : ''}
            </p>
          </div>
          <span className={`prediction-status ${predictionStatus}`}>
            {predictionStatus === 'open' ? '투표 진행 중' : '결과 공개'}
          </span>
        </div>

        {selectableMatches.length > 1 ? (
          <div className="prediction-matches">
            <label className="inline-field">
              진행 중 경기
              <select
                value={predictionMatchId ?? ''}
                onChange={(event) => {
                  const nextId = Number(event.target.value)
                  setPredictionChoice(null)
                  setPredictionMatchId(Number.isFinite(nextId) ? nextId : null)
                }}
              >
                {selectableMatches.map((match) => {
                  const id = extractNumericId(match, ['id', 'match_id', 'matchId'])
                  const teamA = resolveMatchTeam(match, 'teamA')
                  const teamB = resolveMatchTeam(match, 'teamB')
                  const title = match?.title || predictionDefaults.title
                  return (
                    <option key={id ?? title} value={id ?? ''}>
                      {title} · {teamA.name || predictionDefaults.teamAName} vs{' '}
                      {teamB.name || predictionDefaults.teamBName}
                    </option>
                  )
                })}
              </select>
            </label>
          </div>
        ) : null}

        <div className="prediction-grid">
          <div className="prediction-card">
            <strong>{predictionTeams.teamA.name} 승</strong>
            <p className="muted">현재 투표수 {predictionVotes.teamA}</p>
            <div className="prediction-bar">
              <span
                style={{
                  width: `${Math.round((predictionVotes.teamA / safeTotalVotes) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="prediction-card">
            <strong>{predictionTeams.teamB.name} 승</strong>
            <p className="muted">현재 투표수 {predictionVotes.teamB}</p>
            <div className="prediction-bar">
              <span
                style={{
                  width: `${Math.round((predictionVotes.teamB / safeTotalVotes) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="divider" />

        {predictionStatus === 'open' ? (
          <div className="prediction-form">
            <div className="prediction-options">
              {[
                { id: 'teamA', label: `${predictionTeams.teamA.name} 승` },
                { id: 'teamB', label: `${predictionTeams.teamB.name} 승` },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`prediction-option ${
                    predictionChoice === option.id ? 'active' : ''
                  }`}
                  onClick={() => setPredictionChoice(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="prediction-actions">
              <label className="inline-field">
                투표 크레딧
                <input
                  type="number"
                  min="1"
                  value={predictionAmount}
                  onChange={(event) =>
                    setPredictionAmount(Math.max(1, Number(event.target.value)))
                  }
                />
              </label>
              <button
                className="btn primary"
                type="button"
                onClick={handlePredictionSubmit}
                  disabled={
                    !predictionChoice ||
                    predictionSubmitting ||
                    predictionLoading ||
                    hasVotedCurrentMatch
                  }
              >
                {predictionSubmitting ? '투표 중...' : '투표하기'}
              </button>
            </div>
            {predictionLoading ? (
              <p className="muted">승부 예측 정보를 불러오는 중입니다.</p>
            ) : null}
            {predictionMessage ? <p className="status">{predictionMessage}</p> : null}
            <p className="muted">
              결과는 경기 종료 후 공개됩니다.
            </p>
            {showPredictionAdmin ? (
              <div className="prediction-admin">
                <span className="muted">관리자 결과 확정</span>
                <select
                  value={predictionAdminChoice}
                  onChange={(event) => setPredictionAdminChoice(event.target.value)}
                >
                  <option value="teamA">{predictionTeams.teamA.name} 승</option>
                  <option value="teamB">{predictionTeams.teamB.name} 승</option>
                </select>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={handlePredictionFinalize}
                  disabled={predictionSubmitting || predictionLoading || !predictionReady}
                >
                  결과 확정
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="prediction-result">
            <strong>최종 결과</strong>
            <p>{predictionResult || `${predictionTeams.teamA.name} 승`}</p>
            <p className="muted">정산 결과는 크레딧 내역에 반영됩니다.</p>
          </div>
        )}
        </>
      </Section>
    )
  }

  return (
    <div className="page">
      <div className="minigame-tabs-bar">
        <div className="minigame-tabs">
          {gameTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`minigame-tab ${
                activeGame === tab.id ? 'active' : ''
              }`}
              onClick={() => {
                if (!tab.disabled) setActiveGame(tab.id)
              }}
              disabled={tab.disabled}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="minigame-credits">현재 크레딧: {credits}</div>
      </div>
      {renderGame()}
    </div>
  )
}

export default MiniGamePage
