import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { fetchMe } from '../api'
import { APP_API_BASE_URL } from '../api/client'
import useCredits from '../hooks/useCredits'

const navItems = [
  { to: '/main', label: '메인' },
  { to: '/share', label: '공유' },
  { to: '/chat', label: '대화' },
  { to: '/minigame', label: '미니게임' },
]

function Layout() {
  const { credits } = useCredits()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('닉네임')
  const [avatarUrl, setAvatarUrl] = useState('')

  const resolveAvatarUrl = (raw) => {
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw
    if (raw.startsWith('/')) return `${APP_API_BASE_URL}${raw}`
    return `${APP_API_BASE_URL}/${raw}`
  }

  useEffect(() => {
    let cancelled = false
    const loadProfile = async () => {
      try {
        const me = await fetchMe()
        if (cancelled) return
        if (me?.nickname) {
          setNickname(me.nickname)
        } else if (me?.username) {
          setNickname(me.username)
        }
        const rawAvatar =
          me?.profile_image || me?.profileImage || me?.avatar || me?.avatar_url || me?.avatarUrl
        if (rawAvatar) {
          setAvatarUrl(resolveAvatarUrl(rawAvatar))
        } else {
          setAvatarUrl('')
        }
      } catch {
        // ignore to keep layout stable
      }
    }
    loadProfile()
    const handleFocus = () => loadProfile()
    window.addEventListener('focus', handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleLogout = () => {
    if (typeof window === 'undefined') return
    localStorage.removeItem('token')
    localStorage.removeItem('access_token')
    localStorage.removeItem('nickname')
    localStorage.removeItem('email')
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">VoxLab</span>
          <span className="brand-sub">Voice TTS Studio</span>
        </div>
        <div className="header-actions">
          <button className="btn logout-btn" type="button" onClick={handleLogout}>
            <span className="logout-icon" aria-hidden="true">
              ⎋
            </span>
            로그아웃
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-hero">
            <div className="sidebar-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="프로필 사진" /> : null}
            </div>
            <p className="sidebar-name">{nickname}</p>
            <p className="sidebar-credit">보유 크레딧: {credits}</p>
            <NavLink to="/mypage" className="sidebar-cta">
              My Page
            </NavLink>
          </div>
          <nav className="side-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'side-link side-link-active' : 'side-link'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
