import { useMemo, useState } from 'react'
import type { CustomerItemType, TransactionCustomerItem, TransactionCustomerItemInput } from '../types/database'
import { supabase } from '../lib/supabase'
import { ButtonSpinner, InlineAlert } from './UiFeedback'

const ITEM_OPTIONS: Array<{ value: CustomerItemType; label: string }> = [
  { value: 'shorts', label: 'Shorts' },
  { value: 't_shirts', label: 'T-shirts' },
  { value: 'pants', label: 'Pants' },
  { value: 'underwear', label: 'Underwear' },
  { value: 'dresses', label: 'Dresses' },
  { value: 'towels', label: 'Towels' },
  { value: 'bedsheets', label: 'Bedsheets' },
  { value: 'jackets', label: 'Jackets' },
  { value: 'other', label: 'Other' },
]

const itemLabel = (item: Pick<TransactionCustomerItem, 'item_type' | 'custom_item_name'>) =>
  item.item_type === 'other' ? item.custom_item_name || 'Other' : ITEM_OPTIONS.find((option) => option.value === item.item_type)?.label || item.item_type

type DraftItem = TransactionCustomerItemInput & { key: string }

export default function CustomerItemsCard({
  transactionId,
  items,
  canEdit,
  onSaved,
}: {
  transactionId: string
  items: TransactionCustomerItem[]
  canEdit: boolean
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const total = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [items])

  const handleSaved = async () => {
    await onSaved()
    setSavedMessage('Customer item list saved successfully.')
  }

  return (
    <>
      <DetailCard
        title="Customer Items"
        action={canEdit ? (
          <button
            type="button"
            onClick={() => { setSavedMessage(null); setEditing(true) }}
            className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
          >
            {items.length ? 'Edit Item List' : 'Add Customer Items'}
          </button>
        ) : undefined}
      >
        {savedMessage && <InlineAlert variant="success" title="Saved">{savedMessage}</InlineAlert>}
        {items.length ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Customer Items: {total} total</p>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">{itemLabel(item)}</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{item.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No customer clothing items have been recorded yet.</p>
        )}
      </DetailCard>

      {editing && (
        <CustomerItemsModal
          transactionId={transactionId}
          items={items}
          onClose={() => setEditing(false)}
          onSaved={async () => { await handleSaved(); setEditing(false) }}
        />
      )}
    </>
  )
}

function CustomerItemsModal({
  transactionId,
  items,
  onClose,
  onSaved,
}: {
  transactionId: string
  items: TransactionCustomerItem[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<DraftItem[]>(() => items.map((item) => ({
    key: item.id,
    item_type: item.item_type,
    quantity: item.quantity,
    custom_item_name: item.custom_item_name,
  })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableOptions = ITEM_OPTIONS.filter((option) => !draft.some((item) => item.item_type === option.value))

  const addItem = () => {
    const option = availableOptions[0]
    if (!option) return
    setDraft((current) => [...current, { key: `${option.value}-${Date.now()}`, item_type: option.value, quantity: 1, custom_item_name: '' }])
  }

  const updateItem = (key: string, changes: Partial<DraftItem>) => {
    setDraft((current) => current.map((item) => item.key === key ? { ...item, ...changes } : item))
  }

  const save = async () => {
    setError(null)
    if (draft.length === 0) {
      setError('Add at least one customer item before saving.')
      return
    }
    for (const item of draft) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        setError('Each quantity must be a whole number greater than zero.')
        return
      }
      if (item.item_type === 'other' && !item.custom_item_name?.trim()) {
        setError('Please enter a custom item name for Other.')
        return
      }
    }

    setSaving(true)
    const payload: TransactionCustomerItemInput[] = draft.map(({ item_type, quantity, custom_item_name }) => ({
      item_type,
      quantity,
      custom_item_name: item_type === 'other' ? custom_item_name?.trim() || null : null,
    }))
    const { error: saveError } = await supabase.rpc('save_transaction_customer_items', {
      p_transaction_id: transactionId,
      p_items: payload,
    })
    setSaving(false)

    if (saveError) {
      setError(saveError.message || 'Could not save the customer item list. Refresh and try again.')
      return
    }

    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="customer-items-title">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="customer-items-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{items.length ? 'Edit Item List' : 'Add Customer Items'}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Record the items submitted by the customer. This does not change pricing or inventory usage.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close">×</button>
        </div>

        <div className="mt-5 space-y-3">
          {draft.map((item) => (
            <div key={item.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-[1fr_110px_auto] sm:items-end">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Item type</label>
                <select
                  value={item.item_type}
                  onChange={(event) => updateItem(item.key, { item_type: event.target.value as CustomerItemType, custom_item_name: event.target.value === 'other' ? '' : null })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {ITEM_OPTIONS.filter((option) => option.value === item.item_type || !draft.some((other) => other.key !== item.key && other.item_type === option.value)).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {item.item_type === 'other' && (
                  <input
                    value={item.custom_item_name || ''}
                    onChange={(event) => updateItem(item.key, { custom_item_name: event.target.value })}
                    placeholder="Custom item name"
                    maxLength={120}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(event) => updateItem(item.key, { quantity: Number(event.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <button type="button" onClick={() => setDraft((current) => current.filter((entry) => entry.key !== item.key))} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">Remove</button>
            </div>
          ))}
        </div>

        <button type="button" onClick={addItem} disabled={!availableOptions.length} className="mt-3 rounded-lg border border-dashed border-sky-300 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/30">+ Add item type</button>

        {error && <div className="mt-4"><InlineAlert variant="error" title="Customer items were not saved">{error}</InlineAlert></div>}

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving && <ButtonSpinner />}{saving ? 'Saving…' : 'Save Items'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
