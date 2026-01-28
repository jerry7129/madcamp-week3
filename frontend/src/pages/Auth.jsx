import LoginPage from './Login'

function AuthPage({ mode = 'login' }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <LoginPage initialMode={mode} />
      </div>
    </div>
  )
}

export default AuthPage
