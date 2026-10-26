import { Eye, SmilePlus, UserPlus, Volume2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sendOp } from '../lib/ws'
import { callReactionListeners, type CallReactionListener } from '../lib/callReactions'
import { useStore } from '../store'
import { ControlButton } from './CallControls'
import Emoji from './Emoji'

/* ---- floating emoji reactions in calls ---- */


const QUICK = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🔥', '😢']

/** Emoji floating up over a participant's tile for a couple of seconds. */
export function TileReactions({ userId }: { userId: string }) {
  const [items, setItems] = useState<{ id: number; emoji: string; x: number }[]>([])
  useEffect(() => {
    const l: CallReactionListener = (uid, emoji) => {
      if (uid !== userId) return
      const id = Math.random()
      setItems((xs) => [...xs.slice(-11), { id, emoji, x: 15 + Math.random() * 70 }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600)
    }
    callReactionListeners.add(l)
    return () => { callReactionListeners.delete(l) }
  }, [userId])
  if (!items.length) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-tile-reactions={items.length}>
      {items.map((r) => <span key={r.id} className="call-react absolute bottom-2 text-4xl" style={{ left: `${r.x}%` }} data-call-reaction={r.emoji}><Emoji value={r.emoji} size={40} /></span>)}
    </div>
  )
}

/** Control-bar button: pick an emoji to float over your tile for everyone in the call. */
export function ReactButton() {
  const [open, setOpen] = useState(false)
  const send = (emoji: string) => { sendOp({ op: 'voice_reaction', emoji }); setOpen(false) }
  return (
    <span className="relative flex">
      <ControlButton label="Send a Reaction" on={open} onClick={() => setOpen((o) => !o)} data-call-react-open=""><SmilePlus size={20} /></ControlButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 flex gap-0.5 rounded-xl bg-bg-1 border border-line shadow-2xl p-1.5" data-call-react-menu>
            {QUICK.map((e) => <button key={e} type="button" onClick={() => send(e)} className="h-10 w-10 rounded-lg hover:bg-bg-3 flex items-center justify-center" data-call-react={e} title={`React with ${e}`}><Emoji value={e} size={26} /></button>)}
          </div>
        </>
      )}
    </span>
  )
}

/* ---- stream viewers ---- */

/** Who is watching `streamerId`'s screen share (from everyone's voice state). */
export function useStreamViewers(streamerId: string, channelId: string | null) {
  const ids = useStore(useShallow((s) => Object.values(s.voiceStates).filter((v) => v.channel_id === channelId && v.user_id !== streamerId && v.watching?.includes(streamerId)).map((v) => v.user_id)))
  const users = useStore((s) => s.users)
  return useMemo(() => ids.map((id) => users[id]?.display_name ?? 'Someone'), [ids, users])
}

/** Eye + count on a screen-share tile; hover lists the viewers. */
export function StreamViewers({ streamerId, channelId }: { streamerId: string; channelId: string | null }) {
  const names = useStreamViewers(streamerId, channelId)
  return (
    <span className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white" title={names.length ? `Watching: ${names.join(', ')}` : 'Nobody is watching yet'} data-stream-viewers={names.length}>
      <Eye size={12} />{names.length}
    </span>
  )
}

