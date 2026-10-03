import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CompletedOrderEdit } from '../types/database'
import { InlineAlert } from './UiFeedback'

type EditWithActor = Pick<CompletedOrderEdit, 'id' | 'edited_at' | 'reason'> & { edited_by_profile: { full_name: string } | null }

export default function CompletedOrderEditHistory({ transactionId, updatedAt }: { transactionId: string; updatedAt: string }) {
  const [result, setResult] = useState<{ rows: EditWithActor[]; error: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase.from('completed_order_edits')
      .select('id, edited_at, reason, edited_by_profile:profiles!completed_order_edits_edited_by_fkey(full_name)')
      .eq('transaction_id', transactionId)
      .order('edited_at', { ascending: false })
      .then(({ data, error }) => {
        if (!cancelled) setResult({ rows: (data ?? []) as unknown as EditWithActor[], error: Boolean(error) })
      })
    return () => { cancelled = true }
  }, [transactionId, updatedAt])

  if (!result) return <p className="text-sm text-slate-500">Loading edit history…</p>
  if (result.error) return <InlineAlert variant="error" title="Edit history unavailable">Refresh this order to load its edit reasons.</InlineAlert>
  if (result.rows.length === 0) return null

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-5 dark:border-amber-900 dark:bg-slate-900">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">Completed order edit history</h2>
      <ol className="mt-3 space-y-3">
        {result.rows.map((edit) => (
          <li key={edit.id} className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Edited <time dateTime={edit.edited_at}>{new Date(edit.edited_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</time>
              {edit.edited_by_profile?.full_name ? ` by ${edit.edited_by_profile.full_name}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">Reason: {edit.reason}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
