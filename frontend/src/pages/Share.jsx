import { useEffect, useMemo, useRef, useState } from 'react'
import Section from '../components/Section'
import {
  fetchMe,
  fetchSavedVoiceList,
  fetchSharedVoices,
  saveVoiceModel,
  synthesizeTts,
} from '../api'
import { getDescriptionsMap } from '../utils/voiceDescriptions'
import useCredits from '../hooks/useCredits'

const normalizeId = (value) =>
  value === 0 || value ? String(value) : ''

const getVoiceModelId = (voice) => {
  const raw =
    voice?.model_id ||
    voice?.modelId ||
    voice?.voiceId ||
    voice?._id ||
    voice?.id
  const normalized = normalizeId(raw)
  return normalized && /^[0-9]+$/.test(normalized) ? normalized : null
}

const getOwnerId = (voice) => {
  const raw =
    voice?.user_id ||
    voice?.userId ||
    voice?.owner_id ||
    voice?.ownerId ||
    voice?.creator_id ||
    voice?.creatorId ||
    voice?.created_by ||
    voice?.createdBy ||
    voice?.user?.id
  return normalizeId(raw)
}

const getUploaderInfo = (voice) => {
  const uploader =
    voice?.uploader ||
    voice?.uploader_info ||
    voice?.uploaderInfo ||
    voice?.creator ||
    voice?.owner ||
    voice?.user ||
    {}
  const uploaderId =
    voice?.uploaderId ||
    voice?.uploader_id ||
    voice?.uploaderID ||
    uploader?.id ||
    uploader?.user_id ||
    uploader?.userId ||
    uploader?._id ||
    getOwnerId(voice)
  const uploaderNickname =
    voice?.creator_name ||
    voice?.creatorName ||
    voice?.uploaderNickname ||
    voice?.uploader_nickname ||
    uploader?.nickname ||
    uploader?.name ||
    uploader?.username ||
    uploader?.display_name ||
    uploader?.displayName ||
    ''
  const uploaderProfileImageUrl =
    voice?.creator_profile_image ||
    voice?.creator_profile_image_url ||
    voice?.creatorProfileImage ||
    voice?.creatorProfileImageUrl ||
    voice?.uploaderProfileImageUrl ||
    voice?.uploader_profile_image_url ||
    uploader?.profileImageUrl ||
    uploader?.profile_image_url ||
    uploader?.profile_image ||
    uploader?.avatarUrl ||
    uploader?.avatar_url ||
    uploader?.image ||
    uploader?.photo ||
    ''
  return {
    uploaderId: normalizeId(uploaderId),
    uploaderNickname,
    uploaderProfileImageUrl,
  }
}

const resolvePrice = (voice) => {
  const raw =
    voice?.price ??
    voice?.cost ??
    voice?.credit_price ??
    voice?.creditPrice ??
    voice?.credit_cost ??
    voice?.creditCost
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const extractCreditsValue = (value) => {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractCreditsValue(item)
      if (found != null) return found
    }
    return null
  }
  if (typeof value === 'object') {
    const candidates = [
      'updatedCredit',
      'updated_credit',
      'userCredit',
      'user_credit',
      'credit_balance',
      'credits',
      'credit',
      'balance',
      'points',
      'remaining_credits',
      'remainingCredits',
    ]
    for (const key of candidates) {
      if (value[key] != null) {
        const found = extractCreditsValue(value[key])
        if (found != null) return found
      }
    }
    for (const key of Object.keys(value)) {
      const found = extractCreditsValue(value[key])
      if (found != null) return found
    }
  }
  return null
}

const filterVoices = (voices, query) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return voices
  return voices.filter((voice) => voice.title.toLowerCase().includes(normalized))
}