/* ---- voice channel activity timer ---- */

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** How long a voice channel has had people in it (since the longest-staying member joined). */
export function VoiceTimer({ channelId }: { channelId: string }) {
  const since = useStore((s) => {
    let min = Infinity
    for (const v of Object.values(s.voiceStates)) if (v.channel_id === channelId && v.joined_at) min = Math.min(min, new Date(v.joined_at).getTime())
    return Number.isFinite(min) ? min : null
  })
  const [, tick] = useState(0)
  useEffect(() => { if (!since) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [since])
  if (!since) return null
  return <span className="text-[11px] tabular-nums text-text-2" title="Active for" data-voice-timer={channelId}>{fmt(Date.now() - since)}</span>
}

/* ---- invite to voice ---- */

/** Control-bar button: suggest online friends and members who aren't here yet, and ping them to join. */
export function InviteToVoice({ channelId, guildId }: { channelId: string; guildId: string }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState<Record<string, true>>({})
  const me = useStore((s) => s.user?.id)
  const members = useStore((s) => s.members[guildId])
  const online = useStore((s) => s.online)
  const relationships = useStore((s) => s.relationships)
  const voiceStates = useStore((s) => s.voiceStates)
  const pushToast = useStore((s) => s.pushToast)
  useEffect(() => { if (open && !members) void useStore.getState().loadMembers(guildId) }, [open, members, guildId])
  const picks = useMemo(() => Object.values(members ?? {})
    .filter((m) => m.user_id !== me && online[m.user_id] && voiceStates[m.user_id]?.channel_id !== channelId)
    .sort((a, b) => Number(relationships[b.user_id]?.kind === 'friend') - Number(relationships[a.user_id]?.kind === 'friend') || (a.nickname ?? a.display_name).localeCompare(b.nickname ?? b.display_name))
    .slice(0, 12), [members, me, online, voiceStates, channelId, relationships])
  const invite = async (uid: string) => {
    try { await api.post(`/channels/${channelId}/voice-invite`, { user_id: uid }); setSent((x) => ({ ...x, [uid]: true })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <span className="relative flex">
      <ControlButton label="Invite to Voice" on={open} onClick={() => setOpen((o) => !o)} data-voice-invite-open=""><UserPlus size={20} /></ControlButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="pop absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-40 w-72 rounded-xl bg-bg-1 border border-line shadow-2xl p-2" data-voice-invite>
            <div className="px-2 pb-1.5 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-text-2">Invite to voice</div>
            {!members ? <p className="px-2 py-3 text-sm text-text-2">Loading…</p> : picks.length === 0 ? <p className="px-2 py-3 text-sm text-text-2">Nobody else is online right now.</p> : picks.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-3" data-voice-invite-row={m.user_id}>
                <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm">{m.nickname ?? m.display_name}{relationships[m.user_id]?.kind === 'friend' && <span className="ml-1 text-[10px] text-text-2">friend</span>}</span>
                <button type="button" disabled={!!sent[m.user_id]} onClick={() => invite(m.user_id)} className="rounded-md bg-success px-2 py-0.5 text-xs font-semibold text-black hover:bg-success/80 disabled:bg-bg-4 disabled:text-text-2" data-voice-invite-send={m.user_id}>{sent[m.user_id] ? 'Invited' : 'Invite'}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

/** Bottom-right banner: someone invited you to their voice channel. */
export function VoiceInviteBanner() {
  const inv = useStore((s) => s.voiceInvite)
  const setInv = useStore((s) => s.setVoiceInvite)
  const myChannel = useStore((s) => s.myVoiceChannelId)
  const navigate = useNavigate()
  useEffect(() => { if (!inv) return; const t = setTimeout(() => setInv(null), 60_000); return () => clearTimeout(t) }, [inv, setInv])
  if (!inv || myChannel === inv.channel_id) return null
  const join = () => { setInv(null); navigate(`/channels/${inv.guild_id}/${inv.channel_id}`); void voice.join(inv.channel_id) }
  return (
    <div className="pop fixed safe-corner z-40 w-72 rounded-xl bg-bg-1 border border-line shadow-2xl p-4" role="alert" data-voice-invite-banner={inv.channel_id}>
      <div className="flex items-center gap-3">
        <Avatar user={inv.from} size={40} />
        <div className="min-w-0"><div className="font-bold truncate">{inv.from.display_name}</div><div className="text-xs text-text-2 truncate">invited you to 🔊 {inv.channel_name}</div></div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={join} className="flex-1 btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-voice-invite-join><Volume2 size={16} /> Join</button>
        <button onClick={() => setInv(null)} className="flex-1 btn-ghost py-1.5" data-voice-invite-dismiss>Not now</button>
      </div>
    </div>
  )
}

/* ---- zoom and pan on screen shares ---- */

/** Wheel or the +/− buttons zoom a screen share (up to 4×); drag to pan while zoomed; reset with the 1:1 button. */
export function ZoomPan({ children }: { children: React.ReactNode }) {
  const [z, setZ] = useState({ scale: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const clamp = (scale: number, x: number, y: number) => {
    const r = box.current?.getBoundingClientRect()
    const mx = r ? (r.width * (scale - 1)) / 2 : 0, my = r ? (r.height * (scale - 1)) / 2 : 0
    return { scale, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) }
  }
  const zoomBy = (f: number) => setZ((s) => { const scale = Math.max(1, Math.min(4, s.scale * f)); return clamp(scale, scale === 1 ? 0 : s.x, scale === 1 ? 0 : s.y) })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  return (
    <div ref={box} className={`relative h-full w-full overflow-hidden ${z.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`} data-zoom={z.scale.toFixed(2)}
      onPointerDown={(e) => { if (z.scale > 1 && !(e.target as HTMLElement).closest('[data-zoom-controls]')) { drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; d.moved ||= Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3; setZ((s) => clamp(s.scale, d.ox + e.clientX - d.x, d.oy + e.clientY - d.y)) }}
      onPointerUp={() => { setTimeout(() => { drag.current = null }, 0) }}
      onClickCapture={(e) => { if ((e.target as HTMLElement).closest('[data-zoom-controls]')) return; if (drag.current?.moved || z.scale > 1) e.stopPropagation() }}>
      <div className="h-full w-full origin-center transition-transform duration-75" style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})` }}>{children}</div>
      <div data-zoom-controls className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-within:opacity-100" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1 / 1.25)} className="h-6 w-6 rounded hover:bg-white/20" title="Zoom out" aria-label="Zoom out" data-zoom-out>−</button>
        <button type="button" onClick={() => setZ({ scale: 1, x: 0, y: 0 })} className="h-6 min-w-8 rounded px-1 text-[11px] tabular-nums hover:bg-white/20" title="Reset zoom" aria-label="Reset zoom" data-zoom-reset>{Math.round(z.scale * 100)}%</button>
        <button type="button" onClick={() => zoomBy(1.25)} className="h-6 w-6 rounded hover:bg-white/20" title="Zoom in" aria-label="Zoom in" data-zoom-in>+</button>
      </div>
    </div>
  )
}
