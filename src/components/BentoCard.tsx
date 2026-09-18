import type { ReactNode } from 'react'
import UiIcon, { type IconName } from './UiIcon'

type BentoTone = 'default' | 'sky' | 'emerald' | 'amber' | 'violet'

const toneStyles: Record<BentoTone, { icon: string; border: string }> = {
  default: { icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-800' },
  sky: { icon: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300', border: 'border-sky-200 dark:border-sky-900/70' },
  emerald: { icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-900/70' },
  amber: { icon: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900/70' },
  violet: { icon: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300', border: 'border-violet-200 dark:border-violet-900/70' },
}

export default function BentoCard({ title, description, icon, tone = 'default', action, className = '', children }: { title?: string; description?: string; icon?: IconName; tone?: BentoTone; action?: ReactNode; className?: string; children: ReactNode }) {
  const styles = toneStyles[tone]
  return (
    <section className={`rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-slate-900 ${styles.border} ${className}`}>
      {(title || description || icon || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}><UiIcon name={icon} size={20} /></span>}
            <div className="min-w-0">
              {title && <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
