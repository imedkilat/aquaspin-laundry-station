import type { ReactNode } from 'react'
import { useSlowLoading } from '../hooks/useSlowLoading'

export function AqSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = size === 'sm' ? 'h-5 w-5' : size === 'lg' ? 'h-12 w-12' : 'h-8 w-8'
  const text = size === 'sm' ? 'text-[6px]' : size === 'lg' ? 'text-[10px]' : 'text-[8px]'

  return (
    <span className={`relative inline-flex shrink-0 ${sizes}`} aria-hidden="true">
      <span className="absolute inset-0 rounded-full border-2 border-slate-200 dark:border-slate-700" />
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-r-sky-500 border-t-sky-500" />
      <span className={`absolute inset-0 flex items-center justify-center font-bold tracking-tight text-sky-600 dark:text-sky-400 ${text}`}>
        AQ
      </span>
    </span>
  )
}

export function LoadingPanel({
  loading = true,
  label = 'Loading…',
  slowLabel = 'Still loading… your connection may be slow.',
  compact = false,
}: {
  loading?: boolean
  label?: string
  slowLabel?: string
  compact?: boolean
}) {
  const slow = useSlowLoading(loading)
  if (!loading) return null

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40 ${compact ? 'p-3' : 'p-5'}`} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <AqSpinner size={compact ? 'sm' : 'md'} />
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{slow ? slowLabel : label}</p>
          {!compact && <p className="mt-0.5 text-xs text-slate-400">Please keep this page open while Aquaspin syncs.</p>}
        </div>
      </div>
      {!compact && (
        <div className="mt-4 space-y-2" aria-hidden="true">
          <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      )}
    </div>
  )
}

type AlertVariant = 'error' | 'warning' | 'success' | 'info'

export function InlineAlert({
  variant,
  title,
  children,
  actionLabel,
  onAction,
}: {
  variant: AlertVariant
  title?: string
  children: ReactNode
  actionLabel?: string
  onAction?: () => void
}) {
  const styles: Record<AlertVariant, string> = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-300',
  }

  return (
    <div className={`rounded-xl border px-3 py-2.5 text-sm ${styles[variant]}`} role={variant === 'error' ? 'alert' : 'status'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {title && <p className="font-semibold">{title}</p>}
          <div className={title ? 'mt-0.5 text-xs leading-5 opacity-90' : 'text-xs leading-5'}>{children}</div>
        </div>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="shrink-0 rounded-lg border border-current/20 px-2.5 py-1 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5">
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center dark:border-slate-700">
      <div className="mx-auto mb-2 h-9 w-9 rounded-full border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
    </div>
  )
}

export function ButtonSpinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]" aria-hidden="true" />
}
