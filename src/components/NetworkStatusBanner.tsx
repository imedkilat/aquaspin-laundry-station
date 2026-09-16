import { useEffect, useState } from 'react'

export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300" role="alert">
      No internet connection. You can review data already on screen, but avoid saving changes until the connection returns.
    </div>
  )
}
