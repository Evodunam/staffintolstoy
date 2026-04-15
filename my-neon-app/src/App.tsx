import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/home'
import AuthPage from './pages/auth'
import AccountPage from './pages/account'
import CompanyDashboardPage from './pages/company-dashboard'
import WorkerDashboardPage from './pages/worker-dashboard'
import PrivacyPage from './pages/privacy'
import TermsPage from './pages/terms'
import { ProtectedRoute, PublicOnlyRoute, RoleProtectedRoute } from './components/route-guards'
import SiteFooter from './components/site-footer'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/auth/*"
          element={
            <PublicOnlyRoute>
              <AuthPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/account/*"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/company-dashboard"
          element={
            <RoleProtectedRoute allowedRoles={['company', 'admin']}>
              <CompanyDashboardPage />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/worker-dashboard"
          element={
            <RoleProtectedRoute allowedRoles={['worker', 'admin']}>
              <WorkerDashboardPage />
            </RoleProtectedRoute>
          }
        />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SiteFooter />
    </>
  )
}
