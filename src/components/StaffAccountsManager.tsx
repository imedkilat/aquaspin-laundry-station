import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useProfiles } from '../hooks/useProfiles'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { edgeFunctionErrorMessage } from '../lib/edge-functions'
import type { Profile, Role } from '../types/database'

export default function StaffAccountsManager() {
  const { profiles, loading, reload } = useProfiles()
  const { profile: currentProfile } = useAuth()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const creatingRef = useRef(false)

  const ownerProfiles = useMemo(() => profiles.filter((profile) => profile.role === 'owner'), [profiles])
  const staffProfiles = useMemo(() => profiles.filter((profile) => profile.role === 'staff'), [profiles])

  const createStaff = async (event: FormEvent) => {
    event.preventDefault()

    // Synchronous guard against a fast double-click firing this twice
    // before the button re-renders as disabled -- this creates a real
    // Auth login, so a duplicate attempt should never even reach the
    // server (which would just reject it as an existing email anyway).
    if (creatingRef.current) return
    creatingRef.current = true

    try {
      setError(null)
      setSuccess(null)
      setCreating(true)

      const { data, error: functionError } = await supabase.functions.invoke('create-staff-user', {
        body: {
          full_name: fullName.trim(),
          email: email.trim(),
          password,
        },
      })

      setCreating(false)

      if (functionError) {
        setError(await edgeFunctionErrorMessage(functionError, 'Could not create the staff account. Please try again.'))
        return
      }

      if (data?.error) {
        setError(String(data.error))
        return
      }

      setSuccess(`Staff account created for ${email.trim()}.`)
      setFullName('')
      setEmail('')
      setPassword('')
      reload()
      window.setTimeout(reload, 800)
    } finally {
      creatingRef.current = false
    }
  }

  const toggleRole = async (id: string, current: Role) => {
    setUpdatingId(id)
    setError(null)
    setSuccess(null)
    const next: Role = current === 'owner' ? 'staff' : 'owner'
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', id)
    setUpdatingId(null)
    if (error) {
      setError(error.message)
      return
    }
    reload()
  }

  return (
    <div className="space-y-5">
      <form onSubmit={createStaff} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Create Staff Credentials</h2>
          <p className="text-sm text-slate-500 mt-1">Owner-only. New accounts are created directly as Staff and can sign in immediately.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Staff Name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Juan Dela Cruz" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Login Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="staff@aquaspin.ph" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Temporary Password</label>
            <input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="At least 8 characters" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>}

        <button type="submit" disabled={creating} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition">
          {creating ? 'Creating…' : 'Create Staff Account'}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Account Access</h2>
            <p className="text-sm text-slate-500 mt-1">Owners and staff are separated below for easier access review.</p>
          </div>
          <button type="button" onClick={reload} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <AccessGroup title="Owner Access" profiles={ownerProfiles} currentProfileId={currentProfile?.id} updatingId={updatingId} onToggleRole={toggleRole} emptyText="No owner accounts found." />
            <AccessGroup title="Staff Access" profiles={staffProfiles} currentProfileId={currentProfile?.id} updatingId={updatingId} onToggleRole={toggleRole} emptyText="No staff profiles found. If an Auth login already exists, run the profile repair migration once." />
          </div>
        )}
      </div>
    </div>
  )
}

function AccessGroup({ title, profiles, currentProfileId, updatingId, onToggleRole, emptyText }: {
  title: string
  profiles: Profile[]
  currentProfileId?: string
  updatingId: string | null
  onToggleRole: (id: string, current: Role) => void
  emptyText: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{profiles.length}</span>
      </div>

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Since</th>
                <th className="py-2 pr-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{profile.full_name}</td>
                  <td className="py-2 pr-3 capitalize">{profile.role}</td>
                  <td className="py-2 pr-3 text-slate-500">{new Date(profile.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">
                    <button
                      disabled={updatingId === profile.id || (profile.id === currentProfileId && profile.role === 'owner')}
                      onClick={() => onToggleRole(profile.id, profile.role)}
                      className="text-sky-600 hover:text-sky-700 text-xs font-medium disabled:opacity-50"
                    >
                      {profile.id === currentProfileId && profile.role === 'owner' ? 'Current Owner' : profile.role === 'owner' ? 'Demote to Staff' : 'Promote to Owner'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
