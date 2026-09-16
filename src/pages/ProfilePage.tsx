import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import { supabase } from '../lib/supabase'
import {
  PROFILE_AVATARS_BUCKET,
  createAvatarSignedUrl,
  imageExtension,
  validateProfileImage,
} from '../lib/storage-images'
import { ButtonSpinner, InlineAlert } from '../components/UiFeedback'
import ProfileAvatar from '../components/ProfileAvatar'
import { toTitleCaseName } from '../lib/text'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500'

export default function ProfilePage() {
  const { session, profile, refreshProfile } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canEdit = isOwner || settings.staff_can_edit_own_profile

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [contactPhone, setContactPhone] = useState(profile?.contact_phone ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
    setContactPhone(profile?.contact_phone ?? '')
  }, [profile?.contact_phone, profile?.full_name])

  useEffect(() => {
    let cancelled = false
    setAvatarPreviewUrl(null)
    if (!profile?.avatar_path) return

    void createAvatarSignedUrl(profile.avatar_path).then((url) => {
      if (!cancelled) setAvatarPreviewUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [profile?.avatar_path])

  const saveProfile = async () => {
    if (!profile || !canEdit) return

    const normalizedName = toTitleCaseName(fullName)
    if (!normalizedName) {
      setError('Full name is required.')
      return
    }

    setSaving(true)
    setMessage(null)
    setError(null)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: normalizedName,
        contact_phone: contactPhone.trim() || null,
      })
      .eq('id', profile.id)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await refreshProfile()
    setMessage('Profile updated.')
  }

  const uploadAvatar = async (file: File) => {
    if (!profile || !canEdit) return

    const validationError = validateProfileImage(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setUploading(true)
    setMessage(null)
    setError(null)

    const previousPath = profile.avatar_path
    const path = `${profile.id}/avatar-${Date.now()}.${imageExtension(file)}`

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_AVATARS_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', profile.id)

    if (profileError) {
      await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([path])
      setUploading(false)
      setError(profileError.message)
      return
    }

    if (previousPath && previousPath !== path) {
      await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([previousPath])
    }

    await refreshProfile()
    setUploading(false)
    setMessage('Profile photo updated.')
  }

  const removeAvatar = async () => {
    if (!profile?.avatar_path || !canEdit) return
    setUploading(true)
    setMessage(null)
    setError(null)

    const previousPath = profile.avatar_path
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', profile.id)

    if (updateError) {
      setUploading(false)
      setError(updateError.message)
      return
    }

    await supabase.storage.from(PROFILE_AVATARS_BUCKET).remove([previousPath])
    await refreshProfile()
    setUploading(false)
    setMessage('Profile photo removed.')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">My Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your personal Aquaspin account details. Role and sign-in email stay protected.</p>
      </div>

      {!canEdit && (
        <InlineAlert variant="info" title="Profile editing is read-only">
          The Owner has disabled Staff profile edits. You can still view your account details here.
        </InlineAlert>
      )}
      {error && <InlineAlert variant="error" title="Profile update did not finish">{error}</InlineAlert>}
      {message && <InlineAlert variant="success" title="Profile updated">{message}</InlineAlert>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            {avatarPreviewUrl ? (
              <img src={avatarPreviewUrl} alt="Profile preview" className="h-24 w-24 rounded-full border border-slate-200 object-cover dark:border-slate-700" />
            ) : (
              <ProfileAvatar path={profile?.avatar_path} name={profile?.full_name} size="lg" />
            )}
          </div>

          <div className="space-y-2">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Profile Photo</h2>
              <p className="text-xs text-slate-500">PNG, JPG/JPEG, or WebP. Maximum 2 MB.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200 ${canEdit && !uploading ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : 'cursor-not-allowed opacity-50'}`}>
                {uploading && <ButtonSpinner />}{uploading ? 'Uploading…' : 'Upload Photo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={!canEdit || uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadAvatar(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {profile?.avatar_path && (
                <button type="button" disabled={!canEdit || uploading} onClick={() => void removeAvatar()} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30">
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Full Name</span>
            <input value={fullName} disabled={!canEdit} maxLength={120} onChange={(e) => setFullName(e.target.value)} onBlur={() => setFullName(toTitleCaseName(fullName))} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Contact Number · Optional</span>
            <input value={contactPhone} disabled={!canEdit} maxLength={64} onChange={(e) => setContactPhone(e.target.value)} placeholder="09xxxxxxxxx" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Sign-in Email · Locked</span>
            <input value={session?.user.email ?? ''} readOnly disabled className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Role · Locked</span>
            <input value={profile?.role === 'owner' ? 'Owner' : 'Staff'} readOnly disabled className={inputClass} />
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => void saveProfile()} disabled={!canEdit || saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </section>
    </div>
  )
}
