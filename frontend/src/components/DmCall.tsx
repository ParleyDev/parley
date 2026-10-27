import { useShallow } from 'zustand/react/shallow'
import { HeadphoneOff, Maximize2, Mic, MicOff, Minimize2, Monitor, MonitorOff, MonitorUp, Music2, Phone, Video, VideoOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { playSfx, sfxEnabled } from '../lib/sfx'
import { useStore, voiceParticipants } from '../store'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { useUserAudioMap } from '../lib/userAudio'
import type { DmChannel, User, VoiceState } from '../lib/types'
import SoundboardPicker from './SoundboardPicker'
import { ConnQuality, ReactButton, StreamViewers, TileReactions, ZoomPan } from './CallExtras'
import { ActivitiesButton, ActivityChips, ActivityFrame, ClipButton } from './Activities'
import { loadActivities, useActivities, useCallActivities } from '../lib/activities'
import { CameraMenu, ControlBar, ControlButton, ControlGroup, HangUpButton, MicMenu, SplitControl } from './CallControls'
import { useResizableHeight } from '../lib/resize'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import CallLock from './CallLock'
import VideoTile, { FitToggle, StopWatching, StreamGate, useVideoFit } from './VideoTile'
import { useT } from '../lib/i18n'

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
  const hidden = useUserAudioMap()
  // Right-click a tile: the person's menu, with their volume and local mute while you're in the call.
  const userMenu = useUserMenu(null)
  const tileMenu = useContextMenu()
  const watching = useStore((s) => s.watching)
  const [focused, setFocused] = useState<string | null>(null)
  const [board, setBoard] = useState(false)
  const t = useT()
  const videoFit = useVideoFit()
  const stage = useResizableHeight('dmCall', DEFAULT_HEIGHT, 160, 0.8)
  const inThis = myChannel === channel.id
  const activities = useCallActivities(channel.id)
  const openActivity = useActivities((s) => s.open)
  const activity = inThis ? activities.find((a) => a.id === openActivity) : undefined
  useEffect(() => { if (inThis) void loadActivities(channel.id) }, [channel.id, inThis])
  const notInCall = channel.recipients.filter((r) => !participants.some((p) => p.user_id === r.id))

  const tiles: Tile[] = []
  for (const p of participants) {
    const isMe = me?.id === p.user_id
    const user = users[p.user_id] ?? (isMe && me ? me : undefined) ?? channel.recipients.find((r) => r.id === p.user_id)
    const media = isMe ? { camera: localCamera, screen: localScreen } : remoteMedia[p.user_id]
    if (p.self_stream) tiles.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: 'screen', user, state: p, stream: media?.screen ?? null, isMe })
    // A camera you hid in their user menu shows their avatar instead.
    tiles.push({ key: `${p.user_id}:camera`, userId: p.user_id, kind: 'camera', user, state: p, stream: p.self_video && !(!isMe && hidden[p.user_id]?.hideVideo) ? media?.camera ?? null : null, isMe })
  }
  const screenKeys = tiles.filter((tile) => tile.kind === 'screen').map((tile) => tile.key).join(',')
  // Auto-focus a newly started screen share; drop focus if that tile went away.
  useEffect(() => {
    const keys = screenKeys ? screenKeys.split(',') : []
    setFocused((f) => {
      if (f && !tiles.some((tile) => tile.key === f)) return keys[0] ?? null
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
  const focusTile = focused ? tiles.find((tile) => tile.key === focused) : undefined
  const strip = focusTile ? tiles.filter((tile) => tile.key !== focused) : []
  const toggleFullscreen = (el: HTMLElement) => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else el.requestFullscreen?.().catch(() => {}) }

  const renderTile = (tile: Tile, big: boolean, cell = false) => {
    const talking = tile.kind === 'camera' && !!speaking[tile.userId]
    const name = tile.user?.display_name ?? t('User')
    return (
      <div key={tile.key} onClick={() => setFocused(focused === tile.key ? null : tile.key)} onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget) }}
        onContextMenu={(e) => { if (!tile.isMe || tile.kind === 'camera') tileMenu.open(e, userMenu({ id: tile.userId, display_name: name }, e.currentTarget.getBoundingClientRect())) }}
        className={`group relative min-h-0 min-w-0 overflow-hidden rounded-xl bg-bg-2 border-2 transition-colors cursor-pointer ${talking ? 'border-success' : 'border-line'} ${big || cell ? 'h-full w-full' : 'aspect-video'}`}
        data-call-tile={tile.key} data-tile-big={big ? '1' : '0'} title={big ? t('Click to return to the grid · double-click for fullscreen') : t('Click to focus · double-click for fullscreen')}
        {...(tile.kind === 'camera' ? { 'data-call-participant': tile.userId } : { 'data-call-screen': tile.userId })}>
        {tile.kind === 'screen' && !tile.isMe && !watching[tile.userId] ? (
          <StreamGate user={tile.user} big={big} canWatch={inThis} onWatch={() => voice.watch(tile.userId, true)} channelId={channel.id} />
        ) : tile.stream && tile.kind === 'screen' ? (
          <ZoomPan><VideoTile stream={tile.stream} mirror={false} contain /></ZoomPan>
        ) : tile.stream ? (
          <VideoTile stream={tile.stream} mirror={tile.isMe && tile.kind === 'camera'} contain={videoFit === 'fit' || tile.kind === 'screen'} />
        ) : tile.kind === 'screen' ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-text-2"><Monitor size={big ? 64 : 32} /><span className="text-sm">{t('Loading stream…')}</span></div>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <div className={`rounded-full transition-shadow ${talking ? 'ring-4 ring-success/70' : ''}`}>
              {tile.user ? <Avatar user={tile.user} size={big ? 160 : 80} /> : <div className="h-20 w-20 rounded-full bg-bg-4" />}
            </div>
          </div>
        )}
        <span className="absolute left-2 bottom-2 flex items-center gap-1 rounded-md bg-bg-0/80 px-1.5 py-0.5 text-xs font-semibold">
          {tile.kind === 'screen' && <Monitor size={12} className="text-success" />}
          <span className="truncate max-w-[160px]">{tile.kind === 'screen' ? t('{name}\'s screen', { name }) : name}</span>
          {tile.kind === 'camera' && (tile.state.self_deaf ? <HeadphoneOff size={12} className="text-danger" /> : tile.state.self_mute ? <MicOff size={12} className="text-danger" /> : null)}
        </span>
        {tile.kind === 'screen' && <span className="absolute left-2 top-2 rounded-md bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">{t('LIVE')}</span>}
        {tile.kind === 'screen' && <StreamViewers streamerId={tile.userId} channelId={channel.id} />}
        {tile.kind === 'camera' && <TileReactions userId={tile.userId} />}
        <div className="absolute right-2 bottom-2 flex items-center gap-1">
          {tile.kind === 'camera' && !tile.isMe && inThis && <ConnQuality userId={tile.userId} />}
          {tile.stream && tile.kind === 'camera' && <FitToggle />}
          {tile.kind === 'screen' && !tile.isMe && watching[tile.userId] && <StopWatching onStop={() => voice.watch(tile.userId, false)} />}
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleFullscreen(e.currentTarget.closest('[data-call-tile]') as HTMLElement) }} title={t('Fullscreen')} aria-label={t('Fullscreen')} className="rounded-md bg-bg-0/80 p-1.5 text-text-1 opacity-0 group-hover:opacity-100 hover:text-text-0" data-tile-fullscreen>{document.fullscreenElement ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
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
      {tileMenu.menu && <ContextMenu {...tileMenu.menu} onClose={tileMenu.close} label={t('Participant')} />}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        {inThis && <ActivityChips channelId={channel.id} inCall />}
        {activity ? (
          <>
            <div className="flex-1 min-h-0"><ActivityFrame session={activity} /></div>
            <div className="shrink-0 flex gap-2 overflow-x-auto">{tiles.map((tile) => <div key={tile.key} className="w-32 shrink-0">{renderTile(tile, false)}</div>)}</div>
          </>
        ) : tiles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-text-2">{t('Connecting…')}</div>
        ) : focusTile ? (
          <>
            <div className="flex-1 min-h-0">{renderTile(focusTile, true)}</div>
            {strip.length > 0 && <div className="shrink-0 flex gap-2 overflow-x-auto">{strip.map((tile) => <div key={tile.key} className="w-40 shrink-0">{renderTile(tile, false)}</div>)}</div>}
          </>
        ) : (
          <div className="flex-1 min-h-0 grid gap-3 justify-center" data-call-grid style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${Math.round(rowHeight * 16 / 9)}px))`, gridAutoRows: 'minmax(0, 1fr)' }}>
            {tiles.map((tile) => renderTile(tile, false, true))}
          </div>
        )}
      </div>
      {inThis && notInCall.length > 0 && (
        <div className="mt-2 shrink-0 flex flex-wrap items-center justify-center gap-1.5 text-xs text-text-2" data-ring-row>
          <span>{t('Not here yet:')}</span>
          {notInCall.map((r) => (
            <button key={r.id} type="button" onClick={() => api.post(`/channels/${channel.id}/call/ring`, { user_ids: [r.id] }).then(() => useStore.getState().pushToast(t('Ringing {name}', { name: r.display_name }))).catch((e: Error) => useStore.getState().pushToast(e.message, 'error'))}
              className="flex items-center gap-1.5 rounded-full border border-line bg-bg-1 py-0.5 pl-0.5 pr-2 text-text-1 hover:bg-bg-3" data-ring={r.id} title={t('Ring {name}', { name: r.display_name })}>
              <Avatar user={users[r.id] ?? r} size={18} /><span className="max-w-[120px] truncate">{r.display_name}</span><Phone size={12} className="text-success" />
            </button>
          ))}
        </div>
      )}
      <div className="relative mt-2 shrink-0 flex justify-center pb-1">
        <span className="absolute left-0 top-1/2 -translate-y-1/2"><CallLock channelId={channel.id} /></span>
        {inThis ? (
          <ControlBar compact>
            <ControlGroup>
              <SplitControl chevronLabel={t('Microphone options')} menuKind="input" menu={(close) => <MicMenu close={close} />}>
                <ControlButton label={selfMute ? t('Unmute') : t('Mute')} on={selfMute || selfDeaf} tone="danger" onClick={() => voice.setMute(!selfMute)}>{selfMute || selfDeaf ? <MicOff size={18} /> : <Mic size={18} />}</ControlButton>
              </SplitControl>
              <SplitControl chevronLabel={t('Camera options')} menuKind="camera" menu={(close) => <CameraMenu close={close} />}>
                <ControlButton label={localCamera ? t('Turn Off Camera') : t('Turn On Camera')} on={!!localCamera} onClick={() => voice.toggleCamera()}>{localCamera ? <Video size={18} /> : <VideoOff size={18} />}</ControlButton>
              </SplitControl>
            </ControlGroup>
            <ControlGroup>
              <ReactButton />
              <span className="relative flex">
                <ControlButton label={t('Soundboard')} on={board} onClick={() => setBoard((b) => !b)} data-dm-soundboard=""><Music2 size={18} /></ControlButton>
                {board && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setBoard(false)} />
                    <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-[320px] max-w-[calc(100vw-16px)] rounded-xl bg-bg-1 border border-line shadow-2xl p-3" data-soundboard>
                      <div className="mb-2 font-bold text-sm">{t('Soundboard')}</div>
                      <SoundboardPicker onPlay={(id) => { api.post(`/channels/${channel.id}/soundboard/${id}`).catch((e: Error) => useStore.getState().pushToast(e.message, 'error')) }} />
                    </div>
                  </>
                )}
              </span>
              <ActivitiesButton channelId={channel.id} />
              <ClipButton />
              <ControlButton label={localScreen ? t('Stop Sharing') : t('Share Your Screen')} on={!!localScreen} onClick={() => voice.toggleScreen()}>{localScreen ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</ControlButton>
            </ControlGroup>
            <HangUpButton label={t('Leave Call')} onClick={() => voice.leave()} />
          </ControlBar>
        ) : (
          <button onClick={() => voice.join(channel.id)} disabled={connecting} title={t('Join Call')} className="h-10 px-6 rounded-xl bg-success text-black font-bold flex items-center gap-2 hover:bg-success/80 disabled:opacity-50" data-join-call><Phone size={18} /> {myChannel ? t('Switch to this call') : t('Join Call')}</button>
        )}
      </div>
      <div {...stage.handleProps} />
    </section>
  )
}
