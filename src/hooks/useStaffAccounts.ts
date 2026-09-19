import { useCallback, useEffect, useState } from 'react'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export type StaffAccount = Profile & { email: string }

export function useStaffAccounts() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: functionError } = await supabase.functions.invoke('manage-staff-user', {
      body: { action: 'list' },
    })

    if (functionError) {
      // Keep Account Access available if the optional Auth email lookup is
      // unavailable. The Owner-authorized profiles query still gives the UI
      // the complete role list; email is shown when the Edge Function works.
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at')
      if (profilesError) {
        setError(await edgeFunctionErrorMessage(functionError, 'Could not load account access. Check the connection and try again.'))
        setLoading(false)
        return
      }
      setAccounts((profiles ?? []).map((profile) => ({ ...profile, email: '' })) as StaffAccount[])
      setLoading(false)
      return
    }

    if (data?.error) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at')
      if (profilesError) {
        setError(String(data.error))
        setLoading(false)
        return
      }
      setAccounts((profiles ?? []).map((profile) => ({ ...profile, email: '' })) as StaffAccount[])
      setLoading(false)
      return
    }

    setAccounts((data?.accounts ?? []) as StaffAccount[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, loading, error, reload }
}
