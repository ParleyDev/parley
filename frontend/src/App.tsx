import { APP_INITIAL } from './lib/brand'
import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './store'
import { connectSocket, disconnectSocket } from './lib/ws'
import AuthPage from './pages/Auth'
import AppShell from './pages/AppShell'
import InvitePage from './pages/Invite'
import Toasts from './components/Toasts'

export default function App() {
  const token = useStore((s) => s.token)
  const ready = useStore((s) => s.ready)
  const location = useLocation()

  useEffect(() => {
    if (token) connectSocket()
    else disconnectSocket()
    return () => disconnectSocket()
  }, [token])

  return (
    <>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/channels/@me" replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={token ? <Navigate to="/channels/@me" replace /> : <AuthPage mode="register" />} />
        <Route path="/invite/:code" element={token ? <InvitePage /> : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route
          path="/channels/*"
          element={token ? (ready ? <AppShell /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
        <Route path="*" element={<Navigate to={token ? '/channels/@me' : '/login'} replace />} />
      </Routes>
      <Toasts />
    </>
  )
}

function Splash() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-bg-0">
      <div className="h-14 w-14 rounded-2xl bg-accent flex items-center justify-center text-white font-extrabold text-2xl shadow-lg shadow-accent/30 animate-pulse">{APP_INITIAL}</div>
      <p className="text-text-2 text-sm">Connecting…</p>
    </div>
  )
}
