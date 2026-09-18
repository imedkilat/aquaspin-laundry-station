import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { useShopSettings } from '../lib/shop-settings-context'
import { getShopLogoUrl } from '../lib/storage-images'
import ThemeToggle from './ThemeToggle'
import NetworkStatusBanner from './NetworkStatusBanner'
import ProfileAvatar from './ProfileAvatar'
import UiIcon, { type IconName } from './UiIcon'

type NavItem = {
  to: string
  label: string
  icon: IconName
  end?: boolean
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const { settings } = useShopSettings()
  const isOwner = profile?.role === 'owner'
  const canOpenDashboard = isOwner || settings.staff_can_access_dashboard
  const logoUrl = getShopLogoUrl(settings.logo_path)

  const navItems: NavItem[] = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/new', label: 'New Order', icon: 'plus' },
    { to: '/orders', label: 'Orders', icon: 'orders' },
    { to: '/customers', label: 'Customers', icon: 'customers' },
    ...(canOpenDashboard ? [{ to: '/dashboard', label: isOwner ? 'Dashboard' : 'Reports', icon: 'dashboard' as IconName }] : []),
  ]

  const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${isActive ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`

  return (
    <div className="min-h-svh bg-slate-100 dark:bg-slate-950">
      <NetworkStatusBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={`${settings.shop_display_name} logo`} className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain p-1 dark:border-slate-700" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-sm font-bold text-white">AQ</div>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-slate-900 dark:text-slate-100">{settings.shop_display_name}</p>
              <p className="truncate text-xs leading-tight text-slate-500 dark:text-slate-400">{profile?.full_name} · {isOwner ? 'Owner' : 'Staff'}</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={desktopLinkClass}><UiIcon name={item.icon} size={18} />{item.label}</NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <NavLink
              to="/profile"
              className={({ isActive }) => `hidden rounded-xl p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 md:flex ${isActive ? 'bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-950 dark:ring-sky-800' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              aria-label="Open profile"
            >
              <ProfileAvatar path={profile?.avatar_path} name={profile?.full_name} size="sm" />
            </NavLink>
            <ThemeToggle />
            <button
              onClick={signOut}
              className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Sign out"
              title="Sign out"
            >
              <span className="sm:hidden"><UiIcon name="arrow-right" size={18} /></span>
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 pb-24 sm:py-6 md:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden" aria-label="Mobile navigation">
        <div className="mx-auto flex max-w-lg items-stretch justify-around gap-1">
          {navItems.map((item) => (
            <MobileNavLink key={item.to} item={item} />
          ))}
          <MobileNavLink item={{ to: '/profile', label: 'Profile', icon: 'profile' }} />
        </div>
      </nav>
    </div>
  )
}

function MobileNavLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1 py-1.5 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${isActive ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400'}`}
    >
      <UiIcon name={item.icon} size={19} />
      <span className="mt-0.5 truncate">{item.label}</span>
    </NavLink>
  )
}
