const STORAGE_KEY = 'voice-descriptions-map'

const readMap = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeMap = (map) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export const getDescriptionsMap = () => readMap()

export const setVoiceDescription = (voiceId, description) => {
  const map = readMap()
  if (description == null) {
    delete map[voiceId]
  } else {
    map[voiceId] = description
  }
  writeMap(map)
  return map
}
