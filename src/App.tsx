import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './components/auth/AuthProvider'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { LoginPage } from './components/auth/LoginPage'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Dashboard } from './pages/Dashboard'
import { ClientsPage } from './pages/Clients'
import { AdminPage } from './pages/Admin'
import { StaffPage } from './pages/Staff'
import { AuditLogPage } from './pages/AuditLog'
import { ExpensesPage } from './pages/Expenses'
import { SubscriptionsPage } from './pages/Subscriptions'

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-right" richColors />
      <HashRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/staff" element={
                <ProtectedRoute allowedRoles={['admin']}><StaffPage /></ProtectedRoute>
              } />
              <Route path="/audit" element={
                <ProtectedRoute allowedRoles={['admin']}><AuditLogPage /></ProtectedRoute>
              } />
              <Route path="/expenses" element={
                <ProtectedRoute allowedRoles={['admin']}><ExpensesPage /></ProtectedRoute>
              } />
              <Route path="/subscriptions" element={
                <ProtectedRoute allowedRoles={['admin']}><SubscriptionsPage /></ProtectedRoute>
              } />
              <Route path="/admin" element={
                <ProtectedRoute allowedRoles={['admin', 'manager']}><AdminPage /></ProtectedRoute>
              } />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  )
}
