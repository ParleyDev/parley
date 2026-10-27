import WidgetPage from './pages/Widget'
import { LogoNeon } from './components/Logo'
import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './store'
import { connectSocket, disconnectSocket } from './lib/ws'
import AuthPage from './pages/Auth'
import AppShell from './pages/AppShell'
import InvitePage from './pages/Invite'
import TemplatePage from './pages/Template'
import AppDirectoryPage from './pages/AppDirectory'
import DevelopersPage from './pages/Developers'
import QrApprovePage from './pages/QrApprove'
import DiscoverPage from './pages/Discover'
import AdminPage from './pages/Admin'
import GuildPreviewPage from './pages/GuildPreview'
import VerifyPage from './pages/Verify'
import OAuthPage from './pages/OAuth'
import McpAuthorizePage from './pages/McpAuthorize'
import { ForgotPage, ResetPage } from './pages/PasswordReset'
import { api } from './lib/api'
import Toasts from './components/Toasts'
import { useParams } from 'react-router-dom'

export default function App() {
  const token = useStore((s) => s.token)
  const ready = useStore((s) => s.ready)
  const location = useLocation()

  useEffect(() => {
    if (token) connectSocket()
    else disconnectSocket()
    return () => disconnectSocket()
  }, [token])
  const setInstance = useStore((s) => s.setInstance)
  useEffect(() => { api.get<{ registration_enabled: boolean; announcement: string }>('/instance').then(setInstance).catch(() => {}) }, [setInstance])
  const isAdmin = useStore((s) => !!s.user?.is_admin)

  return (
    <>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/channels/@me" replace /> : <AuthPage mode="login" />} />
        <Route path="/register" element={token ? <Navigate to="/channels/@me" replace /> : <AuthPage mode="register" />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/confirm-email" element={<VerifyPage mode="change" />} />
        <Route path="/forgot" element={token ? <Navigate to="/channels/@me" replace /> : <ForgotPage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/widget/:guildId" element={<WidgetPage />} />
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/login/qr/:id" element={token ? <QrApprovePage /> : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/template/:code" element={token ? <TemplatePage /> : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/invite/:code" element={token ? <InvitePage /> : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/oauth2/authorize" element={token ? <OAuthPage /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
        <Route path="/oauth2/mcp/authorize" element={token ? <McpAuthorizePage /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
        <Route
          path="/channels/*"
          element={token ? (ready ? <AppShell /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
        <Route path="/admin/*" element={token ? (ready ? (isAdmin ? <AdminPage /> : <Navigate to="/channels/@me" replace />) : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/discover/review/*" element={token ? (ready ? <DiscoverPage /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/discover/:guildId/:channelId?" element={token ? (ready ? <GuildPreviewPage /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/app-directory" element={token ? (ready ? <AppDirectoryPage /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/discover/*" element={token ? (ready ? <DiscoverPage /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="/users/:userId" element={token ? (ready ? <ProfileLink /> : <Splash />) : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        <Route path="*" element={<Navigate to={token ? '/channels/@me' : '/login'} replace />} />
      </Routes>
      <Toasts />
    </>
  )
}

/** /users/:id (the "Copy Profile Link" target): open the app with that profile showing. */
function ProfileLink() {
  const { userId = '' } = useParams()
  const openModal = useStore((s) => s.openModal)
  useEffect(() => { if (userId) openModal({ kind: 'profile', userId }) }, [userId, openModal])
  return <Navigate to="/channels/@me" replace />
}

function Splash() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-bg-0">
      <LogoNeon className="h-14 w-14 rounded-2xl shadow-lg shadow-accent/30 animate-pulse" />
      <p className="text-text-2 text-sm">Connecting…</p>
    </div>
  )
}
