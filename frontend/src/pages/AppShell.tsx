import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import GuildBar from '../components/GuildBar'
import ChannelSidebar from '../components/ChannelSidebar'
import DmSidebar from '../components/DmSidebar'
import ChatView from '../components/ChatView'
import MemberList from '../components/MemberList'
import HomeView from '../components/HomeView'
import RequestsView from '../components/RequestsView'
import VoiceView from '../components/VoiceView'
import Modals from '../components/modals'
import ErrorBoundary from '../components/ErrorBoundary'
import IncomingCall from '../components/IncomingCall'
import { VoiceInviteBanner } from '../components/CallExtras'
import MiniCall from '../components/MiniCall'
import UserPanel from '../components/UserPanel'
import { NavColumn } from '../components/SplitLayout'
import VerifyBanner from '../components/VerifyBanner'
import { lastChannel, rememberChannel } from '../lib/dm'
import { useSwipe } from '../lib/swipe'
import { useKeybinds } from '../lib/keybinds'
import { isDesktop, setNativeNavigator } from '../lib/native'
import { voice } from '../lib/voice'
import { initBadge } from '../lib/badge'
import { installLinkGuard } from '../lib/links'
import { getPrefs, setPrefs } from '../lib/prefs'
import StreamerBanner from '../components/StreamerBanner'
import UpdateBanner from '../components/UpdateBanner'
import { useMemo } from 'react'

/**
 * Two route trees share the URL: one picks the sidebar, one picks the main content.
 * On phones only one pane is on screen at a time (`mobilePane`); on wider screens
 * guild bar + sidebar + content + member list sit side by side.
 */
