import { useCallback, useEffect, useState } from 'react'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export type StaffAccount = Profile & {
  email: string
  /** true/false = whether Supabase Auth itself blocks sign-in; null/undefined = unknown. */
  sign_in_blocked?: boolean | null
}

export const EMAIL_LOOKUP_UNAVAILABLE_NOTICE =
  'Login email addresses could not be loaded from Supabase Auth, so the Login Email column is blank. Names, roles and access status are still accurate. Press Refresh to try again.'
export const SERVICE_UNAVAILABLE_NOTICE =
  'The staff account service could not be reached, so this list was loaded from profiles only: Login Email is blank and sign-in blocking status is unknown. Edit, Disable and Enable need that service and may fail until it is back. Press Refresh to try again.'

export function useStaffAccounts() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emailNotice, setEmailNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: functionError } = await supabase.functions.invoke('manage-staff-user', {
      body: { action: 'list' },
    })

    if (!functionError && !data?.error) {
      setAccounts((data?.accounts ?? []) as StaffAccount[])
      setEmailNotice(data?.email_lookup === 'unavailable' ? EMAIL_LOOKUP_UNAVAILABLE_NOTICE : null)
      setLoading(false)
      return
    }

    // Keep Account Access usable when the Edge Function is down: the
    // Owner-authorized profiles query still gives the complete list. Emails
    // come from Supabase Auth only, so say so instead of showing silent blanks.
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')

    if (profilesError) {
      setError(functionError
        ? await edgeFunctionErrorMessage(functionError, 'Could not load account access. Check the connection and try again.')
        : String(data?.error ?? 'Could not load account access. Check the connection and try again.'))
      setLoading(false)
      return
    }

    setAccounts((profiles ?? []).map((profile) => ({ ...profile, email: '', sign_in_blocked: null })) as StaffAccount[])
    setEmailNotice(SERVICE_UNAVAILABLE_NOTICE)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, loading, error, emailNotice, reload }
}
