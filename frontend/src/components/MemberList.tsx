import { Crown, X } from 'lucide-react'
import { useStore } from '../store'
import Avatar from './Avatar'

export default function MemberList({ guildId }: { guildId: string }) {
  const members = useStore((s) => s.members[guildId])
  const online = useStore((s) => s.online)
  const users = useStore((s) => s.users)
  const guild = useStore((s) => s.guilds[guildId])
  const openModal = useStore((s) => s.openModal)
  const open = useStore((s) => s.membersOpen)
  const setOpen = useStore((s) => s.setMembersOpen)
  const list = Object.values(members ?? {}).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const visible = (id: string) => online[id] && (users[id]?.status ?? '') !== 'invisible'
  const on = list.filter((m) => visible(m.user_id))
  const off = list.filter((m) => !visible(m.user_id))

  const Row = ({ m, dim }: { m: typeof list[number]; dim?: boolean }) => (
    <button onClick={() => openModal({ kind: 'profile', userId: m.user_id })} className={`w-full flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3 text-left ${dim ? 'opacity-40 hover:opacity-100' : ''}`}>
      <Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={32} presence />
      <span className="truncate text-[15px] font-medium text-text-1">{m.nickname ?? m.display_name}</span>
      {guild?.owner_id === m.user_id && <Crown size={14} className="text-warn shrink-0" />}
    </button>
  )

  if (!open) return null
  return (
    <aside className="w-60 shrink-0 bg-bg-1 overflow-y-auto px-2 pt-4 max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:pt-0">
      <div className="lg:hidden h-12 -mx-2 mb-2 px-3 flex items-center gap-2 border-b border-line bg-bg-1 sticky top-0">
        <span className="font-bold">Members</span>
        <button onClick={() => setOpen(false)} className="ml-auto h-9 w-9 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0"><X size={20} /></button>
      </div>
      <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Online — {on.length}</h3>
      <div className="space-y-0.5 mb-5">{on.map((m) => <Row key={m.user_id} m={m} />)}</div>
      {off.length > 0 && (<>
        <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Offline — {off.length}</h3>
        <div className="space-y-0.5">{off.map((m) => <Row key={m.user_id} m={m} dim />)}</div>
      </>)}
    </aside>
  )
}
