import { useState } from 'react'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import { supabase } from '../lib/supabase'
import type { StaffAccount } from '../hooks/useStaffAccounts'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

export default function EditStaffAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: StaffAccount
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [fullName, setFullName] = useState(account.full_name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    setSaving(true)

    const { data, error: functionError } = await supabase.functions.invoke('manage-staff-user', {
      body: {
        action: 'update',
        user_id: account.id,
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      },
    })

    setSaving(false)

    if (functionError) {
      setError(await edgeFunctionErrorMessage(functionError, 'Could not update the staff account. Please try again.'))
      return
    }
    if (data?.error) {
      setError(String(data.error))
      return
    }

    onSaved(`Staff account updated for ${email.trim()}.`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-staff-account-title"
      >
        <div>
          <h2 id="edit-staff-account-title" className="font-semibold text-slate-900 dark:text-slate-100">Edit Staff Account</h2>
          <p className="mt-1 text-sm text-slate-500">Update the staff name or login details. Leave the password blank to keep it unchanged.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Staff Name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Login Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400 sm:col-span-2">New Temporary Password (optional)
            <input value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} type="password" placeholder="Leave blank to keep the current password" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
        </div>

        {error && <InlineAlert variant="error" title="Account was not updated">{error}</InlineAlert>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">{saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}
