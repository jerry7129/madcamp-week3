import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import StartPage from './pages/Start'
import AuthPage from './pages/Auth'
import LoginPage from './pages/Login'
import MainPage from './pages/Main'
import MyPage from './pages/MyPage'
import SharePage from './pages/Share'
import ChatPage from './pages/Chat'
import MiniGamePage from './pages/MiniGame'
import NotFoundPage from './pages/NotFound'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route element={<Layout />}>
          <Route path="/main" element={<MainPage />} />
          <Route path="/login-legacy" element={<LoginPage />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/minigame" element={<MiniGamePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
