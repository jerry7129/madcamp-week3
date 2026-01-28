const DEFAULT_ORIGIN =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''
const RAW_APP_API_BASE_URL =
  import.meta.env.VITE_APP_API_BASE_URL || DEFAULT_ORIGIN || 'http://localhost:3001'
const RAW_TTS_API_BASE_URL =
  import.meta.env.VITE_TTS_API_BASE_URL || DEFAULT_ORIGIN || 'http://127.0.0.1:9880'

const APP_API_BASE_URL =
  import.meta.env.DEV && window.location.hostname === 'localhost'
    ? '/api'
    : RAW_APP_API_BASE_URL
const TTS_API_BASE_URL =
  import.meta.env.DEV && window.location.hostname === 'localhost'
    ? '/tts-api'
    : RAW_TTS_API_BASE_URL

function getAuthToken() {
  const raw = localStorage.getItem('token') || localStorage.getItem('access_token')
  if (!raw) return null
  return raw.startsWith('Bearer ') ? raw.slice(7) : raw
}

function buildAuthHeaders(extraHeaders = {}) {
  const token = getAuthToken()
  return {
    ...(token
      ? { Authorization: `Bearer ${token}`, 'X-Access-Token': token }
      : {}),
    ...extraHeaders,
  }
}

function withQuery(url, params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return url
  const search = new URLSearchParams(entries).toString()
  const delimiter = url.includes('?') ? '&' : '?'
  return `${url}${delimiter}${search}`
}

async function requestJson(url, options = {}) {
  const mergedHeaders = buildAuthHeaders({
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  })
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials ?? 'include',
    headers: mergedHeaders,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }

  return response.json()
}

async function requestBlob(url, options = {}) {
  const response = await fetch(url, {
    credentials: options.credentials ?? 'include',
    ...options,
    headers: buildAuthHeaders(options.headers || {}),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return response.blob()
}

export {
  APP_API_BASE_URL,
  TTS_API_BASE_URL,
  requestJson,
  requestBlob,
  buildAuthHeaders,
  withQuery,
}