export default function AppShell() {
  useEffect(() => { initBadge() }, [])
  useEffect(() => installLinkGuard(), [])
  const connected = useStore((s) => s.connected)
  const pane = useStore((s) => s.mobilePane)
  const announcement = useStore((s) => s.instance.announcement)
  // Ask for notification permission on the first click/keypress, not at load: Safari/WebKit only allows the
  // prompt from a user gesture (and logs an error otherwise), and Chrome ranks gesture-driven prompts better.
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'default') return
    const ask = () => { try { Notification.requestPermission() } catch { /* ignore */ } cleanup() }
    const cleanup = () => { window.removeEventListener('pointerdown', ask); window.removeEventListener('keydown', ask) }
    window.addEventListener('pointerdown', ask, { once: true }); window.addEventListener('keydown', ask, { once: true })
    return cleanup
  }, [])
  return (
    <div className="h-full flex flex-col overflow-hidden relative safe-area">
      <a href="#messages" onClick={(e) => { e.preventDefault(); (document.querySelector<HTMLElement>('[data-message-list]') ?? document.querySelector<HTMLElement>('main'))?.focus() }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[300] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-white" data-skip-link>Skip to messages</a>
      <Shortcuts />
      <VerifyBanner />
      <StreamerBanner />
      <UpdateBanner />
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
      {!connected && (
        <div className="absolute top-0 inset-x-0 z-40 bg-warn text-black text-xs font-semibold text-center py-1">Reconnecting…</div>
      )}
      {announcement && connected && (
        <div className="absolute top-0 inset-x-0 z-40 bg-accent text-white text-xs font-semibold text-center py-1 px-3 truncate" data-announcement>{announcement}</div>
      )}
      <NavColumn hidden={pane === 'content'}>
        <div className="flex flex-1 min-h-0">
          <GuildBar />
          <Routes>
            <Route path="@me/*" element={<DmSidebar />} />
            <Route path=":guildId/*" element={<GuildSidebar />} />
            <Route path="*" element={<div className="w-[var(--sidebar-w)] tab:w-[224px] max-md:flex-1 bg-bg-1" />} />
          </Routes>
        </div>
        {/* Discord's self card floats across the bottom of both the server column and the channel list. */}
        <UserPanel />
      </NavColumn>
      <ErrorBoundary>
      <Routes>
        <Route path="@me" element={<HomeView />} />
        <Route path="@me/requests" element={<RequestsView />} />
        <Route path="@me/:channelId" element={<DmChat />} />
        <Route path=":guildId" element={<GuildRedirect />} />
        <Route path=":guildId/:channelId" element={<GuildMain />} />
        <Route path="*" element={<Navigate to="/channels/@me" replace />} />
      </Routes>
      </ErrorBoundary>
      <Modals />
      <IncomingCall />
      <VoiceInviteBanner />
      <MiniCall />
      </div>
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

/** `/channels/:guildId` lands on the channel you last had open in that server, else its first text channel. */
/** /channels/:guildId — render the remembered (or first text) channel straight away and tidy the URL. */
function GuildRedirect() {
  const { guildId = '' } = useParams()
  const channels = useStore((s) => s.channels)
  const guild = useStore((s) => s.guilds[guildId])
  const navigate = useNavigate()
  const remembered = lastChannel(guildId)
  const target = (remembered && channels[remembered]?.guild_id === guildId ? channels[remembered] : undefined)
    ?? Object.values(channels).filter((c) => c.guild_id === guildId && c.kind === 'text').sort((a, b) => a.position - b.position)[0]
  const targetId = target?.id
  // Rendering never waits for the navigation: the URL is fixed up for bookmarks/reloads, but the view is already there.
  useEffect(() => { if (guild && targetId) navigate(`/channels/${guildId}/${targetId}`, { replace: true }) }, [guild, guildId, targetId, navigate])
  if (!guild) return <Navigate to="/channels/@me" replace />
  if (!targetId) return <div className="flex-1 max-md:hidden" />
  return <GuildMain channelOverride={targetId} />
}

function GuildMain({ channelOverride }: { channelOverride?: string } = {}) {
  const params = useParams()
  const guildId = params.guildId ?? ''
  const channelId = channelOverride ?? params.channelId ?? ''
  useEffect(() => { if (guildId && channelId) rememberChannel(guildId, channelId) }, [guildId, channelId])
  const guild = useStore((s) => s.guilds[guildId])
  const channel = useStore((s) => s.channels[channelId])
  const loadMembers = useStore((s) => s.loadMembers)
  const hasMembers = useStore((s) => !!s.membersLoaded[guildId])
  const navigate = useNavigate()

  useEffect(() => { if (guild && !hasMembers) loadMembers(guildId) }, [guild, guildId, hasMembers, loadMembers])
  useEffect(() => { if (guild && !channel && !channelOverride) navigate(`/channels/${guildId}`, { replace: true }) }, [guild, channel, guildId, navigate, channelOverride])

  if (!guild) return <Navigate to="/channels/@me" replace />
  if (!channel || channel.guild_id !== guildId) return <div className="flex-1 max-md:hidden" />
  return (
    <>
      {channel.kind === 'voice' || channel.kind === 'stage' || channel.kind === 'studio' ? <VoiceView channel={channel} /> : <ChatView channel={channel} />}
      <MemberList guildId={guildId} />
    </>
  )
}


/** Phone swipes (content → channel list / member list) and the rebindable keyboard shortcuts. Renders nothing. */
function Shortcuts() {
  const nav = useNavigate()
  useEffect(() => { setNativeNavigator((p) => nav(p)) }, [nav])
  // AppShell is mounted at /channels/*, so read the ids from the path rather than useParams.
  const { pathname } = useLocation()
  const [, guildId, channelId] = /^\/channels\/([^/]+)(?:\/([^/]+))?/.exec(pathname) ?? []
  const navigate = useNavigate()
  const pane = useStore((s) => s.mobilePane)
  const membersOpen = useStore((s) => s.membersOpen)
  const setMembersOpen = useStore((s) => s.setMembersOpen)
  const setMobilePane = useStore((s) => s.setMobilePane)
  const openModal = useStore((s) => s.openModal)
  const selfMute = useStore((s) => s.selfMute)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const inGuild = !!guildId && guildId !== '@me'
  const swipe = useMemo(() => ({
    onRight: () => { if (membersOpen) setMembersOpen(false); else if (pane === 'content') setMobilePane('nav') },
    onLeft: () => { if (pane === 'content' && inGuild && !membersOpen) setMembersOpen(true) },
  }), [membersOpen, pane, inGuild, setMembersOpen, setMobilePane])
  useSwipe(swipe, typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  // Alt+↑/↓ walk the sidebar as it is shown (categories, collapsed ones, pins aside, or the DM list), so the
  // order always matches what you see; the unread variants skip to the next row marked unread.
  const step = (dir: -1 | 1, unreadOnly = false) => {
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('[data-channel-item] > a[href], aside a[data-dm-row][href], aside a[data-group-row][href]')]
    const here = rows.findIndex((a) => a.getAttribute('href') === location.pathname)
    for (let i = here + dir; i >= 0 && i < rows.length; i += dir) {
      if (!unreadOnly || rows[i].dataset.unread === 'true') { navigate(rows[i].getAttribute('href')!); return }
    }
  }
  // Ctrl+Alt+↑/↓: the next server in the server bar.
  const stepServer = (dir: -1 | 1) => {
    const ids = [...document.querySelectorAll<HTMLElement>('[data-guild-icon]')].map((el) => el.dataset.guildIcon!)
    const i = ids.indexOf(guildId ?? '')
    const next = ids[i < 0 ? (dir > 0 ? 0 : ids.length - 1) : i + dir]
    if (next) navigate(`/channels/${next}`)
  }
  const handlers = useMemo(() => ({
    toggleMute: () => voice.setMute(!useStore.getState().selfMute),
    toggleDeafen: () => voice.setDeaf(!useStore.getState().selfDeaf),
    toggleMembers: () => setMembersOpen(!useStore.getState().membersOpen),
    focusComposer: () => document.querySelector<HTMLTextAreaElement>('textarea.composer-input')?.focus(),
    prevChannel: () => step(-1),
    nextChannel: () => step(1),
    openSettings: () => openModal({ kind: 'userSettings', tab: 'account' }),
    jumpToDate: () => document.querySelector<HTMLButtonElement>('[data-jump-date-btn]')?.click(),
    toggleStreamer: () => { const on = !getPrefs().streamer; setPrefs({ streamer: on }); useStore.getState().pushToast(on ? 'Streamer Mode on' : 'Streamer Mode off') },
    quickSwitcher: () => { const s = useStore.getState(); if (s.modal?.kind === 'quickSwitcher') s.closeModal(); else openModal({ kind: 'quickSwitcher' }) },
    prevUnread: () => step(-1, true),
    nextUnread: () => step(1, true),
    prevServer: () => stepServer(-1),
    nextServer: () => stepServer(1),
    toggleInbox: () => document.querySelector<HTMLButtonElement>('[data-inbox-toggle]')?.click(),
    togglePins: () => document.querySelector<HTMLButtonElement>('[data-pins-toggle]')?.click(),
    showShortcuts: () => { const s = useStore.getState(); if (s.modal?.kind === 'shortcuts') s.closeModal(); else openModal({ kind: 'shortcuts' }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [guildId, channelId, selfMute, selfDeaf])
  useKeybinds(handlers)
  // Typing a letter with nothing focused starts a message, as in Discord.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return
      const el = document.activeElement as HTMLElement | null
      if (el && el !== document.body && (el.matches('input, textarea, select, [contenteditable="true"]') || el.closest('[role=dialog], [role=menu], [data-context-menu]'))) return
      if (useStore.getState().modal) return
      document.querySelector<HTMLTextAreaElement>('textarea.composer-input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The desktop app has no browser chrome: Alt+Left/Right and the mouse's back/forward buttons move through history.
  useEffect(() => {
    if (!isDesktop()) return
    // Not while typing: Alt/Option+arrows move the caret by word there.
    const onKey = (e: KeyboardEvent) => { if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !document.activeElement?.matches('input, textarea, [contenteditable="true"]')) { e.preventDefault(); if (e.key === 'ArrowLeft') history.back(); else history.forward() } }
    const onMouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); if (e.button === 3) history.back(); else history.forward() } }
    window.addEventListener('keydown', onKey); window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse) }
  }, [])
  // Event reminders: ten minutes before an event you RSVPed to (once per event per browser).
  const events = useStore((s) => s.events)
  const pushToast = useStore((s) => s.pushToast)
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      for (const list of Object.values(events)) for (const e of list) {
        if (!e.me_rsvp || useStore.getState().notifSettings[e.guild_id]?.mute_events) continue
        const ms = new Date(e.starts_at).getTime() - now
        if (ms > 10 * 60 * 1000 || ms < -60 * 1000) continue
        const key = `parley.reminded.${e.id}`
        try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1') } catch { /* ignore */ }
        const when = ms <= 0 ? 'is starting now' : `starts in ${Math.max(1, Math.round(ms / 60000))} min`
        pushToast(`${e.name} ${when}`)
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification(e.name, { body: `Event ${when}` }) } catch { /* ignore */ }
      }
    }
    tick(); const t = setInterval(tick, 30 * 1000); return () => clearInterval(t)
  }, [events, pushToast])
  return null
}
