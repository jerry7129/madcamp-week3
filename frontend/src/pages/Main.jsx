import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Section from '../components/Section'
import Field from '../components/Field'
import {
  chargeCredits,
  fetchCredits,
  fetchMyVoices,
  fetchSavedVoiceList,
  synthesizeTts,
  uploadVoice,
} from '../api'
import useCredits from '../hooks/useCredits'

const languages = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: '영어' },
  { value: 'ja', label: '일본어' },
  { value: 'zh', label: '중국어' },
]

const presetOptions = [
  {
    id: 'default',
    name: '기본 프리셋',
    gptModel: 'gpt-default',
    sovitsModel: 'sovits-default',
  },
  {
    id: 'demo-v2',
    name: '데모 v2',
    gptModel: 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt',
    sovitsModel: 's2G2333k.pth',
  },
  {
    id: 'demo-v4',
    name: '데모 v4',
    gptModel: 's1v3.ckpt',
    sovitsModel: 's2Gv4.pth',
  },
]

const readPresetSettings = () => {
  if (typeof window === 'undefined') {
    return {
      presetName: '기본 프리셋',
      presetId: presetOptions[0].id,
      gptModel: 'gpt-default',
      sovitsModel: 'sovits-default',
    }
  }
  return {
    presetName: localStorage.getItem('presetName') || '기본 프리셋',
    presetId: localStorage.getItem('presetId') || presetOptions[0].id,
    gptModel: localStorage.getItem('gptModel') || 'gpt-default',
    sovitsModel: localStorage.getItem('sovitsModel') || 'sovits-default',
  }
}

