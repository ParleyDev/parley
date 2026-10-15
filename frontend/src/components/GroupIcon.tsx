import { Users } from 'lucide-react'
import type { DmChannel, User } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'

/** A group DM's icon: its custom image, or a stacked pair of member avatars like Discord. */
export default function GroupIcon({ dm, size = 32 }: { dm: DmChannel; size?: number }) {
  const users = useStore((s) => s.users)
  if (dm.icon_url) return <img src={dm.icon_url} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} draggable={false} />
  const rec: User[] = dm.recipients.map((r) => users[r.id] ?? r)
  if (rec.length === 0) return <span className="rounded-full bg-bg-4 text-text-1 flex items-center justify-center shrink-0" style={{ width: size, height: size }}><Users size={size * 0.5} /></span>
  if (rec.length === 1) return <Avatar user={rec[0]} size={size} />
  const small = Math.round(size * 0.68)
  return (
    <span className="relative shrink-0 block" style={{ width: size, height: size }} data-group-icon>
      <span className="absolute left-0 top-0"><Avatar user={rec[1]} size={small} /></span>
      <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-bg-1"><Avatar user={rec[0]} size={small} /></span>
    </span>
  )
}
