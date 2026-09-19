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
      setError(await edgeFunctionErrorMessage(functionError, 'Could not load account access. Check the connection and try again.'))
      setLoading(false)
      return
    }

    if (data?.error) {
      setError(String(data.error))
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
