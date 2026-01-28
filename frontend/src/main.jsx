import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (typeof window !== 'undefined') {
  localStorage.removeItem('voice-tags-map')
}

import { CreditProvider } from './hooks/useCredits'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CreditProvider>
      <App />
    </CreditProvider>
  </StrictMode>,
)
