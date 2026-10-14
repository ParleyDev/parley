import { MessageSquare, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { DmChannel, User } from '../lib/types'
import Avatar from './Avatar'
import { MobileBack } from './HeaderBits'

export default function HomeView() {
  const users = useStore((s) => s.users)
  const online = useStore((s) => s.online)
  const dms = useStore((s) => s.dms)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<User[] | null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults(null); return }
    const t = setTimeout(() => api.get<User[]>(`/users/search?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 200)
    return () => clearTimeout(t)
  }, [q])

  const openDm = async (u: User) => {
    try {
      const dm = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id })
      upsertChannel(dm)
      navigate(`/channels/@me/${dm.id}`)
    } catch (e) { pushToast((e as Error).message, 'error') }
  }

  // "Friends" = everyone you've DM'd, plus anyone known online. Simple, honest heuristic for a clone.
  const known = Object.values(dms).flatMap((d) => d.recipients)
  const seen = new Set<string>()
  const people = known.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true))).map((u) => users[u.id] ?? u)
  const list = results ?? people
  const me = useStore((s) => s.user)

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
      <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line">
        <MobileBack />
        <MessageSquare size={22} className="text-text-2" /><span className="font-bold">Friends</span>
        <span className="mx-2 h-6 w-px bg-line" />
        <span className="text-sm text-text-1 rounded-md px-2 py-0.5 bg-bg-4">All</span>
        <button onClick={() => openModal({ kind: 'newDm' })} className="ml-2 text-sm text-text-1 rounded-md px-2 py-0.5 hover:bg-bg-3">New DM</button>
      </header>
      <div className="flex-1 min-h-0 p-6 max-md:p-3 max-w-3xl w-full mx-auto overflow-y-auto">
        <div className="relative mb-6">
          <input className="input pl-9 py-2.5" placeholder="Search people by username or display name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">{results ? `Results — ${list.length}` : `People — ${list.length}`}</h3>
        <div className="divide-y divide-line">
          {list.map((u) => (
            <button key={u.id} onClick={() => openDm(u)} className="w-full flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-bg-3 text-left group">
              <Avatar user={u} size={36} presence />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{u.display_name} <span className="text-text-2 font-normal text-sm opacity-0 group-hover:opacity-100">@{u.username}</span></div>
                <div className="text-xs text-text-2">{online[u.id] ? 'Online' : 'Offline'}</div>
              </div>
              <span className="h-9 w-9 rounded-full bg-bg-1 flex items-center justify-center text-text-2 group-hover:text-text-0"><MessageSquare size={18} /></span>
            </button>
          ))}
          {list.length === 0 && (
            <div className="py-16 text-center text-text-2">
              <div className="text-5xl mb-3">🫥</div>
              {results ? <p>No one found.</p> : <p>No one here yet. Search for someone to start a conversation{me ? `, ${me.display_name}` : ''}.</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
