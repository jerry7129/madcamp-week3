import { useEffect, useMemo, useRef, useState } from 'react'
import Section from '../components/Section'
import Field from '../components/Field'
import {
  chargeCredits,
  chatWithBot,
  fetchCredits,
  fetchMyVoices,
  fetchSavedVoiceList,
  synthesizeTts,
} from '../api'
import useCredits from '../hooks/useCredits'

const CHAT_STORAGE_KEY = 'chat-history'
const BOT_NAME_KEY = 'chat-bot-name'
const BOT_AVATAR_KEY = 'chat-bot-avatar'

const mockReplies = [
  '좋은 질문이에요! 핵심만 요약해서 알려드릴게요.',
  '지금 단계에서는 흐름 설계가 가장 중요합니다.',
  '예시를 하나 들어서 설명해볼게요.',
  '이 부분은 백엔드 연결 전에도 충분히 데모 가능해요.',
]

const getMockReply = (text) => {
  const seed = text.trim().length % mockReplies.length
  const base = mockReplies[seed] || '알겠습니다. 바로 정리해드릴게요.'
  return base
}

const isMockChatEnabled = () => {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('mock-chat') === '1'
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const normalizeModel = (model) => model.replace(/-latest$/, '').trim()
const GEMINI_MODELS = (() => {
  const raw =
    import.meta.env.VITE_GEMINI_MODEL || 'gemini-1.5-flash,gemini-1.5-pro'
  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  const expanded = models.flatMap((model) => {
    const normalized = normalizeModel(model)
    return normalized && normalized !== model ? [model, normalized] : [model]
  })
  return Array.from(new Set(expanded))
})()

const listGeminiModels = async () => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
  )
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Gemini models list failed')
  }
  const data = await response.json()
  return (data?.models || [])
    .filter((model) => model?.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => model?.name?.replace(/^models\//, ''))
    .filter(Boolean)
}

const fetchGeminiReply = async (text) => {
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
  })

  for (const model of GEMINI_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const response = await fetch(`${endpoint}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (response.ok) {
      const data = await response.json()
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }

    if (response.status === 404) {
      continue
    }

    const message = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new Error('API 키 권한/제한 문제입니다. 키 설정을 확인하세요.')
    }
    throw new Error(message || 'Gemini request failed')
  }

  try {
    const availableModels = await listGeminiModels()
    for (const model of availableModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
      const response = await fetch(`${endpoint}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (response.ok) {
        const data = await response.json()
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      }
    }
    throw new Error(
      `모델을 찾을 수 없습니다. 사용 가능한 모델: ${availableModels.join(', ')}`,
    )
  } catch (error) {
    throw new Error(
      '모델을 찾을 수 없습니다. Generative Language API 활성화/키 제한을 확인하세요.',
    )
  }
}

