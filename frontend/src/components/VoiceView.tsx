import { CaptionsButton, CaptionsOverlay } from './Captions'
import { STORAGE_PREFIX } from '../lib/brand'
import { useShallow } from 'zustand/react/shallow'
import { Disc3, Hand, Megaphone, HeadphoneOff, ListMusic, Maximize2, MessageSquare, Mic, MicOff, Minimize2, Monitor, MonitorOff, MonitorUp, MoreHorizontal, Music2, PhoneOff, Radio, Video, VideoOff, Volume2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isUnread, myChannelPerms, useStore, voiceParticipants } from '../store'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { useUserAudioMap } from '../lib/userAudio'
import { has, P } from '../lib/perms'
import { api } from '../lib/api'
import { isPhone } from '../lib/swipe'
import type { Channel, User, VoiceState } from '../lib/types'
import { screenShareSupported, voice } from '../lib/voice'
import Avatar from './Avatar'
import StudioPanel from './StudioPanel'
import { ActivitiesButton, ActivityChips, ActivityFrame, ClipButton } from './Activities'
import { loadActivities, useActivities, useCallActivities } from '../lib/activities'
import { CameraMenu, CheckRow, ControlBar, ControlButton, ControlGroup, HangUpButton, MenuControl, MenuDivider, MicMenu, SettingsRow, SplitControl } from './CallControls'
import { useResizablePanel } from '../lib/resize'
import { studio as studioRec } from '../lib/studio'
import CallLock from './CallLock'
import SoundboardPicker from './SoundboardPicker'
import { ConnQuality, InviteToVoice, ReactButton, StreamViewers, TileReactions, ZoomPan } from './CallExtras'
import VideoTile, { FitToggle, StopWatching, StreamGate, useVideoFit } from './VideoTile'
import ChatPane from './ChatPane'
import { MembersToggle, MobileBack } from './HeaderBits'
import { t, useT } from '../lib/i18n'

type Tile = { key: string; userId: string; kind: 'camera' | 'screen'; user: User | undefined; state: VoiceState; stream: MediaStream | null; isMe: boolean }

