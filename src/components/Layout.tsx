import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { SHOP_NAME } from '../lib/supabase'

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const isOwner = profile?.role === 'owner'

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${
      isActive ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-200'
    }`

  return (
    <div className="min-h-svh bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold text-sm">
              AQ
            </div>
            <div>
              <p className="font-semibold text-slate-900 leading-tight">{SHOP_NAME}</p>
              <p className="text-xs text-slate-500 leading-tight">
                {profile?.full_name} · {isOwner ? 'Owner' : 'Staff'}
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <NavLink to="/" end className={linkClass}>
              Add Transaction
            </NavLink>
            {isOwner && (
              <NavLink to="/dashboard" className={linkClass}>
                Dashboard
              </NavLink>
            )}
            <button
              onClick={signOut}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-200 transition"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
