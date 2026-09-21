import { useState } from 'react'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import { supabase } from '../lib/supabase'
import type { StaffAccount } from '../hooks/useStaffAccounts'
import { staffPasswordProblem, STAFF_PASSWORD_MAX_BYTES, STAFF_PASSWORD_MIN_LENGTH } from '../lib/staff-password'
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

    const trimmedName = fullName.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedName) {
      setSaving(false)
      setError('Staff name is required.')
      return
    }
    if (password) {
      const passwordProblem = staffPasswordProblem(password)
      if (passwordProblem) {
        setSaving(false)
        setError(passwordProblem)
        return
      }
    }
    // Every edit, including a name-only change, goes through the Edge Function
    // so the server always re-checks the target's role and the caller's Owner status.
    const functionResult = await supabase.functions.invoke('manage-staff-user', {
      body: { action: 'update', user_id: account.id, full_name: trimmedName, email: trimmedEmail, password },
    })

    setSaving(false)

    if (functionResult.error) {
      setError(await edgeFunctionErrorMessage(functionResult.error, 'Could not update the staff account. Please try again.'))
      return
    }
    if (functionResult.data?.error) {
      setError(String(functionResult.data.error))
      return
    }

    onSaved(`Staff account updated for ${trimmedName}.${functionResult.data?.session_revoke_failed ? ' Their existing sessions could not be signed out automatically.' : password ? ' They were signed out everywhere and must use the new password.' : ''}`)
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
          <p className="mt-1 text-sm text-slate-500">Update the staff name or login details. Leave email and password blank to keep them unchanged. Passwords must be 8–72 characters.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Staff Name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Login Email (optional)
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Enter only when changing the email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400 sm:col-span-2">New Temporary Password (optional)
            <input value={password} onChange={(event) => setPassword(event.target.value)} minLength={STAFF_PASSWORD_MIN_LENGTH} maxLength={STAFF_PASSWORD_MAX_BYTES} type="password" placeholder="Leave blank to keep the current password" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
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
