import { useEffect, useState } from 'react'
import { fetchCredits } from '../api'

const STORAGE_KEY = 'tts-credits'
const DEFAULT_CREDITS = 30
const DISABLE_LIMIT =
  import.meta.env.VITE_DISABLE_CREDIT_LIMIT === 'true' || import.meta.env.DEV

const readStoredCredits = () => {
  const raw = localStorage.getItem(STORAGE_KEY)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_CREDITS
}

function useCredits(initialCredits = DEFAULT_CREDITS) {
  const [credits, setCredits] = useState(() => {
    if (typeof window === 'undefined') return initialCredits
    return readStoredCredits()
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, String(credits))
    window.dispatchEvent(new Event('credits-changed'))
  }, [credits])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let cancelled = false
    const syncCreditsFromServer = async () => {
      try {
        const serverCredits = await fetchCredits()
        if (!cancelled && Number.isFinite(serverCredits)) {
          setCredits(serverCredits)
        }
      } catch {
        // ignore sync errors to avoid blocking UI
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncFromStorage = () => {
      const next = readStoredCredits()
      setCredits((prev) => (prev === next ? prev : next))
    }
    const handleStorage = (event) => {
      if (event?.key && event.key !== STORAGE_KEY) return
      syncFromStorage()
    }
    window.addEventListener('credits-changed', syncFromStorage)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('credits-changed', syncFromStorage)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const spendCredits = (amount = 1) => {
    if (DISABLE_LIMIT) {
      setCredits((prev) => Math.max(prev - amount, 0))
      return true
    }
    if (credits < amount) return false
    setCredits(credits - amount)
    return true
  }

  const addCredits = (amount = 1) => {
    setCredits((prev) => prev + amount)
  }

  return { credits, spendCredits, addCredits, setCredits }
}

export default useCredits
