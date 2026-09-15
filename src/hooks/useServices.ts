import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Service } from '../types/database'

export function useServices() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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

  return { services, loading }
}
