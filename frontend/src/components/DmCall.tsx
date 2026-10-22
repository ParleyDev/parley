import { useShallow } from 'zustand/react/shallow'
import { HeadphoneOff, Maximize2, Mic, MicOff, Minimize2, Monitor, MonitorOff, MonitorUp, Phone, Video, VideoOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { playSfx, sfxEnabled } from '../lib/sfx'
import { useStore, voiceParticipants } from '../store'
import type { DmChannel, User, VoiceState } from '../lib/types'
import { CameraMenu, ControlBar, ControlButton, ControlGroup, HangUpButton, MicMenu, SplitControl } from './CallControls'
import { useResizableHeight } from '../lib/resize'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import VideoTile, { FitToggle, useVideoFit } from './VideoTile'

type Tile = { key: string; userId: string; kind: 'camera' | 'screen'; user: User | undefined; state: VoiceState; stream: MediaStream | null; isMe: boolean }

const DEFAULT_HEIGHT = 360

/**
 * A call inside a DM: a resizable stage of participant tiles (camera, screen share or avatar) above the chat, with
 * the call controls. Click a tile to focus it, double-click (or the corner button) for fullscreen; drag the bottom
 * edge to make the stage taller or shorter.
 */
export default function DmCall({ channel }: { channel: DmChannel }) {
  const participants = useStore(useShallow((s) => voiceParticipants(s, channel.id)))
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const connecting = useStore((s) => s.voiceConnecting)
  const speaking = useStore((s) => s.speaking)
  const selfMute = useStore((s) => s.selfMute)
  const selfDeaf = useStore((s) => s.selfDeaf)
  const localCamera = useStore((s) => s.localCamera)
  const localScreen = useStore((s) => s.localScreen)
  const remoteMedia = useStore((s) => s.remoteMedia)
  const [focused, setFocused] = useState<string | null>(null)
  const videoFit = useVideoFit()
  const stage = useResizableHeight('dmCall', DEFAULT_HEIGHT, 160, 0.8)
  const inThis = myChannel === channel.id

  const tiles: Tile[] = []
  for (const p of participants) {
    const isMe = me?.id === p.user_id
    const user = users[p.user_id] ?? (isMe && me ? me : undefined) ?? channel.recipients.find((r) => r.id === p.user_id)
    const media = isMe ? { camera: localCamera, screen: localScreen } : remoteMedia[p.user_id]
    if (p.self_stream) tiles.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: 'screen', user, state: p, stream: media?.screen ?? null, isMe })
    tiles.push({ key: `${p.user_id}:camera`, userId: p.user_id, kind: 'camera', user, state: p, stream: p.self_video ? media?.camera ?? null : null, isMe })
  }
  const screenKeys = tiles.filter((t) => t.kind === 'screen').map((t) => t.key).join(',')
  // Auto-focus a newly started screen share; drop focus if that tile went away.
  useEffect(() => {
    const keys = screenKeys ? screenKeys.split(',') : []
    setFocused((f) => {
      if (f && !tiles.some((t) => t.key === f)) return keys[0] ?? null
      if (!f && keys.length) return keys[0]
      return f
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKeys, tiles.length])

  // Outgoing ring: you are the only one in the call → ring every few seconds until someone picks up (45 s max).
  const waiting = inThis && participants.length === 1 && participants[0]?.user_id === me?.id
  useEffect(() => {
    const w = window as unknown as { __parleyOutRing?: boolean }
    if (!waiting || !sfxEnabled('outgoing_ring')) { w.__parleyOutRing = false; return }
    w.__parleyOutRing = true
    playSfx('outgoing_ring')
    const timer = setInterval(() => playSfx('outgoing_ring'), 3000)
    const cutoff = setTimeout(() => { clearInterval(timer); w.__parleyOutRing = false }, 45_000)
    return () => { clearInterval(timer); clearTimeout(cutoff); w.__parleyOutRing = false }
  }, [waiting])
  if (participants.length === 0 && !inThis) return null
  const focusTile = focused ? tiles.find((t) => t.key === focused) : undefined
  const strip = focusTile ? tiles.filter((t) => t.key !== focused) : []
  const toggleFullscreen = (el: HTMLElement) => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else el.requestFullscreen?.().catch(() => {}) }

  const renderTile = (t: Tile, big: boolean, cell = false) => {
    const talking = t.kind === 'camera' && !!speaking[t.userId]
    const name = t.user?.display_name ?? 'User'
    return (
      <div key={t.key} onClick={() => setFocused(focused === t.key ? null : t.key)} onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget) }}
        className={`group relative min-h-0 min-w-0 overflow-hidden rounded-xl bg-bg-2 border-2 transition-colors cursor-pointer ${talking ? 'border-success' : 'border-line'} ${big || cell ? 'h-full w-full' : 'aspect-video'}`}
        data-call-tile={t.key} data-tile-big={big ? '1' : '0'} title={big ? 'Click to return to the grid · double-click for fullscreen' : 'Click to focus · double-click for fullscreen'}
        {...(t.kind === 'camera' ? { 'data-call-participant': t.userId } : { 'data-call-screen': t.userId })}>
        {t.stream ? (
          <VideoTile stream={t.stream} mirror={t.isMe && t.kind === 'camera'} contain={videoFit === 'fit' || t.kind === 'screen'} />
        ) : t.kind === 'screen' ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-text-2"><Monitor size={big ? 64 : 32} /><span className="text-sm">Loading stream…</span></div>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <div className={`rounded-full transition-shadow ${talking ? 'ring-4 ring-success/70' : ''}`}>
              {t.user ? <Avatar user={t.user} size={big ? 160 : 80} /> : <div className="h-20 w-20 rounded-full bg-bg-4" />}
            </div>
          </div>
        )}
        <span className="absolute left-2 bottom-2 flex items-center gap-1 rounded-md bg-bg-0/80 px-1.5 py-0.5 text-xs font-semibold">
          {t.kind === 'screen' && <Monitor size={12} className="text-success" />}
          <span className="truncate max-w-[160px]">{t.kind === 'screen' ? `${name}'s screen` : name}</span>
          {t.kind === 'camera' && (t.state.self_deaf ? <HeadphoneOff size={12} className="text-danger" /> : t.state.self_mute ? <MicOff size={12} className="text-danger" /> : null)}
        </span>
        {t.kind === 'screen' && <span className="absolute left-2 top-2 rounded-md bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
        <div className="absolute right-2 bottom-2 flex items-center gap-1">
          {t.stream && t.kind === 'camera' && <FitToggle />}
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget.closest('[data-call-tile]') as HTMLElement) }} title="Fullscreen" aria-label="Fullscreen" className="rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 hover:text-text-0" data-tile-fullscreen>{document.fullscreenElement ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </div>
      </div>
    )
  }

  // Grid cells share the stage height evenly; columns are capped at 16:9 of a row so tiles stay video-shaped.
  const cols = Math.min(tiles.length, tiles.length <= 4 ? 2 : 3)
  const rows = Math.max(1, Math.ceil(tiles.length / cols))
  const rowHeight = Math.max(80, (stage.height - 80 - (rows - 1) * 12) / rows)
  return (
    <section ref={(el) => stage.setContainer(el?.parentElement ?? null)} style={{ height: stage.height }} className="relative shrink-0 border-b border-line bg-bg-0 px-4 pt-3 pb-2 flex flex-col max-md:h-auto max-md:max-h-[55vh]" data-dm-call data-call-height={stage.height}>
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {tiles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-text-2">Connecting…</div>
        ) : focusTile ? (
          <>
            <div className="flex-1 min-h-0">{renderTile(focusTile, true)}</div>
            {strip.length > 0 && <div className="shrink-0 flex gap-2 overflow-x-auto">{strip.map((t) => <div key={t.key} className="w-40 shrink-0">{renderTile(t, false)}</div>)}</div>}
          </>
        ) : (
          <div className="flex-1 min-h-0 grid gap-3 justify-center" data-call-grid style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${Math.round(rowHeight * 16 / 9)}px))`, gridAutoRows: 'minmax(0, 1fr)' }}>
            {tiles.map((t) => renderTile(t, false, true))}
          </div>
        )}
      </div>
      <div className="mt-2 shrink-0 flex justify-center pb-1">
        {inThis ? (
          <ControlBar compact>
            <ControlGroup>
              <SplitControl chevronLabel="Microphone options" menuKind="input" menu={(close) => <MicMenu close={close} />}>
                <ControlButton label={selfMute ? 'Unmute' : 'Mute'} on={selfMute || selfDeaf} tone="danger" onClick={() => voice.setMute(!selfMute)}>{selfMute || selfDeaf ? <MicOff size={18} /> : <Mic size={18} />}</ControlButton>
              </SplitControl>
              <SplitControl chevronLabel="Camera options" menuKind="camera" menu={(close) => <CameraMenu close={close} />}>
                <ControlButton label={localCamera ? 'Turn Off Camera' : 'Turn On Camera'} on={!!localCamera} onClick={() => voice.toggleCamera()}>{localCamera ? <Video size={18} /> : <VideoOff size={18} />}</ControlButton>
              </SplitControl>
            </ControlGroup>
            <ControlGroup>
              <ControlButton label={localScreen ? 'Stop Sharing' : 'Share Your Screen'} on={!!localScreen} onClick={() => voice.toggleScreen()}>{localScreen ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</ControlButton>
            </ControlGroup>
            <HangUpButton label="Leave Call" onClick={() => voice.leave()} />
          </ControlBar>
        ) : (
          <button onClick={() => voice.join(channel.id)} disabled={connecting} title="Join Call" className="h-10 px-6 rounded-xl bg-success text-black font-bold flex items-center gap-2 hover:bg-success/80 disabled:opacity-50" data-join-call><Phone size={18} /> {myChannel ? 'Switch to this call' : 'Join Call'}</button>
        )}
      </div>
      <div {...stage.handleProps} />
    </section>
  )
}
