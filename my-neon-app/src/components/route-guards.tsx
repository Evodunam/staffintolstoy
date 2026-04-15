import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { authClient } from '../lib/auth'

type GuardProps = {
  children: ReactNode
}

type RoleGuardProps = GuardProps & {
  allowedRoles: string[]
}

const loadingStyle = { maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }

function getUserRole(session: unknown): string | null {
  const user = (session as any)?.data?.user
  return (
    user?.role ??
    user?.user_metadata?.role ??
    user?.metadata?.role ??
    user?.app_metadata?.role ??
    null
  )
}

export function ProtectedRoute({ children }: GuardProps) {
  const session = authClient.useSession()
  const location = useLocation()

  if (session.isPending) {
    return <main style={loadingStyle}>Checking session...</main>
  }

  if (!session.data) {
    const redirectTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/auth/sign-in" replace state={{ from: redirectTo }} />
  }

  return <>{children}</>
}

export function RoleProtectedRoute({ children, allowedRoles }: RoleGuardProps) {
  const session = authClient.useSession()
  const location = useLocation()

  if (session.isPending) {
    return <main style={loadingStyle}>Checking role access...</main>
  }

  if (!session.data) {
    const redirectTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/auth/sign-in" replace state={{ from: redirectTo }} />
  }

  const role = getUserRole(session)
  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to="/account" replace />
  }

  return <>{children}</>
}

export function PublicOnlyRoute({ children }: GuardProps) {
  const session = authClient.useSession()
  const location = useLocation()

  if (session.isPending) {
    return <main style={loadingStyle}>Checking session...</main>
  }

  if (session.data) {
    const destination = (location.state as { from?: string } | null)?.from ?? '/account'
    return <Navigate to={destination} replace />
  }

  return <>{children}</>
}
