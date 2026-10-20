import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'

interface Props {
  user: { id: string; display_name: string; avatar_url: string | null; status?: string; avatar_decoration?: string }
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

export default function Avatar({ user, size = 32, presence = false, className = '' }: Props) {
  const online = useStore((s) => !!s.online[user.id])
  const status = useStore((s) => s.users[user.id]?.status ?? user.status)
  const decoration = useStore((s) => s.users[user.id]?.avatar_decoration ?? user.avatar_decoration ?? '')
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
      {presence && (
        <span className="absolute rounded-full ring-[3px] ring-bg-1"
          style={{ width: dot, height: dot, right: -1, bottom: -1, background: statusColor(status, online) }} />
      )}
    </div>
  )
}
