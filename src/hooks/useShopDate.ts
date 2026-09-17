import { useEffect, useState } from 'react'
import { shopDate } from '../lib/date'

export function useShopDate() {
  const [today, setToday] = useState(shopDate())

  useEffect(() => {
    const refresh = () => {
      const current = shopDate()
      setToday((previous) => (previous === current ? previous : current))
    }

    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return today
}
