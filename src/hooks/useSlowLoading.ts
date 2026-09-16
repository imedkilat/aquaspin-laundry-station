import { useEffect, useState } from 'react'

export function useSlowLoading(loading: boolean, delayMs = 3000) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return
    }

    const timer = window.setTimeout(() => setSlow(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [loading, delayMs])

  return slow
}
