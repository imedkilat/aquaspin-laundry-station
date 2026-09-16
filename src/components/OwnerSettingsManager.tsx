import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useShopSettings } from '../lib/shop-settings-context'
import {
  SHOP_BRANDING_BUCKET,
  getShopLogoUrl,
  imageExtension,
  validateProfileImage,
} from '../lib/storage-images'
import { ButtonSpinner, InlineAlert, LoadingPanel } from './UiFeedback'
import type { PaymentMethod, ShopSettings } from '../types/database'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'

export default function OwnerSettingsManager() {
  const { settings, loading, error, realtimeState, reload } = useShopSettings()
  const [draft, setDraft] = useState<ShopSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage(null)
    setSaveError(null)
  }

  const save = async () => {
    const name = draft.shop_display_name.trim()
    const dashboardDays = Number(draft.default_dashboard_days)

    if (!name) {
      setSaveError('Shop display name is required.')
      return
    }
    if (!Number.isInteger(dashboardDays) || dashboardDays < 1 || dashboardDays > 365) {
      setSaveError('Default Dashboard range must be between 1 and 365 days.')
      return
    }

    setSaving(true)
    setMessage(null)
    setSaveError(null)

    const { error: updateError } = await supabase
      .from('shop_settings')
      .update({
        shop_display_name: name,
        contact_phone: draft.contact_phone?.trim() || null,
        report_footer: draft.report_footer?.trim() || null,
        logo_path: draft.logo_path || null,
        default_payment_method: draft.default_payment_method,
        default_dashboard_days: dashboardDays,
        require_phone_number: draft.require_phone_number,
        require_pickup_date: draft.require_pickup_date,
        require_notes_for_pay_later: draft.require_notes_for_pay_later,
        allow_manual_total_override: draft.allow_manual_total_override,
        staff_can_create_transactions: draft.staff_can_create_transactions,
        staff_can_access_dashboard: draft.staff_can_access_dashboard,
        staff_can_view_full_history: draft.staff_can_view_full_history,
        staff_can_edit_transactions: draft.staff_can_edit_transactions,
        staff_can_delete_transactions: draft.staff_can_delete_transactions,
        staff_can_view_historical_pay_later: draft.staff_can_view_historical_pay_later,
        staff_can_edit_own_profile: draft.staff_can_edit_own_profile,
      })
      .eq('id', 1)

    setSaving(false)

    if (updateError) {
      setSaveError(updateError.message)
      return
    }

    await reload()
    setMessage('Settings saved. Open Staff browsers will receive the new access rules automatically.')
  }

  const uploadLogo = async (file: File) => {
    const validationError = validateProfileImage(file)
    if (validationError) {
      setSaveError(validationError)
      return
    }

    setUploadingLogo(true)
    setMessage(null)
    setSaveError(null)

    const previousPath = settings.logo_path
    const path = `branding/logo-${Date.now()}.${imageExtension(file)}`
    const { error: uploadError } = await supabase.storage
      .from(SHOP_BRANDING_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })

    if (uploadError) {
      setUploadingLogo(false)
      setSaveError(uploadError.message)
      return
    }

    const { error: updateError } = await supabase
      .from('shop_settings')
      .update({ logo_path: path })
      .eq('id', 1)

    if (updateError) {
      await supabase.storage.from(SHOP_BRANDING_BUCKET).remove([path])
      setUploadingLogo(false)
      setSaveError(updateError.message)
      return
    }

    if (previousPath && previousPath !== path) {
      await supabase.storage.from(SHOP_BRANDING_BUCKET).remove([previousPath])
    }

    await reload()
    setUploadingLogo(false)
    setMessage('Shop logo updated. Open Aquaspin screens will receive the new branding automatically.')
  }

  const removeLogo = async () => {
    if (!settings.logo_path) return
    setUploadingLogo(true)
    setMessage(null)
    setSaveError(null)

    const previousPath = settings.logo_path
    const { error: updateError } = await supabase
      .from('shop_settings')
      .update({ logo_path: null })
      .eq('id', 1)

    if (updateError) {
      setUploadingLogo(false)
      setSaveError(updateError.message)
      return
    }

    await supabase.storage.from(SHOP_BRANDING_BUCKET).remove([previousPath])
    await reload()
    setUploadingLogo(false)
    setMessage('Shop logo removed. Aquaspin will use the AQ fallback mark.')
  }

  if (loading) {
    return <LoadingPanel label="Loading Owner settings…" slowLabel="Still loading settings… your connection may be slow." />
  }

  const logoUrl = getShopLogoUrl(draft.logo_path)

  return (
    <div className="space-y-5">
      {error && (
        <InlineAlert variant="error" title="Settings storage is not ready" actionLabel="Try again" onAction={() => void reload()}>
          {error}. The rest of Aquaspin keeps using safe defaults until the settings migration is active.
        </InlineAlert>
      )}
      {!error && (realtimeState === 'disconnected' || realtimeState === 'error') && (
        <InlineAlert variant="warning" title="Settings live sync is temporarily offline" actionLabel="Refresh" onAction={() => void reload()}>
          You can still save settings, but other open browsers may need a manual Refresh until Realtime reconnects.
        </InlineAlert>
      )}
      {saveError && <InlineAlert variant="error" title="Settings were not saved">{saveError}</InlineAlert>}
      {message && <InlineAlert variant="success" title="Settings updated">{message}</InlineAlert>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Shop Branding</h2>
          <p className="mt-1 text-sm text-slate-500">Your logo is a public business asset. Only Owners can upload, replace, or remove it.</p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {logoUrl ? (
            <img src={logoUrl} alt={`${draft.shop_display_name} logo`} className="h-24 w-24 rounded-2xl border border-slate-200 bg-white object-contain p-2 dark:border-slate-700" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-sky-600 text-2xl font-bold text-white">AQ</div>
          )}
          <div className="space-y-2">
            <p className="text-xs text-slate-500">PNG, JPG/JPEG, or WebP. Maximum 2 MB. Used in the app header and PDF reports.</p>
            <div className="flex flex-wrap gap-2">
              <label className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200 ${uploadingLogo ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                {uploadingLogo && <ButtonSpinner />}{uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace Logo' : 'Upload Logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploadingLogo}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadLogo(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {settings.logo_path && (
                <button type="button" disabled={uploadingLogo} onClick={() => void removeLogo()} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30">
                  Remove Logo
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Shop Preferences</h2>
          <p className="mt-1 text-sm text-slate-500">Customize normal shop behavior without changing code or redeploying Aquaspin.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Shop Display Name">
            <input value={draft.shop_display_name} onChange={(e) => set('shop_display_name', e.target.value)} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Contact Number" optional>
            <input value={draft.contact_phone ?? ''} onChange={(e) => set('contact_phone', e.target.value)} maxLength={64} className={inputClass} placeholder="09xxxxxxxxx" />
          </Field>
          <Field label="Default Payment Method">
            <select value={draft.default_payment_method} onChange={(e) => set('default_payment_method', e.target.value as PaymentMethod)} className={inputClass}>
              <option value="paid">Cash</option>
              <option value="gcash">GCash</option>
              <option value="pay_later">Pay Later</option>
            </select>
          </Field>
          <Field label="Default Dashboard Range">
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="365" value={draft.default_dashboard_days} onChange={(e) => set('default_dashboard_days', Number(e.target.value))} className={inputClass} />
              <span className="text-sm text-slate-500">days</span>
            </div>
          </Field>
          <div className="md:col-span-2">
            <Field label="Report / PDF Footer" optional>
              <textarea value={draft.report_footer ?? ''} onChange={(e) => set('report_footer', e.target.value)} maxLength={300} rows={2} className={inputClass} placeholder="Thank you for choosing Aquaspin Laundry Station." />
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Transaction Rules</h2>
          <p className="mt-1 text-sm text-slate-500">These are data-quality rules. Once enabled, Postgres enforces them too, not only the browser form.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingToggle checked={draft.require_phone_number} onChange={(value) => set('require_phone_number', value)} title="Require customer phone number" description="Prevents saving a transaction without a contact number." />
          <SettingToggle checked={draft.require_pickup_date} onChange={(value) => set('require_pickup_date', value)} title="Require pickup date" description="Useful when every drop-off must have a planned pickup date. Pickup time remains optional." />
          <SettingToggle checked={draft.require_notes_for_pay_later} onChange={(value) => set('require_notes_for_pay_later', value)} title="Require notes for Pay Later" description="Forces Staff to leave a reason/context whenever payment is deferred." />
          <SettingToggle checked={draft.allow_manual_total_override} onChange={(value) => set('allow_manual_total_override', value)} title="Allow manual Total override" description="Turn this off for stricter accounting so Total must equal Base Amount + Add-ons." caution={draft.allow_manual_total_override} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Staff Access</h2>
          <p className="mt-1 text-sm text-slate-500">Delegable operational permissions. These rules are checked by the database, so hiding a button is not the security boundary.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingToggle checked={draft.staff_can_create_transactions} onChange={(value) => set('staff_can_create_transactions', value)} title="Create transactions" description="Allows Staff to add new customer transactions." />
          <SettingToggle checked={draft.staff_can_access_dashboard} onChange={(value) => set('staff_can_access_dashboard', value)} title="Open Dashboard" description="Controls whether Staff can open the Dashboard at all. Today's Transactions remains available on the Add Transaction page." />
          <SettingToggle checked={draft.staff_can_view_full_history} disabled={!draft.staff_can_access_dashboard} onChange={(value) => set('staff_can_view_full_history', value)} title="View full transaction history" description="If off, Staff data access is limited to today's transactions even through direct database requests." />
          <SettingToggle checked={draft.staff_can_view_historical_pay_later} disabled={!draft.staff_can_access_dashboard || !draft.staff_can_view_full_history} onChange={(value) => set('staff_can_view_historical_pay_later', value)} title="View historical Pay Later accounts" description="Can be disabled while still letting Staff see today's Pay Later transactions." />
          <SettingToggle checked={draft.staff_can_edit_transactions} onChange={(value) => set('staff_can_edit_transactions', value)} title="Edit transactions" description="Allows normal corrections. Concurrent-edit protection still applies." />
          <SettingToggle checked={draft.staff_can_delete_transactions} onChange={(value) => set('staff_can_delete_transactions', value)} title="Soft-delete transactions" description="Allows Staff to remove a transaction with a required reason. Permanent delete remains unavailable." />
          <SettingToggle checked={draft.staff_can_edit_own_profile} onChange={(value) => set('staff_can_edit_own_profile', value)} title="Edit own profile" description="Allows Staff to change only their own photo, full name, and contact number. Email, role, and access permissions stay locked." />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Always Owner-only</h2>
          <p className="mt-1 text-sm text-slate-500">These controls are intentionally non-delegable so a Staff account cannot gain administrative power.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {['Staff accounts & role changes', 'Service pricing & service catalog', 'Add-ons catalog management', 'Shop branding', 'Restore deleted transactions', 'PDF / CSV / Google Sheets exports', 'Security & access settings'].map((label) => (
            <div key={label} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              <span aria-hidden="true">🔒</span><span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-3 z-20 flex justify-end">
        <button type="button" disabled={saving || Boolean(error)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-sky-700 disabled:opacity-50">
          {saving && <ButtonSpinner />}{saving ? 'Saving Settings…' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}{optional ? ' · Optional' : ''}</span>
      {children}
    </label>
  )
}

function SettingToggle({
  checked,
  onChange,
  title,
  description,
  disabled = false,
  caution = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  description: string
  disabled?: boolean
  caution?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border p-4 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${caution ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
      </span>
    </label>
  )
}
