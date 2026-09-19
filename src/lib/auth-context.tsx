import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../types/database'

export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled by the Owner, so you have been signed out. Please contact the shop Owner if you need access.'
export const ACCOUNT_NOT_SET_UP_MESSAGE = 'This login is not set up for Aquaspin, so you have been signed out. Please contact the shop Owner.'
// A disabled account's browser session is revoked server-side; this is only how
// often an already-open tab notices, so the notice does not wait for a reload.
const ACCESS_RECHECK_MS = 60_000

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Why the user was signed out (disabled / no profile). Shown on the login page. */
  accessNotice: string | null
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

type ProfileLookup =
  | { kind: 'ok'; profile: Profile }
  | { kind: 'disabled' }
  | { kind: 'missing' }
  | { kind: 'error' }

async function lookupProfile(userId: string): Promise<ProfileLookup> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    // PGRST116 = no row: a valid login whose profile was removed. Any other
    // error (network, 5xx) is transient and must never sign the user out.
    if (error.code === 'PGRST116') return { kind: 'missing' }
    // eslint-disable-next-line no-console
    console.error('Failed to load profile', error)
    return { kind: 'error' }
  }
  if (!data) return { kind: 'missing' }
  if (data.is_active === false) return { kind: 'disabled' }
  return { kind: 'ok', profile: data }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessNotice, setAccessNotice] = useState<string | null>(null)
  const userId = session?.user.id ?? null
  // Lets a slow re-check for a previous user be ignored after someone else signs in.
  const currentUserIdRef = useRef<string | null>(null)
  useEffect(() => { currentUserIdRef.current = userId }, [userId])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const applyLookup = useCallback(async (result: ProfileLookup) => {
    if (result.kind === 'ok') {
      setAccessNotice(null)
      // Keep the same object when nothing changed so the periodic re-check
      // does not re-render every consumer once a minute.
      setProfile((previous) => (previous && JSON.stringify(previous) === JSON.stringify(result.profile) ? previous : result.profile))
      return
    }
    if (result.kind === 'disabled' || result.kind === 'missing') {
      setAccessNotice(result.kind === 'disabled' ? ACCOUNT_DISABLED_MESSAGE : ACCOUNT_NOT_SET_UP_MESSAGE)
      setProfile(null)
      setLoading(false)
      // Revokes the local session. A 401/403 from an already-revoked session is fine.
      await supabase.auth.signOut().catch(() => undefined)
    }
    // 'error': keep the current state and try again on the next check.
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }
    const result = await lookupProfile(userId)
    if (currentUserIdRef.current !== userId) return
    await applyLookup(result)
  }, [userId, applyLookup])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)

    lookupProfile(userId).then(async (result) => {
      if (cancelled) return
      await applyLookup(result)
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [userId, applyLookup])

  useEffect(() => {
    if (!userId) return
    const recheck = () => { void refreshProfile() }
    const onVisible = () => { if (document.visibilityState === 'visible') recheck() }
    const timer = window.setInterval(recheck, ACCESS_RECHECK_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refreshProfile])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, accessNotice, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
