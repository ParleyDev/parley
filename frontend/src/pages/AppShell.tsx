import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import GuildBar from '../components/GuildBar'
import ChannelSidebar from '../components/ChannelSidebar'
import DmSidebar from '../components/DmSidebar'
import ChatView from '../components/ChatView'
import MemberList from '../components/MemberList'
import HomeView from '../components/HomeView'
import VoiceView from '../components/VoiceView'
import Modals from '../components/modals'
import ErrorBoundary from '../components/ErrorBoundary'
import IncomingCall from '../components/IncomingCall'
import UserPanel from '../components/UserPanel'

/**
 * Two route trees share the URL: one picks the sidebar, one picks the main content.
 * On phones only one pane is on screen at a time (`mobilePane`); on wider screens
 * guild bar + sidebar + content + member list sit side by side.
 */
export default function AppShell() {
  const connected = useStore((s) => s.connected)
  const pane = useStore((s) => s.mobilePane)
  useEffect(() => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch { /* ignore */ }
  }, [])
  return (
    <div className="h-full flex overflow-hidden relative">
      {!connected && (
        <div className="absolute top-0 inset-x-0 z-40 bg-warn text-black text-xs font-semibold text-center py-1">Reconnecting…</div>
      )}
      <div className={`flex flex-col h-full shrink-0 w-[344px] max-md:w-auto max-md:absolute max-md:inset-0 max-md:z-20 ${pane === 'content' ? 'max-md:hidden' : ''}`}>
        <div className="flex flex-1 min-h-0">
          <GuildBar />
          <Routes>
            <Route path="@me/*" element={<DmSidebar />} />
            <Route path=":guildId/*" element={<GuildSidebar />} />
            <Route path="*" element={<div className="w-[272px] max-md:flex-1 bg-bg-1" />} />
          </Routes>
        </div>
        {/* Discord's self card floats across the bottom of both the server column and the channel list. */}
        <UserPanel />
      </div>
      <ErrorBoundary>
      <Routes>
        <Route path="@me" element={<HomeView />} />
        <Route path="@me/:channelId" element={<DmChat />} />
        <Route path=":guildId" element={<GuildRedirect />} />
        <Route path=":guildId/:channelId" element={<GuildMain />} />
        <Route path="*" element={<Navigate to="/channels/@me" replace />} />
      </Routes>
      </ErrorBoundary>
      <Modals />
      <IncomingCall />
    </div>
  )
}

function GuildSidebar() {
  const { guildId = '' } = useParams()
  return <ChannelSidebar guildId={guildId} />
}

function DmChat() {
  const { channelId = '' } = useParams()
  const dm = useStore((s) => s.dms[channelId])
  const setMobilePane = useStore((s) => s.setMobilePane)
  // Any way of landing on a DM (sidebar, profile "Message", search) should reveal it on phones.
  useEffect(() => { if (dm) setMobilePane('content') }, [channelId, dm, setMobilePane])
  if (!dm) return <Navigate to="/channels/@me" replace />
  return <ChatView channel={dm} />
}

function GuildRedirect() {
  const { guildId = '' } = useParams()
  const first = useStore((s) => Object.values(s.channels).filter((c) => c.guild_id === guildId && c.kind === 'text').sort((a, b) => a.position - b.position)[0])
  const guild = useStore((s) => s.guilds[guildId])
  if (!guild) return <Navigate to="/channels/@me" replace />
  if (!first) return <div className="flex-1 max-md:hidden" />
  return <Navigate to={`/channels/${guildId}/${first.id}`} replace />
}

function GuildMain() {
  const { guildId = '', channelId = '' } = useParams()
  const guild = useStore((s) => s.guilds[guildId])
  const channel = useStore((s) => s.channels[channelId])
  const loadMembers = useStore((s) => s.loadMembers)
  const hasMembers = useStore((s) => !!s.membersLoaded[guildId])
  const navigate = useNavigate()

  useEffect(() => { if (guild && !hasMembers) loadMembers(guildId) }, [guild, guildId, hasMembers, loadMembers])
  useEffect(() => { if (guild && !channel) navigate(`/channels/${guildId}`, { replace: true }) }, [guild, channel, guildId, navigate])

  if (!guild) return <Navigate to="/channels/@me" replace />
  if (!channel || channel.guild_id !== guildId) return <div className="flex-1 max-md:hidden" />
  return (
    <>
      {channel.kind === 'voice' ? <VoiceView channel={channel} /> : <ChatView channel={channel} />}
      <MemberList guildId={guildId} />
    </>
  )
}