function MainPage() {
  const [mainTab, setMainTab] = useState('learn')
  const initialPreset = useMemo(() => readPresetSettings(), [])
  const [presetName, setPresetName] = useState(initialPreset.presetName)
  const [presetId, setPresetId] = useState(initialPreset.presetId)
  const [gptModel, setGptModel] = useState(initialPreset.gptModel)
  const [sovitsModel, setSovitsModel] = useState(initialPreset.sovitsModel)
  const [trainFile, setTrainFile] = useState(null)
  const [trainText, setTrainText] = useState('')
  const [trainDescription, setTrainDescription] = useState('')
  const [trainName, setTrainName] = useState('')
  const [trainIsPublic, setTrainIsPublic] = useState(false)
  const [trainPrice, setTrainPrice] = useState('')
  const [trainPriceError, setTrainPriceError] = useState(false)
  const [trainStatus, setTrainStatus] = useState(null)
  const [uploadSource, setUploadSource] = useState(null)
  const [uploadReady, setUploadReady] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [recordedUrl, setRecordedUrl] = useState('')
  const [recordedName, setRecordedName] = useState('recording')
  const [mediaRecorder, setMediaRecorder] = useState(null)
  const [recordingSupported, setRecordingSupported] = useState(true)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [maxRecordSeconds, setMaxRecordSeconds] = useState(12)
  const [linkAsReference, setLinkAsReference] = useState(true)
  const mediaStreamRef = useRef(null)
  const timerRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animationRef = useRef(null)
  const waveCanvasRef = useRef(null)
  const recordingProgress = maxRecordSeconds
    ? Math.min((recordingSeconds / maxRecordSeconds) * 100, 100)
    : 0

  const [ttsText, setTtsText] = useState('')
  const [ttsLang, setTtsLang] = useState('ko')
  const [voiceOptions, setVoiceOptions] = useState([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const selectedVoiceRef = useRef('')
  const [refAudioPath, setRefAudioPath] = useState('')
  const [promptText, setPromptText] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [ttsStatus, setTtsStatus] = useState(null)
  const [directEngine, setDirectEngine] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTrainAdvanced, setShowTrainAdvanced] = useState(false)
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)
  const CHARGE_AMOUNT = 100
  const readAuthToken = () => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('token') || localStorage.getItem('access_token') || ''
  }
  const [isAuthed, setIsAuthed] = useState(() => Boolean(readAuthToken()))

  const { credits, spendCredits, addCredits, setCredits } = useCredits()

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
      // ignore sync errors to avoid blocking TTS
    }
    return null
  }

  const normalizedVoices = useMemo(() => {
    return voiceOptions.map((voice, index) => ({
      id: String(voice.id ?? voice.voiceId ?? voice._id ?? `voice-${index}`),
      name: voice.name || `보이스 ${index + 1}`,
      source: voice.source || 'my',
    }))
  }, [voiceOptions])

  const syncPresetSettings = () => {
    const next = readPresetSettings()
    setPresetName(next.presetName)
    setPresetId(next.presetId)
    setGptModel(next.gptModel)
    setSovitsModel(next.sovitsModel)
  }

  useEffect(() => {
    setRecordingSupported(
      Boolean(navigator?.mediaDevices?.getUserMedia && window.MediaRecorder),
    )
  }, [])

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl)
      }
    }
  }, [recordedUrl])

  useEffect(() => {
    window.addEventListener('focus', syncPresetSettings)
    return () => {
      window.removeEventListener('focus', syncPresetSettings)
    }
  }, [])

  useEffect(() => {
    const syncAuth = () => {
      setIsAuthed(Boolean(readAuthToken()))
    }
    syncAuth()
    window.addEventListener('focus', syncAuth)
    return () => window.removeEventListener('focus', syncAuth)
  }, [])

  const getVoiceId = (voice, index) =>
    String(
      voice?.model_id ??
        voice?.modelId ??
        voice?.id ??
        voice?.voiceId ??
        voice?._id ??
        `voice-${index}`,
    )

  const buildVoiceOptions = (myList, savedList) => {
    const seen = new Set()
    const options = []
    myList.forEach((voice, index) => {
      const id = getVoiceId(voice, index)
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
      const id = getVoiceId(voice, index)
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

  const loadVoices = useCallback(
    async ({ preserveSelection = true, preferName = '' } = {}) => {
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
        const options = buildVoiceOptions(myItems, savedItems)
        setVoiceOptions(options)
        if (options.length === 0) {
          setSelectedVoice('')
          return
        }
        const normalizedName = preferName?.trim()
        const selectedId = preserveSelection ? selectedVoiceRef.current : ''
        const hasSelected = selectedId && options.some((voice) => voice.id === selectedId)
        if (hasSelected) return
        const matchedByName = normalizedName
          ? options.find((voice) => voice.name.trim() === normalizedName)
          : null
        const nextId = matchedByName ? matchedByName.id : options[0].id
        setSelectedVoice(nextId)
      } catch (error) {
        setTtsStatus(`목소리 목록 불러오기 실패: ${error.message}`)
      }
    },
    [],
  )

  useEffect(() => {
    loadVoices({ preserveSelection: false })
  }, [loadVoices])

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice
  }, [selectedVoice])

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null
    setTrainFile(nextFile)
    if (nextFile) {
      setRecordedBlob(null)
      setRecordedUrl('')
    }
    setUploadSource(nextFile ? 'file' : null)
    setUploadReady(Boolean(nextFile))
  }

  const startRecording = async () => {
    try {
      setTrainStatus(null)
      if (!recordingSupported || isRecording) return
      setTrainStatus(null)
      setTrainFile(null)
      setRecordedBlob(null)
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      setRecordedUrl('')
      setUploadSource(null)
      setUploadReady(false)
      setRecordingSeconds(0)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioCtx()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      const recorder = new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType })
        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
      }
      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)
      const drawWave = () => {
        const canvas = waveCanvasRef.current
        const analyserNode = analyserRef.current
        if (!canvas || !analyserNode) {
          animationRef.current = requestAnimationFrame(drawWave)
          return
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const { width, height } = canvas
        const bufferLength = analyserNode.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyserNode.getByteFrequencyData(dataArray)

        ctx.clearRect(0, 0, width, height)
        const barCount = 32
        const step = Math.floor(bufferLength / barCount)
        const barWidth = Math.max(4, (width - barCount * 6) / barCount)
        let x = 0

        for (let i = 0; i < barCount; i += 1) {
          const value = dataArray[i * step] || 0
          const barHeight = Math.max(6, (value / 255) * height)
          ctx.fillStyle = '#7b5cff'
          ctx.globalAlpha = 0.85
          ctx.fillRect(x, height - barHeight, barWidth, barHeight)
          x += barWidth + 6
        }
        ctx.globalAlpha = 1
        animationRef.current = requestAnimationFrame(drawWave)
      }
      animationRef.current = requestAnimationFrame(drawWave)
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1
          if (maxRecordSeconds && next >= maxRecordSeconds) {
            stopRecording()
          }
          return next
        })
      }, 1000)
    } catch (error) {
      setTrainStatus(`녹음 시작 실패: ${error.message}`)
    }
  }

  const stopRecording = () => {
    if (!mediaRecorder || !isRecording) return
    mediaRecorder.stop()
    setIsRecording(false)
    setMediaRecorder(null)
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  const useRecordedAudio = () => {
    if (!recordedBlob) return
    const safeName = recordedName?.trim() || 'recording'
    const file = new File([recordedBlob], `${safeName}.webm`, {
      type: recordedBlob.type || 'audio/webm',
    })
    setTrainFile(file)
    setUploadSource('recording')
    setUploadReady(true)
    setTrainStatus('녹음 파일을 학습 업로드 대상으로 설정했습니다.')
  }

  const resetRecordedAudio = () => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl)
    }
    setRecordedBlob(null)
    setRecordedUrl('')
    setTrainFile(null)
    setUploadSource(null)
    setUploadReady(false)
    setTrainStatus('녹음 파일을 초기화했습니다.')
  }

  const convertToWavFile = async (blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioCtx()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
      await audioContext.close()
      const wavBuffer = encodeWav(audioBuffer)
      return new File([wavBuffer], 'recording.wav', { type: 'audio/wav' })
    } catch (error) {
      return new File([blob], 'recording.webm', {
        type: blob.type || 'audio/webm',
      })
    }
  }

  const encodeWav = (audioBuffer) => {
    const numChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const format = 1
    const bitDepth = 16
    const samples = audioBuffer.length
    const blockAlign = (numChannels * bitDepth) / 8
    const byteRate = sampleRate * blockAlign
    const dataSize = samples * blockAlign
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    let offset = 0
    const writeString = (str) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
      offset += str.length
    }

    writeString('RIFF')
    view.setUint32(offset, 36 + dataSize, true)
    offset += 4
    writeString('WAVE')
    writeString('fmt ')
    view.setUint32(offset, 16, true)
    offset += 4
    view.setUint16(offset, format, true)
    offset += 2
    view.setUint16(offset, numChannels, true)
    offset += 2
    view.setUint32(offset, sampleRate, true)
    offset += 4
    view.setUint32(offset, byteRate, true)
    offset += 4
    view.setUint16(offset, blockAlign, true)
    offset += 2
    view.setUint16(offset, bitDepth, true)
    offset += 2
    writeString('data')
    view.setUint32(offset, dataSize, true)
    offset += 4

    const channelData = []
    for (let channel = 0; channel < numChannels; channel += 1) {
      channelData.push(audioBuffer.getChannelData(channel))
    }

    let sampleIndex = 0
    for (let i = 0; i < samples; i += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]))
        view.setInt16(offset + sampleIndex, sample * 0x7fff, true)
        sampleIndex += 2
      }
    }

    return buffer
  }

  const handleUpload = async (fileOverride = null) => {
    const isEventLike =
      fileOverride &&
      typeof fileOverride === 'object' &&
      'currentTarget' in fileOverride &&
      'preventDefault' in fileOverride
    const rawTarget = (isEventLike ? null : fileOverride) || trainFile
    const targetFile =
      rawTarget instanceof Blob
        ? rawTarget
        : rawTarget?.file || rawTarget?.blob || rawTarget?.originFileObj
    if (!targetFile || !uploadReady) {
      if (recordedBlob && !uploadReady) {
        setTrainStatus('업로드 전에 "녹음 사용"을 눌러 파일을 선택하세요.')
      } else {
        setTrainStatus('업로드할 음성 파일을 선택하세요.')
      }
      return
    }
    if (!(targetFile instanceof Blob)) {
      setTrainStatus('업로드 파일 형식이 올바르지 않습니다.')
      return
    }
    try {
      setTrainStatus('업로드 중...')
      const filename =
        targetFile instanceof File
          ? targetFile.name
          : `${(recordedName?.trim() || 'recording')}.webm`
      if (!trainName.trim()) {
        setTrainStatus('모델 이름을 입력하세요.')
        return
      }
      if (!trainText.trim()) {
        setTrainStatus('음성 텍스트를 입력하세요.')
        return
      }
      if (trainIsPublic) {
        const priceValue = Number(trainPrice)
        if (!trainPrice.trim() || !Number.isFinite(priceValue)) {
          setTrainPriceError(true)
          return
        }
      }
      const formData = new FormData()
      formData.append('name', trainName.trim())
      formData.append('description', trainDescription.trim())
      formData.append('is_public', String(Boolean(trainIsPublic)))
      if (trainIsPublic) {
        formData.append('price', String(Number(trainPrice)))
      }
      formData.append('ref_text', trainText.trim())
      formData.append('audio_file', targetFile, filename)
      const response = await uploadVoice(formData)
      setTrainStatus('업로드 완료! 학습 파이프라인에서 처리됩니다.')
      await loadVoices({
        preserveSelection: true,
        preferName: trainName.trim(),
      })
      if (linkAsReference) {
        const nextVoiceId =
          response?.voiceId || response?.voice?.id || response?.id
        const nextRefPath = response?.refAudioPath || response?.path
        if (nextVoiceId) {
          setSelectedVoice(nextVoiceId)
        }
        if (nextRefPath) {
          setRefAudioPath(nextRefPath)
          setDirectEngine(true)
        }
      }
    } catch (error) {
      setTrainStatus(`업로드 실패: ${error.message}`)
    }
  }

  const handleSynthesize = async () => {
    if (!isAuthed) {
      setTtsStatus('로그인 후 합성할 수 있습니다.')
      return
    }
    await syncCredits({ allowDecrease: false })
    const canSpend = spendCredits(10)
    const spent = canSpend
    if (!canSpend) {
      setTtsStatus('크래딧이 부족합니다. 필요 시 자동으로 충전합니다.')
    }
    setLoading(true)
    setTtsStatus(null)
    setAudioUrl('')
    try {
      if (!ttsText.trim()) {
        setTtsStatus('합성할 텍스트를 입력하세요.')
        if (spent) {
          addCredits(10)
        }
        setLoading(false)
        return
      }
      if (!selectedVoice) {
        setTtsStatus('내 목소리를 선택하세요.')
        if (spent) {
          addCredits(10)
        }
        setLoading(false)
        return
      }
      const voiceIdValue = Number(selectedVoice)
      const voiceModelId = Number.isFinite(voiceIdValue)
        ? voiceIdValue
        : selectedVoice
      const payload = directEngine
        ? {
            text: ttsText,
            text_lang: ttsLang,
            ref_audio_path: refAudioPath,
            prompt_lang: ttsLang,
            prompt_text: promptText,
          }
        : {
            text: ttsText,
            voice_model_id: voiceModelId,
          }

      const trySynthesize = async () => synthesizeTts(payload, { directEngine })
      let blob
      let retried = false
      let charged = false
      while (true) {
        try {
          blob = await trySynthesize()
          break
        } catch (error) {
          const message = String(error?.message || '')
          const isInsufficient =
            message.includes('잔액 부족') || message.toLowerCase().includes('insufficient')
          if (!retried && isInsufficient) {
            await chargeCredits(CHARGE_AMOUNT)
            await syncCredits({ allowDecrease: false })
            retried = true
            charged = true
            continue
          }
          throw error
        }
      }
      const nextUrl = URL.createObjectURL(blob)
      setAudioUrl(nextUrl)
      setTtsStatus('합성 완료')
    } catch (error) {
      if (!charged && spent) {
        addCredits(10)
      }
      setTtsStatus(`합성 실패: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page stack">
      <div className="main-tabs">
        <button
          className={`main-tab ${mainTab === 'learn' ? 'active' : ''}`}
          type="button"
          onClick={() => setMainTab('learn')}
        >
          학습
        </button>
        <button
          className={`main-tab ${mainTab === 'output' ? 'active' : ''}`}
          type="button"
          onClick={() => setMainTab('output')}
        >
          출력
        </button>
      </div>

      {mainTab === 'learn' ? (
        <Section title="" subtitle="">
          <div className="page-header">
            <h1>Voice Training</h1>
            <p className="page-subtitle">3단계로 쉽고 빠르게 보이스를 등록하세요.</p>
          </div>

          <div className="step-grid">
            <div className="step-card">
              <div className="step-header">
                <span className="step-label">Step 1</span>
                <h2>음성 추가</h2>
              </div>
              <p className="muted">녹음 또는 파일 업로드로 샘플을 준비하세요.</p>
              <div className="step-split">
                <div className="step-panel">
                  <div className="recording-panel">
                    <div className="recording-header">
                      <div
                        className={`recording-status ${
                          isRecording && recordingSupported ? 'live' : ''
                        }`}
                      >
                        <span className="recording-dot" />
                        {recordingSupported
                          ? isRecording
                            ? '녹음 중'
                            : '대기 중'
                          : '녹음 불가'}
                      </div>
                      <div className="recording-timer">
                        {recordingSeconds}s / {maxRecordSeconds}s
                      </div>
                    </div>
                    <div className="recording-progress">
                      <span style={{ width: `${recordingProgress}%` }} />
                    </div>
                    {isRecording ? (
                      <canvas
                        ref={waveCanvasRef}
                        className="recording-wave"
                        width={360}
                        height={56}
                        aria-hidden="true"
                      />
                    ) : null}
                    <div className="recording-actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={startRecording}
                        disabled={!recordingSupported || isRecording}
                      >
                        녹음 시작
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={stopRecording}
                        disabled={!mediaRecorder}
                      >
                        녹음 중지
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={useRecordedAudio}
                        disabled={!recordedBlob}
                      >
                        녹음 사용
                      </button>
                    </div>
                    {recordedUrl ? (
                      <audio className="audio recording-audio" controls src={recordedUrl} />
                    ) : null}
                  </div>
                </div>
                <div className="step-panel">
                  <label className="field-label">파일 업로드</label>
                  <input
                    className="file-input"
                    type="file"
                    accept="audio/*"
                    onChange={handleFileChange}
                  />
                  <p className="muted">권장: 10~30초, 깨끗한 발음</p>
                </div>
              </div>
            </div>

            <div className="step-card">
              <div className="step-header">
                <span className="step-label">Step 2</span>
                <h2>텍스트 입력</h2>
              </div>
              <textarea
                className="train-textarea"
                rows={4}
                value={trainText}
                onChange={(event) => setTrainText(event.target.value)}
                placeholder="예: 안녕하세요. 테스트용 문장입니다."
              />
              <p className="muted">선택 입력 · 더 정확한 발음을 돕습니다.</p>
            </div>

            <div className="step-card">
              <div className="step-header">
                <span className="step-label">Step 3</span>
                <h2>보이스 정보</h2>
              </div>
              <div className="step-fields">
                <input
                  value={trainName}
                  onChange={(event) => setTrainName(event.target.value)}
                  placeholder="보이스 이름"
                />
                <textarea
                  rows={3}
                  value={trainDescription}
                  onChange={(event) => setTrainDescription(event.target.value)}
                  placeholder="보이스 설명 (선택)"
                />
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={trainIsPublic}
                    onChange={(event) => {
                      const nextChecked = event.target.checked
                      setTrainIsPublic(nextChecked)
                      if (!nextChecked) {
                        setTrainPrice('')
                        setTrainPriceError(false)
                      }
                    }}
                  />
                  <span>마켓플레이스에 공개</span>
                </label>
                {trainIsPublic ? (
                  <div className="price-field">
                    <label className="field-label">가격(크레딧)</label>
                    <input
                      className={`price-input ${trainPriceError ? 'input-error' : ''}`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="예: 100"
                      value={trainPrice}
                      onChange={(event) => {
                        const next = event.target.value.replace(/\D/g, '')
                        setTrainPrice(next)
                        if (trainPriceError) setTrainPriceError(false)
                      }}
                    />
                    {trainPriceError ? (
                      <span className="input-helper">가격을 입력하세요</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <button
            className="btn ghost advanced-toggle"
            type="button"
            onClick={() => setShowTrainAdvanced((prev) => !prev)}
          >
            {showTrainAdvanced ? '고급 옵션 숨기기' : '고급 옵션 열기'}
          </button>
          {showTrainAdvanced ? (
            <div className="advanced-panel">
              <label className="inline-field">
                최대 녹음(초)
                <input
                  type="number"
                  min="3"
                  max="60"
                  value={maxRecordSeconds}
                  onChange={(event) => setMaxRecordSeconds(Number(event.target.value))}
                />
              </label>
              <div className="recording-field">
                <span>파일 이름</span>
                <input
                  value={recordedName}
                  onChange={(event) => setRecordedName(event.target.value)}
                  placeholder="예: my-voice-01"
                />
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={linkAsReference}
                  onChange={(event) => setLinkAsReference(event.target.checked)}
                />
                <span>업로드 후 TTS 참조로 연결</span>
              </label>
            </div>
          ) : null}

          <div className="primary-cta-bar">
            <div className="muted">
              선택된 파일: {uploadReady && trainFile ? trainFile.name : '없음'}
            </div>
            <button className="btn primary" type="button" onClick={handleUpload}>
              Train Voice
            </button>
          </div>
          {trainStatus ? <p className="status">{trainStatus}</p> : null}
        </Section>
      ) : (
        <Section title="" subtitle="">
          <div className="page-header">
            <h1>Text to Speech</h1>
            <p className="page-subtitle">원하는 보이스를 선택하고 즉시 합성하세요.</p>
          </div>

          <div className="tts-layout">
            <div className="tts-input">
              <textarea
                rows={8}
                value={ttsText}
                onChange={(event) => setTtsText(event.target.value)}
                placeholder="읽어줄 문장을 입력하세요."
              />
              <div className="tts-meta">
                <label className="inline-field">
                  언어
                  <select value={ttsLang} onChange={(event) => setTtsLang(event.target.value)}>
                    {languages.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted">남은 크래딧 {credits} · 1회 10 크레딧</span>
              </div>
            </div>

            <div className="tts-voices">
              <div className="section-title">
                <h2>보이스 선택</h2>
                <span className="muted">내 보이스와 저장 보이스에서 선택합니다.</span>
              </div>
              <div className="voice-selected-row">
                <div className="voice-selected">
                  {selectedVoice
                    ? normalizedVoices.find((voice) => voice.id === selectedVoice)
                        ? (() => {
                            const current = normalizedVoices.find(
                              (voice) => voice.id === selectedVoice,
                            )
                            if (!current) return '선택됨'
                            return `${current.name}${current.source === 'saved' ? ' (저장)' : ''}`
                          })()
                        : '선택됨'
                    : '보이스를 선택하세요.'}
                </div>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setVoicePickerOpen(true)}
                  disabled={normalizedVoices.length === 0}
                >
                  변경
                </button>
              </div>
              {voicePickerOpen ? (
                <div className="voice-list">
                  {normalizedVoices.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      className={`voice-row ${
                        selectedVoice === voice.id ? 'active' : ''
                      }`}
                      onClick={() => {
                        setSelectedVoice(voice.id)
                        setVoicePickerOpen(false)
                      }}
                    >
                      <span className="voice-name">
                        {voice.name}
                        {voice.source === 'saved' ? ' (저장)' : ''}
                      </span>
                    </button>
                  ))}
                  <button
                    className="btn ghost voice-picker-close"
                    type="button"
                    onClick={() => setVoicePickerOpen(false)}
                  >
                    목록 닫기
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="primary-cta-bar">
            <button
              className="btn primary"
              type="button"
              onClick={handleSynthesize}
              disabled={loading || !isAuthed}
            >
              {!isAuthed ? '로그인 필요' : loading ? '합성 중...' : 'Generate'}
            </button>
            {ttsStatus ? <span className="status">{ttsStatus}</span> : null}
          </div>
          {audioUrl ? <audio className="audio" controls src={audioUrl} /> : null}
        </Section>
      )}
    </div>
  )
}

export default MainPage
