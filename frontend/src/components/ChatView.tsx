import { Bookmark, BookmarkMinus, CalendarDays, ChevronRight, CircleUserRound, Crown, Hash, Lock, LockOpen, LogOut, MessageSquareText, MessagesSquare, Phone, Pin, PinOff, Search, UserPlus, Users, Video, X } from 'lucide-react'
import GroupIcon from './GroupIcon'
import { dmName, isGroup, nameOf } from '../lib/dm'
import { uploadImage } from '../lib/upload'
import { anchorOf } from '../lib/anchor'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Channel, DmChannel, Message } from '../lib/types'
import { api } from '../lib/api'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { formatTime, renderMarkdown } from '../lib/format'
import { voice } from '../lib/voice'
import Avatar from './Avatar'
import ChatPane from './ChatPane'
import { ThreadPanel, ThreadsPanel } from './ThreadPanel'
import ForumView from './ForumView'
import DmCall from './DmCall'
import { STORAGE_PREFIX } from '../lib/brand'
import InboxButton from './InboxButton'
import DmProfilePanel from './DmProfilePanel'
import { MembersToggle, MobileBack } from './HeaderBits'
import { useT } from '../lib/i18n'

/** Scroll a loaded message into view and flash it. Returns false when it is not in the DOM. */
export function jumpToMessage(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${id}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center' })
  el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1800)
  el.dispatchEvent(new Event('msgflash'))
  return true
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Scroll to a message in `channelId`, loading older history page by page until it is in the list (pins, bookmarks,
 * search hits, reply links). Works right after navigating to the channel too: waits for its first page first.
 * Resolves false only when the message cannot be reached (deleted, or further back than the page cap).
 */
export async function jumpToMessageAsync(channelId: string, id: string): Promise<boolean> {
  if (jumpToMessage(id)) return true
  for (let i = 0; i < 50 && !(useStore.getState().messages[channelId]?.length); i++) await sleep(100)
  // Load a window around it (one request however far back it is); the pane then pages forward on scroll.
  await useStore.getState().loadAround(channelId, id)
  for (let i = 0; i < 20; i++) { if (jumpToMessage(id)) return true; await sleep(50) }
  return false
}

