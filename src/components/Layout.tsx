import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import ThemeToggle from './ThemeToggle'
import NetworkStatusBanner from './NetworkStatusBanner'

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canOpenDashboard = isOwner || settings.staff_can_access_dashboard

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${isActive ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'}`

  return (
    <div className="min-h-svh bg-slate-100 dark:bg-slate-950">
      <NetworkStatusBanner />
      <header className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold text-sm">AQ</div>
            <div>
              <p className="font-semibold text-slate-900 leading-tight dark:text-slate-100">{settings.shop_display_name}</p>
              <p className="text-xs text-slate-500 leading-tight dark:text-slate-400">{profile?.full_name} · {isOwner ? 'Owner' : 'Staff'}</p>
            </div>
          </div>

          <nav className="flex items-center gap-2 flex-wrap">
            <NavLink to="/" end className={linkClass}>Add Transaction</NavLink>
            {canOpenDashboard && <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>}
            <ThemeToggle />
            <button onClick={signOut} className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-200 transition dark:text-slate-400 dark:hover:bg-slate-800">Sign out</button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