const CHAT_KEY = `${STORAGE_PREFIX}voiceChat`
const VIEW_KEY = `${STORAGE_PREFIX}voiceView`
const loadView = (): { self: boolean; nonVideo: boolean } => { try { return { self: true, nonVideo: true, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') } } catch { return { self: true, nonVideo: true } } }

export default function VoiceView({ channel }: { channel: Channel }) {
  const t = useT()
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const speaking = useStore((s) => s.speaking)
  const peerStatus = useStore((s) => s.peerStatus)
  const selfMute = useStore((s) => s.selfMute)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const localCamera = useStore((s) => s.localCamera)
  const localScreen = useStore((s) => s.localScreen)
  const remoteMedia = useStore((s) => s.remoteMedia)
  const hidden = useUserAudioMap()
  const watching = useStore((s) => s.watching)
  const unread = useStore((s) => isUnread(s, channel.id))
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const [priorityOn, setPriorityOn] = useState(() => voice.priorityOn)
  const canConnect = has(perms, P.CONNECT)
  const canStream = has(perms, P.STREAM)
  const suppressed = useStore((s) => !!(s.user && s.voiceStates[s.user.id]?.suppress))
  const myVs = useStore((s) => (s.user ? s.voiceStates[s.user.id] : undefined))
  const [focused, setFocused] = useState<string | null>(null)
  const [chat, setChat] = useState(() => { try { return localStorage.getItem(CHAT_KEY) === '1' } catch { return false } })
  // Soundboard: the server's sounds, loaded when the picker first opens; playing is a REST call the server fans out.
  const sounds = useStore((s) => (channel.guild_id ? s.sounds[channel.guild_id] : undefined))
  const loadSounds = useStore((s) => s.loadSounds)
  const pushToast = useStore((s) => s.pushToast)
  const canSpeak = has(perms, P.SPEAK)
  const [board, setBoard] = useState(false)
  // Stage channels: speakers are the unsuppressed participants; everyone else is the audience (can raise a hand).
  const isStudio = channel.kind === 'studio'
  const isStage = channel.kind === 'stage' || isStudio
  const engineers = channel.engineer_ids ?? []
  const isEngineer = isStudio && !!me && engineers.includes(me.id)
  // Stage moderators: Manage Channels, or Mute + Move Members on this stage (backend perms::stage_mod).
  const isMod = has(perms, P.MANAGE_CHANNELS) || (has(perms, P.MUTE_MEMBERS) && has(perms, P.MOVE_MEMBERS)) || isEngineer
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const chatPanel = useResizablePanel('voiceChat', 400)
  const sessionsPanel = useResizablePanel('studioSessions', 420)
  const liveSession = useStore((s) => (isStudio ? s.studio[channel.id]?.find((x) => !x.ended_at) : undefined))
  const [recBusy, setRecBusy] = useState(false)
  const record = async () => {
    setRecBusy(true)
    try { if (liveSession) await api.post(`/channels/${channel.id}/studio/sessions/${liveSession.id}/stop`); else await api.post(`/channels/${channel.id}/studio/sessions`, { name: '' }) } catch (e) { pushToast((e as Error).message, 'error') } finally { setRecBusy(false) }
  }
  const setRole = async (uid: string, role: 'engineer' | 'artist' | 'audience') => { try { await api.put(`/channels/${channel.id}/studio/role/${uid}`, { role }); setRoleMenu(null) } catch (e) { pushToast((e as Error).message, 'error') } }
  const [roleMenu, setRoleMenu] = useState<string | null>(null)
  const roleOf = (uid: string, suppress: boolean | undefined) => (engineers.includes(uid) ? 'engineer' : suppress ? 'audience' : 'artist')
  /** Promote / demote between engineer, artist and audience; moderators and engineers for anyone, members can step down. */
  const RoleMenu = ({ uid }: { uid: string }) => {
    const st = participants.find((x) => x.user_id === uid)
    const cur = roleOf(uid, st?.suppress)
    const self = uid === me?.id
    const open = roleMenu === uid
    const options: ('engineer' | 'artist' | 'audience')[] = isMod ? ['engineer', 'artist', 'audience'] : cur === 'engineer' ? ['artist', 'audience'] : cur === 'artist' ? ['audience'] : []
    if (!options.length) return null
    return (
      <span className="relative inline-flex" data-role-menu={uid} data-role={cur}>
        <button type="button" onClick={() => setRoleMenu(open ? null : uid)} className={`rounded-md px-2 py-0.5 text-[11px] font-bold capitalize ${cur === 'engineer' ? 'bg-warn text-black' : cur === 'artist' ? 'bg-accent text-white' : 'bg-bg-4 text-text-1'} hover:brightness-110`} aria-haspopup="menu" aria-expanded={open} data-role-button>{self && !isMod ? t('Step down') : cur === 'engineer' ? t('Engineer') : cur === 'artist' ? t('Artist') : t('Audience')} ▾</button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setRoleMenu(null)} />
            <div className="pop absolute right-0 top-full mt-1 z-40 w-40 rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5" role="menu">
              {options.map((r) => <button key={r} type="button" role="menuitemradio" aria-checked={cur === r} onClick={() => setRole(uid, r)} className={`w-full rounded-md px-2 py-1.5 text-left text-sm capitalize hover:bg-accent hover:text-white ${cur === r ? 'text-text-0 font-semibold' : 'text-text-1'}`} data-role-option={r}>{r === 'engineer' ? t('Engineer') : r === 'artist' ? t('Artist (band)') : t('Audience')}{cur === r ? ' ✓' : ''}</button>)}
            </div>
          </>
        )}
      </span>
    )
  }
  useEffect(() => { if (isStudio) loadStudioList(channel.id) }, [isStudio, channel.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const myState = useStore((s) => (s.user ? s.voiceStates[s.user.id] : undefined))
  const handUp = !!myState?.request_to_speak
  const stageCall = async (method: 'post' | 'put' | 'delete', path: string) => { try { await api[method](path) } catch (e) { pushToast((e as Error).message, 'error') } }
  const loadStudioList = useStore((s) => s.loadStudio)
  const toggleHand = () => stageCall(handUp ? 'delete' : 'post', `/channels/${channel.id}/stage/hand`)
  const inviteToSpeak = (uid: string) => stageCall('put', `/channels/${channel.id}/stage/speakers/${uid}`)
  const toAudience = (uid: string) => stageCall('delete', `/channels/${channel.id}/stage/speakers/${uid}`)
  const audience = isStage ? participants.filter((p) => p.suppress) : []
  useEffect(() => { if (board && channel.guild_id && !sounds) loadSounds(channel.guild_id) }, [board, channel.guild_id, sounds, loadSounds])
  const playSound = async (id: string) => { try { await api.post(`/channels/${channel.id}/soundboard/${id}`) } catch (e) { pushToast((e as Error).message, 'error') } }
  const inThis = myChannel === channel.id
  const activities = useCallActivities(channel.id)
  const openActivity = useActivities((s) => s.open)
  const activity = inThis ? activities.find((a) => a.id === openActivity) : undefined
  useEffect(() => { void loadActivities(channel.id) }, [channel.id, inThis])
  // Every voice, stage and studio channel shows a join splash until you connect.
  const preJoin = !inThis
  const toggleChat = () => setChat((c) => { try { localStorage.setItem(CHAT_KEY, c ? '0' : '1') } catch { /* ignore */ } return !c })

  // Build tiles: one per participant (camera or avatar) plus one per active screen share.
  const tiles: Tile[] = []
  for (const p of participants) {
    if (isStage && p.suppress) continue
    const isMe = me?.id === p.user_id
    const user = users[p.user_id] ?? (isMe ? me ?? undefined : undefined)
    const media = isMe ? { camera: localCamera, screen: localScreen } : remoteMedia[p.user_id]
    if (p.self_stream) tiles.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: 'screen', user, state: p, stream: media?.screen ?? null, isMe })
    // A camera you hid in their user menu shows their avatar instead.
    tiles.push({ key: `${p.user_id}:camera`, userId: p.user_id, kind: 'camera', user, state: p, stream: p.self_video && !(!isMe && hidden[p.user_id]?.hideVideo) ? media?.camera ?? null : null, isMe })
  }
  const screenKeys = tiles.filter((x) => x.kind === 'screen').map((x) => x.key).join(',')

  // Auto-focus a newly started screen share (Discord-like); drop focus if that tile went away.
  useEffect(() => {
    const keys = screenKeys ? screenKeys.split(',') : []
    setFocused((f) => {
      if (f && !tiles.some((x) => x.key === f)) return keys[0] ?? null
      if (!f && keys.length) return keys[0]
      return f
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKeys, tiles.length])

  // View options (More menu): hide your own camera tile and/or tiles without video. If that would empty the stage,
  // everyone is shown rather than a blank grid.
  const [view, setViewState] = useState(loadView)
  const setView = (patch: Partial<typeof view>) => setViewState((v) => { const n = { ...v, ...patch }; try { localStorage.setItem(VIEW_KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })
  const filtered = tiles.filter((x) => x.kind === 'screen' || ((view.self || !x.isMe) && (view.nonVideo || !!x.stream)))
  const shown = filtered.length ? filtered : tiles
  const focusTile = focused ? shown.find((x) => x.key === focused) : undefined
  const strip = focusTile ? shown.filter((x) => x.key !== focused) : []
  const count = participants.length

  const phone = usePhone()
  const videoFit = useVideoFit()
  // Right-click a tile: the person's menu, with their volume and local mute while you're in the call.
  const userMenu = useUserMenu(channel.guild_id)
  const tileMenu = useContextMenu()
  const toggleFullscreen = (el: HTMLElement) => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else el.requestFullscreen?.().catch(() => {}) }
  const renderTile = (tile: Tile, big: boolean) => {
    const talking = tile.kind === 'camera' && !!speaking[tile.userId]
    const status = tile.kind !== 'camera' ? null : tile.isMe ? (connecting ? 'connecting' : 'connected') : inThis ? peerStatus[tile.userId] ?? 'connecting' : null
    const name = tile.user?.display_name ?? t('Unknown')
    return (
      <div key={tile.key} onClick={() => setFocused(focused === tile.key ? null : tile.key)} onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget) }}
        onContextMenu={(e) => { if (!tile.isMe || tile.kind === 'camera') tileMenu.open(e, userMenu({ id: tile.userId, display_name: name }, e.currentTarget.getBoundingClientRect())) }}
        className={`group relative overflow-hidden rounded-2xl bg-bg-2 border-2 transition-colors cursor-pointer ${talking ? 'border-success' : 'border-line'} ${big ? 'h-full w-full' : 'aspect-video'}`} data-voice-tile={tile.userId} data-tile-big={big ? '1' : '0'} title={big ? t('Click to return to the grid · double-click for fullscreen') : t('Click to focus · double-click for fullscreen')}>
        {isStage && isMod && inThis && !tile.isMe && tile.kind === 'camera' && <button type="button" onClick={(e) => { e.stopPropagation(); toAudience(tile.userId) }} className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100" data-to-audience>{t('Move to audience')}</button>}
        {isStudio && tile.kind === 'camera' && engineers.includes(tile.userId) && <span className="absolute left-2 top-2 z-10 rounded-md bg-warn px-1.5 py-0.5 text-[10px] font-bold uppercase text-black" data-engineer-badge>{t('Engineer')}</span>}
        {isStudio && tile.kind === 'camera' && !engineers.includes(tile.userId) && !tile.state.suppress && <span className="absolute left-2 top-2 z-10 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" data-artist-badge>{t('Artist')}</span>}
        {isStudio && tile.kind === 'camera' && (isMod || tile.isMe) && <span className="absolute right-2 top-2 z-10" onClick={(e) => e.stopPropagation()}><RoleMenu uid={tile.userId} /></span>}
        {tile.kind === 'screen' && !tile.isMe && !watching[tile.userId] ? (
          <StreamGate user={tile.user} big={big} canWatch={inThis} onWatch={() => voice.watch(tile.userId, true)} channelId={channel.id} />
        ) : tile.stream && tile.kind === 'screen' ? (
          <ZoomPan><VideoTile stream={tile.stream} mirror={false} contain /></ZoomPan>
        ) : tile.stream ? (
          <VideoTile stream={tile.stream} mirror={tile.isMe && tile.kind === 'camera'} contain={videoFit === 'fit' || tile.kind === 'screen'} />
        ) : tile.kind === 'screen' ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-text-2"><Monitor size={big ? 64 : 40} /><span className="text-sm">{t('Loading stream…')}</span></div>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <div className={`rounded-full transition-shadow ${talking ? 'ring-4 ring-success/70' : ''}`}>
              {tile.user ? <Avatar user={tile.user} size={big ? 160 : 96} /> : <div className="h-24 w-24 rounded-full bg-bg-4" />}
            </div>
          </div>
        )}
        <div className="absolute left-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-bg-0/80 px-2 py-1 text-sm font-semibold">
          {tile.kind === 'screen' && <Monitor size={14} className="text-success" />}
          <span className="truncate max-w-[200px]">{tile.kind === 'screen' ? t("{name}'s screen", { name }) : name}</span>
          {tile.kind === 'camera' && (tile.state.self_deaf ? <HeadphoneOff size={14} className="text-danger" /> : tile.state.self_mute ? <MicOff size={14} className="text-danger" /> : null)}
        </div>
        {tile.kind === 'screen' && <span className="absolute left-3 top-3 rounded-md bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">{t('LIVE')}</span>}
        {tile.kind === 'screen' && <StreamViewers streamerId={tile.userId} channelId={channel.id} />}
        {tile.kind === 'camera' && <TileReactions userId={tile.userId} />}
        {status && status !== 'connected' && (
          <span className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${status === 'failed' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{status === 'failed' ? t('No route') : t('Connecting')}</span>
        )}
        <div className="absolute right-3 bottom-3 flex items-center gap-1">
          {tile.kind === 'camera' && !tile.isMe && inThis && <ConnQuality userId={tile.userId} />}
          {tile.stream && tile.kind === 'camera' && <FitToggle />}
          {tile.kind === 'screen' && !tile.isMe && watching[tile.userId] && <StopWatching onStop={() => voice.watch(tile.userId, false)} />}
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget.closest('[data-voice-tile]') as HTMLElement) }} title={t('Fullscreen')} aria-label={t('Fullscreen')} className="rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 hover:text-text-0" data-tile-fullscreen>{document.fullscreenElement ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </div>
      </div>
    )
  }

  const chatToggle = (
    <button onClick={toggleChat} title={chat ? t('Hide Chat') : t('Show Chat')} className={`relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${chat ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`}>
      <MessageSquare size={20} />
      {unread && !chat && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg-0" />}
    </button>
  )

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-0 relative">
      {tileMenu.menu && <ContextMenu {...tileMenu.menu} onClose={tileMenu.close} label={t('Participant')} />}
      <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line">
        <MobileBack />
        {isStudio ? <Disc3 size={22} className="text-text-2 shrink-0" /> : isStage ? <Radio size={22} className="text-text-2 shrink-0" /> : <Volume2 size={22} className="text-text-2 shrink-0" />}<span className="font-bold truncate">{channel.name}</span>
        {isStudio && liveSession && <span className="flex items-center gap-1.5 rounded-full bg-danger/20 px-2 py-0.5 text-[11px] font-bold uppercase text-danger" data-studio-rec><span className="h-2 w-2 rounded-full bg-danger animate-pulse" />{t('REC · {name}', { name: liveSession.name })}</span>}
        {/* Phones: the name and the people count; encryption and channel status are a desktop header's details. */}
        <span className="max-md:hidden flex"><CallLock channelId={channel.id} /></span>
        <span className="text-xs text-text-2 whitespace-nowrap" data-voice-count>{isStage ? t('{n} speaking · {m} listening', { n: tiles.length, m: audience.length }) : t('{n} connected', { n: count })}</span>
        {channel.kind === 'voice' && <span className="max-md:hidden contents"><VoiceStatus channel={channel} canSet={inThis || has(myChannelPerms(useStore.getState(), channel.id), P.MANAGE_CHANNELS)} /></span>}
        {inThis && suppressed && <span className="rounded-md bg-danger/20 text-danger px-2 py-0.5 text-[11px] font-bold uppercase">{t('Muted by server')}</span>}
        {inThis && !suppressed && myVs?.deaf && <span className="rounded-md bg-danger/20 text-danger px-2 py-0.5 text-[11px] font-bold uppercase" data-server-deafened>{t('Deafened by a moderator')}</span>}
        {inThis && !suppressed && !myVs?.deaf && myVs?.mute && <span className="rounded-md bg-danger/20 text-danger px-2 py-0.5 text-[11px] font-bold uppercase" data-server-muted>{t('Muted by a moderator')}</span>}
        <span className="ml-auto flex items-center gap-1">
          {isStudio && <button onClick={() => setSessionsOpen((o) => !o)} title={t('Sessions')} className={`h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${sessionsOpen ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-studio-toggle><ListMusic size={20} /></button>}
          {chatToggle}<MembersToggle /></span>
      </header>

      <div className="flex-1 min-h-0 flex" ref={(el) => { chatPanel.setContainer(el); sessionsPanel.setContainer(el) }}>
        {/* Stage */}
        <div className="flex-1 min-w-0 flex flex-col">
          {preJoin ? <PreJoin channel={channel} participants={participants} users={users} canConnect={canConnect} connecting={connecting} switching={!!myChannel} recording={liveSession?.name} /> : (
          <div className="flex-1 min-h-0 overflow-hidden p-4 max-md:p-2 flex flex-col gap-3">
            {!isStage && <ActivityChips channelId={channel.id} inCall={inThis} />}
            {count === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="h-20 w-20 rounded-full bg-bg-3 flex items-center justify-center mb-4"><Volume2 size={36} className="text-text-1" /></div>
                <h2 className="text-2xl font-bold">{channel.name}</h2>
                <p className="text-text-2 mt-2 max-w-sm">{t('No one is here yet. Join to start a call, or say something in chat.')}</p>
              </div>
            ) : activity ? (
              <>
                <div className="flex-1 min-h-0"><ActivityFrame session={activity} /></div>
                <div className="shrink-0 flex gap-3 overflow-x-auto pb-1">
                  {shown.map((x) => <div key={x.key} className="w-40 max-md:w-28 shrink-0">{renderTile(x, false)}</div>)}
                </div>
              </>
            ) : focusTile ? (
              <>
                <div className="flex-1 min-h-0">{renderTile(focusTile, true)}</div>
                {strip.length > 0 && (
                  <div className="shrink-0 flex gap-3 overflow-x-auto pb-1">
                    {strip.map((x) => <div key={x.key} className="w-48 max-md:w-36 shrink-0">{renderTile(x, false)}</div>)}
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="grid gap-4 max-md:gap-2 justify-center content-start" data-voice-grid style={{ gridTemplateColumns: phone ? (shown.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))') : `repeat(auto-fit, minmax(min(240px, 100%), ${shown.length <= 2 ? '480px' : '340px'}))` }}>
                  {shown.map((x) => renderTile(x, false))}
                </div>
              </div>
            )}
            <CaptionsOverlay guildId={channel.guild_id} />
            {isStage && audience.length > 0 && (
              <div className="shrink-0 rounded-xl border border-line bg-bg-2/60 px-3 py-2 max-h-[40%] overflow-y-auto" data-stage-audience data-studio-audience={isStudio ? '1' : undefined}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">{t('Audience — {n}', { n: audience.length })}</div>
                <div className="grid gap-2 justify-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                  {audience.map((p) => { const u = users[p.user_id] ?? (me?.id === p.user_id ? me : undefined); const talking = !!speaking[p.user_id]; return (
                    <div key={p.user_id} className="group relative flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center hover:bg-bg-3" data-audience={p.user_id} data-hand={p.request_to_speak ? '1' : '0'}>
                      <div className={`relative rounded-full ${talking ? 'ring-2 ring-success' : ''}`}>
                        {u ? <Avatar user={u} size={48} /> : <div className="h-12 w-12 rounded-full bg-bg-4" />}
                        {p.request_to_speak && <span className="absolute -right-1 -top-1 rounded-full bg-warn p-0.5 text-black"><Hand size={12} /></span>}
                        {(p.self_deaf || p.self_mute) && <span className="absolute -right-1 -bottom-1 rounded-full bg-bg-0 p-0.5 text-danger">{p.self_deaf ? <HeadphoneOff size={12} /> : <MicOff size={12} />}</span>}
                      </div>
                      <span className="w-full truncate text-xs text-text-1" data-audience-name>{u?.display_name ?? t('Unknown')}</span>
                      {!isStudio && isMod && inThis && <button type="button" onClick={() => inviteToSpeak(p.user_id)} className="whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white hover:bg-accent-hover" title={t('Invite to speak')} data-invite-speak>{t('Invite to speak')}</button>}
                      {isStudio && isMod && inThis && <span className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}><RoleMenu uid={p.user_id} /></span>}
                    </div>
                  ) })}
                </div>
              </div>
            )}
          </div>

          )}
          {!preJoin && <div className="shrink-0 px-3 pt-3 pb-4 max-md:px-2 max-md:pb-3 border-t border-line" data-voice-controls>
              <ControlBar>
                <ControlGroup>
                  <SplitControl chevronLabel={t('Microphone options')} menuKind="input" menu={(close) => <MicMenu close={close} />}>
                    <ControlButton label={selfMute ? t('Unmute') : t('Mute')} on={selfMute || selfDeaf} tone="danger" onClick={() => voice.setMute(!selfMute)}>{selfMute || selfDeaf ? <MicOff size={20} /> : <Mic size={20} />}</ControlButton>
                  </SplitControl>
                  {canStream && (
                    <SplitControl chevronLabel={t('Camera options')} menuKind="camera" menu={(close) => <CameraMenu close={close} />}>
                      <ControlButton label={localCamera ? t('Turn Off Camera') : t('Turn On Camera')} on={!!localCamera} onClick={() => voice.toggleCamera()}>{localCamera ? <Video size={20} /> : <VideoOff size={20} />}</ControlButton>
                    </SplitControl>
                  )}
                </ControlGroup>
                <ControlGroup>
                  {isStudio && isEngineer && (
                    <ControlButton label={liveSession ? t('Stop recording') : t('Record')} on={!!liveSession} tone="danger" onClick={record} disabled={recBusy} data-studio-record="">{liveSession ? <span className="h-3.5 w-3.5 rounded-sm bg-danger" /> : <span className="h-3.5 w-3.5 rounded-full bg-danger" />}</ControlButton>
                  )}
                  {isStage && suppressed && <ControlButton label={handUp ? t('Lower Hand') : t('Raise Hand')} on={handUp} onClick={toggleHand}><Hand size={20} /></ControlButton>}
                  {isStage && !suppressed && !isMod && <ControlButton label={t('Leave the stage')} onClick={() => toAudience(me!.id)}><Hand size={20} /></ControlButton>}
                  <ReactButton />
                  {inThis && <CaptionsButton channelId={channel.id} />}
                  {channel.guild_id && channel.kind === 'voice' && has(perms, P.PRIORITY_SPEAKER) && <ControlButton label={priorityOn ? t('Priority Speaker: on') : t('Priority Speaker')} on={priorityOn} onClick={() => { voice.setPriority(!priorityOn); setPriorityOn(!priorityOn) }} data-priority-toggle=""><Megaphone size={20} /></ControlButton>}
                  {channel.guild_id && channel.kind === 'voice' && <InviteToVoice channelId={channel.id} guildId={channel.guild_id} />}
                  {!isStage && <ActivitiesButton channelId={channel.id} />}
                  <ClipButton />
                  {canStream && (screenShareSupported() || localScreen) && <ControlButton label={localScreen ? t('Stop Sharing') : t('Share Your Screen')} on={!!localScreen} onClick={() => voice.toggleScreen()}>{localScreen ? <MonitorOff size={20} /> : <MonitorUp size={20} />}</ControlButton>}
                  {canSpeak && !suppressed && (
                    <span className="relative flex">
                      <ControlButton label={t('Soundboard')} on={board} onClick={() => setBoard((b) => !b)}><Music2 size={20} /></ControlButton>
                      {board && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setBoard(false)} />
                          <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-[320px] max-w-[calc(100vw-16px)] rounded-xl bg-bg-1 border border-line shadow-2xl p-3" data-soundboard>
                            <div className="flex items-center justify-between mb-2"><span className="font-bold text-sm">{t('Soundboard')}</span><span className="text-xs text-text-2">{sounds ? (sounds.length === 1 ? t('1 server sound') : t('{n} server sounds', { n: sounds.length })) : t('Loading…')}</span></div>
                            <SoundboardPicker guildId={channel.guild_id} onPlay={playSound} />
                          </div>
                        </>
                      )}
                    </span>
                  )}
                  <MenuControl label={t('More options')} icon={<MoreHorizontal size={20} />} menu={(close) => (
                    <div data-voice-more>
                      <CheckRow label={t('Grid View')} checked={!focusTile} onChange={(grid) => setFocused(grid ? null : (shown.find((x) => x.kind === 'screen') ?? shown[0])?.key ?? null)} data-view-grid="" />
                      <CheckRow label={t('Show My Own Camera')} checked={view.self} onChange={(v) => setView({ self: v })} data-view-self="" />
                      <CheckRow label={t('Show Non-Video Participants')} checked={view.nonVideo} onChange={(v) => setView({ nonVideo: v })} data-view-nonvideo="" />
                      <MenuDivider />
                      <SettingsRow label={t('Voice & Video Settings')} close={close} />
                    </div>
                  )} />
                </ControlGroup>
                <HangUpButton label={t('Disconnect')} onClick={() => { void studioRec.stop(); voice.leave() }} data-voice-leave="" />
              </ControlBar>
          </div>}
        </div>

        {isStudio && sessionsOpen && <StudioPanel channelId={channel.id} canManage={isMod} onClose={() => setSessionsOpen(false)} width={sessionsPanel.width} handle={<div {...sessionsPanel.handleProps} />} />}
        {/* Chat: side panel on wide screens, full overlay on phones. */}
        {chat && (
          <section className="relative flex flex-col bg-bg-2 border-l border-line shrink-0 max-md:absolute max-md:inset-0 max-md:w-auto max-md:border-l-0 max-md:z-10" data-layer="md" style={{ width: chatPanel.width }} data-voice-chat-panel>
            <div {...chatPanel.handleProps} />
            <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line">
              <MessageSquare size={18} className="text-text-2" />
              <span className="font-bold truncate">{channel.name}</span>
              <span className="text-xs text-text-2">{t('chat')}</span>
              {inThis && (
                <span className="ml-auto flex items-center gap-1 md:hidden">
                  <button title={selfMute ? t('Unmute') : t('Mute')} onClick={() => voice.setMute(!selfMute)} className={`h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${selfMute ? 'text-danger' : 'text-text-1'}`}>{selfMute ? <MicOff size={18} /> : <Mic size={18} />}</button>
                  <button title={t('Disconnect')} onClick={() => voice.leave()} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-danger"><PhoneOff size={18} /></button>
                </span>
              )}
              <button onClick={toggleChat} title={t('Close chat')} className={`h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0 ${inThis ? '' : 'ml-auto'}`}><X size={18} /></button>
            </div>
            <ChatPane channel={channel} />
          </section>
        )}
      </div>
    </main>
  )
}

/** Phone-sized layout? Re-evaluated on resize/rotation. */
function usePhone() {
  const [p, setP] = useState(isPhone)
  useEffect(() => { const mq = window.matchMedia('(max-width: 767px)'); const on = () => setP(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }, [])
  return p
}

/** "Alice", "Alice and Bob", "Alice, Bob, and 3 others" for `count` people of whom `names` are known. */
function peopleList(names: string[], count: number) {
  if (count === 1) return names[0] ?? t('Someone')
  if (count === 2 && names.length === 2) return t('{a} and {b}', { a: names[0], b: names[1] })
  const rest = count - Math.min(2, names.length)
  const list = names.slice(0, 2).join(', ')
  return rest === 1 ? t('{names}, and 1 other', { names: list }) : t('{names}, and {n} others', { names: list, n: rest })
}

/**
 * Before joining: who is there (Discord-style cards) and one Join button. Voice channels list everyone; stages and
 * studios show the people on stage (or in the band) as cards with the audience as a count, and a studio shows when
 * a session is recording.
 */
function PreJoin({ channel, participants, users, canConnect, connecting, switching, recording }: { channel: Channel; participants: VoiceState[]; users: Record<string, User>; canConnect: boolean; connecting: boolean; switching: boolean; recording?: string }) {
  const t = useT()
  const isStudio = channel.kind === 'studio', isStage = channel.kind === 'stage' || isStudio
  const onStage = isStage ? participants.filter((p) => !p.suppress) : participants
  const listening = participants.length - onStage.length
  const people = onStage.map((p) => users[p.user_id]).filter((u): u is User => !!u)
  const names = people.map((u) => u.display_name)
  const plist = peopleList(names, onStage.length), one = onStage.length === 1
  const lead = onStage.length === 0 ? (isStudio ? t('No one is in the studio') : isStage ? t('No one is on stage') : t('No one is currently in voice'))
    : isStudio ? (one ? t('{people} is in the studio', { people: plist }) : t('{people} are in the studio', { people: plist }))
    : isStage ? (one ? t('{people} is on stage', { people: plist }) : t('{people} are on stage', { people: plist }))
    : (one ? t('{people} is currently in voice', { people: plist }) : t('{people} are currently in voice', { people: plist }))
  const who = isStage && listening > 0 ? t('{lead} · {n} listening', { lead, n: listening }) : lead
  const Icon = isStudio ? Disc3 : isStage ? Radio : Volume2
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: 'radial-gradient(120% 70% at 50% 115%, color-mix(in srgb, var(--color-accent) 75%, transparent), transparent 75%), var(--color-bg-0)' }} data-voice-prejoin={channel.kind}>
      {people.length > 0 && (
        <div className="flex max-w-[520px] flex-wrap justify-center gap-2" data-prejoin-people>
          {people.slice(0, 6).map((u) => (
            <div key={u.id} title={u.display_name} className="flex h-[88px] w-[156px] max-md:h-16 max-md:w-28 items-center justify-center rounded-lg bg-bg-3" style={u.theme_accent ? { backgroundColor: u.theme_accent } : undefined}>
              <Avatar user={u} size={44} />
            </div>
          ))}
        </div>
      )}
      <div className="max-w-full">
        {recording !== undefined && <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-0.5 text-[11px] font-bold uppercase text-danger" data-prejoin-rec><span className="h-2 w-2 rounded-full bg-danger animate-pulse" />{t('Recording')}{recording ? ` · ${recording}` : ''}</span>}
        <h2 className="flex items-center justify-center gap-2 text-3xl max-md:text-2xl font-bold"><Icon size={30} className="text-text-1 shrink-0" /><span className="truncate">{channel.name}</span></h2>
        {isStage && channel.topic && <p className="mt-1 text-sm text-text-0">{channel.topic}</p>}
        <p className="mt-1.5 text-sm text-text-1" data-prejoin-who>{who}</p>
      </div>
      <button onClick={() => voice.join(channel.id)} disabled={connecting || !canConnect} title={canConnect ? undefined : t('You do not have permission to connect')} className="h-10 rounded-lg bg-text-0 px-5 font-semibold text-bg-0 hover:bg-text-1 disabled:opacity-50">
        {!canConnect ? t('No permission to connect') : switching ? t('Switch to this channel') : t('Join Voice')}
      </button>
    </div>
  )
}

/** A voice channel's status ("Watching the finals"): anyone in the channel (or who manages it) can set it; it clears when everyone leaves. */
function VoiceStatus({ channel, canSet }: { channel: Channel; canSet: boolean }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(channel.voice_status ?? '')
  const pushToast = useStore((s) => s.pushToast)
  useEffect(() => { if (!editing) setText(channel.voice_status ?? '') }, [channel.voice_status, editing])
  const save = async () => {
    setEditing(false)
    if (text.trim() === (channel.voice_status ?? '')) return
    try { await api.put(`/channels/${channel.id}/voice-status`, { status: text.trim() }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  if (editing) {
    return <input autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setText(channel.voice_status ?? ''); setEditing(false) } }}
      placeholder={t("What's going on in here?")} className="input h-7 min-w-0 max-w-xs flex-1 py-0 text-xs" aria-label={t('Channel status')} data-voice-status-input />
  }
  if (channel.voice_status) {
    return <button type="button" disabled={!canSet} onClick={() => setEditing(true)} className="min-w-0 truncate rounded-md px-1.5 text-xs text-text-1 hover:bg-bg-3 disabled:hover:bg-transparent" title={canSet ? t('Change the channel status') : channel.voice_status} data-voice-status-show>{channel.voice_status}</button>
  }
  return canSet ? <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-md px-1.5 text-xs text-text-2 hover:bg-bg-3 hover:text-text-1" data-voice-status-set>{t('Set a channel status')}</button> : null
}
