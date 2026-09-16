import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
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

  // Every effect run gets its own Realtime topic. This is deliberate:
  // React StrictMode mounts/cleans/re-mounts effects, and Edit modals can
  // mount another useServices() while the page already has one. Reusing a
  // fixed channel topic can make supabase-js try to add postgres_changes
  // callbacks to a channel that is already subscribed.
  useEffect(() => {
    const channel = supabase
      .channel(makeRealtimeTopic('services-realtime'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'services' },
        () => reload()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload])

  return { services, loading, reload }
}
