import { Check, MessageSquare, MoreVertical, Search, UserPlus, Users, X } from 'lucide-react'
import { useEffect as useEffectCb } from 'react'
import { useSearchParams } from 'react-router-dom'
import InboxButton from './InboxButton'
import { anchorOf } from '../lib/anchor'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { pendingCount, useStore } from '../store'
import type { DmChannel, Relationship, User } from '../lib/types'
import Avatar from './Avatar'
import { MobileBack } from './HeaderBits'
import StyledName from './StyledName'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

export default function HomeView() {
  const [params, setParams] = useSearchParams()
  useEffectCb(() => {
    const ok = params.get('connected'); const err = params.get('connect_error')
    if (!ok && !err) return
    useStore.getState().pushToast(ok ? `${ok[0].toUpperCase()}${ok.slice(1)} account linked. Manage it in Settings → Connections.` : `Could not link the account: ${err}`, ok ? undefined : 'error')
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const relationships = useStore((s) => s.relationships)
  const online = useStore((s) => s.online)
  const users = useStore((s) => s.users)
  const pending = useStore(pendingCount)
  const [tab, setTab] = useState<Tab>('online')
  const [q, setQ] = useState('')
  const all = Object.values(relationships)
  const friends = all.filter((r) => r.kind === 'friend')
  const isOnline = (u: User) => !!online[u.id] && (users[u.id]?.status ?? u.status) !== 'invisible'
  const match = (r: Relationship) => !q || r.user.display_name.toLowerCase().includes(q.toLowerCase()) || r.user.username.toLowerCase().includes(q.toLowerCase())
  const list = (tab === 'online' ? friends.filter((r) => isOnline(r.user)) : tab === 'all' ? friends : tab === 'pending' ? all.filter((r) => r.kind === 'incoming' || r.kind === 'outgoing') : all.filter((r) => r.kind === 'blocked'))
    .filter(match)
    .sort((a, b) => (a.kind === 'incoming' ? -1 : 0) - (b.kind === 'incoming' ? -1 : 0) || a.user.display_name.localeCompare(b.user.display_name))

  const TabBtn = ({ id, label, badge }: { id: Tab; label: string; badge?: number }) => (
    <button onClick={() => setTab(id)} className={`relative text-sm rounded-md px-2 py-0.5 whitespace-nowrap ${tab === id ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3 hover:text-text-0'}`}>
      {label}
      {!!badge && <span className="ml-1.5 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold">{badge}</span>}
    </button>
  )

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
      <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line overflow-x-auto">
        <MobileBack />
        <Users size={22} className="text-text-2 shrink-0" /><span className="font-bold">Friends</span>
        <span className="mx-2 h-6 w-px bg-line shrink-0" />
        <TabBtn id="online" label="Online" />
        <TabBtn id="all" label="All" />
        <TabBtn id="pending" label="Pending" badge={pending} />
        <TabBtn id="blocked" label="Blocked" />
        <button onClick={() => setTab('add')} className={`text-sm rounded-md px-2.5 py-0.5 font-semibold whitespace-nowrap ${tab === 'add' ? 'text-success' : 'bg-success text-black hover:bg-success/80'}`}>Add Friend</button>
        <span className="ml-auto"><InboxButton /></span>
      </header>

      {tab === 'add' ? <AddFriend /> : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-6 max-md:p-3 w-full">
            <div className="relative mb-5">
              <input className="input pl-9 py-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
            </div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">
              {tab === 'online' ? 'Online' : tab === 'all' ? 'All friends' : tab === 'pending' ? 'Pending' : 'Blocked'} — {list.length}
            </h3>
            <div className="divide-y divide-line">
              {list.map((r) => <Row key={r.user.id} r={r} online={isOnline(r.user)} />)}
              {list.length === 0 && <Empty tab={tab} />}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Empty({ tab }: { tab: Tab }) {
  const text = tab === 'online' ? 'No friends are online right now.' : tab === 'all' ? 'No friends yet. Use Add Friend to find people by username.' : tab === 'pending' ? 'There are no pending friend requests.' : 'You haven\'t blocked anyone.'
  return (
    <div className="py-16 text-center text-text-2">
      <div className="text-5xl mb-3">{tab === 'blocked' ? '🚫' : '🫥'}</div>
      <p>{text}</p>
    </div>
  )
}

function Row({ r, online }: { r: Relationship; online: boolean }) {
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const u = r.user
  const act = async (fn: () => Promise<unknown>) => { setMenu(false); try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } }
  const dm = () => act(async () => { const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(c); navigate(`/channels/@me/${c.id}`) })
  const accept = () => act(() => api.put(`/users/@me/relationships/${u.id}`))
  // New friends (the last day) get a one-tap wave: a 👋 in your DM with them.
  const [waved, setWaved] = useState(false)
  const wave = () => act(async () => { setWaved(true); const c = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(c); await api.post(`/channels/${c.id}/messages`, { content: '👋' }); pushToast(`You waved at ${u.display_name}`) })
  const remove = () => act(() => api.delete(`/users/@me/relationships/${u.id}`))
  const block = () => act(() => api.put(`/users/@me/relationships/${u.id}/block`))
  const sub = r.kind === 'incoming' ? 'Incoming Friend Request' : r.kind === 'outgoing' ? 'Outgoing Friend Request' : r.kind === 'blocked' ? 'Blocked' : online ? 'Online' : 'Offline'
  const Btn = ({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
    <button title={title} onClick={onClick} className={`h-9 w-9 rounded-full bg-bg-1 flex items-center justify-center text-text-2 ${danger ? 'hover:text-danger' : 'hover:text-text-0'}`}>{children}</button>
  )
  return (
    <div className="group flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-bg-3" data-motion-row>
      <button onClick={(e) => openModal({ kind: 'profile', userId: u.id, anchor: anchorOf(e) })}><Avatar user={u} size={36} presence={r.kind === 'friend'} /></button>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate"><StyledName userId={u.id}>{u.display_name}</StyledName> <span className="text-text-2 font-normal text-sm opacity-0 group-hover:opacity-100 max-md:opacity-100">@{u.username}</span></div>
        <div className="text-xs text-text-2">{sub}</div>
        {r.note && (r.kind === 'incoming' || r.kind === 'outgoing') && <div className="mt-0.5 truncate text-sm text-text-1" title={r.note} data-request-note>“{r.note}”</div>}
      </div>
      <div className="flex items-center gap-2 relative">
        {r.kind === 'friend' && isNewFriend(r) && !waved && <button type="button" onClick={wave} className="rounded-full bg-bg-1 px-3 py-1.5 text-sm text-text-1 hover:text-text-0" title={`Say hi to ${u.display_name}`} data-wave-friend={u.id}>👋 Wave</button>}
        {r.kind === 'friend' && <Btn title="Message" onClick={dm}><MessageSquare size={18} /></Btn>}
        {r.kind === 'incoming' && <Btn title="Accept" onClick={accept}><Check size={18} className="text-success" /></Btn>}
        {r.kind === 'incoming' && <Btn title="Ignore" onClick={remove} danger><X size={18} /></Btn>}
        {r.kind === 'outgoing' && <Btn title="Cancel" onClick={remove} danger><X size={18} /></Btn>}
        {r.kind === 'blocked' && <Btn title="Unblock" onClick={remove}><X size={18} /></Btn>}
        {r.kind === 'friend' && (
          <>
            <Btn title="More" onClick={() => setMenu((m) => !m)}><MoreVertical size={18} /></Btn>
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div className="pop absolute right-0 top-full mt-1 z-40 w-44 rounded-xl bg-bg-0 border border-line shadow-2xl p-1.5 text-sm">
                  <button onClick={remove} className="w-full text-left rounded-md px-2.5 py-2 text-danger hover:bg-danger hover:text-white">Remove Friend</button>
                  <button onClick={block} className="w-full text-left rounded-md px-2.5 py-2 text-danger hover:bg-danger hover:text-white">Block</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AddFriend() {
  const relationships = useStore((s) => s.relationships)
  const me = useStore((s) => s.user)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [results, setResults] = useState<User[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!name.trim()) { setResults([]); return }
    const t = setTimeout(() => api.get<User[]>(`/users/search?q=${encodeURIComponent(name.trim())}`).then(setResults).catch(() => setResults([])), 200)
    return () => clearTimeout(t)
  }, [name])

  const send = async (body: { username?: string; user_id?: string }, label: string) => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/users/@me/relationships', { ...body, ...(note.trim() ? { note: note.trim() } : {}) })
      setNote('')
      setMsg({ ok: true, text: `Success! Your friend request to ${label} was sent.` })
      setName('')
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) send({ username: name.trim() }, name.trim()) }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 max-md:p-3 w-full">
        <h2 className="font-bold uppercase text-sm tracking-wide">Add Friend</h2>
        <p className="text-sm text-text-2 mt-1">You can add friends with their username.</p>
        <form onSubmit={submit} className={`mt-4 flex items-center gap-2 rounded-lg bg-bg-0/60 border p-1 pl-3 ${msg ? (msg.ok ? 'border-success' : 'border-danger') : 'border-line focus-within:border-accent/70'}`}>
          <input className="flex-1 bg-transparent text-[15px] outline-none py-1.5 placeholder:text-text-2" placeholder="You can add friends with their username." value={name} onChange={(e) => { setName(e.target.value); setMsg(null) }} autoFocus />
          <button className="btn-primary py-1.5 whitespace-nowrap" disabled={busy || !name.trim()}><UserPlus size={16} /> Send Friend Request</button>
        </form>
        <input className="input mt-2 text-sm" maxLength={150} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional), e.g. how you know them" aria-label="Note with the request" data-request-note-input />
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
        {results.length > 0 && (
          <div className="mt-6">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">People — {results.length}</h3>
            <div className="divide-y divide-line">
              {results.filter((u) => u.id !== me?.id).map((u) => {
                const rel = relationships[u.id]?.kind
                return (
                  <div key={u.id} className="flex items-center gap-3 py-2.5 px-2" data-motion-row>
                    <Avatar user={u} size={36} />
                    <div className="min-w-0 flex-1"><div className="font-semibold truncate">{u.display_name}</div><div className="text-xs text-text-2">@{u.username}</div></div>
                    {rel === 'friend' ? <span className="text-xs text-text-2">Friends</span>
                      : rel === 'outgoing' ? <span className="text-xs text-text-2">Request sent</span>
                      : rel === 'incoming' ? <button onClick={() => send({ user_id: u.id }, u.display_name)} className="btn-primary bg-success hover:bg-success/80 text-black py-1.5">Accept</button>
                      : rel === 'blocked' ? <span className="text-xs text-text-2">Blocked</span>
                      : <button onClick={() => send({ user_id: u.id }, u.display_name)} disabled={busy} className="btn-primary py-1.5"><UserPlus size={16} /> Add</button>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {name.trim() && results.length === 0 && !msg && <p className="mt-6 text-sm text-text-2">No one found. Usernames are exact: letters, numbers, _ and . only.</p>}
      </div>
    </div>
  )
}

/** Friends for less than a day get the Wave button. */
const isNewFriend = (r: Relationship) => Date.now() - new Date(r.created_at).getTime() < 86_400_000
