import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { fetchCredits } from '../api'

const STORAGE_KEY = 'tts-credits'
const DEFAULT_CREDITS = 30
const DISABLE_LIMIT =
  import.meta.env.VITE_DISABLE_CREDIT_LIMIT === 'true' || import.meta.env.DEV

const readStoredCredits = () => {
  if (typeof window === 'undefined') return DEFAULT_CREDITS
  const raw = localStorage.getItem(STORAGE_KEY)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_CREDITS
}

const CreditContext = createContext(null)

export function CreditProvider({ children }) {
  const [credits, setCredits] = useState(() => readStoredCredits())

  // 1. Persist to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(credits))
  }, [credits])

  // 2. Sync from Server (on mount & focus)
  useEffect(() => {
    let cancelled = false
    const syncCreditsFromServer = async () => {
      try {
        const serverCredits = await fetchCredits()
        if (!cancelled && Number.isFinite(serverCredits)) {
          setCredits(serverCredits)
        }
      } catch {
        // ignore errors
      }
    }
    
    syncCreditsFromServer()
    
    const handleFocus = () => syncCreditsFromServer()
    window.addEventListener('focus', handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  // 3. Sync from other tabs (storage event) is optional but good
  useEffect(() => {
    const handleStorage = (event) => {
      if (event?.key && event.key !== STORAGE_KEY) return
      const next = readStoredCredits()
      setCredits((prev) => (prev === next ? prev : next))
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const spendCredits = (amount = 1) => {
    if (DISABLE_LIMIT) {
      setCredits((prev) => Math.max(prev - amount, 0))
      return true
    }
    let success = false
    setCredits((prev) => {
      if (prev < amount) return prev
      success = true
      return prev - amount
    })
    return success
  }

  const addCredits = (amount = 1) => {
    setCredits((prev) => prev + amount)
  }

  // Value object memoized to prevent unnecessary re-renders
  const value = useMemo(() => ({
    credits,
    spendCredits,
    addCredits,
    setCredits
  }), [credits])

  return (
    <CreditContext.Provider value={value}>
      {children}
    </CreditContext.Provider>
  )
}

function useCredits() {
  const context = useContext(CreditContext)
  if (!context) {
    // If used outside provider, behave like a local state (backward compatibility fallback or error)
    // For safety, let's just return a local state dummy to prevent crash, but strictly it should be wrapped.
    // However, since we are wrapping App, this should be fine.
    // Retaining old logic as fallback would be complex. Let's warn.
    console.warn('useCredits must be used within a CreditProvider')
    return { credits: 0, spendCredits: () => false, addCredits: () => {}, setCredits: () => {} }
  }
  return context
}

export default useCredits