/** A uuid v7 whose timestamp is `ms`: sorts exactly where a message created then would. */
export const uuidAt = (ms: number) => { const hex = Math.max(0, Math.floor(ms)).toString(16).padStart(12, '0'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000` }

/** Show the channel from the start of a day (local time); true when a message on or after it was found. */
export async function jumpToDate(channelId: string, date: string): Promise<boolean> {
  const start = new Date(`${date}T00:00:00`).getTime()
  if (!Number.isFinite(start)) return false
  const anchor = uuidAt(start)
  await useStore.getState().loadAround(channelId, anchor)
  const first = (useStore.getState().messages[channelId] ?? []).find((m) => m.id > anchor && !m.local)
  if (!first) return false
  for (let i = 0; i < 20; i++) { if (jumpToMessage(first.id)) return true; await sleep(50) }
  return false
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
  const t = useT()
  const isDm = channel.guild_id === null
  const [ageOk, setAgeOk] = useState(() => nsfwAccepted(channel.id))
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const dmProfileOpen = useStore((s) => s.dmProfileOpen)
  const setDmProfileOpen = useStore((s) => s.setDmProfileOpen)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const pushToast = useStore((s) => s.pushToast)
  const group = isDm && isGroup(channel as DmChannel)
  const recipient = isDm && !group ? (channel as DmChannel).recipients[0] : null
  const other = recipient ? { ...recipient, ...users[recipient.id] } : null
  const openModal = useStore((s) => s.openModal)
  const [renaming, setRenaming] = useState(false)
  const [datePick, setDatePick] = useState(false)
  const iconRef = useRef<HTMLInputElement>(null)
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
  const [threads, setThreads] = useState(false)
  const openThread = useStore((s) => s.openThread)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const openThreadChannel = useStore((s) => (s.openThread ? s.channels[s.openThread] : undefined))
  const threadHere = !!openThread && openThreadChannel?.parent_id === channel.id
  const [search, setSearch] = useState<string | null>(null)
  useEffect(() => { setPins(false); setSearch(null); setQuery(''); setThreads(false) }, [channel.id])

  const startCall = async (video: boolean) => {
    if (myVoice === channel.id) return
    await voice.join(channel.id)
    if (video) voice.toggleCamera()
  }
  // DM and group calls: any member can switch end-to-end encryption on or off (everyone in a call reconnects).
  const toggleE2ee = async () => {
    try { await api.patch(`/channels/${channel.id}`, { e2ee: !channel.e2ee }) } catch (e) { useStore.getState().pushToast((e as Error).message, 'error') }
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
              <button type="button" title="Change group icon" className="rounded-full hover:opacity-80" onClick={() => iconRef.current?.click()} data-group-icon-btn><GroupIcon dm={channel as DmChannel} size={24} /></button>
              <input ref={iconRef} type="file" accept="image/*" className="hidden" data-group-icon-input onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const img = await uploadImage('icon', f); await api.patch(`/channels/${channel.id}`, { icon_url: img.url }) } catch (err) { pushToast((err as Error).message, 'error') } }} />
              {renaming ? (
                <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }} maxLength={100} placeholder="Group name" data-group-rename
                  className="h-7 w-56 rounded-md bg-bg-0 border border-accent/60 px-2 text-sm font-bold outline-none" />
              ) : (
                <button onClick={() => { setNameDraft(channel.name ?? ''); setRenaming(true) }} title="Rename group" className="font-bold truncate hover:underline text-left" data-group-name>{dmName(channel as DmChannel, users, notes)}</button>
              )}
              <span className="text-xs text-text-2 whitespace-nowrap max-md:hidden" data-group-count>{(channel as DmChannel).recipients.length + 1} members</span>
            </>
          ) : isDm && other ? (
            <>
              <Avatar user={other} size={24} presence />
              <span className="font-bold truncate" data-dm-header-name>{nameOf(other, notes)}</span>
              {other.custom_status && <span className="text-sm text-text-1 truncate max-md:hidden" data-header-status>{other.custom_status}</span>}
            </>
          ) : (
            <>
              {channel.kind === 'forum' ? <MessageSquareText size={22} className="text-text-2 shrink-0" /> : <Hash size={22} className="text-text-2 shrink-0" />}
              <span className="font-bold truncate">{channel.name}</span>
              {channel.nsfw && <span className="ml-1 rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger" title="Age-restricted channel" data-nsfw-badge>18+</span>}
              {channel.topic && <><span className="mx-2 h-6 w-px bg-line max-md:hidden" /><span className="text-sm text-text-2 truncate max-md:hidden">{channel.topic}</span></>}
            </>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            <InboxButton />
            {isDm && (
              <>
                <button onClick={() => startCall(false)} title="Start Voice Call" className={btn(myVoice === channel.id)} data-start-call><Phone size={20} /></button>
                <button onClick={() => startCall(true)} title="Start Video Call" className={btn(false)} data-start-video><Video size={20} /></button>
                <button onClick={toggleE2ee} title={channel.e2ee ? 'Calls here are end-to-end encrypted. Click to turn it off.' : 'Turn on end-to-end encryption for calls'} aria-pressed={!!channel.e2ee} className={btn(!!channel.e2ee)} data-dm-e2ee={channel.e2ee ? '1' : '0'}>{channel.e2ee ? <Lock size={18} className="text-success" /> : <LockOpen size={18} />}</button>
              </>
            )}
            {!isDm && channel.kind === 'text' && (
              <span className="relative">
                <button onClick={() => setThreads((t) => !t)} title="Threads" className={btn(threads)} data-threads-toggle><MessagesSquare size={20} /></button>
                {threads && <ThreadsPanel channel={channel as Channel} onClose={() => setThreads(false)} />}
              </span>
            )}
            <span className="relative">
              <button onClick={() => setDatePick((d) => !d)} title={t('Jump to date')} className={btn(datePick)} data-jump-date-btn><CalendarDays size={20} /></button>
              {datePick && (
                <form className="pop absolute right-0 top-full mt-2 z-40 flex items-center gap-2 rounded-xl bg-bg-1 border border-line shadow-2xl p-3" data-jump-date-pop
                  onSubmit={async (e) => { e.preventDefault(); const d = (e.currentTarget.elements.namedItem('date') as HTMLInputElement).value; if (!d) return; setDatePick(false); const found = await jumpToDate(channel.id, d); if (!found) pushToast('No messages on or after that date', 'error') }}>
                  <input name="date" type="date" required className="input py-1 text-sm" max={new Date().toISOString().slice(0, 10)} data-jump-date />
                  <button className="btn-primary py-1 text-sm" data-jump-date-go>Go</button>
                </form>
              )}
            </span>
            <span className="relative">
              <button onClick={() => setPins((p) => !p)} title={t('Pinned Messages')} className={btn(pins)} data-pins-toggle><Pin size={20} /></button>
              {pins && <PinnedPanel channel={channel} onClose={() => setPins(false)} />}
            </span>
            <span className="relative">
              <button onClick={() => setBookmarks((b) => !b)} title={t('Bookmarks')} className={btn(bookmarks)} data-bookmarks-toggle><Bookmark size={20} /></button>
              {bookmarks && <BookmarksPanel channelId={channel.id} onClose={() => setBookmarks(false)} />}
            </span>
            {isDm && <button onClick={() => openModal({ kind: 'groupMembers', channelId: channel.id })} title={group ? 'Add Friends to Group' : 'Add Friends to DM'} className={btn(false)} data-add-to-group><UserPlus size={20} /></button>}
            {isDm && !group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? 'Hide User Profile' : 'Show User Profile'} className={`${btn(dmProfileOpen)} max-md:hidden`} data-profile-toggle><CircleUserRound size={20} /></button>}
            {group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? 'Hide Member List' : 'Show Member List'} className={`${btn(dmProfileOpen)} max-md:hidden`} data-group-members-toggle><Users size={20} /></button>}
            {!isDm && <MembersToggle />}
            <span className="relative ml-1 max-md:hidden">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={isDm && other ? `Search ${other.username}` : 'Search'} title="Filters: from:user in:channel has:link|image|file before:date after:date pinned:true" aria-label="Search messages" data-search-input
                className="h-7 w-36 focus:w-56 transition-[width] rounded-md bg-bg-0 border border-line pl-2 pr-7 text-sm outline-none focus:border-accent/60" />
              <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 pointer-events-none" />
            </span>
          </span>
        </header>
        {isDm && <DmCall channel={channel as DmChannel} />}
        {channel.nsfw && !ageOk ? <AgeGate channel={channel as Channel} onOk={() => setAgeOk(true)} /> : channel.kind === 'forum' ? <ForumView channel={channel as Channel} /> : <ChatPane channel={channel} />}
      </main>
      {search !== null ? (
        <SearchPanel channel={channel} query={search} onClose={() => { setSearch(null); setQuery('') }} onMiss={() => pushToast('That message could not be found', 'error')} />
      ) : threadHere ? (
        <ThreadPanel threadId={openThread!} onClose={() => setOpenThread(null)} />
      ) : isDm && other && dmProfileOpen ? (
        <DmProfilePanel userId={other.id} />
      ) : group && dmProfileOpen ? (
        <GroupMembersPanel dm={channel as DmChannel} />
      ) : null}
    </>
  )
}

const NSFW_KEY = `${STORAGE_PREFIX}nsfwOk`
function nsfwAccepted(id: string): boolean { try { return (JSON.parse(localStorage.getItem(NSFW_KEY) ?? '[]') as string[]).includes(id) } catch { return false } }
function rememberNsfw(id: string) { try { const l = JSON.parse(localStorage.getItem(NSFW_KEY) ?? '[]') as string[]; if (!l.includes(id)) localStorage.setItem(NSFW_KEY, JSON.stringify([...l, id])) } catch { /* ignore */ } }

/** The warning shown once before an age-restricted channel opens. */
function AgeGate({ channel, onOk }: { channel: Channel; onOk: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="flex-1 flex items-center justify-center p-6" data-age-gate>
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-danger/15 text-danger flex items-center justify-center text-2xl font-extrabold">18+</div>
        <h2 className="text-xl font-bold">Age-Restricted Channel</h2>
        <p className="text-sm text-text-2">#{channel.name} may contain content that is not suitable for everyone. You must be over 18 to continue. Pictures and videos here stay blurred until clicked if your sensitive-media setting says so.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)} data-age-nope>Nope</button>
          <button type="button" className="btn-primary" onClick={() => { rememberNsfw(channel.id); onOk() }} data-age-continue>Continue</button>
        </div>
      </div>
    </div>
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
  const notes = useStore((s) => s.notes)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const isOwner = dm.owner_id === me?.id
  const members = [...(me ? [me as unknown as typeof dm.recipients[number]] : []), ...dm.recipients].map((u) => users[u.id] ?? u)
  const remove = (u: { id: string; display_name: string }) => openModal({ kind: 'confirm', title: `Remove ${u.display_name}`, body: `Remove ${u.display_name} from the group? They can be added back later.`, danger: true, confirmLabel: 'Remove',
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${u.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const transfer = (u: { id: string; display_name: string }) => openModal({ kind: 'confirm', title: `Transfer ownership to ${nameOf(u, notes)}`, body: `${nameOf(u, notes)} will be able to rename the group, change its icon and remove members. You stay in the group as a member.`, confirmLabel: 'Transfer',
    action: async () => { try { await api.patch(`/channels/${dm.id}`, { owner_id: u.id }) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const leave = () => openModal({ kind: 'confirm', title: `Leave '${dmName(dm, users, notes)}'`, body: 'You will stop receiving messages from this group unless someone adds you back.', danger: true, confirmLabel: 'Leave Group',
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${me?.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <aside className="w-60 shrink-0 bg-bg-1 border-l border-line overflow-y-auto px-2 pt-4 max-md:hidden flex flex-col" data-group-members>
      <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Members — {members.length}</h3>
      <div className="space-y-0.5">
        {members.map((u) => (
          <div key={u.id} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3" data-group-member={u.id}>
            <button onClick={(e) => openModal({ kind: 'profile', userId: u.id, anchor: anchorOf(e) })} className="flex items-center gap-3 min-w-0 flex-1 text-left">
              <Avatar user={u} size={32} presence />
              <span className="truncate text-[15px] font-medium text-text-1">{nameOf(u, notes)}</span>
              {dm.owner_id === u.id && <span title="Group owner" className="shrink-0 flex"><Crown size={14} className="text-warn" /></span>}
            </button>
            {isOwner && u.id !== me?.id && <button onClick={() => transfer(u)} title="Transfer ownership" className="opacity-0 group-hover:opacity-100 text-text-2 hover:text-warn" data-transfer-owner><Crown size={16} /></button>}
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

type BookmarkedMessage = Message & { guild_id: string | null; channel_name: string; folder: string; position: number }

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
    onClose()
    if (m.channel_id !== channelId) navigate(`/channels/${m.guild_id ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) pushToast('That message could not be found', 'error') })
  }
  // Folders: group by name ('' = loose bookmarks first), manual order inside each.
  const folders = useMemo(() => { const names = Array.from(new Set((list ?? []).map((m) => m.folder))).filter(Boolean).sort((a, b) => a.localeCompare(b)); return ['', ...names] }, [list])
  const inFolder = (f: string) => (list ?? []).filter((m) => m.folder === f).sort((a, b) => a.position - b.position || (a.id < b.id ? 1 : -1))
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null)
  const [newFolder, setNewFolder] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const patch = async (m: BookmarkedMessage, body: { folder?: string; position?: number }) => {
    try { const r = await api.patch<{ folder: string; position: number }>(`/users/@me/bookmarks/${m.id}`, body); setList((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, folder: r.folder, position: r.position } : x))) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const moveTo = (m: BookmarkedMessage, folder: string) => { if (folder === '__new__') { setNewFolderFor(m.id); setNewFolder(''); return } patch(m, { folder, position: inFolder(folder).length }) }
  const shift = (m: BookmarkedMessage, dir: -1 | 1) => {
    const peers = inFolder(m.folder); const i = peers.findIndex((x) => x.id === m.id); const j = i + dir
    if (j < 0 || j >= peers.length) return
    // Renumber the folder densely, then swap the two neighbours.
    const order = peers.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]]
    order.forEach((id, pos) => { const x = peers.find((p) => p.id === id)!; if (x.position !== pos) patch(x, { position: pos }) })
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl" data-bookmarks-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Bookmark size={16} className="text-text-2" /><span className="font-bold">Bookmarks</span><button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
        <div className="overflow-y-auto p-3 space-y-2">
          {list === null && <p className="text-sm text-text-2 p-3">Loading…</p>}
          {list?.length === 0 && <div className="p-6 text-center text-sm text-text-2">No bookmarks yet.<br />Right-click a message and choose Bookmark Message.</div>}
          {list && list.length > 0 && folders.map((f) => (
            <div key={f || '__loose'} data-bookmark-folder={f}>
              {f && (
                <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [f]: !c[f] }))} className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] font-bold uppercase tracking-wider text-text-2 hover:text-text-0" aria-expanded={!collapsed[f]} data-bookmark-folder-toggle={f}>
                  <ChevronRight size={12} className={`transition-transform ${collapsed[f] ? '' : 'rotate-90'}`} />{f}<span className="ml-auto font-normal">{inFolder(f).length}</span>
                </button>
              )}
              {!collapsed[f] && inFolder(f).map((m, i, arr) => (
                <div key={m.id} className="mb-2" data-bookmark={m.id} data-bookmark-position={i}>
                  <div className="px-1 mb-0.5 flex items-center gap-1 text-[11px] text-text-2">
                    <span className="truncate flex-1">{m.guild_id ? `#${m.channel_name}` : 'Direct Message'}</span>
                    {newFolderFor === m.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); const name = newFolder.trim(); setNewFolderFor(null); if (name) patch(m, { folder: name, position: inFolder(name).length }) }} className="flex items-center gap-1">
                        <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={40} placeholder="Folder name" className="input w-32 py-0.5 text-xs" data-bookmark-new-folder />
                        <button className="btn-ghost py-0.5 text-xs" data-bookmark-new-folder-save>Save</button>
                      </form>
                    ) : (
                      <select value={m.folder} onChange={(e) => moveTo(m, e.target.value)} title="Move to folder" className="rounded bg-bg-0 border border-line px-1 py-0.5 text-[11px] text-text-1" data-bookmark-move>
                        <option value="">No folder</option>
                        {folders.filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}
                        <option value="__new__">New folder…</option>
                      </select>
                    )}
                    <button type="button" onClick={() => shift(m, -1)} disabled={i === 0} title="Move up" className="rounded px-1 text-text-2 hover:text-text-0 disabled:opacity-30" data-bookmark-up>▲</button>
                    <button type="button" onClick={() => shift(m, 1)} disabled={i === arr.length - 1} title="Move down" className="rounded px-1 text-text-2 hover:text-text-0 disabled:opacity-30" data-bookmark-down>▼</button>
                  </div>
                  <MessageCard m={m} onJump={() => jump(m)} action={<button onClick={() => remove(m)} title="Remove bookmark" className="rounded p-0.5 text-text-2 hover:text-danger" data-unbookmark><BookmarkMinus size={14} /></button>} />
                </div>
              ))}
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
          {pins?.map((m) => <MessageCard key={m.id} m={m} onJump={() => { onClose(); void jumpToMessageAsync(channel.id, m.id).then((found) => { if (!found) pushToast('That message could not be found', 'error') }) }}
            action={canUnpin ? <button onClick={() => unpin(m)} title="Unpin" className="rounded p-0.5 text-text-2 hover:text-danger" data-unpin><PinOff size={14} /></button> : undefined} />)}
        </div>
      </div>
    </>
  )
}

