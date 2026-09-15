import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to load staff profiles', error)
        }
        setProfiles(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { profiles, loading, reload }
}
