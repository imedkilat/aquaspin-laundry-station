import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'

const CONSENT_KEY = 'aquaspin-analytics-consent'
type Consent = 'accepted' | 'declined' | null

function readConsent(): Consent {
  try {
    const stored = localStorage.getItem(CONSENT_KEY)
    return stored === 'accepted' || stored === 'declined' ? stored : null
  } catch {
    return null
  }
}

export default function AnalyticsConsent() {
  const [consent, setConsent] = useState<Consent>(readConsent)

  const choose = (choice: Exclude<Consent, null>) => {
    try {
      localStorage.setItem(CONSENT_KEY, choice)
    } catch {
      // If storage is unavailable, honor this choice for the current page only.
    }
    setConsent(choice)
  }

  return (
    <>
      {consent === 'accepted' && <Analytics />}
      {consent === null && (
        <aside className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95" aria-label="Analytics consent">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-700 dark:text-slate-200">We use anonymous analytics only. <Link className="font-medium text-sky-700 underline dark:text-sky-300" to="/privacy">Read our Privacy Policy</Link>.</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => choose('declined')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Decline</button>
              <button type="button" onClick={() => choose('accepted')} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">Accept</button>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
