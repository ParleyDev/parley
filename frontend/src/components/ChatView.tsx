import { CircleUserRound, Hash, Phone, Pin, PinOff, Search, Video, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Channel, DmChannel, Message } from '../lib/types'
import { api } from '../lib/api'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { formatTime, renderMarkdown } from '../lib/format'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import ChatPane from './ChatPane'
import DmCall from './DmCall'
import DmProfilePanel from './DmProfilePanel'
import { MembersToggle, MobileBack } from './HeaderBits'

/** Scroll a loaded message into view and flash it. Returns false when it is not in the DOM. */
export function jumpToMessage(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${id}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center' })
  el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1800)
  return true
}

export default function ChatView({ channel }: { channel: Channel | DmChannel }) {
  const isDm = channel.guild_id === null
  const users = useStore((s) => s.users)
  const dmProfileOpen = useStore((s) => s.dmProfileOpen)
  const setDmProfileOpen = useStore((s) => s.setDmProfileOpen)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const pushToast = useStore((s) => s.pushToast)
  const recipient = isDm ? (channel as DmChannel).recipients[0] : null
  const other = recipient ? { ...recipient, ...users[recipient.id] } : null
  const [pins, setPins] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<string | null>(null)
  useEffect(() => { setPins(false); setSearch(null); setQuery('') }, [channel.id])

  const startCall = async (video: boolean) => {
    if (myVoice === channel.id) return
    await voice.join(channel.id)
    if (video) voice.toggleCamera()
  }
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) { e.preventDefault(); setSearch(query.trim()) }
    if (e.key === 'Escape') { setQuery(''); setSearch(null) }
  }
  const btn = (active: boolean) => `h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${active ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`

  return (
    <>
      <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
        <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line shadow-sm">
          <MobileBack />
          {isDm && other ? (
            <>
              <Avatar user={other} size={24} presence />
              <span className="font-bold truncate">{other.display_name}</span>
              {other.custom_status && <span className="text-sm text-text-1 truncate max-md:hidden" data-header-status>{other.custom_status}</span>}
            </>
          ) : (
            <>
              <Hash size={22} className="text-text-2 shrink-0" />
              <span className="font-bold truncate">{channel.name}</span>
              {channel.topic && <><span className="mx-2 h-6 w-px bg-line max-md:hidden" /><span className="text-sm text-text-2 truncate max-md:hidden">{channel.topic}</span></>}
            </>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            {isDm && (
              <>
                <button onClick={() => startCall(false)} title="Start Voice Call" className={btn(myVoice === channel.id)} data-start-call><Phone size={20} /></button>
                <button onClick={() => startCall(true)} title="Start Video Call" className={btn(false)} data-start-video><Video size={20} /></button>
              </>
            )}
            <span className="relative">
              <button onClick={() => setPins((p) => !p)} title="Pinned Messages" className={btn(pins)} data-pins-toggle><Pin size={20} /></button>
              {pins && <PinnedPanel channel={channel} onClose={() => setPins(false)} />}
            </span>
            {isDm && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? 'Hide User Profile' : 'Show User Profile'} className={`${btn(dmProfileOpen)} max-md:hidden`} data-profile-toggle><CircleUserRound size={20} /></button>}
            {!isDm && <MembersToggle />}
            <span className="relative ml-1 max-md:hidden">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={isDm && other ? `Search ${other.username}` : 'Search'} aria-label="Search messages" data-search-input
                className="h-7 w-36 focus:w-56 transition-[width] rounded-md bg-bg-0 border border-line pl-2 pr-7 text-sm outline-none focus:border-accent/60" />
              <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 pointer-events-none" />
            </span>
          </span>
        </header>
        {isDm && <DmCall channel={channel as DmChannel} />}
        <ChatPane channel={channel} />
      </main>
      {search !== null ? (
        <SearchPanel channel={channel} query={search} onClose={() => { setSearch(null); setQuery('') }} onMiss={() => pushToast('That message is not loaded in this view yet', 'error')} />
      ) : isDm && other && dmProfileOpen ? (
        <DmProfilePanel userId={other.id} />
      ) : null}
    </>
  )
}

