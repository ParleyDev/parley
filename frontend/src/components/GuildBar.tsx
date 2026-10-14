import { APP_INITIAL } from '../lib/brand'
import { Compass, Plus } from 'lucide-react'
import { NavLink, useParams } from 'react-router-dom'
import { dmUnreadCount, guildUnread, pendingCount, useStore } from '../store'
import { colorFor, initials } from '../lib/format'

export default function GuildBar() {
  const guildOrder = useStore((s) => s.guildOrder)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const dms = useStore((s) => s.dms)
  const openModal = useStore((s) => s.openModal)
  const { guildId } = useParams()
  const pending = useStore(pendingCount)
  const dmUnread = dmUnreadCount({ readStates, lastMessageId, dms }) + pending

  return (
    <nav className="w-[72px] shrink-0 bg-bg-0 flex flex-col items-center py-3 gap-2 overflow-y-auto">
      <NavLink to="/channels/@me" className={({ isActive }) => `group relative ${isActive ? 'active' : ''}`}>
        {({ isActive }) => (
          <Pill active={isActive} unread={dmUnread > 0}>
            <div className={`h-12 w-12 flex items-center justify-center transition-all duration-200 ${isActive ? 'rounded-2xl bg-accent' : 'rounded-3xl bg-bg-3 group-hover:rounded-2xl group-hover:bg-accent'}`}>
              <span className="font-extrabold text-white text-lg">{APP_INITIAL}</span>
            </div>
            {dmUnread > 0 && <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-[3px] ring-bg-0">{dmUnread}</span>}
            <Tip>Direct Messages</Tip>
          </Pill>
        )}
      </NavLink>
      <div className="h-0.5 w-8 rounded bg-bg-4 my-1" />

      {guildOrder.map((id) => {
        const g = guilds[id]
        if (!g) return null
        const active = guildId === id
        const unread = !active && guildUnread({ readStates, lastMessageId, channels }, id)
        return (
          <NavLink key={id} to={`/channels/${id}`} className="group relative">
            <Pill active={active} unread={unread}>
              <div className={`h-12 w-12 overflow-hidden flex items-center justify-center text-white font-semibold transition-all duration-200 ${active ? 'rounded-2xl' : 'rounded-3xl group-hover:rounded-2xl'}`}
                style={{ background: g.icon_url ? undefined : colorFor(id) }}>
                {g.icon_url ? <img src={g.icon_url} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(g.name)}
              </div>
              <Tip>{g.name}</Tip>
            </Pill>
          </NavLink>
        )
      })}

      <button onClick={() => openModal({ kind: 'createGuild' })} className="group relative">
        <Pill>
          <div className="h-12 w-12 rounded-3xl bg-bg-3 text-success flex items-center justify-center transition-all duration-200 group-hover:rounded-2xl group-hover:bg-success group-hover:text-white"><Plus size={24} /></div>
          <Tip>Add a Server</Tip>
        </Pill>
      </button>
      <button onClick={() => openModal({ kind: 'joinGuild' })} className="group relative">
        <Pill>
          <div className="h-12 w-12 rounded-3xl bg-bg-3 text-success flex items-center justify-center transition-all duration-200 group-hover:rounded-2xl group-hover:bg-success group-hover:text-white"><Compass size={22} /></div>
          <Tip>Join a Server</Tip>
        </Pill>
      </button>
    </nav>
  )
}

function Pill({ active, unread, children }: { active?: boolean; unread?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center">
      <span className={`absolute -left-3 w-1 rounded-r bg-white transition-all duration-200 ${active ? 'h-10' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5'}`} />
      {children}
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-4 whitespace-nowrap rounded-lg bg-bg-0 border border-line px-3 py-1.5 text-sm font-semibold text-text-0 shadow-xl opacity-0 scale-95 transition group-hover:opacity-100 group-hover:scale-100 z-50">
      {children}
    </span>
  )
}
