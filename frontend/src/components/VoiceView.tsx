import { STORAGE_PREFIX } from '../lib/brand'
import { useShallow } from 'zustand/react/shallow'
import { Disc3, Hand, Headphones, HeadphoneOff, ListMusic, Maximize2, MessageSquare, Mic, MicOff, Minimize2, Monitor, MonitorOff, Music2, PhoneOff, Radio, Video, VideoOff, Volume2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isUnread, myChannelPerms, useStore, voiceParticipants } from '../store'
import { has, P } from '../lib/perms'
import { api } from '../lib/api'
import { isPhone } from '../lib/swipe'
import type { Channel, User, VoiceState } from '../lib/types'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import StudioPanel from './StudioPanel'
import { studio as studioRec } from '../lib/studio'
import VideoTile from './VideoTile'
import ChatPane from './ChatPane'
import { MembersToggle, MobileBack } from './HeaderBits'
import { useT } from '../lib/i18n'

type Tile = { key: string; userId: string; kind: 'camera' | 'screen'; user: User | undefined; state: VoiceState; stream: MediaStream | null; isMe: boolean }

const CHAT_KEY = `${STORAGE_PREFIX}voiceChat`

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
  const unread = useStore((s) => isUnread(s, channel.id))
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const canConnect = has(perms, P.CONNECT)
  const canStream = has(perms, P.STREAM)
  const suppressed = useStore((s) => !!(s.user && s.voiceStates[s.user.id]?.suppress))
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
  const isEngineer = isStudio && channel.engineer_id === me?.id
  const isMod = has(perms, P.MANAGE_CHANNELS) || isEngineer
  const canAssign = has(perms, P.MANAGE_CHANNELS)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const liveSession = useStore((s) => (isStudio ? s.studio[channel.id]?.find((x) => !x.ended_at) : undefined))
  const [recBusy, setRecBusy] = useState(false)
  const record = async () => {
    setRecBusy(true)
    try { if (liveSession) await api.post(`/channels/${channel.id}/studio/sessions/${liveSession.id}/stop`); else await api.post(`/channels/${channel.id}/studio/sessions`, { name: '' }) } catch (e) { pushToast((e as Error).message, 'error') } finally { setRecBusy(false) }
  }
  const setEngineer = (uid: string) => stageCallAny('put', `/channels/${channel.id}/studio/engineer/${uid}`)
  useEffect(() => { if (isStudio) loadStudioList(channel.id) }, [isStudio, channel.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const myState = useStore((s) => (s.user ? s.voiceStates[s.user.id] : undefined))
  const handUp = !!myState?.request_to_speak
  const stageCall = async (method: 'post' | 'put' | 'delete', path: string) => { try { await api[method](path) } catch (e) { pushToast((e as Error).message, 'error') } }
  const stageCallAny = stageCall
  const loadStudioList = useStore((s) => s.loadStudio)
  const toggleHand = () => stageCall(handUp ? 'delete' : 'post', `/channels/${channel.id}/stage/hand`)
  const inviteToSpeak = (uid: string) => stageCall('put', `/channels/${channel.id}/stage/speakers/${uid}`)
  const toAudience = (uid: string) => stageCall('delete', `/channels/${channel.id}/stage/speakers/${uid}`)
  const audience = isStage ? participants.filter((p) => p.suppress) : []
  useEffect(() => { if (board && channel.guild_id && !sounds) loadSounds(channel.guild_id) }, [board, channel.guild_id, sounds, loadSounds])
  const playSound = async (id: string) => { try { await api.post(`/channels/${channel.id}/soundboard/${id}`) } catch (e) { pushToast((e as Error).message, 'error') } }
  const inThis = myChannel === channel.id
  const toggleChat = () => setChat((c) => { try { localStorage.setItem(CHAT_KEY, c ? '0' : '1') } catch { /* ignore */ } return !c })

  // Build tiles: one per participant (camera or avatar) plus one per active screen share.
  const tiles: Tile[] = []
  for (const p of participants) {
    if (isStage && p.suppress) continue
    const isMe = me?.id === p.user_id
    const user = users[p.user_id] ?? (isMe ? me ?? undefined : undefined)
    const media = isMe ? { camera: localCamera, screen: localScreen } : remoteMedia[p.user_id]
    if (p.self_stream) tiles.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: 'screen', user, state: p, stream: media?.screen ?? null, isMe })
    tiles.push({ key: `${p.user_id}:camera`, userId: p.user_id, kind: 'camera', user, state: p, stream: p.self_video ? media?.camera ?? null : null, isMe })
  }
  const screenKeys = tiles.filter((t) => t.kind === 'screen').map((t) => t.key).join(',')

  // Auto-focus a newly started screen share (Discord-like); drop focus if that tile went away.
  useEffect(() => {
    const keys = screenKeys ? screenKeys.split(',') : []
    setFocused((f) => {
      if (f && !tiles.some((t) => t.key === f)) return keys[0] ?? null
      if (!f && keys.length) return keys[0]
      return f
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKeys, tiles.length])

  const focusTile = focused ? tiles.find((t) => t.key === focused) : undefined
  const strip = focusTile ? tiles.filter((t) => t.key !== focused) : []
  const count = participants.length

  const phone = usePhone()
  const renderTile = (t: Tile, big: boolean) => {
    const talking = t.kind === 'camera' && !!speaking[t.userId]
    const status = t.kind !== 'camera' ? null : t.isMe ? (connecting ? 'connecting' : 'connected') : inThis ? peerStatus[t.userId] ?? 'connecting' : null
    const name = t.user?.display_name ?? 'Unknown'
    return (
      <div key={t.key} onClick={() => setFocused(focused === t.key ? null : t.key)}
        className={`group relative overflow-hidden rounded-2xl bg-bg-2 border-2 transition-colors cursor-pointer ${talking ? 'border-success' : 'border-line'} ${big ? 'h-full w-full' : 'aspect-video'}`} data-voice-tile={t.userId}>
        {isStage && isMod && inThis && !t.isMe && t.kind === 'camera' && <button type="button" onClick={(e) => { e.stopPropagation(); toAudience(t.userId) }} className="absolute right-2 top-2 z-10 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100" data-to-audience>Move to audience</button>}
        {isStudio && t.kind === 'camera' && channel.engineer_id === t.userId && <span className="absolute left-2 top-2 z-10 rounded-md bg-warn px-1.5 py-0.5 text-[10px] font-bold uppercase text-black" data-engineer-badge>Engineer</span>}
        {isStudio && t.kind === 'camera' && channel.engineer_id !== t.userId && !t.state.suppress && <span className="absolute left-2 top-2 z-10 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" data-artist-badge>Artist</span>}
        {isStudio && canAssign && t.kind === 'camera' && channel.engineer_id !== t.userId && <button type="button" onClick={(e) => { e.stopPropagation(); setEngineer(t.userId) }} className="absolute left-2 bottom-2 z-10 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100" data-make-engineer>Make engineer</button>}
        {t.stream ? (
          <VideoTile stream={t.stream} mirror={t.isMe && t.kind === 'camera'} contain={t.kind === 'screen' || big} />
        ) : t.kind === 'screen' ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-text-2"><Monitor size={big ? 64 : 40} /><span className="text-sm">Loading stream…</span></div>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <div className={`rounded-full transition-shadow ${talking ? 'ring-4 ring-success/70' : ''}`}>
              {t.user ? <Avatar user={t.user} size={big ? 160 : 96} /> : <div className="h-24 w-24 rounded-full bg-bg-4" />}
            </div>
          </div>
        )}
        <div className="absolute left-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-bg-0/80 px-2 py-1 text-sm font-semibold">
          {t.kind === 'screen' && <Monitor size={14} className="text-success" />}
          <span className="truncate max-w-[200px]">{t.kind === 'screen' ? `${name}'s screen` : name}</span>
          {t.kind === 'camera' && (t.state.self_deaf ? <HeadphoneOff size={14} className="text-danger" /> : t.state.self_mute ? <MicOff size={14} className="text-danger" /> : null)}
        </div>
        {t.kind === 'screen' && <span className="absolute left-3 top-3 rounded-md bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
        {status && status !== 'connected' && (
          <span className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${status === 'failed' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{status === 'failed' ? 'No route' : 'Connecting'}</span>
        )}
        <span className="absolute right-3 bottom-3 rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100">{big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</span>
      </div>
    )
  }

  const chatToggle = (
    <button onClick={toggleChat} title={chat ? 'Hide Chat' : 'Show Chat'} className={`relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${chat ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`}>
      <MessageSquare size={20} />
      {unread && !chat && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg-0" />}
    </button>
  )

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-0 relative">
      <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line">
        <MobileBack />
        {isStudio ? <Disc3 size={22} className="text-text-2 shrink-0" /> : isStage ? <Radio size={22} className="text-text-2 shrink-0" /> : <Volume2 size={22} className="text-text-2 shrink-0" />}<span className="font-bold truncate">{channel.name}</span>
        {isStudio && liveSession && <span className="flex items-center gap-1.5 rounded-full bg-danger/20 px-2 py-0.5 text-[11px] font-bold uppercase text-danger" data-studio-rec><span className="h-2 w-2 rounded-full bg-danger animate-pulse" />REC · {liveSession.name}</span>}
        <span className="text-xs text-text-2 whitespace-nowrap" data-voice-count>{isStage ? `${tiles.length} speaking · ${audience.length} listening` : `${count} connected`}</span>
        {inThis && suppressed && <span className="rounded-md bg-danger/20 text-danger px-2 py-0.5 text-[11px] font-bold uppercase">Muted by server</span>}
        <span className="ml-auto flex items-center gap-1">
          {isStudio && <button onClick={() => setSessionsOpen((o) => !o)} title="Sessions" className={`h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${sessionsOpen ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-studio-toggle><ListMusic size={20} /></button>}
          {chatToggle}<MembersToggle /></span>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Stage */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden p-4 max-md:p-2 flex flex-col gap-3">
            {isStage && audience.length > 0 && (
              <div className="shrink-0 rounded-xl border border-line bg-bg-2/60 px-3 py-2" data-stage-audience>
                <div className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-1">{isStudio ? 'Audience' : 'Audience'} — {audience.length}</div>
                <div className="flex flex-wrap gap-2">
                  {audience.map((p) => { const u = users[p.user_id] ?? (me?.id === p.user_id ? me : undefined); return (
                    <div key={p.user_id} className={`flex items-center gap-1.5 rounded-full bg-bg-3 pl-1 pr-2 py-0.5 text-sm ${p.request_to_speak ? 'ring-1 ring-warn' : ''}`} data-audience={p.user_id} data-hand={p.request_to_speak ? '1' : '0'}>
                      {u && <Avatar user={u} size={22} />}<span className="truncate max-w-[120px]">{u?.display_name ?? 'Unknown'}</span>
                      {p.request_to_speak && <Hand size={14} className="text-warn" />}
                      {isMod && inThis && <button type="button" onClick={() => inviteToSpeak(p.user_id)} className="ml-1 rounded-full bg-accent px-2 text-[11px] font-bold text-white hover:bg-accent-hover" data-invite-speak>{isStudio ? 'Add to band' : 'Invite to speak'}</button>}
                      {isStudio && canAssign && channel.engineer_id !== p.user_id && <button type="button" onClick={() => setEngineer(p.user_id)} className="ml-1 rounded-full bg-bg-4 px-2 text-[11px] font-bold hover:bg-warn hover:text-black" data-make-engineer>Make engineer</button>}
                    </div>
                  ) })}
                </div>
              </div>
            )}
            {count === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="h-20 w-20 rounded-full bg-bg-3 flex items-center justify-center mb-4"><Volume2 size={36} className="text-text-1" /></div>
                <h2 className="text-2xl font-bold">{channel.name}</h2>
                <p className="text-text-2 mt-2 max-w-sm">No one is here yet. Join to start a call, or say something in chat.</p>
              </div>
            ) : focusTile ? (
              <>
                <div className="flex-1 min-h-0">{renderTile(focusTile, true)}</div>
                {strip.length > 0 && (
                  <div className="shrink-0 flex gap-3 overflow-x-auto pb-1">
                    {strip.map((t) => <div key={t.key} className="w-48 max-md:w-36 shrink-0">{renderTile(t, false)}</div>)}
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="grid gap-4 max-md:gap-2 justify-center content-start" data-voice-grid style={{ gridTemplateColumns: phone ? (tiles.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))') : `repeat(auto-fit, minmax(min(240px, 100%), ${tiles.length <= 2 ? '480px' : '340px'}))` }}>
                  {tiles.map((t) => renderTile(t, false))}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 flex items-center justify-center gap-3 max-md:gap-4 max-md:flex-wrap py-4 max-md:py-3 px-2 border-t border-line safe-bottom" data-voice-controls>
            {inThis ? (
              <>
                {isStudio && isEngineer && (
                  <span className="flex flex-col items-center gap-1">
                    <button onClick={record} disabled={recBusy} title={liveSession ? 'Stop recording' : 'Record'} aria-label={liveSession ? 'Stop recording' : 'Record'} className={`h-14 w-14 rounded-full flex items-center justify-center ${liveSession ? 'bg-danger text-white' : 'bg-bg-3 text-danger hover:bg-bg-4'}`} data-studio-record>{liveSession ? <span className="h-5 w-5 rounded-sm bg-white" /> : <span className="h-5 w-5 rounded-full bg-danger" />}</button>
                    <span className="md:hidden text-[11px] text-text-2">{liveSession ? 'Stop' : 'Record'}</span>
                  </span>
                )}
                {isStage && suppressed && <Ctl label={handUp ? t('Lower Hand') : t('Raise Hand')} on={handUp} accent onClick={toggleHand}><Hand size={22} /></Ctl>}
                {isStage && !suppressed && !isMod && <Ctl label={t('Leave the stage')} on={false} onClick={() => toAudience(me!.id)}><Hand size={22} /></Ctl>}
                <Ctl label={selfMute ? t('Unmute') : t('Mute')} on={selfMute} onClick={() => voice.setMute(!selfMute)}>{selfMute ? <MicOff size={22} /> : <Mic size={22} />}</Ctl>
                <Ctl label={selfDeaf ? t('Undeafen') : t('Deafen')} on={selfDeaf} onClick={() => voice.setDeaf(!selfDeaf)}>{selfDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</Ctl>
                {canStream && <Ctl label={localCamera ? t('Turn Off Camera') : t('Turn On Camera')} on={!!localCamera} accent onClick={() => voice.toggleCamera()}>{localCamera ? <Video size={22} /> : <VideoOff size={22} />}</Ctl>}
                {canSpeak && !suppressed && (
                  <span className="relative">
                    <Ctl label={t('Soundboard')} on={board} accent onClick={() => setBoard((b) => !b)}><Music2 size={22} /></Ctl>
                    {board && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setBoard(false)} />
                        <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-[320px] max-w-[calc(100vw-16px)] rounded-xl bg-bg-1 border border-line shadow-2xl p-3" data-soundboard>
                          <div className="flex items-center justify-between mb-2"><span className="font-bold text-sm">Soundboard</span><span className="text-xs text-text-2">{sounds ? `${sounds.length} sound${sounds.length === 1 ? '' : 's'}` : 'Loading…'}</span></div>
                          {sounds?.length === 0 && <p className="text-sm text-text-2 py-4 text-center">No sounds yet. Add some in Server Settings → Soundboard.</p>}
                          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                            {sounds?.map((snd) => (
                              <button key={snd.id} type="button" onClick={() => playSound(snd.id)} className="rounded-lg bg-bg-3 hover:bg-accent hover:text-white px-2 py-2 text-xs font-semibold flex flex-col items-center gap-1" data-sound={snd.id} title={snd.name}>
                                <span className="text-xl leading-none">{snd.emoji || '🔊'}</span><span className="truncate max-w-full">{snd.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </span>
                )}
                {canStream && <Ctl label={localScreen ? t('Stop Sharing') : t('Share Your Screen')} on={!!localScreen} accent onClick={() => voice.toggleScreen()}>{localScreen ? <MonitorOff size={22} /> : <Monitor size={22} />}</Ctl>}
                <button onClick={() => { void studioRec.stop(); voice.leave() }} title={t('Disconnect')} className="h-14 max-md:h-12 px-6 max-md:px-4 rounded-full bg-danger text-white font-semibold flex items-center gap-2 hover:bg-danger/80 max-md:basis-full max-md:justify-center max-md:order-last" data-voice-leave><PhoneOff size={20} /><span className="max-md:hidden">Leave</span></button>
              </>
            ) : (
              <button onClick={() => voice.join(channel.id)} disabled={connecting || !canConnect} title={canConnect ? undefined : 'You do not have permission to connect'} className="h-14 max-md:h-12 px-8 rounded-full bg-success text-black font-bold flex items-center gap-2 hover:bg-success/80 disabled:opacity-50">
                <Volume2 size={20} /> {!canConnect ? t('No permission to connect') : myChannel ? t('Switch to this channel') : t('Join Voice')}
              </button>
            )}
          </div>
        </div>

        {isStudio && sessionsOpen && <StudioPanel channelId={channel.id} canManage={isMod} onClose={() => setSessionsOpen(false)} />}
        {/* Chat: side panel on wide screens, full overlay on phones. */}
        {chat && (
          <section className="flex flex-col bg-bg-2 border-l border-line w-[400px] shrink-0 max-md:absolute max-md:inset-0 max-md:w-auto max-md:border-l-0 max-md:z-10">
            <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line">
              <MessageSquare size={18} className="text-text-2" />
              <span className="font-bold truncate">{channel.name}</span>
              <span className="text-xs text-text-2">chat</span>
              {inThis && (
                <span className="ml-auto flex items-center gap-1 md:hidden">
                  <button title={selfMute ? 'Unmute' : 'Mute'} onClick={() => voice.setMute(!selfMute)} className={`h-8 w-8 rounded-md flex items-center justify-center hover:bg-bg-3 ${selfMute ? 'text-danger' : 'text-text-1'}`}>{selfMute ? <MicOff size={18} /> : <Mic size={18} />}</button>
                  <button title="Disconnect" onClick={() => voice.leave()} className="h-8 w-8 rounded-md flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-danger"><PhoneOff size={18} /></button>
                </span>
              )}
              <button onClick={toggleChat} title="Close chat" className={`h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0 ${inThis ? '' : 'ml-auto'}`}><X size={18} /></button>
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

function Ctl({ children, label, on, accent, onClick }: { children: React.ReactNode; label: string; on: boolean; accent?: boolean; onClick: () => void }) {
  const onCls = accent ? 'bg-accent text-white' : 'bg-white text-black'
  return (
    <span className="flex flex-col items-center gap-1">
      <button title={label} aria-label={label} aria-pressed={on} onClick={onClick} className={`h-14 w-14 rounded-full flex items-center justify-center ${on ? onCls : 'bg-bg-3 text-text-0 hover:bg-bg-4'}`}>{children}</button>
      <span className="md:hidden text-[11px] text-text-2">{label}</span>
    </span>
  )
}
