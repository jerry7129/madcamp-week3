import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../api'
import Section from '../components/Section'
import Field from '../components/Field'

const GOOGLE_AUTH_URL = import.meta.env.VITE_GOOGLE_AUTH_URL
const KAKAO_AUTH_URL = import.meta.env.VITE_KAKAO_AUTH_URL

function LoginPage({ initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const isSignup = mode === 'signup'
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileImage, setProfileImage] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleOAuthRedirect = (provider) => {
    const target = provider === 'google' ? GOOGLE_AUTH_URL : KAKAO_AUTH_URL
    if (!target) {
      setStatus(`${provider} 로그인 주소가 설정되지 않았습니다.`)
      return
    }
    window.location.href = target
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    const extractToken = (data) =>
      data?.access_token || data?.token || data?.accessToken || data?.token?.access_token
    try {
      if (isSignup) {
        if (password !== confirmPassword) {
          setStatus('비밀번호가 일치하지 않습니다.')
          setLoading(false)
          return
        }
        const data = await register({
          email,
          password,
          nickname,
          profileImage,
        })
        setStatus(`회원가입 완료: ${data?.user?.username || email}`)
        const token = extractToken(data)
        if (token) {
          localStorage.setItem('token', token)
        }
        if (data?.user?.nickname || nickname) {
          localStorage.setItem('nickname', data?.user?.nickname || nickname)
        }
        const nextEmail =
          data?.user?.username || data?.user?.email || email || ''
        if (nextEmail) {
          localStorage.setItem('email', nextEmail)
        }
        setProfileImage(null)
        setMode('login')
        navigate('/login')
      } else {
        const data = await login({ email, password })
        setStatus(`로그인 성공: ${data?.user?.email || email || '성공'}`)
        const token = extractToken(data)
        if (token) {
          localStorage.setItem('token', token)
        }
        if (data?.user?.nickname) {
          localStorage.setItem('nickname', data.user.nickname)
        }
        const nextEmail =
          data?.user?.email || data?.user?.username || email || ''
        if (nextEmail) {
          localStorage.setItem('email', nextEmail)
        }
        navigate('/main')
      }
    } catch (error) {
      setStatus(
        `${isSignup ? '회원가입' : '로그인'} 실패: ${error.message}`,
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  return (
    <div className="page login-page">
      <Section
        title={isSignup ? '회원가입' : '로그인'}
        subtitle={
          isSignup
            ? '간단한 정보로 계정을 생성합니다.'
            : '계정이 없다면 회원가입을 진행하세요.'
        }
      >
        <form onSubmit={handleSubmit} className="form">
          {isSignup ? (
            <>
              <Field label="닉네임">
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="표시할 이름"
                  required
                />
              </Field>
              <Field label="프로필 이미지 (선택)">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setProfileImage(event.target.files?.[0] || null)}
                />
              </Field>
            </>
          ) : null}
          <Field label="이메일">
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="비밀번호">
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {isSignup ? (
            <Field label="비밀번호 확인">
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>
          ) : null}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading
              ? isSignup
                ? '회원가입 중...'
                : '로그인 중...'
              : isSignup
                ? '회원가입'
                : '로그인'}
          </button>
          <div className="login-toggle">
            <span className="muted">
              {isSignup ? '이미 계정이 있나요?' : '계정이 없나요?'}
            </span>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setStatus(null)
                const nextMode = isSignup ? 'login' : 'signup'
                setMode(nextMode)
                navigate(nextMode === 'login' ? '/login' : '/signup')
              }}
            >
              {isSignup ? '로그인으로 돌아가기' : '회원가입'}
            </button>
          </div>
          {status ? <p className="status">{status}</p> : null}
        </form>
      </Section>
    </div>
  )
}

export default LoginPage