type SearchScope = 'channel' | 'guild' | 'all'
type SearchHit = Message & { guild_id: string | null; channel_name: string }
interface SearchResult { total: number; offset: number; results: SearchHit[] }
const SEARCH_HINTS = ['from:user', 'in:channel', 'has:link', 'has:image', 'has:file', 'before:2026-01-31', 'after:2026-01-01', 'pinned:true']

/** Global search: this channel, this server or everywhere, with Discord-style filters parsed server-side. */
function SearchPanel({ channel, query, onClose, onMiss }: { channel: Channel | DmChannel; query: string; onClose: () => void; onMiss: () => void }) {
  const isDm = channel.guild_id === null
  const [scope, setScope] = useState<SearchScope>(isDm ? 'channel' : 'guild')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const url = (offset: number) => `/search?q=${encodeURIComponent(query)}&offset=${offset}${scope === 'channel' ? `&channel_id=${channel.id}` : scope === 'guild' ? `&guild_id=${channel.guild_id}` : ''}`
  useEffect(() => { setRes(null); api.get<SearchResult>(url(0)).then(setRes).catch(() => setRes({ total: 0, offset: 0, results: [] })) }, [channel.id, query, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const more = async () => {
    if (!res) return
    setBusy(true)
    try { const next = await api.get<SearchResult>(url(res.results.length)); setRes({ ...next, results: [...res.results, ...next.results] }) } catch { /* keep */ } finally { setBusy(false) }
  }
  const jump = (m: SearchHit) => {
    if (m.channel_id !== channel.id) navigate(`/channels/${m.guild_id ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) onMiss() })
  }
  const chip = (id: SearchScope, label: string) => <button key={id} type="button" onClick={() => setScope(id)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${scope === id ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-search-scope={id} aria-pressed={scope === id}>{label}</button>
  return (
    <aside className="w-[420px] shrink-0 bg-bg-1 border-l border-line flex flex-col max-md:hidden" data-search-panel>
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <Search size={16} className="text-text-2" /><span className="font-bold truncate">Results for "{query}"</span>
        {res && <span className="text-xs text-text-2" data-search-total>{res.total}</span>}
        <button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0" title="Close search"><X size={18} /></button>
      </div>
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line">
        {chip('channel', isDm ? 'This conversation' : 'This channel')}
        {!isDm && chip('guild', 'This server')}
        {chip('all', 'Everywhere')}
      </div>
      <div className="overflow-y-auto p-3 space-y-2">
        {res === null && <p className="text-sm text-text-2 p-3">Searching…</p>}
        {res?.results.length === 0 && (
          <div className="p-6 text-center text-sm text-text-2" data-search-empty>
            No results found.
            <div className="mt-3 text-left text-xs">Try a filter: {SEARCH_HINTS.map((h) => <code key={h} className="mr-1.5 rounded bg-bg-0 px-1 py-0.5">{h}</code>)}</div>
          </div>
        )}
        {res?.results.map((m) => (
          <div key={m.id} data-search-hit={m.id} data-search-channel={m.channel_id}>
            <div className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-2 truncate" data-search-hit-channel>{m.guild_id ? `# ${m.channel_name}` : m.channel_name || 'Direct message'}</div>
            <MessageCard m={m} onJump={() => jump(m)} />
          </div>
        ))}
        {res && res.results.length < res.total && <button type="button" className="btn-ghost w-full" disabled={busy} onClick={more} data-search-more>Load more ({res.total - res.results.length} left)</button>}
      </div>
    </aside>
  )
}
