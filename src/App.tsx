import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth-context'
import { supabaseConfigError } from './lib/supabase'
import Login from './pages/Login'
import StaffView from './pages/StaffView'
import OwnerDashboard from './pages/OwnerDashboard'
import Layout from './components/Layout'
import GlobalErrorBoundary from './components/GlobalErrorBoundary'
import { InlineAlert, LoadingPanel } from './components/UiFeedback'

function Gate({ children, ownerOnly = false }: { children: React.ReactNode; ownerOnly?: boolean }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
        <div className="w-full max-w-md">
          <LoadingPanel label="Opening Aquaspin…" slowLabel="Still signing you in… your connection may be slow." />
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (ownerOnly && profile?.role !== 'owner') return <Navigate to="/" replace />

  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { session, loading } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={!loading && session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Gate><StaffView /></Gate>} />
      <Route path="/dashboard" element={<Gate><OwnerDashboard /></Gate>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (supabaseConfigError) {
    return (
      <main className="min-h-svh flex items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-600">Aquaspin Laundry Station</p>
          <h1 className="mt-2 text-xl font-semibold">App configuration is incomplete</h1>
          <div className="mt-4"><InlineAlert variant="error" title="Aquaspin cannot connect yet">{supabaseConfigError}</InlineAlert></div>
        </section>
      </main>
    )
  }

  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </GlobalErrorBoundary>
  )
}