function SharePage() {
  const [status, setStatus] = useState(null)
  const [sharedVoices, setSharedVoices] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('latest')
  const [localDescriptionsMap, setLocalDescriptionsMap] = useState(() =>
    getDescriptionsMap(),
  )
  const [savedVoices, setSavedVoices] = useState([])
  const [savingIds, setSavingIds] = useState({})
  const [previewLoadingId, setPreviewLoadingId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewVoiceId, setPreviewVoiceId] = useState(null)
  const audioRef = useRef(null)
  const audioContextRef = useRef(null)
  const audioSourceRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState(null)
  const { credits, setCredits } = useCredits()
  const SAMPLE_TEXT = '안녕하세요 이것은 샘플 보이스입니다.'
  const SAMPLE_LANG = 'ko'
  const SILENT_AUDIO =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='

  const extractRefAudioPath = (voice) => {
    if (!voice || typeof voice !== 'object') return ''
    const direct =
      voice.ref_audio_path ||
      voice.refAudioPath ||
      voice.ref_audio ||
      voice.refAudio ||
      voice.sample_audio_path ||
      voice.sampleAudioPath ||
      voice.sample_audio_url ||
      voice.sampleAudioUrl ||
      voice.preview_audio_url ||
      voice.previewAudioUrl ||
      voice.demo_audio_url ||
      voice.demoAudioUrl ||
      voice.audio_url ||
      voice.audioUrl
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const nested =
      voice.sample?.audio_url ||
      voice.sample?.audioUrl ||
      voice.preview?.audio_url ||
      voice.preview?.audioUrl ||
      voice.demo?.audio_url ||
      voice.demo?.audioUrl
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
    return ''
  }

  const isPermissionError = (message = '') =>
    message.includes('권한') || message.includes('구매') || message.includes('access')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setIsLoading(true)
        const [sharedResult, savedResult, meResult] = await Promise.allSettled([
          fetchSharedVoices(),
          fetchSavedVoiceList(),
          fetchMe(),
        ])
        if (!mounted) return
        if (sharedResult.status === 'fulfilled') {
          const sharedItems = Array.isArray(sharedResult.value)
            ? sharedResult.value
            : sharedResult.value?.items || sharedResult.value?.voices || sharedResult.value || []
          const normalizedShared = Array.isArray(sharedItems) ? sharedItems : []
          setSharedVoices(normalizedShared)
        }
        if (savedResult.status === 'fulfilled') {
          const savedItems = Array.isArray(savedResult.value)
            ? savedResult.value
            : savedResult.value?.items || savedResult.value?.voices || savedResult.value || []
          const normalizedSaved = Array.isArray(savedItems) ? savedItems : []
          setSavedVoices(normalizedSaved)
        } else {
          setSavedVoices([])
        }
        if (meResult.status === 'fulfilled') {
          const meId = normalizeId(meResult.value?.id || meResult.value?.user_id)
          setCurrentUserId(meId || null)
        }
      } catch (error) {
        if (!mounted) return
        setStatus(`공유 보이스 불러오기 실패: ${error.message}`)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (audioSourceRef.current) {
        audioSourceRef.current.stop()
        audioSourceRef.current.disconnect()
        audioSourceRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  useEffect(() => {
    const syncStorage = () => {
      setLocalDescriptionsMap(getDescriptionsMap())
      fetchSavedVoiceList()
        .then((data) => {
          const items = Array.isArray(data) ? data : []
          setSavedVoices(items)
        })
        .catch(() => setSavedVoices([]))
    }
    window.addEventListener('focus', syncStorage)
    return () => window.removeEventListener('focus', syncStorage)
  }, [])

  const toDisplayVoice = (voice, index, fallbackPrefix) => {
    const modelId = getVoiceModelId(voice)
    const displayId = modelId || `${fallbackPrefix}-${index}`
    const ownerId = getOwnerId(voice)
    const uploaderInfo = getUploaderInfo(voice)
    const isMine = Boolean(
      currentUserId &&
        ((ownerId && ownerId === currentUserId) ||
          (uploaderInfo.uploaderId && uploaderInfo.uploaderId === currentUserId)),
    )
    const hasLocalDescription = Object.prototype.hasOwnProperty.call(
      localDescriptionsMap,
      displayId,
    )
    const fallbackDescription =
      voice?.description ||
      voice?.summary ||
      voice?.memo ||
      voice?.desc ||
      voice?.text ||
      ''
    return {
      id: displayId,
      modelId,
      isMine,
      title:
        voice?.model_name ||
        voice?.title ||
        voice?.name ||
        voice?.voiceName ||
        `보이스 ${index + 1}`,
      subtitle: hasLocalDescription ? localDescriptionsMap[displayId] || '' : fallbackDescription,
      uploaderId: uploaderInfo.uploaderId,
      uploaderNickname: uploaderInfo.uploaderNickname,
      uploaderProfileImageUrl: uploaderInfo.uploaderProfileImageUrl,
      price: resolvePrice(voice),
      raw: voice,
      order: index,
    }
  }

  const normalizedShared = useMemo(
    () => sharedVoices.map((voice, index) => toDisplayVoice(voice, index, 'shared')),
    [sharedVoices, localDescriptionsMap, currentUserId],
  )

  const savedSet = useMemo(() => {
    return new Set(
      savedVoices
        .map((voice, index) => {
          if (typeof voice === 'string' || typeof voice === 'number') {
            return normalizeId(voice)
          }
          return normalizeId(
            voice?.model_id ||
              voice?.modelId ||
              voice?.voiceId ||
              voice?._id ||
              voice?.id ||
              `saved-${index}`,
          )
        })
        .filter(Boolean),
    )
  }, [savedVoices])

  const filteredShared = useMemo(() => {
    const searched = filterVoices(normalizedShared, searchQuery)
    if (sortOrder === 'name') {
      return [...searched].sort((a, b) => a.title.localeCompare(b.title))
    }
    return [...searched].sort((a, b) => b.order - a.order)
  }, [normalizedShared, searchQuery, sortOrder])

  const handleSaveToggle = async (voice) => {
    if (voice.isMine) {
      setStatus('내가 만든 보이스는 저장 대상이 아닙니다.')
      return
    }
    const id = voice.modelId || getVoiceModelId(voice.raw || voice)
    if (!id) {
      setStatus('저장 가능한 모델 ID를 찾지 못했습니다.')
      return
    }
    const isSaved = savedSet.has(id)
    if (savingIds[id] || isSaved) return
    if (voice.price > 0 && Number.isFinite(credits) && credits < voice.price) {
      setStatus('크레딧이 부족합니다')
      return
    }
    setSavingIds((prev) => ({ ...prev, [id]: true }))
    const previous = savedVoices
    const next = [
      ...previous,
      {
        id,
        model_id: Number.isFinite(Number(id)) ? Number(id) : id,
        model_name: voice.title,
        description: voice.subtitle,
        price: voice.price,
      },
    ]
    setSavedVoices(next)
    try {
      const response = await saveVoiceModel(id)
      setStatus('저장 완료')
      const nextCredits = extractCreditsValue(response)
      if (Number.isFinite(nextCredits)) {
        setCredits(nextCredits)
      }
      const refreshed = await fetchSavedVoiceList().catch(() => null)
      if (refreshed && Array.isArray(refreshed)) {
        setSavedVoices(refreshed)
      }
    } catch (error) {
      setSavedVoices(previous)
      setStatus(`저장 처리 실패: ${error.message}`)
    } finally {
      setSavingIds((prev) => {
        const nextState = { ...prev }
        delete nextState[id]
        return nextState
      })
    }
  }

  const ensureAudioContext = async () => {
    if (typeof window === 'undefined') return null
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      audioContextRef.current = new AudioCtx()
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }
    return audioContextRef.current
  }

  const playWithAudioContext = async (blob) => {
    const ctx = await ensureAudioContext()
    if (!ctx) return false
    if (audioSourceRef.current) {
      audioSourceRef.current.stop()
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => setStatus(null)
    source.start(0)
    audioSourceRef.current = source
    return true
  }

  const handlePreviewTts = async (voice) => {
    if (previewLoadingId) return
    const resolvedId = voice.modelId || getVoiceModelId(voice.raw || voice)
    if (!resolvedId) {
      setStatus('미리듣기 가능한 보이스 ID가 없습니다.')
      return
    }
    setPreviewLoadingId(voice.id)
    setStatus('샘플 보이스 합성 중...')
    await ensureAudioContext()
    try {
      const voiceIdValue = Number(resolvedId)
      const voiceModelId = Number.isFinite(voiceIdValue) ? voiceIdValue : resolvedId
      const blob = await synthesizeTts({
        text: SAMPLE_TEXT,
        voice_model_id: voiceModelId,
      })
      if (!blob) {
        throw new Error('TTS 응답이 비어 있습니다.')
      }
      const nextUrl = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.pause()
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
      setPreviewUrl(nextUrl)
      setPreviewVoiceId(voice.id)
      try {
        await playWithAudioContext(blob)
        setStatus('샘플 보이스 재생 중...')
      } catch {
        if (!audioRef.current) {
          audioRef.current = new Audio()
        }
        audioRef.current.src = nextUrl
        audioRef.current.muted = false
        audioRef.current.onended = () => setStatus(null)
        audioRef.current.onplay = () => setStatus('샘플 보이스 재생 중...')
        audioRef.current.onerror = () => setStatus('샘플 보이스 재생에 실패했습니다.')
        audioRef.current
          .play()
          .then(() => {
            setStatus('샘플 보이스 재생 중...')
          })
          .catch(() => {
            setStatus('샘플 보이스 재생에 실패했습니다.')
          })
      }
    } catch (error) {
      const message = String(error?.message || '')
      const refAudioPath = extractRefAudioPath(voice.raw || voice)
      if (isPermissionError(message) && refAudioPath) {
        try {
          setStatus('권한 제한으로 샘플 경로로 재생을 시도합니다.')
          const blob = await synthesizeTts(
            {
              text: SAMPLE_TEXT,
              text_lang: SAMPLE_LANG,
              ref_audio_path: refAudioPath,
              prompt_lang: SAMPLE_LANG,
              prompt_text: SAMPLE_TEXT,
            },
            { directEngine: true },
          )
          if (!blob) {
            throw new Error('TTS 응답이 비어 있습니다.')
          }
          const nextUrl = URL.createObjectURL(blob)
          if (audioRef.current) {
            audioRef.current.pause()
          }
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
          }
          setPreviewUrl(nextUrl)
          setPreviewVoiceId(voice.id)
          try {
            await playWithAudioContext(blob)
            setStatus('샘플 보이스 재생 중...')
          } catch {
            if (!audioRef.current) {
              audioRef.current = new Audio()
            }
            audioRef.current.src = nextUrl
            audioRef.current.muted = false
            audioRef.current.onended = () => setStatus(null)
            audioRef.current.onplay = () => setStatus('샘플 보이스 재생 중...')
            audioRef.current.onerror = () => setStatus('샘플 보이스 재생에 실패했습니다.')
            audioRef.current
              .play()
              .then(() => {
                setStatus('샘플 보이스 재생 중...')
              })
              .catch(() => {
                setStatus('샘플 보이스 재생에 실패했습니다.')
              })
          }
          return
        } catch (fallbackError) {
          setStatus(`미리듣기 실패: ${fallbackError.message}`)
          return
        }
      }
      setStatus(`미리듣기 실패: ${message}`)
    } finally {
      setPreviewLoadingId(null)
    }
  }

  const renderSkeleton = (count = 5) => (
    <div className="share-skeleton-list">
      {Array.from({ length: count }).map((_, index) => (
        <div key={`skeleton-${index}`} className="share-skeleton-row" />
      ))}
    </div>
  )

  return (
    <div className="page share-page">
      <Section title="" subtitle="">
        {/* status message hidden per request */}

        <div className="share-filters">
          <div className="share-search">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="보이스 이름으로 검색"
            />
          </div>
          <div className="share-filter-row">
            <div className="share-sort">
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                <option value="latest">최신순</option>
                <option value="name">이름순</option>
              </select>
            </div>
          </div>
        </div>

        {isLoading ? (
          renderSkeleton()
        ) : filteredShared.length === 0 ? (
          <div className="share-empty">
            <div className="share-empty-icon">🔍</div>
            <strong>표시할 보이스가 없습니다.</strong>
            <p className="muted">다른 태그나 검색어를 입력해보세요.</p>
          </div>
        ) : (
          <div className="share-list">
                {filteredShared.map((voice) => {
              const normalizedId = voice.modelId || getVoiceModelId(voice.raw || voice)
              const isPreviewLoading = previewLoadingId === voice.id
                  const isSaved = !voice.isMine && savedSet.has(normalizedId)
              return (
                <div key={voice.id} className="voiceCard">
                  <div className="leftIcon">
                    <button
                      type="button"
                      className="share-avatar share-avatar-button"
                      onClick={() => handlePreviewTts(voice)}
                      disabled={isPreviewLoading || !normalizedId}
                      aria-label="샘플 보이스 미리듣기"
                      title="샘플 보이스 미리듣기"
                    >
                      {isPreviewLoading ? '⏳' : '🔊'}
                    </button>
                  </div>
                  <div className="mid">
                    <div className="headerLine">
                      <div className="title">{voice.title}</div>
                      {voice.isMine ? (
                        <div className="creatorInfo muted">내 보이스</div>
                      ) : (
                        <div className="creatorInfo">
                          {voice.uploaderProfileImageUrl ? (
                            <img
                              className="share-uploader-avatar"
                              src={voice.uploaderProfileImageUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="share-uploader-avatar fallback">👤</span>
                          )}
                          <span className="share-uploader-name">
                            {voice.uploaderNickname || '알 수 없음'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="audioLine">
                      {previewUrl && previewVoiceId === voice.id ? (
                        <div className="audioPlayerWrap">
                          <audio className="share-audio" controls src={previewUrl} />
                        </div>
                      ) : null}
                    </div>
                    <div className="metaLine">
                      {voice.subtitle && voice.subtitle !== '설명 없음' ? (
                        <div className="share-desc">{voice.subtitle}</div>
                      ) : null}
                      <div className="share-price">
                        {voice.price > 0 ? `가격: ${voice.price} 크레딧` : '무료'}
                      </div>
                    </div>
                  </div>
                  <div className="rightActions">
                    <span className="share-status on">공유중</span>
                        {voice.isMine ? (
                          <button className="btn ghost" type="button" disabled>
                            내 보이스
                          </button>
                        ) : (
                          <button
                            className={isSaved ? 'btn ghost' : 'btn'}
                            type="button"
                            onClick={() => handleSaveToggle(voice)}
                            disabled={
                              Boolean(savingIds[normalizedId]) || !normalizedId || isSaved
                            }
                          >
                            {savingIds[normalizedId]
                              ? '처리중...'
                              : isSaved
                                ? '저장 완료'
                                : normalizedId
                                  ? '저장'
                                  : '저장 불가'}
                          </button>
                        )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

export default SharePage
