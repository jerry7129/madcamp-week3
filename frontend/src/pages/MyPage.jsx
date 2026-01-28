import { useEffect, useMemo, useRef, useState } from 'react'
import Section from '../components/Section'
import Field from '../components/Field'
import {
  deleteVoice,
  fetchMe,
  fetchMyVoices,
  fetchSavedVoiceList,
  shareVoice,
  unsaveVoiceModel,
  updateProfile,
} from '../api'
import { APP_API_BASE_URL } from '../api/client'
import useCredits from '../hooks/useCredits'
import { getDescriptionsMap, setVoiceDescription } from '../utils/voiceDescriptions'

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

const SHARED_KEY = 'shared-voice-ids'

const readJsonList = (key, fallback = []) => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch (error) {
    return fallback
  }
}

const normalizeId = (value) =>
  value === 0 || value ? String(value) : ''

const resolveAvatarUrl = (raw) => {
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw
  if (raw.startsWith('/')) return `${APP_API_BASE_URL}${raw}`
  return `${APP_API_BASE_URL}/${raw}`
}

const getCreatorInfo = (voice) => {
  const nickname =
    voice?.creator_name ||
    voice?.creatorName ||
    voice?.uploaderNickname ||
    voice?.uploader_nickname ||
    voice?.creator?.nickname ||
    voice?.creator?.name ||
    voice?.creator?.username ||
    voice?.uploader?.nickname ||
    voice?.uploader?.name ||
    ''
  const avatar =
    voice?.creator_profile_image ||
    voice?.creator_profile_image_url ||
    voice?.creatorProfileImage ||
    voice?.creatorProfileImageUrl ||
    voice?.uploaderProfileImageUrl ||
    voice?.uploader_profile_image_url ||
    voice?.creator?.profile_image ||
    voice?.creator?.profile_image_url ||
    voice?.creator?.avatar ||
    voice?.uploader?.profile_image ||
    voice?.uploader?.avatar ||
    ''
  return {
    nickname,
    avatarUrl: resolveAvatarUrl(avatar),
  }
}

const getModelId = (voice, fallback) => {
  const raw =
    voice?.model_id ||
    voice?.modelId ||
    voice?.voiceId ||
    voice?._id ||
    voice?.id ||
    fallback
  const normalized = normalizeId(raw)
  return normalized && /^[0-9]+$/.test(normalized) ? normalized : null
}

const readSharedIds = () => readJsonList(SHARED_KEY, []).map(normalizeId).filter(Boolean)
const writeSharedIds = (ids) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(SHARED_KEY, JSON.stringify(ids))
}

const getActionVoiceId = (voice, index) => {
  const raw =
    voice?.model_id ||
    voice?.modelId ||
    voice?.voiceId ||
    voice?.id ||
    voice?._id ||
    `voice-${index}`
  const normalized = normalizeId(raw)
  return normalized || `voice-${index}`
}


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

