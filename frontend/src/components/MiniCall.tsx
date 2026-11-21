import { Eye, Maximize2, Mic, MicOff, MonitorOff, PhoneOff, PictureInPicture2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { STORAGE_PREFIX } from '../lib/brand'
import { useT } from '../lib/i18n'
import { shownName } from '../lib/names'
import { usePhone } from '../lib/swipe'
import { voice } from '../lib/voice'
import { useStreamViewers } from './CallExtras'

type Corner = 'br' | 'bl' | 'tr' | 'tl'
const KEY = `${STORAGE_PREFIX}miniCall`
const MIN_W = 240, MAX_W = 640, DEFAULT_W = 288
/** Space kept from the window's edges: more at the bottom, where the message box and the user panel are. */
const EDGE = 16, BOTTOM = 96, TOP = 64
const load = (): { corner: Corner; w: number } => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { corner: ['br', 'bl', 'tr', 'tl'].includes(v.corner) ? v.corner : 'br', w: Math.min(MAX_W, Math.max(MIN_W, Number(v.w) || DEFAULT_W)) } } catch { return { corner: 'br', w: DEFAULT_W } } }

/**
 * While you're in a call but looking at something else, the call's video floats in a corner: a screen share you
 * watch, else someone's camera, else your own share (so you can see what is going out and who watches it).
 *
 * Drag it to any corner (it snaps to the nearest when let go), drag its grip to resize it; both are remembered.
 * Pointing at it shows mute, stop watching and hang up, so the call can be handled without going back to it. Click
 * the picture (or Back to the call) to return. It can be turned off in Voice & Video settings.
 */
