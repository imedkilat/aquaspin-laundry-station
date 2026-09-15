import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Service } from '../types/database'

export function useServices() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .order('label')
      .then(({ data, error }) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to load services', error)
        }
        setServices(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Keep every open staff/owner screen in sync when an owner changes pricing.
  useEffect(() => {
    const channel = supabase
      .channel('services-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'services' },
        () => reload()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { services, loading, reload }
}
