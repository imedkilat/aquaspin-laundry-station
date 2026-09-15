import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth-context'
import Login from './pages/Login'
import StaffView from './pages/StaffView'
import OwnerDashboard from './pages/OwnerDashboard'
import Layout from './components/Layout'

function Gate({ children, ownerOnly = false }: { children: React.ReactNode; ownerOnly?: boolean }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center text-slate-400 text-sm">
        Loading…
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
      <Route
        path="/login"
        element={!loading && session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <Gate>
            <StaffView />
          </Gate>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Gate ownerOnly>
            <OwnerDashboard />
          </Gate>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