/** A compact rendering of a message for the pins and search lists, with Jump. */
function MessageCard({ m, onJump, action }: { m: Message; onJump: () => void; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 p-3" data-msg-card={m.id}>
      <div className="flex items-center gap-2 mb-1">
        <Avatar user={m.author} size={20} />
        <span className="font-semibold text-sm truncate">{m.author.display_name}</span>
        <span className="text-[11px] text-text-2 shrink-0">{formatTime(m.created_at)}</span>
        <span className="ml-auto flex items-center gap-1">
          {action}
          <button onClick={onJump} className="rounded bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1 hover:bg-bg-4 hover:text-text-0" data-jump>Jump</button>
        </span>
      </div>
      <div className="msg-content text-sm whitespace-pre-wrap break-words line-clamp-4">{renderMarkdown(m.content)}</div>
      {m.attachments?.length > 0 && <div className="mt-1 text-xs text-text-2">📎 {m.attachments.map((a) => a.filename.replace(/^SPOILER_/, '')).join(', ')}</div>}
    </div>
  )
}

function PinnedPanel({ channel, onClose }: { channel: Channel | DmChannel; onClose: () => void }) {
  const [pins, setPins] = useState<Message[] | null>(null)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const pushToast = useStore((s) => s.pushToast)
  const canUnpin = channel.guild_id === null || has(perms, P.MANAGE_MESSAGES)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { api.get<Message[]>(`/channels/${channel.id}/pins`).then(setPins).catch(() => setPins([])) }, [channel.id])
  const unpin = async (m: Message) => {
    try { await api.delete(`/channels/${channel.id}/pins/${m.id}`); setPins((ps) => (ps ?? []).filter((x) => x.id !== m.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div ref={ref} className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl" data-pins-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Pin size={16} className="text-text-2" /><span className="font-bold">Pinned Messages</span><button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
        <div className="overflow-y-auto p-3 space-y-2">
          {pins === null && <p className="text-sm text-text-2 p-3">Loading…</p>}
          {pins?.length === 0 && <div className="p-6 text-center text-sm text-text-2">This channel doesn't have any pinned messages yet.<br />Pin one from a message's "⋯" menu.</div>}
          {pins?.map((m) => <MessageCard key={m.id} m={m} onJump={() => { if (jumpToMessage(m.id)) onClose(); else pushToast('That message is not loaded in this view yet', 'error') }}
            action={canUnpin ? <button onClick={() => unpin(m)} title="Unpin" className="rounded p-0.5 text-text-2 hover:text-danger" data-unpin><PinOff size={14} /></button> : undefined} />)}
        </div>
      </div>
    </>
  )
}

function SearchPanel({ channel, query, onClose, onMiss }: { channel: Channel | DmChannel; query: string; onClose: () => void; onMiss: () => void }) {
  const [results, setResults] = useState<Message[] | null>(null)
  useEffect(() => { setResults(null); api.get<Message[]>(`/channels/${channel.id}/search?q=${encodeURIComponent(query)}`).then(setResults).catch(() => setResults([])) }, [channel.id, query])
  return (
    <aside className="w-[420px] shrink-0 bg-bg-1 border-l border-line flex flex-col max-md:hidden" data-search-panel>
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <Search size={16} className="text-text-2" /><span className="font-bold truncate">Results for "{query}"</span>
        {results && <span className="text-xs text-text-2">{results.length}</span>}
        <button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0" title="Close search"><X size={18} /></button>
      </div>
      <div className="overflow-y-auto p-3 space-y-2">
        {results === null && <p className="text-sm text-text-2 p-3">Searching…</p>}
        {results?.length === 0 && <div className="p-6 text-center text-sm text-text-2">No results found.</div>}
        {results?.map((m) => <MessageCard key={m.id} m={m} onJump={() => { if (!jumpToMessage(m.id)) onMiss() }} />)}
      </div>
    </aside>
  )
}