export default function MiniCall() {
  const channelId = useStore((s) => s.myVoiceChannelId)
  const channel = useStore((s) => (s.myVoiceChannelId ? s.channels[s.myVoiceChannelId] ?? s.dms[s.myVoiceChannelId] : undefined))
  const remote = useStore((s) => s.remoteMedia)
  const watching = useStore((s) => s.watching)
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const members = useStore((s) => { const g = s.myVoiceChannelId ? s.channels[s.myVoiceChannelId]?.guild_id : undefined; return g ? s.members[g] : undefined })
  const notes = useStore((s) => s.notes)
  const voiceStates = useStore((s) => s.voiceStates)
  const localScreen = useStore((s) => s.localScreen)
  const selfMute = useStore((s) => s.selfMute || s.selfDeaf)
  const wanted = useStore((s) => s.voiceSettings.miniCall !== false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const phone = usePhone()
  const t = useT()
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [place, setPlace] = useState(load)
  // While dragging: where the card is, in px from the window's left and top. Null when it rests in its corner.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLVideoElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const live = (id: string) => voiceStates[id]?.channel_id === channelId
  const pick = Object.entries(remote).find(([id, m]) => live(id) && m.screen && watching[id] && voiceStates[id]?.self_stream) ?? Object.entries(remote).find(([id, m]) => live(id) && m.camera && voiceStates[id]?.self_video)
  const mine = !pick && !!localScreen && !!me
  const who = pick ? pick[0] : mine ? me!.id : null
  const watched = !!pick && !!pick[1].screen && !!watching[pick[0]]
  const stream = pick ? (watched ? pick[1].screen : pick[1].camera) : mine ? localScreen : null
  const viewers = useStreamViewers(mine ? me!.id : '', mine ? channelId : null)
  const here = !!channelId && pathname.includes(channelId)
  const show = wanted && !!channelId && !here && !!stream && closedFor !== channelId
  useEffect(() => { const el = ref.current; if (el && stream) { el.srcObject = stream; el.play().catch(() => {}) } }, [stream, show])
  const save = (next: { corner: Corner; w: number }) => { setPlace(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ } }
  // Never wider than the window allows (it may have shrunk since the size was chosen).
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useEffect(() => { const on = () => setVw(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  if (!show || !channel || !who) return null
  const w = phone ? 224 : Math.min(place.w, Math.max(MIN_W, vw - 2 * EDGE), Math.round(vw * 0.7))
  const back = () => navigate(channel.guild_id ? `/channels/${channel.guild_id}/${channel.id}` : `/channels/@me/${channel.id}`)
  const pip = async () => { try { await ref.current?.requestPictureInPicture() } catch { useStore.getState().pushToast(t('Picture-in-picture is not available here'), 'error') } }

  // Dragging the card: it follows the pointer and snaps to the nearest corner when let go. A press that never moves
  // far is a click (back to the call).
  const startDrag = (e: React.PointerEvent) => {
    if (phone || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const box = card.current!.getBoundingClientRect()
    const dx = e.clientX - box.left, dy = e.clientY - box.top
    const x0 = e.clientX, y0 = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
      moved = true
      setDrag({ x: Math.min(window.innerWidth - box.width - 4, Math.max(4, ev.clientX - dx)), y: Math.min(window.innerHeight - box.height - 4, Math.max(4, ev.clientY - dy)) })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag(null)
      if (!moved) { back(); return }
      const cx = ev.clientX - dx + box.width / 2, cy = ev.clientY - dy + box.height / 2
      save({ ...place, corner: `${cy < window.innerHeight / 2 ? 't' : 'b'}${cx < window.innerWidth / 2 ? 'l' : 'r'}` as Corner })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  // The grip sits on the corner facing the middle of the window, so dragging it away from the edge makes the card bigger.
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    const x0 = e.clientX, w0 = w, sign = place.corner.endsWith('r') ? -1 : 1
    let last = w0
    const move = (ev: PointerEvent) => { last = Math.round(Math.min(MAX_W, window.innerWidth * 0.7, Math.max(MIN_W, w0 + sign * (ev.clientX - x0)))); setPlace((p) => ({ ...p, w: last })) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save({ corner: place.corner, w: last }) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const resizeKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault(); save({ ...place, w: Math.min(MAX_W, Math.max(MIN_W, w + step * (e.shiftKey ? 64 : 16))) })
  }
  const style: React.CSSProperties = drag ? { left: drag.x, top: drag.y, width: w } : {
    width: w,
    ...(place.corner.startsWith('b') ? { bottom: BOTTOM } : { top: TOP }),
    ...(place.corner.endsWith('r') ? { right: EDGE } : { left: EDGE }),
  }
  const name = shownName(users[who] ?? members?.[who] ?? (mine ? me! : undefined), members?.[who], notes[who]?.nickname) || t('Call')
  const grip = place.corner === 'br' ? 'left-0 top-0 cursor-nwse-resize' : place.corner === 'bl' ? 'right-0 top-0 cursor-nesw-resize' : place.corner === 'tr' ? 'left-0 bottom-0 cursor-nesw-resize' : 'right-0 bottom-0 cursor-nwse-resize'
  const btn = 'flex h-8 w-8 items-center justify-center rounded-md bg-bg-0/85 text-text-1 hover:text-text-0'
  return (
    <div ref={card} onPointerDown={startDrag} style={style} className={`group fixed z-40 overflow-hidden rounded-xl border border-line bg-bg-0 shadow-2xl select-none touch-none ${drag ? 'cursor-grabbing' : 'pop cursor-pointer transition-[left,top,right,bottom] duration-150'}`}
      data-mini-call={who} data-mini-corner={place.corner} data-mini-width={w} data-mini-own={mine ? '1' : undefined} title={t('Back to the call')}>
      <div className="relative block aspect-video w-full">
        <video ref={ref} autoPlay playsInline muted className="pointer-events-none h-full w-full object-contain bg-black" />
        <span className="absolute left-2 top-2 max-w-[70%] truncate rounded-md bg-bg-0/80 px-1.5 py-0.5 text-xs font-semibold">{mine ? t('Your screen') : name} · {channel.name || t('Call')}</span>
        {mine && <span className="absolute left-2 bottom-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white" title={viewers.length ? t('Watching: {names}', { names: viewers.join(', ') }) : t('Nobody is watching yet')} data-mini-viewers={viewers.length}><Eye size={12} />{viewers.length}</span>}
      </div>
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 phone:opacity-100">
        {'pictureInPictureEnabled' in document && <button type="button" onClick={pip} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Pop out (picture-in-picture)')} aria-label={t('Picture-in-picture')} data-mini-pip><PictureInPicture2 size={14} /></button>}
        <button type="button" onClick={back} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Back to the call')} aria-label={t('Back to the call')} data-mini-back><Maximize2 size={14} /></button>
        <button type="button" onClick={() => setClosedFor(channelId)} className="rounded-md bg-bg-0/80 p-1 text-text-1 hover:text-text-0" title={t('Hide')} aria-label={t('Hide')} data-mini-close><X size={14} /></button>
      </div>
      {/* The call's controls, so it can be handled from wherever you are. */}
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 phone:opacity-100" data-mini-controls>
        <button type="button" onClick={() => voice.setMute(!useStore.getState().selfMute)} className={`${btn} ${selfMute ? 'text-danger' : ''}`} title={selfMute ? t('Unmute') : t('Mute')} aria-label={selfMute ? t('Unmute') : t('Mute')} aria-pressed={selfMute} data-mini-mute>{selfMute ? <MicOff size={16} /> : <Mic size={16} />}</button>
        {watched && <button type="button" onClick={() => voice.watch(who, false)} className={btn} title={t('Stop Watching')} aria-label={t('Stop Watching')} data-mini-stop><MonitorOff size={16} /></button>}
        {mine && <button type="button" onClick={() => voice.toggleScreen()} className={btn} title={t('Stop Sharing')} aria-label={t('Stop Sharing')} data-mini-stop-share><MonitorOff size={16} /></button>}
        <button type="button" onClick={() => voice.leave()} className={`${btn} hover:text-danger`} title={t('Disconnect')} aria-label={t('Disconnect')} data-mini-leave><PhoneOff size={16} /></button>
      </div>
      {!phone && <span role="slider" tabIndex={0} aria-label={t('Resize the call window')} aria-valuemin={MIN_W} aria-valuemax={MAX_W} aria-valuenow={w} onPointerDown={startResize} onKeyDown={resizeKey} onDoubleClick={(e) => { e.stopPropagation(); save({ ...place, w: DEFAULT_W }) }}
        className={`absolute h-4 w-4 opacity-0 group-hover:opacity-100 focus:opacity-100 ${grip}`} data-mini-grip><span className="absolute inset-1 rounded-sm border-2 border-text-1/70" /></span>}
    </div>
  )
}