function MyPage() {
  const [voices, setVoices] = useState([])
  const [voiceStatus, setVoiceStatus] = useState(null)
  const [profileStatus, setProfileStatus] = useState(null)
  const { credits, setCredits } = useCredits()
  const fileInputRef = useRef(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [profileNickname, setProfileNickname] = useState('USERNAME')
  const [profileEmail, setProfileEmail] = useState('AAAAAAA@aaaaaa.com')
  const [editMode, setEditMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expandedVoiceId, setExpandedVoiceId] = useState(null)
  const [emailPassword, setEmailPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [descriptionMap, setDescriptionMap] = useState(() => getDescriptionsMap())
  const [descriptionDrafts, setDescriptionDrafts] = useState({})
  const [, setSharedVoiceIds] = useState(() => readSharedIds())
  const [savedVoices, setSavedVoices] = useState([])
  const [savedStatus, setSavedStatus] = useState(null)
  const initialPreset = readPresetSettings()
  const [presetName, setPresetName] = useState(initialPreset.presetName)
  const [presetId, setPresetId] = useState(initialPreset.presetId)
  const [gptModel, setGptModel] = useState(initialPreset.gptModel)
  const [sovitsModel, setSovitsModel] = useState(initialPreset.sovitsModel)
  const [ttsVoiceId, setTtsVoiceId] = useState(
    (typeof window !== 'undefined' && localStorage.getItem('tts-voice-id')) || '',
  )

  const getVoiceId = (voice, index) =>
    voice?.id || voice?.voiceId || voice?._id || `voice-${index}`

  const buildTtsOptions = (myList, savedList) => {
    const options = []
    const seen = new Set()
    myList.forEach((voice, index) => {
      const id = getModelId(voice, getVoiceId(voice, index))
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
      const id = getModelId(voice, `saved-${index}`)
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

  const ttsVoiceOptions = useMemo(
    () => buildTtsOptions(voices, savedVoices),
    [voices, savedVoices],
  )

  useEffect(() => {
    const load = async () => {
      const [voiceResult, meResult, savedResult] = await Promise.allSettled([
        fetchMyVoices(),
        fetchMe(),
        fetchSavedVoiceList(),
      ])
      let myItems = []
      let savedItems = []
      if (voiceResult.status === 'fulfilled') {
        const voiceData = voiceResult.value
        myItems = Array.isArray(voiceData)
          ? voiceData
          : voiceData?.items || voiceData?.voices || []
        setVoices(myItems)
      } else {
        setVoiceStatus(`목소리 불러오기 실패: ${voiceResult.reason?.message || '오류'}`)
      }
      if (meResult.status === 'fulfilled') {
        const me = meResult.value
        if (me?.nickname) {
          setProfileNickname(me.nickname)
          localStorage.setItem('nickname', me.nickname)
        }
        const nextEmail = me?.email || me?.username
        if (nextEmail) {
          setProfileEmail(nextEmail)
          localStorage.setItem('email', nextEmail)
        }
        const rawAvatar =
          me?.profile_image || me?.profileImage || me?.avatar || me?.avatar_url || me?.avatarUrl
        if (rawAvatar) {
          setAvatarUrl(resolveAvatarUrl(rawAvatar))
        }
        const creditCandidate =
          me?.credit_balance ?? me?.credits ?? me?.credit ?? me?.balance ?? me?.points
        if (Number.isFinite(Number(creditCandidate))) {
          setCredits(Number(creditCandidate))
        }
      } else {
        setProfileStatus(
          `내 정보 불러오기 실패: ${meResult.reason?.message || '오류'}`,
        )
      }
      if (savedResult.status === 'fulfilled') {
        const savedItemsRaw = Array.isArray(savedResult.value)
          ? savedResult.value
          : savedResult.value?.items || savedResult.value?.voices || savedResult.value || []
        savedItems = Array.isArray(savedItemsRaw) ? savedItemsRaw : []
        setSavedVoices(savedItems)
      } else {
        setSavedVoices([])
      }
      if (!ttsVoiceId) {
        const combined = buildTtsOptions(myItems, savedItems)
        if (combined.length > 0) {
          const nextId = combined[0].id
          setTtsVoiceId(nextId)
          localStorage.setItem('tts-voice-id', nextId)
        }
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('voice-tags-map')
    }
  }, [])

  useEffect(() => {
    const syncDescriptions = () => setDescriptionMap(getDescriptionsMap())
    window.addEventListener('focus', syncDescriptions)
    return () => window.removeEventListener('focus', syncDescriptions)
  }, [])

  useEffect(() => {
    const syncSaved = () => {
      fetchSavedVoiceList()
        .then((data) => {
          const items = Array.isArray(data) ? data : []
          setSavedVoices(items)
        })
        .catch(() => setSavedVoices([]))
    }
    window.addEventListener('focus', syncSaved)
    return () => window.removeEventListener('focus', syncSaved)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('presetName', presetName)
    localStorage.setItem('presetId', presetId)
    localStorage.setItem('gptModel', gptModel)
    localStorage.setItem('sovitsModel', sovitsModel)
  }, [presetName, presetId, gptModel, sovitsModel])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (ttsVoiceId) {
      localStorage.setItem('tts-voice-id', ttsVoiceId)
    }
  }, [ttsVoiceId])

  const applyPreset = (optionId) => {
    const nextPreset =
      presetOptions.find((option) => option.id === optionId) ||
      presetOptions[0]
    setPresetId(nextPreset.id)
    setPresetName(nextPreset.name)
    setGptModel(nextPreset.gptModel)
    setSovitsModel(nextPreset.sovitsModel)
  }

  const handleShare = async (voiceId, voiceData) => {
    const currentlyPublic = Boolean(voiceData?.is_public || voiceData?.isPublic)
    const nextPublic = !currentlyPublic
    try {
      await shareVoice(voiceId, nextPublic)
      setVoices((prev) =>
        prev.map((voice, index) => {
          const id = getVoiceId(voice, index)
          if (id !== voiceId) return voice
          return { ...voice, is_public: nextPublic, isPublic: nextPublic }
        }),
      )
      setSharedVoiceIds((prev) => {
        const normalized = normalizeId(voiceId)
        if (!normalized) return prev
        if (nextPublic) {
          if (prev.includes(normalized)) return prev
          const next = [...prev, normalized]
          writeSharedIds(next)
          return next
        }
        const next = prev.filter((id) => id !== normalized)
        writeSharedIds(next)
        return next
      })
      window.dispatchEvent(
        new CustomEvent('shared-voices-updated', {
          detail: { voiceId, isPublic: nextPublic },
        }),
      )
      setVoiceStatus(nextPublic ? '공유 설정 완료' : '미공개로 전환되었습니다.')
    } catch (error) {
      setVoiceStatus(`${nextPublic ? '공유' : '미공개'} 실패: ${error.message}`)
    }
  }

  const handleDelete = async (voiceId) => {
    const confirmDelete = window.confirm('이 보이스를 삭제하시겠습니까?')
    if (!confirmDelete) return
    try {
      await deleteVoice(voiceId)
      setVoices((prev) => {
        const next = prev.filter((voice, index) => getVoiceId(voice, index) !== voiceId)
        if (ttsVoiceId === voiceId) {
          const nextId = next.length > 0 ? getVoiceId(next[0], 0) : ''
          setTtsVoiceId(nextId)
          if (nextId) {
            localStorage.setItem('tts-voice-id', nextId)
          } else {
            localStorage.removeItem('tts-voice-id')
          }
        }
        return next
      })
      setDescriptionMap(setVoiceDescription(voiceId, null))
      setVoiceStatus('삭제 완료')
    } catch (error) {
      setVoiceStatus(`삭제 실패: ${error.message}`)
    }
  }

  const handleSavedRemove = async (voiceId, voiceData) => {
    const normalized = getModelId(voiceData, voiceId)
    if (!normalized) {
      setSavedStatus('저장 해제 가능한 모델 ID가 없습니다.')
      return
    }
    const previous = savedVoices
    const next = previous.filter(
      (voice, index) =>
        normalizeId(
          voice?.id || voice?.model_id || voice?.modelId || voice?.voiceId || voice?._id || `saved-${index}`,
        ) !== normalized,
    )
    setSavedVoices(next)
    try {
      await unsaveVoiceModel(normalized)
      setSavedStatus('저장 해제 완료')
      const refreshed = await fetchSavedVoiceList().catch(() => null)
      if (refreshed && Array.isArray(refreshed)) {
        setSavedVoices(refreshed)
      }
    } catch (error) {
      setSavedVoices(previous)
      setSavedStatus(`저장 해제 실패: ${error.message}`)
    }
  }

  const handleDescriptionSave = (voiceId) => {
    const draft = descriptionDrafts[voiceId]
    const next = draft == null ? '' : String(draft).trim()
    setDescriptionMap(setVoiceDescription(voiceId, next))
    setDescriptionDrafts((prev) => ({ ...prev, [voiceId]: undefined }))
    setVoiceStatus('설명 저장 완료')
  }

  const handleProfileSave = async () => {
    const nextEmail = profileEmail.trim()
    const nextNickname = profileNickname.trim()
    const token =
      (typeof window !== 'undefined' && localStorage.getItem('token')) || ''
    if (!token) {
      setProfileStatus('로그인 후 다시 시도하세요.')
      return
    }
    if (!nextNickname) {
      setProfileStatus('닉네임을 입력하세요.')
      return
    }
    if (!nextEmail) {
      setProfileStatus('이메일을 입력하세요.')
      return
    }
    const storedEmail =
      (typeof window !== 'undefined' && localStorage.getItem('email')) || ''
    if (storedEmail && storedEmail !== nextEmail && !emailPassword.trim()) {
      setProfileStatus('이메일 변경 시 비밀번호를 입력하세요.')
      return
    }
    setSavingProfile(true)
    setProfileStatus(null)
    try {
      const payload = {
        nickname: nextNickname,
        email: nextEmail,
      }
      if (storedEmail && storedEmail !== nextEmail) {
        payload.password = emailPassword
      }
      const result = await updateProfile(payload)
      const updatedNickname = result?.nickname || nextNickname
      const updatedEmail = result?.email || result?.username || nextEmail
      setProfileNickname(updatedNickname)
      setProfileEmail(updatedEmail)
      localStorage.setItem('nickname', updatedNickname)
      localStorage.setItem('email', updatedEmail)
      setEmailPassword('')
      setEditMode(false)
      setProfileStatus('정보 수정 완료')
    } catch (error) {
      setProfileStatus(`정보 수정 실패: ${error.message}`)
    } finally {
      setSavingProfile(false)
    }
  }

  const handleProfileCancel = () => {
    const storedNickname =
      (typeof window !== 'undefined' && localStorage.getItem('nickname')) ||
      profileNickname
    const storedEmail =
      (typeof window !== 'undefined' && localStorage.getItem('email')) ||
      profileEmail
    setProfileNickname(storedNickname)
    setProfileEmail(storedEmail)
    setEmailPassword('')
    setEditMode(false)
    setProfileStatus(null)
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setAvatarUrl(previewUrl)
    setProfileStatus('프로필 이미지 저장 중...')
    updateProfile({ profileImage: file })
      .then((result) => {
        const rawAvatar =
          result?.profile_image ||
          result?.profileImage ||
          result?.avatar ||
          result?.avatar_url ||
          result?.avatarUrl
        if (rawAvatar) {
          setAvatarUrl(resolveAvatarUrl(rawAvatar))
        }
        setProfileStatus('프로필 이미지가 저장되었습니다.')
      })
      .catch((error) => {
        setProfileStatus(`프로필 이미지 저장 실패: ${error.message}`)
      })
      .finally(() => {
        URL.revokeObjectURL(previewUrl)
      })
  }

  const toggleVoiceEdit = (voiceId) => {
    setExpandedVoiceId((prev) => (prev === voiceId ? null : voiceId))
  }

  return (
    <div className="page mypage">
      <Section title="" subtitle="">
        <div className="mypage-header">
          <div>
            <h1>My Page</h1>
            <p className="page-subtitle">내 정보와 기본 설정을 관리합니다.</p>
          </div>
        </div>

        <div className="profile-card profile-card-compact">
          <div className="profile-media">
            <div className="profile-avatar profile-avatar-editable">
              {avatarUrl ? (
                <img src={avatarUrl} alt="프로필 사진" />
              ) : null}
              <button
                className="avatar-edit-btn"
                type="button"
                onClick={handleAvatarClick}
                aria-label="프로필 이미지 변경"
              >
                ✎
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div className="profile-info">
            {editMode ? (
              <div className="profile-edit">
                <Field label="닉네임">
                  <input
                    value={profileNickname}
                    onChange={(event) => setProfileNickname(event.target.value)}
                  />
                </Field>
                <Field label="이메일">
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(event) => setProfileEmail(event.target.value)}
                  />
                </Field>
                <Field label="비밀번호" hint="이메일 변경 시 필수">
                  <input
                    type="password"
                    value={emailPassword}
                    onChange={(event) => setEmailPassword(event.target.value)}
                    placeholder="비밀번호 입력"
                  />
                </Field>
              </div>
            ) : (
              <>
                <h3>{profileNickname}</h3>
                <p className="muted">{profileEmail}</p>
                <p className="muted">보유 크레딧: {credits}</p>
              </>
            )}
          </div>
          <div className="profile-actions">
            {editMode ? (
              <>
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleProfileSave}
                  disabled={savingProfile}
                >
                  {savingProfile ? '저장 중...' : '저장'}
                </button>
                <button className="btn ghost" type="button" onClick={handleProfileCancel}>
                  취소
                </button>
              </>
            ) : (
              <button className="btn" type="button" onClick={() => setEditMode(true)}>
                정보 수정
              </button>
            )}
          </div>
        </div>
        {profileStatus ? <p className="status">{profileStatus}</p> : null}
      </Section>
      <Section title="" subtitle="">
        <div className="settings-card">
          <div className="settings-header">
            <div>
              <h2>기본 설정</h2>
              <p className="muted">메인 화면에 적용될 기본 프리셋입니다.</p>
            </div>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
            >
              {settingsOpen ? '닫기' : '설정 변경'}
            </button>
          </div>
          {!settingsOpen ? (
            <div className="settings-summary">
              <div>
                <span className="muted">프리셋</span>
                <strong>{presetName}</strong>
              </div>
              <div>
                <span className="muted">GPT 모델</span>
                <strong>{gptModel}</strong>
              </div>
              <div>
                <span className="muted">SoVITS 모델</span>
                <strong>{sovitsModel}</strong>
              </div>
            </div>
          ) : (
            <div className="grid">
          <Field label="프리셋 이름">
            <input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </Field>
          <Field label="프리셋 선택" hint="드롭다운에서 자동 채우기">
            <select
              value={presetId}
              onChange={(event) => applyPreset(event.target.value)}
            >
              {presetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="GPT 모델">
            <div className="field-row">
              <input
                value={gptModel}
                onChange={(event) => setGptModel(event.target.value)}
                placeholder="예: s1bert25hz-...ckpt"
              />
              <button
                className="btn"
                type="button"
                onClick={() => applyPreset(presetId)}
              >
                자동
              </button>
            </div>
          </Field>
          <Field label="SoVITS 모델">
            <div className="field-row">
              <input
                value={sovitsModel}
                onChange={(event) => setSovitsModel(event.target.value)}
                placeholder="예: s2Gv4.pth"
              />
              <button
                className="btn"
                type="button"
                onClick={() => applyPreset(presetId)}
              >
                자동
              </button>
            </div>
          </Field>
          <div className="tts-voice-field">
            <label>대화용 TTS 음성 선택</label>
            <p className="muted">
              대화 탭에서 답변을 읽어줄 기본 음성을 선택합니다. (내 보이스 + 저장 보이스)
            </p>
            {ttsVoiceOptions.length === 0 ? (
              <p className="muted">등록된 음성이 없습니다.</p>
            ) : (
              <select
                value={ttsVoiceId}
                onChange={(event) => setTtsVoiceId(event.target.value)}
              >
                {ttsVoiceOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                    {voice.source === 'saved' ? ' (저장)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          </div>
          )}
        </div>
      </Section>
      <Section title="" subtitle="">
        <div className="voice-manage-header">
          <div>
            <h2>내 보이스 관리</h2>
            <p className="muted">내가 만든 보이스를 빠르게 관리합니다.</p>
          </div>
        </div>
        {voiceStatus ? <p className="status">{voiceStatus}</p> : null}
        {voices.length === 0 ? (
          <p className="muted">등록된 음성이 없습니다.</p>
        ) : (
          <div className="voice-list">
            {voices.map((voice, index) => {
              const id = getVoiceId(voice, index)
              const actionId = getActionVoiceId(voice, index)
              const title =
                voice.model_name ||
                voice.name ||
                voice.title ||
                voice.voiceName ||
                `내 음성 ${index + 1}`
              const hasLocalDescription = Object.prototype.hasOwnProperty.call(
                descriptionMap,
                id,
              )
              const fallbackDescription =
                voice.description ||
                voice.summary ||
                voice.memo ||
                voice.desc ||
                voice.text ||
                '설명 없음'
              const description = hasLocalDescription
                ? descriptionMap[id] || ''
                : fallbackDescription === '설명 없음'
                  ? ''
                  : fallbackDescription
              const displayDescription = description || '설명 없음'
              const draftValue =
                descriptionDrafts[id] ??
                (hasLocalDescription ? descriptionMap[id] : fallbackDescription)
              const isExpanded = expandedVoiceId === id
              const isPublic = Boolean(voice?.is_public ?? voice?.isPublic)
              return (
              <div key={id} className={`voice-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="voice-main">
                  <div className="voice-info">
                    <div className="voice-title-row">
                      <strong>{title}</strong>
                      <span className={`voice-status ${isPublic ? 'on' : 'off'}`}>
                        {isPublic ? '공유중' : '비공개'}
                      </span>
                    </div>
                    {!isExpanded ? (
                      <>
                        <p className={`voice-desc ${description ? '' : 'muted'}`}>
                          {displayDescription}
                        </p>
                      </>
                    ) : null}
                  </div>
                  <div className="voice-actions">
                    <button
                      className="btn btn-action neutral"
                      type="button"
                      onClick={() => toggleVoiceEdit(id)}
                    >
                      {isExpanded ? '닫기' : '편집'}
                    </button>
                    <button
                      className="btn btn-action neutral"
                      type="button"
                      onClick={() => handleShare(actionId, voice)}
                    >
                      {isPublic ? '미공개' : '공유'}
                    </button>
                    <button
                      className="btn btn-action danger"
                      type="button"
                      onClick={() => handleDelete(actionId)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="voice-edit">
                    <div className="edit-row">
                      <input
                        value={draftValue || ''}
                        onChange={(event) =>
                          setDescriptionDrafts((prev) => ({
                            ...prev,
                            [id]: event.target.value,
                          }))
                        }
                        placeholder="설명 수정"
                      />
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => handleDescriptionSave(id)}
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )})}
          </div>
        )}
        <div className="voice-saved">
          <div className="voice-manage-header">
            <div>
              <h2>저장한 보이스</h2>
              <p className="muted">공유 탭에서 저장한 보이스입니다.</p>
            </div>
          </div>
          {savedStatus ? <p className="status">{savedStatus}</p> : null}
          {savedVoices.length === 0 ? (
            <p className="muted">저장한 보이스가 없습니다.</p>
          ) : (
            <div className="voice-list">
              {savedVoices.map((voice, index) => {
                const id = normalizeId(
                  voice?.id ||
                    voice?.model_id ||
                    voice?.modelId ||
                    voice?.voiceId ||
                    voice?._id ||
                    `saved-${index}`,
                )
                const title =
                  voice?.title ||
                  voice?.model_name ||
                  voice?.name ||
                  voice?.voiceName ||
                  `저장 보이스 ${index + 1}`
                const hasLocalDescription = Object.prototype.hasOwnProperty.call(
                  descriptionMap,
                  id,
                )
                const fallbackDescription =
                  voice?.description ||
                  voice?.subtitle ||
                  voice?.summary ||
                  voice?.memo ||
                  voice?.desc ||
                  voice?.text ||
                  ''
                const description = hasLocalDescription
                  ? descriptionMap[id] || ''
                  : fallbackDescription === '설명 없음'
                    ? ''
                    : fallbackDescription
                const displayDescription = description || '설명 없음'
                const creatorInfo = getCreatorInfo(voice)
                return (
                  <div key={id} className="voice-card compact">
                    <div className="voice-main">
                      <div className="saved-voice-header">
                        <div className="saved-voice-left">
                          <span className="saved-voice-title" title={title}>
                            {title}
                          </span>
                          {creatorInfo.nickname || creatorInfo.avatarUrl ? (
                            <div className="saved-voice-creator">
                              {creatorInfo.avatarUrl ? (
                                <img
                                  className="saved-voice-avatar"
                                  src={creatorInfo.avatarUrl}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                <span className="saved-voice-avatar fallback">👤</span>
                              )}
                              <span className="saved-voice-name">
                                {creatorInfo.nickname || '알 수 없음'}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <button
                          className="saved-voice-unsave"
                          type="button"
                          onClick={() => handleSavedRemove(id, voice)}
                        >
                          저장 해제
                        </button>
                      </div>
                        <p className="muted">{displayDescription}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

export default MyPage
