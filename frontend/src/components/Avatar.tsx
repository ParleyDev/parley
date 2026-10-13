import { colorFor, initials } from '../lib/format'
import { useStore } from '../store'

interface Props {
  user: { id: string; display_name: string; avatar_url: string | null; status?: string }
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

export default function Avatar({ user, size = 32, presence = false, className = '' }: Props) {
  const online = useStore((s) => !!s.online[user.id])
  const status = useStore((s) => s.users[user.id]?.status ?? user.status)
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
      {presence && (
        <span className="absolute rounded-full ring-[3px] ring-bg-1"
          style={{ width: dot, height: dot, right: -1, bottom: -1, background: statusColor(status, online) }} />
      )}
    </div>
  )
}
