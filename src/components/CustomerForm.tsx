import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toTitleCaseName } from '../lib/text'
import type { Customer } from '../types/customer-status'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950'

export default function CustomerForm({ customer, isOwner, onSaved, onDeleted, onCancel }: { customer?: Customer | null; isOwner: boolean; onSaved: (customer: Customer) => void; onDeleted?: () => void; onCancel: () => void }) {
  const [fullName, setFullName] = useState(customer?.full_name ?? '')
  const [phoneNumber, setPhoneNumber] = useState(customer?.phone_number ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [active, setActive] = useState(customer?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFullName(customer?.full_name ?? '')
    setPhoneNumber(customer?.phone_number ?? '')
    setNotes(customer?.notes ?? '')
    setActive(customer?.active ?? true)
  }, [customer])

  const deletePermanently = async () => {
    if (!customer || !isOwner) return
    if (!window.confirm(`Permanently delete ${customer.full_name}? This cannot be undone.`)) return

    setSaving(true)
    setError(null)
    const result = await supabase.from('customers').delete().eq('id', customer.id)
    setSaving(false)

    if (result.error) {
      const foreignKeyBlocked = result.error.code === '23503' || result.error.message.toLowerCase().includes('foreign key')
      setError(
        foreignKeyBlocked
          ? 'This customer has transaction or loyalty history and cannot be permanently deleted. Set the customer inactive instead.'
          : result.error.message
      )
      return
    }

    onDeleted?.()
  }

  const save = async () => {
    const normalizedName = toTitleCaseName(fullName)
    if (!normalizedName) return setError('Customer name is required.')
    if (phoneNumber.length > 64) return setError('Phone number must be 64 characters or fewer.')
    if (notes.length > 2000) return setError('Notes must be 2,000 characters or fewer.')

    setSaving(true)
    setError(null)
    const values = { full_name: normalizedName, phone_number: phoneNumber.trim() || null, notes: notes.trim() || null }
    const result = customer
      ? await supabase.from('customers').update({ ...values, ...(isOwner ? { active } : {}) }).eq('id', customer.id).select('*').single()
      : await supabase.from('customers').insert(values).select('*').single()
    setSaving(false)

    if (result.error) {
      setError(result.error.message.includes('Only an owner') ? 'Only the Owner can change active or inactive status.' : result.error.message)
      return
    }
    onSaved(result.data as Customer)
  }

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900/70 dark:bg-sky-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">{customer ? 'Edit customer' : 'Add customer'}</h2>
          <p className="mt-1 text-xs text-slate-500">Customer identity is separate from historical transaction snapshots.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Full name *<input value={fullName} onChange={(event) => setFullName(event.target.value)} onBlur={() => setFullName(toTitleCaseName(fullName))} className={`${inputClass} mt-1`} maxLength={120} /></label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Phone number<input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} className={`${inputClass} mt-1`} maxLength={64} placeholder="09xxxxxxxxx" /></label>
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400 sm:col-span-2">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputClass} mt-1 min-h-20`} maxLength={2000} /></label>
        {customer && isOwner && <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 sm:col-span-2"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active customer</label>}
      </div>
      {error && <div className="mt-3"><InlineAlert variant="error" title="Customer was not saved">{error}</InlineAlert></div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {customer && isOwner ? <button type="button" onClick={() => void deletePermanently()} disabled={saving} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30">Delete permanently</button> : <span />}
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">{saving && <ButtonSpinner />} {saving ? 'Saving…' : customer ? 'Save changes' : 'Add customer'}</button>
      </div>
    </section>
  )
}
