import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { makeRealtimeTopic } from '../lib/realtime'
import type { Service } from '../types/database'

export type RealtimeState = 'connecting' | 'connected' | 'disconnected' | 'error'

export function useServices(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase.from('services').select('*').order('label')
    if (!includeInactive) query = query.eq('active', true)

    const { data, error: queryError } = await query
    if (queryError) {
      setError('Could not load the service catalog. Check the connection and try again.')
      setLoading(false)
      return
    }

    setServices(data ?? [])
    setLoading(false)
  }, [includeInactive])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRealtimeState('connecting')
    const channel = supabase
      .channel(makeRealtimeTopic(`services-realtime-${includeInactive ? 'all' : 'active'}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'services' },
        () => void reload()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeState('connected')
        else if (status === 'CHANNEL_ERROR') setRealtimeState('error')
        else if (status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeState('disconnected')
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [includeInactive, reload])

  return { services, loading, error, realtimeState, reload }
}
