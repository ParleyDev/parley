import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'

interface Props {
  user: { id: string; display_name: string; avatar_url: string | null; status?: string; avatar_decoration?: string }
  /** Force a frame regardless of what is saved (previews and unsaved drafts). */
  decoration?: string
  size?: number
  presence?: boolean
  className?: string
}

export function statusColor(status: string | undefined, online: boolean): string {
  if (!online) return '#7d8394'
  switch (status) {
    case 'idle': return '#f6b53d'
    case 'dnd': return '#f0506e'
    case 'invisible': return '#7d8394'
    default: return '#3ccf7d'
  }
}

/** Preset frames drawn over the avatar; keyed by users.avatar_decoration. */
const DECORATION_STYLE: Record<string, React.CSSProperties> = {
  gold: { boxShadow: 'inset 0 0 0 2px #f6b53d, 0 0 0 1px rgba(246,181,61,.5)' },
  rainbow: { background: 'conic-gradient(#f0506e, #f6b53d, #3ccf7d, #38bdf8, #6d5dfc, #f0506e)', WebkitMask: 'radial-gradient(circle, transparent calc(100% - 3px), #000 calc(100% - 2.5px))', mask: 'radial-gradient(circle, transparent calc(100% - 3px), #000 calc(100% - 2.5px))' },
  glow: { boxShadow: '0 0 0 2px #6d5dfc, 0 0 10px 2px rgba(109,93,252,.7)' },
  ice: { boxShadow: 'inset 0 0 0 2px #7dd3fc, 0 0 6px 1px rgba(125,211,252,.6)' },
  dashed: { border: '2px dashed #b8bcc8' },
  ember: { boxShadow: 'inset 0 0 0 2px #f97316, 0 0 8px 2px rgba(249,115,22,.6)' },
}

export default function Avatar({ user, size = 32, presence = false, className = '', decoration: override }: Props) {
  const online = useStore((s) => !!s.online[user.id])
  const platforms = useStore((s) => s.platforms[user.id])
  const status = useStore((s) => s.users[user.id]?.status ?? user.status)
  // `decoration` forces a frame (previews, unsaved drafts); otherwise the live store value, then the user object's.
  const decoration = useStore((s) => override ?? s.users[user.id]?.avatar_decoration ?? user.avatar_decoration ?? '')
  const dot = Math.max(8, Math.round(size * 0.32))
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {user.avatar_url ? (
        <img src={user.avatar_url} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />
      ) : (
        <div className="h-full w-full rounded-full flex items-center justify-center text-white font-bold select-none"
          style={{ background: colorFor(user.id), fontSize: size * 0.38 }}>
          {initials(user.display_name)}
        </div>
      )}
      {decoration && DECORATION_STYLE[decoration] && size >= 20 && (
        <span className="absolute inset-0 rounded-full pointer-events-none" style={DECORATION_STYLE[decoration]} data-decoration={decoration} aria-hidden />
      )}
      {presence && <PresenceBadge size={dot} color={statusColor(status, online)} kind={online ? presenceKind(platforms) : 'dot'} title={presenceTitle(status, online, platforms)} />}
    </div>
  )
}

/** Discord-style presence indicator: a dot for desktop/web, a phone when only on mobile, a headset when only in VR. */
export type PresenceKind = 'dot' | 'mobile' | 'vr'
export function presenceKind(platforms: string[] | undefined): PresenceKind {
  const p = platforms ?? []
  if (!p.length || p.includes('desktop') || p.includes('web')) return 'dot'
  if (p.includes('mobile')) return 'mobile'
  if (p.includes('vr')) return 'vr'
  return 'dot'
}
const LABEL: Record<string, string> = { web: 'web', desktop: 'desktop', mobile: 'mobile', vr: 'VR' }
export function presenceTitle(status: string | undefined, online: boolean, platforms: string[] | undefined): string {
  if (!online || status === 'invisible') return 'Offline'
  const s = status === 'idle' ? 'Idle' : status === 'dnd' ? 'Do Not Disturb' : 'Online'
  const p = (platforms ?? []).map((x) => LABEL[x] ?? x)
  return p.length ? `${s} on ${p.join(', ')}` : s
}
function PresenceBadge({ size, color, kind, title }: { size: number; color: string; kind: PresenceKind; title: string }) {
  if (kind === 'dot') return <span className="absolute rounded-full ring-[3px] ring-bg-1" style={{ width: size, height: size, right: -1, bottom: -1, background: color }} title={title} data-presence="dot" />
  const w = Math.round(size * 1.25), h = Math.round(size * 1.25)
  return (
    <span className="absolute rounded-md ring-[3px] ring-bg-1 bg-bg-1 flex items-center justify-center" style={{ width: w, height: h, right: -2, bottom: -2 }} title={title} data-presence={kind} aria-label={title}>
      {kind === 'mobile'
        ? <svg viewBox="0 0 10 16" width={w * 0.55} height={h * 0.8} aria-hidden><rect x="0.5" y="0.5" width="9" height="15" rx="2" fill={color} /><rect x="2" y="2.5" width="6" height="9" rx="0.5" fill="var(--color-bg-1)" /><circle cx="5" cy="13.5" r="0.9" fill="var(--color-bg-1)" /></svg>
        : <svg viewBox="0 0 18 10" width={w * 0.85} height={h * 0.55} aria-hidden><rect x="0.5" y="0.5" width="17" height="9" rx="3" fill={color} /><path d="M6 5.2 Q9 8 12 5.2" stroke="var(--color-bg-1)" strokeWidth="1.6" fill="none" /><circle cx="4.8" cy="4.2" r="1.3" fill="var(--color-bg-1)" /><circle cx="13.2" cy="4.2" r="1.3" fill="var(--color-bg-1)" /></svg>}
    </span>
  )
}
