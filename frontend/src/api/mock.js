const MOCK_VOICES_KEY = 'mock-voices'
const MOCK_SHARED_KEY = 'mock-shared-voices'

const readList = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

const writeList = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value))
}

export const mockUploadVoice = async (payload) => {
  const voices = readList(MOCK_VOICES_KEY)
  const id = `mock-${Date.now()}`
  const name =
    payload?.filename?.replace(/\.[^/.]+$/, '') || `내 음성 ${voices.length + 1}`
  const voice = {
    id,
    name,
    description: payload?.description || payload?.text || '설명 없음',
    tags: payload?.tags || [],
    refAudioPath: `mock://${id}`,
  }
  writeList(MOCK_VOICES_KEY, [voice, ...voices])
  return { id, voiceId: id, voice, refAudioPath: voice.refAudioPath }
}

export const mockFetchMyVoices = async () => {
  return { items: readList(MOCK_VOICES_KEY) }
}

export const mockFetchSharedVoices = async () => {
  return { items: readList(MOCK_SHARED_KEY) }
}

export const mockShareVoice = async (voiceId, isPublic = true) => {
  const voices = readList(MOCK_VOICES_KEY)
  const shared = readList(MOCK_SHARED_KEY)
  const voiceIndex = voices.findIndex((item) => item.id === voiceId)
  const voice = voiceIndex >= 0 ? voices[voiceIndex] : null
  if (!voice) {
    throw new Error('공유할 보이스를 찾을 수 없습니다.')
  }
  const updatedVoice = { ...voice, is_public: isPublic }
  const nextVoices = [...voices]
  nextVoices[voiceIndex] = updatedVoice
  writeList(MOCK_VOICES_KEY, nextVoices)
  if (isPublic) {
    writeList(
      MOCK_SHARED_KEY,
      [
        { ...updatedVoice, sharedAt: Date.now() },
        ...shared.filter((v) => v.id !== voiceId),
      ],
    )
  } else {
    writeList(
      MOCK_SHARED_KEY,
      shared.filter((v) => v.id !== voiceId),
    )
  }
  return { ok: true }
}

export const mockDeleteVoice = async (voiceId) => {
  const voices = readList(MOCK_VOICES_KEY)
  const shared = readList(MOCK_SHARED_KEY)
  const nextVoices = voices.filter((voice) => voice.id !== voiceId)
  if (nextVoices.length === voices.length) {
    throw new Error('삭제할 보이스를 찾을 수 없습니다.')
  }
  writeList(MOCK_VOICES_KEY, nextVoices)
  writeList(
    MOCK_SHARED_KEY,
    shared.filter((voice) => voice.id !== voiceId),
  )
  return { ok: true }
}

export const mockFetchVoiceModels = async () => {
  return { items: readList(MOCK_SHARED_KEY) }
}
