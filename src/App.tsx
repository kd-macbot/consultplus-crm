import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClient, persistOptions } from './lib/queryClient'
import { AuthProvider } from './components/auth/AuthProvider'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { LoginPage } from './components/auth/LoginPage'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'

// Lazy-loaded страници — всяка става отделен chunk, който се сваля при нужда.
// Така първоначалният bundle пада драстично (login + layout вместо всичко).
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const ClientsPage = lazy(() => import('./pages/Clients').then(m => ({ default: m.ClientsPage })))
const WorkSheetPage = lazy(() => import('./pages/WorkSheet').then(m => ({ default: m.WorkSheetPage })))
const YearlyViewPage = lazy(() => import('./pages/YearlyView').then(m => ({ default: m.YearlyViewPage })))
const OpportunitiesPage = lazy(() => import('./pages/Opportunities').then(m => ({ default: m.OpportunitiesPage })))
const ContactsPage = lazy(() => import('./pages/Contacts').then(m => ({ default: m.ContactsPage })))
const AdminPage = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminPage })))
const StaffPage = lazy(() => import('./pages/Staff').then(m => ({ default: m.StaffPage })))
const AuditLogPage = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLogPage })))
const ExpensesPage = lazy(() => import('./pages/Expenses').then(m => ({ default: m.ExpensesPage })))
const SubscriptionsPage = lazy(() => import('./pages/Subscriptions').then(m => ({ default: m.SubscriptionsPage })))
const TrzPage = lazy(() => import('./pages/Trz').then(m => ({ default: m.TrzPage })))
const ChecklistPage = lazy(() => import('./pages/Checklist').then(m => ({ default: m.ChecklistPage })))
const ClientProfilesPage = lazy(() => import('./pages/ClientProfiles').then(m => ({ default: m.ClientProfilesPage })))
const ImportPage = lazy(() => import('./pages/Import').then(m => ({ default: m.ImportPage })))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full min-h-[50vh] text-muted-foreground">
      <div className="flex items-center gap-2 text-sm">
        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Зареждане...
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <Toaster position="top-right" richColors />
      <HashRouter>
        <AuthProvider>
          <Suspense fallback={<PageFallback />}>
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
                <Route path="/worksheet" element={<WorkSheetPage />} />
                <Route path="/yearly" element={<YearlyViewPage />} />
                <Route path="/trz" element={<TrzPage />} />
                <Route path="/checklist" element={<ChecklistPage />} />
                <Route path="/profiles" element={<ClientProfilesPage />} />
                <Route path="/opportunities" element={
                  <ProtectedRoute allowedRoles={['admin']}><OpportunitiesPage /></ProtectedRoute>
                } />
                <Route path="/contacts" element={<ContactsPage />} />
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
                  <ProtectedRoute allowedRoles={['admin']}><AdminPage /></ProtectedRoute>
                } />
                <Route path="/import" element={
                  <ProtectedRoute allowedRoles={['admin']}><ImportPage /></ProtectedRoute>
                } />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </HashRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  )
}
