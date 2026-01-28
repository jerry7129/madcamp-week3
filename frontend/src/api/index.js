import {
  APP_API_BASE_URL,
  TTS_API_BASE_URL,
  requestBlob,
  requestJson,
  buildAuthHeaders,
  withQuery,
} from './client'
import {
  mockFetchMyVoices,
  mockFetchSharedVoices,
  mockFetchVoiceModels,
  mockShareVoice,
  mockUploadVoice,
  mockDeleteVoice,
} from './mock'

const isMockEnabled =
  typeof window !== 'undefined' && localStorage.getItem('mock-api') === '1'

const CREDIT_KEYS = new Set([
  'credits',
  'credit',
  'balance',
  'points',
  'point',
  'credit_balance',
  'remaining',
  'remaining_credits',
  'remainingCredits',
  'tts_credits',
  'ttsCredits',
  'creditBalance',
])

const findCreditsValue = (value) => {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCreditsValue(item)
      if (found != null) return found
    }
    return null
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (CREDIT_KEYS.has(key)) {
        const found = findCreditsValue(value[key])
        if (found != null) return found
      }
    }
    for (const key of Object.keys(value)) {
      const found = findCreditsValue(value[key])
      if (found != null) return found
    }
  }
  return null
}

const fetchJsonWithStatus = async (url) => {
  const response = await fetch(url, {
    headers: buildAuthHeaders(),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    const error = new Error(message || 'Request failed')
    error.status = response.status
    throw error
  }
  return response.json()
}

export async function login(payload) {
  const form = new URLSearchParams()
  form.set('username', payload.username || payload.email || '')
  form.set('password', payload.password || '')
  const findToken = (value) => {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findToken(item)
        if (found) return found
      }
      return ''
    }
    if (typeof value === 'object') {
      const direct =
        value.access_token ||
        value.token ||
        value.accessToken ||
        value.jwt ||
        value.authorization
      if (typeof direct === 'string' && direct) return direct
      for (const key of Object.keys(value)) {
        const found = findToken(value[key])
        if (found) return found
      }
    }
    return ''
  }
  const response = await fetch(`${APP_API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  const headerToken =
    response.headers.get('authorization') ||
    response.headers.get('Authorization') ||
    response.headers.get('x-access-token')
  if (headerToken && !data?.access_token && !data?.token) {
    data = { ...data, token: headerToken, access_token: headerToken }
  }
  const parsedToken = findToken(data)
  if (typeof window !== 'undefined' && parsedToken) {
    const normalized = parsedToken.startsWith('Bearer ')
      ? parsedToken.slice(7)
      : parsedToken
    localStorage.setItem('token', normalized)
    localStorage.setItem('access_token', normalized)
  }
  return data
}

export async function register(payload) {
  const form = new FormData()
  form.set('username', payload.username || payload.email || '')
  form.set('password', payload.password || '')
  if (payload.nickname) {
    form.set('nickname', payload.nickname)
  }
  if (payload.profileImage instanceof Blob) {
    form.set('profile_image', payload.profileImage)
  }
  const response = await fetch(`${APP_API_BASE_URL}/signup`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: form,
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

// [NEW] 프로필 수정 (Multipart로 사진, 텍스트 전송)
export async function updateProfile(payload) {
  const form = new FormData()
  if (payload.username) form.append('username', payload.username)
  if (payload.nickname) form.append('nickname', payload.nickname)
  if (payload.password) form.append('password', payload.password)
  // 파일이 있는 경우에만 추가
  if (payload.profile_image instanceof File) {
    form.append('profile_image', payload.profile_image)
  }

  const headers = buildAuthHeaders()
  // FormData 전송 시 Content-Type 헤더는 브라우저가 자동 설정함 (boundary 포함)
  // 따라서 buildAuthHeaders()가 'Content-Type': 'application/json'을 포함한다면 제거해야 함.
  // buildAuthHeaders 구현 확인: 보통 Authorization만 반환함. 확인 필요.

  const response = await fetch(`${APP_API_BASE_URL}/users/me`, {
    method: 'PUT',
    headers: { ...headers }, 
    body: form,
  })

  if (!response.ok) {
    const message = await response.text()
    try {
       const json = JSON.parse(message)
       throw new Error(json.detail || '프로필 수정 실패')
    } catch(e) {
       throw new Error(message || '프로필 수정 실패')
    }
  }
  const data = await response.json()
  if (data.access_token) {
     if (typeof window !== 'undefined') {
        localStorage.setItem('token', data.access_token)
        localStorage.setItem('access_token', data.access_token)
     }
  }
  return data
}

export async function fetchMe() {
  return requestJson(`${APP_API_BASE_URL}/users/me`)
}



export async function loginWithGoogle(idToken) {
  return requestJson(`${APP_API_BASE_URL}/auth/google`, {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  })
}

export async function uploadVoice(payload) {
  if (isMockEnabled) {
    if (payload instanceof FormData) {
      const mockPayload = {}
      payload.forEach((value, key) => {
        mockPayload[key] = value
      })
      return mockUploadVoice(mockPayload)
    }
    return mockUploadVoice(payload)
  }
  return fetch(`${APP_API_BASE_URL}/voice/train`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: payload,
    credentials: 'include',
  }).then(async (response) => {
    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || 'Request failed')
    }
    return response.json()
  })
}

export async function fetchMyVoices() {
  if (isMockEnabled) {
    return mockFetchMyVoices()
  }
  return requestJson(`${APP_API_BASE_URL}/voice/my_list`)
}

export async function fetchSharedVoices() {
  if (isMockEnabled) {
    return mockFetchSharedVoices()
  }
  return requestJson(`${APP_API_BASE_URL}/voice/list`)
}

export async function fetchMatches(params = {}) {
  if (isMockEnabled) {
    return []
  }
  return requestJson(withQuery(`${APP_API_BASE_URL}/matches`, params))
}

const parseMaybeJson = async (response) => {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

const postMaybeJson = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

export async function fetchSavedVoiceList() {
  if (isMockEnabled) {
    return []
  }
  const data = await requestJson(`${APP_API_BASE_URL}/voice/saved_list`)
  return Array.isArray(data) ? data : data?.items || data?.voices || data?.list || []
}

export async function saveVoiceModel(modelId) {
  if (!modelId) throw new Error('model_id가 필요합니다.')
  const response = await fetch(`${APP_API_BASE_URL}/voice/buy/${modelId}`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

export async function unsaveVoiceModel(modelId) {
  if (!modelId) throw new Error('model_id가 필요합니다.')
  const response = await fetch(`${APP_API_BASE_URL}/voice/save/${modelId}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
    credentials: 'include',
  })
  if (!response.ok) {
    if (response.status === 404 || response.status === 422) {
      return { ok: true }
    }
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

export async function playRpsGame(payload) {
  if (isMockEnabled) {
    return { mock: true }
  }
  const response = await fetch(`${APP_API_BASE_URL}/game/rps`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

export async function playOddEvenGame(payload) {
  if (isMockEnabled) {
    return { mock: true }
  }
  const response = await fetch(`${APP_API_BASE_URL}/game/oddeven`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    credentials: 'include',
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return parseMaybeJson(response)
}

export async function createTeam(payload) {
  if (!payload?.name) {
    throw new Error('팀 이름이 필요합니다.')
  }
  return postMaybeJson(`${APP_API_BASE_URL}/teams`, {
    name: payload.name,
    description: payload.description || '',
  })
}

export async function createMatch(payload) {
  if (!payload?.title || payload?.team_a_id == null || payload?.team_b_id == null) {
    throw new Error('매치 생성 정보가 필요합니다.')
  }
  return postMaybeJson(`${APP_API_BASE_URL}/matches`, {
    title: payload.title,
    team_a_id: payload.team_a_id,
    team_b_id: payload.team_b_id,
  })
}

export async function voteMatch(payload) {
  if (payload?.match_id == null || payload?.team_id == null) {
    throw new Error('투표 정보가 필요합니다.')
  }
  return postMaybeJson(`${APP_API_BASE_URL}/votes`, {
    match_id: payload.match_id,
    team_id: payload.team_id,
    bet_amount: payload.bet_amount ?? 1,
  })
}

export async function decideMatch(payload) {
  if (payload?.match_id == null || payload?.winner_team_id == null) {
    throw new Error('결과 확정 정보가 필요합니다.')
  }
  return postMaybeJson(`${APP_API_BASE_URL}/matches/decide`, {
    match_id: payload.match_id,
    winner_team_id: payload.winner_team_id,
  })
}

export async function shareVoice(voiceId, isPublic = true) {
  if (isMockEnabled) {
    return mockShareVoice(voiceId, isPublic)
  }
  const updateEndpoint = {
    url: `${APP_API_BASE_URL}/voice/update/${voiceId}`,
    options: {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: isPublic }),
    },
  }

  if (!isPublic) {
    const response = await fetch(updateEndpoint.url, {
      ...updateEndpoint.options,
      headers: buildAuthHeaders(updateEndpoint.options.headers || {}),
    })
    if (!response.ok) {
      const errorMessage = await resolveErrorMessage(response)
      throw new Error(errorMessage || '미공개 처리에 실패했습니다.')
    }
    return response.json?.() ?? response
  }

  const endpoints = [
    updateEndpoint,
    {
      url: `${APP_API_BASE_URL}/voice/${voiceId}/share`,
      options: { method: 'POST' },
    },
    {
      url: `${APP_API_BASE_URL}/voice/share`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, voiceId }),
      },
    },
    {
      url: `${APP_API_BASE_URL}/voice/${voiceId}/public`,
      options: { method: 'POST' },
    },
    {
      url: `${APP_API_BASE_URL}/voice/${voiceId}/publish`,
      options: { method: 'POST' },
    },
    {
      url: `${APP_API_BASE_URL}/voice/publish`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, voiceId }),
      },
    },
  ]

  let lastError = null
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint.url, {
      ...endpoint.options,
      headers: buildAuthHeaders(endpoint.options.headers || {}),
      credentials: 'include',
    })
    if (response.ok) {
      return parseMaybeJson(response)
    }
    const message = await response.text()
    lastError = new Error(message || 'Request failed')
    if (response.status !== 404 && response.status !== 405) {
      throw lastError
    }
  }

  throw lastError || new Error('Request failed')
}

