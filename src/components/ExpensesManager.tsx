import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { shopDate } from '../lib/date'
import type { ActiveExpense, Expense, ExpenseCategory } from '../types/database'
import { ButtonSpinner, EmptyState, InlineAlert, LoadingPanel } from './UiFeedback'

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
const peso = (value: number) =>
  '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateTime = (value: string) =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
type Notice = { type: 'error' | 'success'; text: string } | null

export default function ExpensesManager() {
  const { profile } = useAuth()
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [activeExpenses, setActiveExpenses] = useState<ActiveExpense[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(shopDate())
  const [categoryId, setCategoryId] = useState('')
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [expenseSaving, setExpenseSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidSaving, setVoidSaving] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const [categoryResult, activeResult, expenseResult] = await Promise.all([
      supabase.from('expense_categories').select('*').order('name'),
      supabase.from('active_expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    const firstError = [categoryResult.error, activeResult.error, expenseResult.error].find(Boolean)

    if (firstError) {
      setError(firstError.message)
    } else {
      setCategories(categoryResult.data ?? [])
      setActiveExpenses(activeResult.data ?? [])
      setAllExpenses(expenseResult.data ?? [])
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const addCategory = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    const normalizedName = categoryName.trim()
    if (!normalizedName) return setNotice({ type: 'error', text: 'Category name is required.' })
    if (!profile?.id) return setNotice({ type: 'error', text: 'Your profile is not ready yet. Please try again.' })

    setCategorySaving(true)
    const { error: saveError } = await supabase.from('expense_categories').insert({
      name: normalizedName,
      active: true,
      created_by: profile.id,
    })
    setCategorySaving(false)

    if (saveError) {
      setNotice({
        type: 'error',
        text: saveError.message.toLowerCase().includes('expense_categories_name_unique_idx')
          ? 'That category already exists.'
          : saveError.message,
      })
      return
    }

    setCategoryName('')
    setNotice({ type: 'success', text: normalizedName + ' added.' })
    void load(true)
  }

  const recordExpense = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    const normalizedDescription = description.trim()
    const nextAmount = Number(amount)

    if (!normalizedDescription) return setNotice({ type: 'error', text: 'Expense description is required.' })
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) return setNotice({ type: 'error', text: 'Amount must be greater than zero.' })
    if (!expenseDate) return setNotice({ type: 'error', text: 'Expense date is required.' })

    setExpenseSaving(true)
    const { error: saveError } = await supabase.rpc('record_expense', {
      p_description: normalizedDescription,
      p_amount: nextAmount,
      p_expense_date: expenseDate,
      p_category_id: categoryId || null,
      p_vendor: vendor.trim() || null,
      p_notes: notes.trim() || null,
    })
    setExpenseSaving(false)

    if (saveError) {
      setNotice({ type: 'error', text: saveError.message })
      return
    }

    setDescription('')
    setAmount('')
    setExpenseDate(shopDate())
    setCategoryId('')
    setVendor('')
    setNotes('')
    setNotice({ type: 'success', text: 'Expense recorded.' })
    void load(true)
  }

  const submitVoid = async () => {
    if (!voidingId) return
    const normalizedReason = voidReason.trim()
    if (normalizedReason.length < 3) {
      setNotice({ type: 'error', text: 'A void reason of at least 3 characters is required.' })
      return
    }

    setVoidSaving(true)
    setNotice(null)
    const { error: voidError } = await supabase.rpc('void_expense', {
      p_expense_id: voidingId,
      p_reason: normalizedReason,
    })
    setVoidSaving(false)

    if (voidError) {
      setNotice({ type: 'error', text: voidError.message })
      return
    }

    setVoidingId(null)
    setVoidReason('')
    setShowVoided(true)
    setNotice({ type: 'success', text: 'Expense voided and retained in the audit history.' })
    void load(true)
  }

  const filteredActive = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return activeExpenses
    return activeExpenses.filter((expense) =>
      [expense.description, expense.category_name ?? '', expense.vendor ?? '', expense.notes ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [activeExpenses, search])

  const voidedExpenses = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allExpenses.filter((expense) => {
      if (!expense.voided_at) return false
      if (!needle) return true
      return [expense.description, expense.vendor ?? '', expense.notes ?? '', expense.void_reason ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [allExpenses, search])

  const activeTotal = filteredActive.reduce((total, expense) => total + Number(expense.amount), 0)
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])

  if (profile?.role !== 'owner') {
    return <InlineAlert variant="error" title="Owner access required">Expenses are available only to the Owner.</InlineAlert>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Phase 4 · Expenses</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Operating Expenses</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Track independent shop operating costs. Expenses do not change transaction totals, customer balances, refunds, or settlements.</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {error && <InlineAlert variant="error" title="Expenses could not be refreshed" actionLabel="Try again" onAction={() => void load()}>{error} Existing loaded rows remain visible.</InlineAlert>}
      {notice && <InlineAlert variant={notice.type}>{notice.text}</InlineAlert>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric label="Active entries" value={String(activeExpenses.length)} hint="Unvoided operating costs" />
        <Metric label="Visible total" value={peso(activeTotal)} hint="Filtered active entries" />
        <Metric label="Voided entries" value={String(voidedExpenses.length)} hint="Retained for audit history" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <form onSubmit={addCategory} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Expense Categories</h2><p className="mt-1 text-sm text-slate-500">Use categories such as utilities, supplies, rent, or transport.</p></div>
          <div className="flex gap-2">
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Utilities" maxLength={80} className={INPUT} />
            <button type="submit" disabled={categorySaving} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">{categorySaving && <ButtonSpinner />}{categorySaving ? 'Adding…' : 'Add category'}</button>
          </div>
          {categories.length === 0 ? <p className="text-sm text-slate-500">No expense categories yet.</p> : <div className="space-y-2">{categories.map((category) => <CategoryRow key={category.id} category={category} onSaved={() => void load(true)} />)}</div>}
        </form>

        <form onSubmit={recordExpense} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Record Operating Expense</h2><p className="mt-1 text-sm text-slate-500">Each entry is append-only. Corrections happen through a reasoned void.</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Description"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Water bill" maxLength={160} className={INPUT} /></Field>
            <Field label="Amount (₱)"><input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className={INPUT} /></Field>
            <Field label="Expense date"><input required type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} className={INPUT} /></Field>
            <Field label="Category"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={INPUT}><option value="">Uncategorized</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
            <Field label="Vendor"><input value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={120} placeholder="Optional" className={INPUT} /></Field>
            <Field label="Notes"><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Optional" className={INPUT} /></Field>
          </div>
          <button type="submit" disabled={expenseSaving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">{expenseSaving && <ButtonSpinner />}{expenseSaving ? 'Recording…' : 'Record expense'}</button>
        </form>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Active Expense Ledger</h2><p className="mt-1 text-sm text-slate-500">Active entries come from the protected active-expenses view and remain separate from laundry transaction totals.</p></div>
          <div className="min-w-[180px]"><label className="block text-xs font-medium text-slate-600 mb-1 dark:text-slate-400">Search ledger</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, vendor, category…" className={INPUT} /></div>
        </div>
        {loading ? <LoadingPanel label="Loading expenses…" slowLabel="Still loading expenses… the connection may be slow." /> : filteredActive.length === 0 ? <EmptyState title="No active expenses yet" description="Record an operating expense above when a real shop cost occurs." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700"><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Description</th><th className="py-2 pr-4">Category</th><th className="py-2 pr-4">Vendor</th><th className="py-2 pr-4 text-right">Amount</th><th className="py-2 text-right">Action</th></tr></thead><tbody>{filteredActive.map((expense) => <ActiveExpenseRow key={expense.id} expense={expense} onVoid={() => { setVoidingId(expense.id); setVoidReason(''); setNotice(null) }} />)}</tbody></table></div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 flex-wrap"><div><h2 className="font-semibold text-slate-900 dark:text-slate-100">Voided Expense Audit</h2><p className="mt-1 text-sm text-slate-500">Voided entries remain visible for Owner audit and are excluded from active totals.</p></div><button type="button" onClick={() => setShowVoided((visible) => !visible)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{showVoided ? 'Hide voided' : 'Show voided'}</button></div>
        {showVoided && (voidedExpenses.length === 0 ? <EmptyState title="No voided expenses" description="Voided entries will appear here with their reason and timestamp." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700"><th className="py-2 pr-4">Expense date</th><th className="py-2 pr-4">Description</th><th className="py-2 pr-4">Category</th><th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Voided</th><th className="py-2">Reason</th></tr></thead><tbody>{voidedExpenses.map((expense) => <tr key={expense.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-4 whitespace-nowrap">{expense.expense_date}</td><td className="py-2 pr-4">{expense.description}</td><td className="py-2 pr-4">{categoryMap.get(expense.category_id ?? '') ?? 'Uncategorized'}</td><td className="py-2 pr-4">{peso(Number(expense.amount))}</td><td className="py-2 pr-4 whitespace-nowrap text-slate-500">{expense.voided_at ? dateTime(expense.voided_at) : 'Unknown'}</td><td className="max-w-xs text-slate-500">{expense.void_reason ?? 'No reason recorded'}</td></tr>)}</tbody></table></div>)}
      </section>

      {voidingId && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/20"><h2 className="font-semibold text-rose-900 dark:text-rose-100">Void this expense?</h2><p className="mt-1 text-sm text-rose-800 dark:text-rose-200">This removes the entry from the active ledger but preserves it in the audit history. A reason is required.</p><label className="mt-4 block text-xs font-medium text-rose-900 dark:text-rose-100">Reason<input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={500} placeholder="Duplicate entry or corrected receipt" className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm dark:border-rose-800 dark:bg-slate-950 dark:text-slate-100" /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => { setVoidingId(null); setVoidReason('') }} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-950/50">Cancel</button><button type="button" onClick={() => void submitVoid()} disabled={voidSaving} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">{voidSaving && <ButtonSpinner />}{voidSaving ? 'Voiding…' : 'Void expense'}</button></div></div>}
    </div>
  )
}

function ActiveExpenseRow({ expense, onVoid }: { expense: ActiveExpense; onVoid: () => void }) {
  return <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800"><td className="py-2 pr-4 whitespace-nowrap">{expense.expense_date}</td><td className="py-2 pr-4"><p>{expense.description}</p>{expense.notes && <p className="mt-0.5 text-xs text-slate-500">{expense.notes}</p>}</td><td className="py-2 pr-4">{expense.category_name ?? 'Uncategorized'}</td><td className="py-2 pr-4 text-slate-500">{expense.vendor ?? 'Not specified'}</td><td className="py-2 pr-4 text-right font-medium">{peso(Number(expense.amount))}</td><td className="py-2 text-right"><button type="button" onClick={onVoid} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">Void</button></td></tr>
}

function CategoryRow({ category, onSaved }: { category: ExpenseCategory; onSaved: () => void }) {
  const [active, setActive] = useState(category.active)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => { setActive(category.active) }, [category.active])

  const save = async () => {
    setSaving(true)
    setNotice(null)
    const { error } = await supabase.from('expense_categories').update({ active }).eq('id', category.id)
    setSaving(false)
    if (error) return setNotice({ type: 'error', text: error.message })
    setNotice({ type: 'success', text: 'Category status saved.' })
    onSaved()
  }

  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"><div><p className="font-medium text-slate-800 dark:text-slate-200">{category.name}</p><p className="text-xs text-slate-500">{category.active ? 'Active' : 'Inactive'}</p></div><div className="flex items-center gap-2"><select value={active ? 'active' : 'inactive'} onChange={(event) => setActive(event.target.value === 'active')} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="active">Active</option><option value="inactive">Inactive</option></select><button type="button" onClick={() => void save()} disabled={saving || active === category.active} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{saving ? 'Saving…' : 'Save'}</button></div>{notice && <span className="text-xs text-rose-600">{notice.text}</span>}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">{label}<span className="mt-1 block">{children}</span></label>
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p><p className="mt-1 text-xs text-slate-400">{hint}</p></div>
}