function ChatPage() {
  const [message, setMessage] = useState('')
  const [chatHistory, setChatHistory] = useState(() => {
    if (typeof window === 'undefined') {
      return [{ role: 'bot', text: '안녕하세요! 텍스트를 입력해 대화를 시작해보세요.' }]
    }
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    } catch (error) {
      // ignore storage parse errors
    }
    return [{ role: 'bot', text: '안녕하세요! 텍스트를 입력해 대화를 시작해보세요.' }]
  })
  const [activeBotMenu, setActiveBotMenu] = useState(null)
  const [botName, setBotName] = useState(() => {
    if (typeof window === 'undefined') return '봇'
    return localStorage.getItem(BOT_NAME_KEY) || '봇'
  })
  const [botAvatarUrl, setBotAvatarUrl] = useState(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(BOT_AVATAR_KEY) || ''
  })
  const [voiceOptions, setVoiceOptions] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('tts-voice-id') || ''
  })
  const [status, setStatus] = useState(null)
  const [audioUrl, setAudioUrl] = useState('')
  const audioRef = useRef(null)
  const [isPaused, setIsPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const { spendCredits, addCredits, setCredits } = useCredits()
  const CHARGE_AMOUNT = 100
  const recognitionRef = useRef(null)
  const botFileRef = useRef(null)
  const historyRef = useRef(null)
  const isSpeechSupported =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)

  const getVoiceId = (voice, index, fallbackPrefix = 'voice') =>
    String(
      voice?.model_id ??
        voice?.modelId ??
        voice?.id ??
        voice?.voiceId ??
        voice?._id ??
        `${fallbackPrefix}-${index}`,
    )

  const buildVoiceOptions = (myList, savedList) => {
    const seen = new Set()
    const options = []
    myList.forEach((voice, index) => {
      const id = getVoiceId(voice, index, 'my')
      if (!id || seen.has(id)) return
      seen.add(id)
      const name =
        voice.model_name ||
        voice.name ||
        voice.title ||
        voice.voiceName ||
        `내 음성 ${index + 1}`
      options.push({ id, name, source: 'my' })
    })
    savedList.forEach((voice, index) => {
      const id = getVoiceId(voice, index, 'saved')
      if (!id || seen.has(id)) return
      seen.add(id)
      const name =
        voice?.title ||
        voice?.model_name ||
        voice?.name ||
        voice?.voiceName ||
        `저장 보이스 ${index + 1}`
      options.push({ id, name, source: 'saved' })
    })
    return options
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatHistory))
    } catch (error) {
      // ignore storage errors
    }
  }, [chatHistory])

  useEffect(() => {
    const loadVoices = async () => {
      try {
        const [myResult, savedResult] = await Promise.allSettled([
          fetchMyVoices(),
          fetchSavedVoiceList(),
        ])
        const myItems =
          myResult.status === 'fulfilled'
            ? Array.isArray(myResult.value)
              ? myResult.value
              : myResult.value?.items || []
            : []
        const savedItems =
          savedResult.status === 'fulfilled'
            ? Array.isArray(savedResult.value)
              ? savedResult.value
              : savedResult.value?.items || savedResult.value?.voices || savedResult.value || []
            : []
        const normalized = buildVoiceOptions(myItems, savedItems)
        setVoiceOptions(normalized)
        const hasSelected =
          selectedVoice && normalized.some((voice) => voice.id === selectedVoice)
        if ((!selectedVoice || !hasSelected) && normalized.length > 0) {
          const nextId = normalized[0].id
          setSelectedVoice(nextId)
          localStorage.setItem('tts-voice-id', nextId)
        }
      } catch (error) {
        setStatus(`보이스 목록 불러오기 실패: ${error.message}`)
      }
    }
    loadVoices()
  }, [selectedVoice])

  useEffect(() => {
    if (!historyRef.current) return
    historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [chatHistory])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(BOT_NAME_KEY, botName)
  }, [botName])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (selectedVoice) {
      localStorage.setItem('tts-voice-id', selectedVoice)
    }
  }, [selectedVoice])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (botAvatarUrl) {
      localStorage.setItem(BOT_AVATAR_KEY, botAvatarUrl)
    }
  }, [botAvatarUrl])

  useEffect(() => {
    if (!isSpeechSupported) return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'ko-KR'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join('')
      if (transcript) {
        setMessage(transcript)
      }
    }
    recognition.onerror = (event) => {
      setStatus(`음성 인식 실패: ${event.error || '알 수 없는 오류'}`)
    }
    recognition.onend = () => {
      setIsListening(false)
    }
    recognitionRef.current = recognition
    return () => {
      recognition.stop()
      recognitionRef.current = null
    }
  }, [isSpeechSupported])

  const handleSpeechToggle = () => {
    if (!recognitionRef.current) {
      setStatus('이 브라우저는 음성 인식을 지원하지 않습니다.')
      return
    }
    setStatus(null)
    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
      return
    }
    setIsListening(true)
    recognitionRef.current.start()
  }

  const syncCredits = async ({ allowDecrease = false } = {}) => {
    try {
      const serverCredits = await fetchCredits()
      if (Number.isFinite(serverCredits)) {
        setCredits((prev) =>
          allowDecrease ? serverCredits : Math.max(prev, serverCredits),
        )
        return serverCredits
      }
    } catch (error) {
      // ignore sync errors to avoid blocking chat
    }
    return null
  }

  const handleSend = async () => {
    if (!message.trim()) return
    await syncCredits({ allowDecrease: false })
    const canSpend = spendCredits(10)
    const spent = canSpend
    if (!canSpend) {
      setStatus('크래딧이 부족합니다. 필요 시 자동으로 충전합니다.')
    }
    setLoading(true)
    setStatus(null)
    try {
      let botText = ''
      try {
        const username = 'user' // 백엔드에서 토큰으로 유저 식별하므로 임의 값
        const response = await chatWithBot({
          username,
          voice_model_id: selectedVoice,
          text: message,
          message,
        })
        botText = response?.reply_text || response?.reply || ''
        
        if (!botText) {
          throw new Error('AI 응답이 비어 있습니다.')
        }
      } catch (error) {
        if (isMockChatEnabled()) {
          botText = getMockReply(message)
          setStatus(`AI 실패: ${error.message}`)
        } else {
          throw error
        }
      }
      const newBotMessage = { role: 'bot', text: botText, audioUrl: null, isLoading: true }
      
      setChatHistory((prev) => [
        ...prev,
        { role: 'user', text: message },
        newBotMessage,
      ])
      setMessage('')
      
      if (!selectedVoice) {
        setStatus('TTS 보이스를 선택하세요.')
        setChatHistory(prev => prev.map((item, idx) => 
          idx === prev.length - 1 ? { ...item, isLoading: false } : item
        ))
        return
      }

      // [NEW] TTS 비동기 요청 시작
      (async () => {
        try {
          const voiceIdValue = Number(selectedVoice)
          const voiceModelId = Number.isFinite(voiceIdValue)
            ? voiceIdValue
            : selectedVoice
            
          const trySynthesize = async () =>
            synthesizeTts({
              text: botText,
              voice_model_id: voiceModelId,
            })
            
          let blob
          let retried = false
          while (true) {
            try {
              blob = await trySynthesize()
              break
            } catch (ttsError) {
              const message = String(ttsError?.message || '')
              const isInsufficient =
                message.includes('잔액 부족') || message.toLowerCase().includes('insufficient')
              if (!retried && isInsufficient) {
                await chargeCredits(CHARGE_AMOUNT)
                await syncCredits({ allowDecrease: false })
                retried = true
                continue
              }
              throw ttsError
            }
          }
          
          const nextUrl = URL.createObjectURL(blob)
          
          // [NEW] 히스토리에 오디오 URL 업데이트
          setChatHistory(prev => {
             const updated = [...prev]
             const lastIdx = updated.length - 1
             if (lastIdx >= 0 && updated[lastIdx].role === 'bot' && updated[lastIdx].text === botText) {
                 updated[lastIdx] = { ...updated[lastIdx], audioUrl: nextUrl, isLoading: false }
             }
             return updated
          })

          setAudioUrl(nextUrl)
          if (audioRef.current) {
            audioRef.current.pause()
          }
          audioRef.current = new Audio(nextUrl)
          audioRef.current.onended = () => setIsPaused(false)
          audioRef.current.play().catch(() => {})
          setIsPaused(false)
          
        } catch (ttsError) {
          setStatus(`TTS 실패: ${ttsError.message}`)
           // 에러 시 로딩 상태 해제
           setChatHistory(prev => prev.map((item, idx) => 
             idx === prev.length - 1 ? { ...item, isLoading: false } : item
           ))
        }
      })() // Fire and forget (don't await here to unlock UI)

    } catch (error) {
      if (spent) {
        addCredits(10)
      }
      setStatus(`대화 실패: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClearChat = () => {
    const initial = [{ role: 'bot', text: '안녕하세요! 텍스트를 입력해 대화를 시작해보세요.' }]
    setChatHistory(initial)
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(initial))
    }
  }

  const handleBotAvatarPick = () => {
    botFileRef.current?.click()
  }

  const handleBotAvatarChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setBotAvatarUrl(result)
    }
    reader.readAsDataURL(file)
  }

  const handleBotNameChange = () => {
    const nextName = window.prompt('봇 이름을 입력하세요.', botName)
    if (!nextName) return
    setBotName(nextName.trim() || botName)
  }

  // [MODIFIED] 아이템 전체를 받아서 처리 (캐시된 오디오 사용)
  const handlePlayBotTts = async (item) => {
    const text = item.text
    if (!text.trim()) return

    // 1. 이미 오디오가 있다면 바로 재생
    if (item.audioUrl) {
       setAudioUrl(item.audioUrl)
       if (audioRef.current) {
         audioRef.current.pause()
       }
       audioRef.current = new Audio(item.audioUrl)
       audioRef.current.onended = () => setIsPaused(false)
       audioRef.current.play().catch(() => {})
       setIsPaused(false)
       return
    }

    // 2. 로딩 중이면 무시 (또는 알림)
    if (item.isLoading) {
        setStatus('음성을 생성하고 있습니다. 잠시만 기다려주세요.')
        return
    }

    // 3. 없으면 새로 생성 (기존 로직)
    try {
      if (!selectedVoice) {
        setStatus('TTS 보이스를 선택하세요.')
        return
      }
      await syncCredits({ allowDecrease: false })
      const voiceIdValue = Number(selectedVoice)
      const voiceModelId = Number.isFinite(voiceIdValue)
        ? voiceIdValue
        : selectedVoice
      const trySynthesize = async () =>
        synthesizeTts({
          text,
          voice_model_id: voiceModelId,
        })
      let blob
      let retried = false
      while (true) {
        try {
          blob = await trySynthesize()
          break
        } catch (ttsError) {
          const message = String(ttsError?.message || '')
          const isInsufficient =
            message.includes('잔액 부족') || message.toLowerCase().includes('insufficient')
          if (!retried && isInsufficient) {
            await chargeCredits(CHARGE_AMOUNT)
            await syncCredits({ allowDecrease: false })
            retried = true
            continue
          }
          throw ttsError
        }
      }
      const nextUrl = URL.createObjectURL(blob)
      
      // [NEW] 생성된 오디오 URL 저장 (다음에 클릭 시 바로 재생)
      setChatHistory(prev => prev.map(msg => 
          msg === item ? { ...msg, audioUrl: nextUrl } : msg
      ))

      setAudioUrl(nextUrl)
      if (audioRef.current) {
        audioRef.current.pause()
      }
      audioRef.current = new Audio(nextUrl)
      audioRef.current.onended = () => setIsPaused(false)
      audioRef.current.play().catch(() => {})
      setIsPaused(false)
    } catch (ttsError) {
      setStatus(`TTS 실패: ${ttsError.message}`)
    }
  }

  const handlePauseToggle = () => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {})
      setIsPaused(false)
    } else {
      audioRef.current.pause()
      setIsPaused(true)
    }
  }


  return (
    <div className="page stack">
      <Section
        title="Chat"
        subtitle="대화를 음성으로 이어가는 TTS 채팅."
        actions={
          <button className="btn ghost" type="button" onClick={handleClearChat}>
            대화 기록 비우기
          </button>
        }
      >
        <input
          ref={botFileRef}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={handleBotAvatarChange}
        />
        <div className="chat-history" ref={historyRef}>
          {chatHistory.map((item, index) => (
            <div
              key={`${item.role}-${index}`}
              className={`chat-bubble chat-${item.role}`}
            >
              {item.role === 'bot' ? (
                <div className="chat-avatar-wrap">
                  <button
                    type="button"
                    className="chat-avatar"
                    aria-label="봇 프로필 설정"
                    style={
                      botAvatarUrl
                        ? {
                            backgroundImage: `url(${botAvatarUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }
                        : undefined
                    }
                    onClick={() =>
                      setActiveBotMenu((prev) => (prev === index ? null : index))
                    }
                  />
                  {activeBotMenu === index ? (
                    <div className="chat-avatar-menu">
                      <button
                        className="chat-avatar-close"
                        type="button"
                        aria-label="닫기"
                        onClick={() => setActiveBotMenu(null)}
                      >
                        ×
                      </button>
                      <button className="btn ghost" type="button" onClick={handleBotAvatarPick}>
                        프로필 사진 변경
                      </button>
                      <button className="btn ghost" type="button" onClick={handleBotNameChange}>
                        봇 이름 설정
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                className="chat-content"
                onClick={
                  item.role === 'bot' ? () => handlePlayBotTts(item) : undefined
                }
                role={item.role === 'bot' ? 'button' : undefined}
                tabIndex={item.role === 'bot' ? 0 : undefined}
                onKeyDown={(event) => {
                  if (item.role !== 'bot') return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handlePlayBotTts(item)
                  }
                }}
              >
                <strong>{item.role === 'user' ? '나' : botName}</strong>
                <p>{item.text}</p>
                {/* [NEW] 로딩 인디케이터 */ }
                {item.isLoading ? ( 
                   <span style={{ fontSize: '0.8em', color: '#888' }}> (음성 생성 중...)</span> 
                ) : null}
              </div>
              {item.role === 'bot' ? (
                <button
                  className="btn ghost chat-tts-toggle"
                  type="button"
                  onClick={handlePauseToggle}
                >
                  {isPaused ? '재생' : '일시정지'}
                </button>
              ) : null}


      </Section>
    </div>
  )
}

export default ChatPage
