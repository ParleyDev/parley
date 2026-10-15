import { Bookmark, BookmarkMinus, CircleUserRound, Crown, Hash, LogOut, Phone, Pin, PinOff, Search, UserPlus, Users, Video, X } from 'lucide-react'
import GroupIcon from './GroupIcon'
import { dmName, isGroup } from '../lib/dm'
import { anchorOf } from '../lib/anchor'
import { useNavigate } from 'react-router-dom'
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

/** Close a header popover on Escape. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

export default function ChatView({ channel }: { channel: Channel | DmChannel }) {
  const isDm = channel.guild_id === null
  const users = useStore((s) => s.users)
  const dmProfileOpen = useStore((s) => s.dmProfileOpen)
  const setDmProfileOpen = useStore((s) => s.setDmProfileOpen)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const pushToast = useStore((s) => s.pushToast)
  const group = isDm && isGroup(channel as DmChannel)
  const recipient = isDm && !group ? (channel as DmChannel).recipients[0] : null
  const other = recipient ? { ...recipient, ...users[recipient.id] } : null
  const openModal = useStore((s) => s.openModal)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const saveName = async () => {
    setRenaming(false)
    const n = nameDraft.trim()
    if (n === (channel.name ?? '')) return
    try { await api.patch(`/channels/${channel.id}`, { name: n }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const [pins, setPins] = useState(false)
  const [bookmarks, setBookmarks] = useState(false)
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
          {group ? (
            <>
              <GroupIcon dm={channel as DmChannel} size={24} />
              {renaming ? (
                <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }} maxLength={100} placeholder="Group name" data-group-rename
                  className="h-7 w-56 rounded-md bg-bg-0 border border-accent/60 px-2 text-sm font-bold outline-none" />
              ) : (
                <button onClick={() => { setNameDraft(channel.name ?? ''); setRenaming(true) }} title="Rename group" className="font-bold truncate hover:underline text-left" data-group-name>{dmName(channel as DmChannel, users)}</button>
              )}
              <span className="text-xs text-text-2 whitespace-nowrap max-md:hidden" data-group-count>{(channel as DmChannel).recipients.length + 1} members</span>
            </>
          ) : isDm && other ? (
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
            <span className="relative">
              <button onClick={() => setBookmarks((b) => !b)} title="Bookmarks" className={btn(bookmarks)} data-bookmarks-toggle><Bookmark size={20} /></button>
              {bookmarks && <BookmarksPanel channelId={channel.id} onClose={() => setBookmarks(false)} />}
            </span>
            {isDm && <button onClick={() => openModal({ kind: 'groupMembers', channelId: channel.id })} title={group ? 'Add Friends to Group' : 'Add Friends to DM'} className={btn(false)} data-add-to-group><UserPlus size={20} /></button>}
            {isDm && !group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? 'Hide User Profile' : 'Show User Profile'} className={`${btn(dmProfileOpen)} max-md:hidden`} data-profile-toggle><CircleUserRound size={20} /></button>}
            {group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? 'Hide Member List' : 'Show Member List'} className={`${btn(dmProfileOpen)} max-md:hidden`} data-group-members-toggle><Users size={20} /></button>}
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
      ) : group && dmProfileOpen ? (
        <GroupMembersPanel dm={channel as DmChannel} />
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

/** Right-hand panel in a group DM: members with the owner's crown, remove (owner) and Leave. */
function GroupMembersPanel({ dm }: { dm: DmChannel }) {
  const me = useStore((s) => s.user)
  const users = useStore((s) => s.users)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const isOwner = dm.owner_id === me?.id
  const members = [...(me ? [me as unknown as typeof dm.recipients[number]] : []), ...dm.recipients].map((u) => users[u.id] ?? u)
  const remove = (u: { id: string; display_name: string }) => openModal({ kind: 'confirm', title: `Remove ${u.display_name}`, body: `Remove ${u.display_name} from the group? They can be added back later.`, danger: true, confirmLabel: 'Remove',
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${u.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const leave = () => openModal({ kind: 'confirm', title: `Leave '${dmName(dm, users)}'`, body: 'You will stop receiving messages from this group unless someone adds you back.', danger: true, confirmLabel: 'Leave Group',
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${me?.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <aside className="w-60 shrink-0 bg-bg-1 border-l border-line overflow-y-auto px-2 pt-4 max-md:hidden flex flex-col" data-group-members>
      <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Members — {members.length}</h3>
      <div className="space-y-0.5">
        {members.map((u) => (
          <div key={u.id} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3" data-group-member={u.id}>
            <button onClick={(e) => openModal({ kind: 'profile', userId: u.id, anchor: anchorOf(e) })} className="flex items-center gap-3 min-w-0 flex-1 text-left">
              <Avatar user={u} size={32} presence />
              <span className="truncate text-[15px] font-medium text-text-1">{u.display_name}</span>
              {dm.owner_id === u.id && <span title="Group owner" className="shrink-0 flex"><Crown size={14} className="text-warn" /></span>}
            </button>
            {isOwner && u.id !== me?.id && <button onClick={() => remove(u)} title="Remove from group" className="opacity-0 group-hover:opacity-100 text-text-2 hover:text-danger" data-remove-member><X size={16} /></button>}
          </div>
        ))}
      </div>
      <div className="mt-auto p-2 space-y-1">
        <button onClick={() => openModal({ kind: 'groupMembers', channelId: dm.id })} className="w-full btn-ghost justify-center"><UserPlus size={16} /> Add Friends</button>
        <button onClick={leave} className="w-full btn-ghost justify-center text-danger" data-leave-group><LogOut size={16} /> Leave Group</button>
      </div>
    </aside>
  )
}

type BookmarkedMessage = Message & { guild_id: string | null; channel_name: string }

/** Every message the user bookmarked, across channels; Jump navigates when it lives elsewhere. */
function BookmarksPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [list, setList] = useState<BookmarkedMessage[] | null>(null)
  const pushToast = useStore((s) => s.pushToast)
  const setBookmark = useStore((s) => s.setBookmark)
  const navigate = useNavigate()
  useEscape(onClose)
  useEffect(() => { api.get<BookmarkedMessage[]>('/users/@me/bookmarks').then(setList).catch(() => setList([])) }, [])
  const remove = async (m: Message) => {
    try { await api.delete(`/users/@me/bookmarks/${m.id}`); setBookmark(m.id, false); setList((l) => (l ?? []).filter((x) => x.id !== m.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const jump = (m: BookmarkedMessage) => {
    if (m.channel_id === channelId) { if (jumpToMessage(m.id)) onClose(); else pushToast('That message is not loaded in this view yet', 'error'); return }
    onClose(); navigate(`/channels/${m.guild_id ?? '@me'}/${m.channel_id}`)
    // Give the channel a moment to load, then flash the message if it is among the recent ones.
    let tries = 0
    const t = setInterval(() => { if (jumpToMessage(m.id) || ++tries > 20) clearInterval(t) }, 150)
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl" data-bookmarks-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Bookmark size={16} className="text-text-2" /><span className="font-bold">Bookmarks</span><button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
        <div className="overflow-y-auto p-3 space-y-2">
          {list === null && <p className="text-sm text-text-2 p-3">Loading…</p>}
          {list?.length === 0 && <div className="p-6 text-center text-sm text-text-2">No bookmarks yet.<br />Right-click a message and choose Bookmark Message.</div>}
          {list?.map((m) => (
            <div key={m.id}>
              <div className="px-1 mb-0.5 text-[11px] text-text-2 truncate">{m.guild_id ? `#${m.channel_name}` : 'Direct Message'}</div>
              <MessageCard m={m} onJump={() => jump(m)} action={<button onClick={() => remove(m)} title="Remove bookmark" className="rounded p-0.5 text-text-2 hover:text-danger" data-unbookmark><BookmarkMinus size={14} /></button>} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function PinnedPanel({ channel, onClose }: { channel: Channel | DmChannel; onClose: () => void }) {
  const [pins, setPins] = useState<Message[] | null>(null)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const pushToast = useStore((s) => s.pushToast)
  const canUnpin = channel.guild_id === null || has(perms, P.MANAGE_MESSAGES)
  const ref = useRef<HTMLDivElement>(null)
  useEscape(onClose)
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
