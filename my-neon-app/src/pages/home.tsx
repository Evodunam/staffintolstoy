import { Link } from 'react-router-dom'
import { authClient } from '../lib/auth'

export default function HomePage() {
  const session = authClient.useSession()
  const userEmail = session.data?.user?.email
  const userRole =
    (session.data?.user as any)?.role ??
    (session.data?.user as any)?.user_metadata?.role ??
    (session.data?.user as any)?.metadata?.role ??
    (session.data?.user as any)?.app_metadata?.role

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>Neon Auth + Vite</h1>
      <p>Session status: {session.isPending ? 'loading...' : session.data ? 'signed in' : 'signed out'}</p>
      {userEmail ? <p>Current user: {userEmail}</p> : null}
      {userRole ? <p>Current role: {userRole}</p> : null}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <Link to="/auth/sign-in">Sign in / Sign up</Link>
        <Link to="/account">Account</Link>
        <Link to="/company-dashboard">Company dashboard</Link>
        <Link to="/worker-dashboard">Worker dashboard</Link>
      </div>
    </main>
  )
}
