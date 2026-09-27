import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SHOP_NAME } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import ThemeToggle from '../components/ThemeToggle'
import { ButtonSpinner, InlineAlert } from '../components/UiFeedback'

const friendlyLoginError = (message: string) => {
  const lower = message.toLowerCase()
  if (lower.includes('banned')) return 'This account has been disabled by the Owner. Please contact the shop Owner if you need access.'
  if (lower.includes('invalid login credentials')) return 'Email or password is incorrect. Please check the credentials and try again.'
  if (lower.includes('fetch') || lower.includes('network')) return 'Aquaspin could not reach the server. Check the internet connection and try again.'
  return message
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const attempts = useRef<number[]>([])
  const { accessNotice } = useAuth()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const honeypot = form.elements.namedItem('website') as HTMLInputElement | null
    if (honeypot?.value.trim()) return

    const now = Date.now()
    if (now < cooldownUntil) {
      setError(`Too many sign-in attempts. Please wait ${Math.ceil((cooldownUntil - now) / 1000)} seconds and try again.`)
      return
    }
    attempts.current = attempts.current.filter((time) => now - time < 30_000)
    if (attempts.current.length >= 5) {
      const nextCooldown = now + 20_000
      setCooldownUntil(nextCooldown)
      attempts.current = []
      setError('Too many sign-in attempts. Please wait 20 seconds and try again.')
      return
    }
    // Supabase Auth also rate-limits sign-in server-side; this is defense-in-depth.
    attempts.current.push(now)
    setError(null)
    setSubmitting(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) setError(friendlyLoginError(signInError.message))
    } catch {
      setError('Aquaspin could not reach the server. Check the internet connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 dark:bg-slate-900 dark:border-slate-800">
        <h1 className="text-xl font-semibold text-slate-900 text-center dark:text-slate-100">{SHOP_NAME}</h1>
        <p className="text-sm text-slate-500 text-center mt-1 mb-6">Staff &amp; owner sign in</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="website">Leave this field empty</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 dark:text-slate-300">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="you@aquaspin.ph" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 dark:text-slate-300">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="••••••••" />
          </div>

          {accessNotice && !error && <InlineAlert variant="warning" title="Account access">{accessNotice}</InlineAlert>}
          {error && <InlineAlert variant="error" title="Sign in did not finish">{error}</InlineAlert>}

          <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-3 py-2 text-sm transition">
            {submitting && <ButtonSpinner />}{submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-6">Accounts are created by the shop owner. Ask them if you need one.</p>
        <footer className="mt-4 flex justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <Link className="hover:text-sky-700 dark:hover:text-sky-300" to="/privacy">Privacy</Link>
          <Link className="hover:text-sky-700 dark:hover:text-sky-300" to="/terms">Terms</Link>
        </footer>
      </div>
    </div>
  )
}
