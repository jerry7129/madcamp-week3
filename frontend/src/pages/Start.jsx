import { NavLink } from 'react-router-dom'

function StartPage() {
  return (
    <div className="start-page">
      <div className="start-card">
        <div className="start-brand">
          <h1>VoxLab</h1>
          <p className="muted">Voice TTS Studio</p>
        </div>
        <p className="start-copy">
          로그인 또는 회원가입 후 서비스를 이용할 수 있습니다.
        </p>
        <div className="start-actions">
          <NavLink to="/login" className="btn primary">
            Login
          </NavLink>
        </div>
      </div>
    </div>
  )
}

export default StartPage