export async function deleteVoice(voiceId) {
  if (isMockEnabled) {
    return mockDeleteVoice(voiceId)
  }
  const endpoints = [
    {
      url: `${APP_API_BASE_URL}/voice/${voiceId}`,
      options: { method: 'DELETE' },
    },
    {
      url: `${APP_API_BASE_URL}/voices/${voiceId}`,
      options: { method: 'DELETE' },
    },
    {
      url: `${APP_API_BASE_URL}/voice/delete`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, voiceId, id: voiceId }),
      },
    },
  ]

  let lastError = null
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint.url, {
      ...endpoint.options,
      headers: buildAuthHeaders(endpoint.options.headers || {}),
      credentials: 'include',
    })
    if (response.ok) {
      const text = await response.text()
      return text ? JSON.parse(text) : { ok: true }
    }
    const message = await response.text()
    lastError = new Error(message || 'Request failed')
    if (response.status !== 404 && response.status !== 405) {
      throw lastError
    }
  }

  throw lastError || new Error('Request failed')
}

export async function fetchVoiceModels(params = {}) {
  if (isMockEnabled) {
    return mockFetchVoiceModels()
  }
  return requestJson(withQuery(`${APP_API_BASE_URL}/voice-models`, params))
}

// [NEW] TTS 생성 요청 (JSON 반환 - URL 저장용)
export async function generateTts(payload, { directEngine = false } = {}) {
  const baseUrl = directEngine ? TTS_API_BASE_URL : APP_API_BASE_URL
  const path = directEngine ? '/tts' : '/tts/generate'
  const url = `${baseUrl}${path}`

  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function synthesizeTts(payload, { directEngine = false } = {}) {
  const result = await generateTts(payload, { directEngine })

  const resolveAudioUrl = (rawUrl) => {
    if (!rawUrl) return ''
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl
    if (rawUrl.startsWith('/')) return `${APP_API_BASE_URL}${rawUrl}`
    return `${APP_API_BASE_URL}/${rawUrl}`
  }

  const fetchAudio = async (rawUrl) => {
    const resolved = resolveAudioUrl(rawUrl)
    const response = await fetch(resolved, {
      headers: buildAuthHeaders(),
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error('TTS audio fetch failed')
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.startsWith('audio/')) {
      const message = await response.text()
      throw new Error(message || 'TTS audio fetch failed')
    }
    return response.blob()
  }

  if (typeof result === 'string') {
    return fetchAudio(result)
  }

  const audioUrl = result?.audio_url || result?.audioUrl || result?.url
  if (audioUrl) {
    return fetchAudio(audioUrl)
  }

  throw new Error('TTS 응답 형식이 올바르지 않습니다.')
}

export async function chatWithBot(payload) {
  // [NEW] 텍스트만 먼저 받기 위해 /chat/text 엔드포인트 사용
  return requestJson(`${APP_API_BASE_URL}/chat/text`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchTtsHistory(params = {}) {
  return requestJson(withQuery(`${APP_API_BASE_URL}/tts/history`, params))
}

export async function fetchCreditLogs(params = {}) {
  return requestJson(withQuery(`${APP_API_BASE_URL}/credits/logs`, params))
}

export async function chargeCredits(amount) {
  return requestJson(`${APP_API_BASE_URL}/charge`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

export async function fetchCredits() {
  const endpoints = [
    `${APP_API_BASE_URL}/credits`,
    `${APP_API_BASE_URL}/credit`,
    `${APP_API_BASE_URL}/users/me`,
    `${APP_API_BASE_URL}/me`,
  ]

  let lastError = null
  for (const url of endpoints) {
    try {
      const data = await fetchJsonWithStatus(url)
      const credits = findCreditsValue(data)
      if (credits != null) return credits
    } catch (error) {
      lastError = error
      if (error?.status === 404 || error?.status === 405) {
        continue
      }
      throw error
    }
  }
  if (lastError && lastError?.status && lastError.status !== 404 && lastError.status !== 405) {
    throw lastError
  }
  return null
}
