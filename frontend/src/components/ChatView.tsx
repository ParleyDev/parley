import { nameplateClass } from '../lib/cosmetics'
import { isAssetNameplate, NameplateVideo } from './Nameplate'
import SummariesButton from './Summaries'
import { AlarmClock, Megaphone, Bookmark, EyeOff, BookmarkMinus, CalendarDays, ChevronRight, CircleUserRound, Crown, Hash, Lock, LockOpen, LogOut, MessageSquareText, MessagesSquare, MoreVertical, Phone, Pin, PinOff, Search, UserPlus, Users, Video, X } from 'lucide-react'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import GroupIcon from './GroupIcon'
import { dmName, isGroup, nameOf } from '../lib/dm'
import { uploadImage } from '../lib/upload'
import { anchorOf } from '../lib/anchor'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Channel, DmChannel, Message, PrivateUser } from '../lib/types'
import { BirthdateForm, TeenDmNotice } from './AgeSafety'
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
import { remindLabel, setReminder } from '../lib/reminders'
import { applySuggestion, useSearchSuggestions } from './SearchSuggest'
import DirectoryView from './DirectoryView'
import { confirmSkipped } from './modals/Confirm'

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
  const [spoilerOk, setSpoilerOk] = useState(() => gateAccepted(SPOILER_KEY, channel.id))
  useEffect(() => { setSpoilerOk(gateAccepted(SPOILER_KEY, channel.id)) }, [channel.id])
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const dmProfileOpen = useStore((s) => s.dmProfileOpen)
  const setDmProfileOpen = useStore((s) => s.setDmProfileOpen)
  const myVoice = useStore((s) => s.myVoiceChannelId)
  const pushToast = useStore((s) => s.pushToast)
  const group = isDm && isGroup(channel as DmChannel)
  const recipient = isDm && !group ? (channel as DmChannel).recipients[0] : null
  const other = recipient ? { ...recipient, ...users[recipient.id] } : null
  const myAge = useStore((s) => (s.user as PrivateUser | null)?.age_group)
  const relKind = useStore((s) => (recipient ? s.relationships[recipient.id]?.kind : undefined))
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
  // Message links (`?message=<id>`) open the channel scrolled to that message.
  const [params, setParams] = useSearchParams()
  const linked = params.get('message')
  useEffect(() => {
    if (!linked) return
    void jumpToMessageAsync(channel.id, linked).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') })
    setParams((p) => { p.delete('message'); return p }, { replace: true })
  }, [linked, channel.id, pushToast, setParams, t])
  const [bookmarks, setBookmarks] = useState(false)
  const [query, setQuery] = useState('')
  // Phones: the header keeps the name and the main actions; the rest is in a More sheet, search opens over the header.
  const more = useContextMenu()
  const [phoneSearch, setPhoneSearch] = useState(false)
  const [threads, setThreads] = useState(false)
  const openThread = useStore((s) => s.openThread)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const openThreadChannel = useStore((s) => (s.openThread ? s.channels[s.openThread] : undefined))
  const threadHere = !!openThread && openThreadChannel?.parent_id === channel.id
  const [search, setSearch] = useState<string | null>(null)
  const [searchFocus, setSearchFocus] = useState(false)
  useEffect(() => { setPins(false); setSearch(null); setQuery(''); setThreads(false) }, [channel.id])

  const startCall = async (video: boolean) => {
    if (myVoice === channel.id) return
    const go = async () => { await voice.join(channel.id); if (video) voice.toggleCamera() }
    // Starting a group call rings everyone: ask first (unless they said not to, or a call is already going).
    const live = Object.values(useStore.getState().voiceStates).some((v) => v.channel_id === channel.id)
    if (group && !live && !confirmSkipped('ringGroup')) {
      const n = (channel as DmChannel).recipients.length
      openModal({ kind: 'confirm', title: t('Start a group call?'), body: n === 1 ? t('This will ring all {n} other member of {name}.', { n, name: channel.name || t('this group') }) : t('This will ring all {n} other members of {name}.', { n, name: channel.name || t('this group') }), confirmLabel: video ? t('Start Video Call') : t('Start Call'), dontAskKey: 'ringGroup', action: go })
      return
    }
    await go()
  }
  // DM and group calls: any member can switch end-to-end encryption on or off (everyone in a call reconnects).
  const toggleE2ee = async () => {
    try { await api.patch(`/channels/${channel.id}`, { e2ee: !channel.e2ee }) } catch (e) { useStore.getState().pushToast((e as Error).message, 'error') }
  }
  const suggestions = useSearchSuggestions(query, channel)
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Tab takes the first suggestion (a filter name, person, channel or date).
    if (e.key === 'Tab' && suggestions.length > 0) { e.preventDefault(); setQuery(applySuggestion(query, suggestions[0].value)); return }
    if (e.key === 'Enter' && query.trim()) { e.preventDefault(); setSearch(query.trim()); setSearchFocus(false) }
    if (e.key === 'Escape') { setQuery(''); setSearch(null) }
  }
  const btn = (active: boolean) => `h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${active ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`

  return (
    <>
      <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
        <header className="h-12 shrink-0 px-4 phone:px-2 flex items-center gap-2 border-b border-line shadow-sm">
          <MobileBack />
          {group ? (
            <>
              <button type="button" title={t('Change group icon')} className="rounded-full hover:opacity-80" onClick={() => iconRef.current?.click()} data-group-icon-btn><GroupIcon dm={channel as DmChannel} size={24} /></button>
              <input ref={iconRef} type="file" accept="image/*" className="hidden" data-group-icon-input onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const img = await uploadImage('icon', f); await api.patch(`/channels/${channel.id}`, { icon_url: img.url }) } catch (err) { pushToast((err as Error).message, 'error') } }} />
              {renaming ? (
                <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }} maxLength={100} placeholder={t('Group name')} data-group-rename
                  className="h-7 w-56 rounded-md bg-bg-0 border border-accent/60 px-2 text-sm font-bold outline-none" />
              ) : (
                <button onClick={() => { setNameDraft(channel.name ?? ''); setRenaming(true) }} title={t('Rename group')} className="font-bold truncate hover:underline text-left" data-group-name>{dmName(channel as DmChannel, users, notes)}</button>
              )}
              <span className="text-xs text-text-2 whitespace-nowrap phone:hidden" data-group-count>{t('{n} members', { n: (channel as DmChannel).recipients.length + 1 })}</span>
            </>
          ) : isDm && other ? (
            <>
              <Avatar user={other} size={24} presence />
              <span className="font-bold truncate" data-dm-header-name>{nameOf(other, notes)}</span>
              {other.custom_status && <span className="text-sm text-text-1 truncate phone:hidden" data-header-status>{other.custom_status}</span>}
            </>
          ) : (
            <>
              {channel.kind === 'forum' ? <MessageSquareText size={22} className="text-text-2 shrink-0" /> : <Hash size={22} className="text-text-2 shrink-0" />}
              <span className="font-bold truncate">{channel.name}</span>
              {channel.nsfw && <span className="ml-1 rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger" title={t('Age-restricted channel')} data-nsfw-badge>18+</span>}
              {channel.topic && <><span className="mx-2 h-6 w-px bg-line phone:hidden" /><span className="text-sm text-text-2 truncate phone:hidden">{channel.topic}</span></>}
            </>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            {!isDm && <SummariesButton channel={channel} />}
            <InboxButton />
            {isDm && (
              <>
                <button onClick={() => startCall(false)} title={t('Start Voice Call')} className={btn(myVoice === channel.id)} data-start-call><Phone size={20} /></button>
                <button onClick={() => startCall(true)} title={t('Start Video Call')} className={btn(false)} data-start-video><Video size={20} /></button>
                <button onClick={toggleE2ee} title={channel.e2ee ? t('Calls here are end-to-end encrypted. Click to turn it off.') : t('Turn on end-to-end encryption for calls')} aria-pressed={!!channel.e2ee} className={`${btn(!!channel.e2ee)} phone:hidden`} data-dm-e2ee={channel.e2ee ? '1' : '0'}>{channel.e2ee ? <Lock size={18} className="text-success" /> : <LockOpen size={18} />}</button>
              </>
            )}
            {!isDm && channel.news && <button onClick={() => openModal({ kind: 'followChannel', channelId: channel.id })} title={t('Follow')} className="flex items-center gap-1 rounded-md bg-bg-3 px-2 py-1 text-sm font-medium hover:bg-bg-4 phone:hidden" data-follow-channel><Megaphone size={16} />{t('Follow')}</button>}
            {!isDm && channel.kind === 'text' && (
              <span className="relative">
                <button onClick={() => setThreads((v) => !v)} title={t('Threads')} className={`${btn(threads)} phone:hidden`} data-threads-toggle><MessagesSquare size={20} /></button>
                {threads && <ThreadsPanel channel={channel as Channel} onClose={() => setThreads(false)} />}
              </span>
            )}
            <span className="relative">
              <button onClick={() => setDatePick((d) => !d)} title={t('Jump to date')} className={`${btn(datePick)} phone:hidden`} data-jump-date-btn><CalendarDays size={20} /></button>
              {datePick && (
                <form className="pop absolute right-0 top-full mt-2 z-40 flex items-center gap-2 rounded-xl bg-bg-1 border border-line shadow-2xl p-3 phone:fixed phone:inset-x-2 phone:top-auto phone:bottom-[calc(1rem+var(--sab))] phone:mt-0" data-jump-date-pop
                  onSubmit={async (e) => { e.preventDefault(); const d = (e.currentTarget.elements.namedItem('date') as HTMLInputElement).value; if (!d) return; setDatePick(false); const found = await jumpToDate(channel.id, d); if (!found) pushToast(t('No messages on or after that date'), 'error') }}>
                  <input name="date" type="date" required className="input py-1 text-sm" max={new Date().toISOString().slice(0, 10)} data-jump-date />
                  <button className="btn-primary py-1 text-sm" data-jump-date-go>{t('Go')}</button>
                </form>
              )}
            </span>
            <span className="relative">
              <button onClick={() => setPins((p) => !p)} title={t('Pinned Messages')} className={`${btn(pins)} phone:hidden`} data-pins-toggle><Pin size={20} /></button>
              {pins && <PinnedPanel channel={channel} onClose={() => setPins(false)} />}
            </span>
            <span className="relative">
              <button onClick={() => setBookmarks((b) => !b)} title={t('Bookmarks')} className={`${btn(bookmarks)} phone:hidden`} data-bookmarks-toggle><Bookmark size={20} /></button>
              {bookmarks && <BookmarksPanel channelId={channel.id} onClose={() => setBookmarks(false)} />}
            </span>
            {isDm && <button onClick={() => openModal({ kind: 'groupMembers', channelId: channel.id })} title={group ? t('Add Friends to Group') : t('Add Friends to DM')} className={`${btn(false)} phone:hidden`} data-add-to-group><UserPlus size={20} /></button>}
            {isDm && !group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? t('Hide User Profile') : t('Show User Profile')} className={`${btn(dmProfileOpen)} phone:hidden`} data-profile-toggle><CircleUserRound size={20} /></button>}
            {group && <button onClick={() => setDmProfileOpen(!dmProfileOpen)} title={dmProfileOpen ? t('Hide Member List') : t('Show Member List')} className={`${btn(dmProfileOpen)} phone:hidden`} data-group-members-toggle><Users size={20} /></button>}
            {!isDm && <MembersToggle />}
            <button type="button" onClick={(e) => more.open(e, ([
              { label: t('Search'), icon: <Search size={18} />, onClick: () => setPhoneSearch(true) },
              !isDm && channel.kind === 'text' && { label: t('Threads'), icon: <MessagesSquare size={18} />, onClick: () => setThreads(true) },
              { label: t('Pinned Messages'), icon: <Pin size={18} />, onClick: () => setPins(true) },
              { label: t('Bookmarks'), icon: <Bookmark size={18} />, onClick: () => setBookmarks(true) },
              { label: t('Jump to date'), icon: <CalendarDays size={18} />, onClick: () => setDatePick(true) },
              !isDm && channel.news && { label: t('Follow'), icon: <Megaphone size={18} />, onClick: () => openModal({ kind: 'followChannel', channelId: channel.id }) },
              isDm && { label: group ? t('Add Friends to Group') : t('Add Friends to DM'), icon: <UserPlus size={18} />, onClick: () => openModal({ kind: 'groupMembers', channelId: channel.id }) },
              isDm && { label: channel.e2ee ? t('Calls are end-to-end encrypted') : t('Encrypt calls end to end'), icon: channel.e2ee ? <Lock size={18} className="text-success" /> : <LockOpen size={18} />, onClick: toggleE2ee },
            ] as (MenuEntry | false)[]).filter((x): x is MenuEntry => !!x))} title={t('More')} className={`${btn(false)} wide:hidden`} data-header-more><MoreVertical size={20} /></button>
            {more.menu && <ContextMenu {...more.menu} onClose={more.close} label={t('More')} />}
            <span className={`relative ml-1 ${phoneSearch ? 'phone:absolute phone:inset-x-2 phone:top-2 phone:z-30 phone:ml-0 phone:flex phone:items-center phone:gap-1 phone:bg-bg-2' : 'phone:hidden'}`} data-search-box>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 150)} placeholder={isDm && other ? t('Search {name}', { name: other.username }) : t('Search')} title={t('Filters: from:user in:channel has:link|image|file before:date after:date pinned:true')} aria-label={t('Search messages')} data-search-input
                className="h-7 w-36 focus:w-56 transition-[width] rounded-md bg-bg-0 border border-line pl-2 pr-7 text-sm outline-none focus:border-accent/60 phone:h-9 phone:w-full phone:focus:w-full" />
              <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 pointer-events-none phone:hidden" />
              {phoneSearch && <button type="button" onClick={() => { setPhoneSearch(false); setQuery('') }} title={t('Close search')} className="wide:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-text-2" data-phone-search-close><X size={18} /></button>}
              {searchFocus && suggestions.length > 0 && (
                <div className="pop absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-line bg-bg-0 p-1 shadow-2xl" data-search-suggest>
                  {suggestions.map((sg, i) => (
                    <button key={sg.value} type="button" onMouseDown={(e) => { e.preventDefault(); setQuery(applySuggestion(query, sg.value)) }} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-bg-3 ${i === 0 ? 'bg-bg-3/60' : ''}`} data-search-suggestion={sg.value}>
                      <span className="truncate font-medium">{sg.label}</span>{sg.detail && <span className="ml-auto truncate text-xs text-text-2">{sg.detail}</span>}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </span>
        </header>
        {isDm && <DmCall channel={channel as DmChannel} />}
        {isDm && !group && other && myAge === 'teen' && relKind !== 'friend' && <TeenDmNotice name={other.display_name} onBlock={() => { void api.put(`/users/@me/relationships/${other.id}/block`).then(() => pushToast(t('{name} blocked', { name: other.display_name }))).catch((e: Error) => pushToast(e.message, 'error')) }} />}
        {channel.nsfw && !ageOk ? <AgeGate channel={channel as Channel} onOk={() => setAgeOk(true)} /> : (channel as Channel).spoiler && !spoilerOk ? <SpoilerGate channel={channel as Channel} onOk={() => setSpoilerOk(true)} /> : channel.kind === 'forum' ? <ForumView channel={channel as Channel} /> : channel.kind === 'directory' ? <DirectoryView channel={channel as Channel} /> : <ChatPane channel={channel} />}
      </main>
      {search !== null ? (
        <SearchPanel channel={channel} query={search} onClose={() => { setSearch(null); setQuery('') }} onMiss={() => pushToast(t('That message could not be found'), 'error')} />
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

const SPOILER_KEY = `${STORAGE_PREFIX}spoilerOk`
function gateAccepted(key: string, id: string): boolean { try { return (JSON.parse(localStorage.getItem(key) ?? '[]') as string[]).includes(id) } catch { return false } }
function rememberGate(key: string, id: string) { try { const l = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; if (!l.includes(id)) localStorage.setItem(key, JSON.stringify([...l, id])) } catch { /* ignore */ } }

/** The spoiler warning shown once before a spoiler channel opens (its topic says what it spoils). */
function SpoilerGate({ channel, onOk }: { channel: Channel; onOk: () => void }) {
  const navigate = useNavigate()
  const t = useT()
  return (
    <div className="flex-1 flex items-center justify-center p-6" data-spoiler-gate>
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-warn/15 text-warn flex items-center justify-center"><EyeOff size={30} /></div>
        <h2 className="text-xl font-bold">{t('Spoilers ahead')}</h2>
        <p className="text-sm text-text-2">{channel.topic ? t('#{name} is a spoiler channel: {topic}. Pictures and videos stay hidden until you click them.', { name: channel.name, topic: channel.topic }) : t('#{name} is a spoiler channel. Pictures and videos stay hidden until you click them.', { name: channel.name })}</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)} data-spoiler-back>{t('Go Back')}</button>
          <button type="button" className="btn-primary" onClick={() => { rememberGate(SPOILER_KEY, channel.id); onOk() }} data-spoiler-continue>{t('Show Me')}</button>
        </div>
      </div>
    </div>
  )
}

/** The warning shown once before an age-restricted channel opens. */
function AgeGate({ channel, onOk }: { channel: Channel; onOk: () => void }) {
  const navigate = useNavigate()
  const age = useStore((s) => (s.user as PrivateUser | null)?.age_group ?? 'unknown')
  const t = useT()
  if (age === 'teen') {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-age-gate="teen">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-full bg-danger/15 text-danger flex items-center justify-center text-2xl font-extrabold">18+</div>
          <h2 className="text-xl font-bold">{t('You can\'t view this channel')}</h2>
          <p className="text-sm text-text-2">{t('#{name} is age-restricted, and you need to be 18 or older to see it.', { name: channel.name })}</p>
          <button type="button" className="btn-primary" onClick={() => navigate(-1)} data-age-nope>{t('Go back')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex-1 flex items-center justify-center p-6" data-age-gate>
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-danger/15 text-danger flex items-center justify-center text-2xl font-extrabold">18+</div>
        <h2 className="text-xl font-bold">{t('Age-Restricted Channel')}</h2>
        <p className="text-sm text-text-2">{t('#{name} may contain content that is not suitable for everyone. You must be over 18 to continue. Pictures and videos here stay blurred until clicked if your sensitive-media setting says so.', { name: channel.name })}</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)} data-age-nope>{t('Nope')}</button>
          {age === 'adult' && <button type="button" className="btn-primary" onClick={() => { rememberNsfw(channel.id); onOk() }} data-age-continue>{t('Continue')}</button>}
        </div>
        {age === 'unknown' && <div className="text-left"><BirthdateForm onDone={(u) => { if (u.age_group === 'adult') { rememberNsfw(channel.id); onOk() } }} /></div>}
      </div>
    </div>
  )
}

/** A neighbouring message shown faintly around a search result. */
function ContextLine({ m }: { m: Message }) {
  return <div className="truncate px-3 py-0.5 text-xs text-text-2" data-search-context-line={m.id}><span className="font-semibold">{m.author.display_name}</span> {m.content || (m.attachments?.length ? '📎' : '')}</div>
}

/** A compact rendering of a message for the pins and search lists, with Jump. */
function MessageCard({ m, onJump, action }: { m: Message; onJump: () => void; action?: React.ReactNode }) {
  const t = useT()
  return (
    <div className="rounded-lg border border-line bg-bg-2 p-3" data-msg-card={m.id}>
      <div className="flex items-center gap-2 mb-1">
        <Avatar user={m.author} size={20} />
        <span className="font-semibold text-sm truncate">{m.author.display_name}</span>
        <span className="text-[11px] text-text-2 shrink-0">{formatTime(m.created_at)}</span>
        <span className="ml-auto flex items-center gap-1">
          {action}
          <button onClick={onJump} className="rounded bg-bg-3 px-2 py-0.5 text-[11px] font-semibold text-text-1 hover:bg-bg-4 hover:text-text-0" data-jump>{t('Jump')}</button>
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
  const online = useStore((s) => s.online)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const t = useT()
  const isOwner = dm.owner_id === me?.id
  // Like the server member list: nameplates behind members who show as online, not those who appear offline.
  const plateOf = (u: { id: string; nameplate?: string | null; status?: string }) => (online[u.id] && u.status !== 'invisible' ? u.nameplate ?? null : null)
  const members = [...(me ? [me as unknown as typeof dm.recipients[number]] : []), ...dm.recipients].map((u) => users[u.id] ?? u)
  const remove = (u: { id: string; display_name: string }) => openModal({ kind: 'confirm', title: t('Remove {name}', { name: u.display_name }), body: t('Remove {name} from the group? They can be added back later.', { name: u.display_name }), danger: true, confirmLabel: t('Remove'),
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${u.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const transfer = (u: { id: string; display_name: string }) => openModal({ kind: 'confirm', title: t('Transfer ownership to {name}', { name: nameOf(u, notes) }), body: t('{name} will be able to rename the group, change its icon and remove members. You stay in the group as a member.', { name: nameOf(u, notes) }), confirmLabel: t('Transfer'),
    action: async () => { try { await api.patch(`/channels/${dm.id}`, { owner_id: u.id }) } catch (e) { pushToast((e as Error).message, 'error') } } })
  const leave = () => openModal({ kind: 'confirm', title: t('Leave \'{name}\'', { name: dmName(dm, users, notes) }), body: t('You will stop receiving messages from this group unless someone adds you back.'), danger: true, confirmLabel: t('Leave Group'),
    action: async () => { try { await api.delete(`/channels/${dm.id}/recipients/${me?.id}`) } catch (e) { pushToast((e as Error).message, 'error') } } })
  return (
    <aside className="w-60 shrink-0 bg-bg-1 border-l border-line overflow-y-auto px-2 pt-4 phone:hidden flex flex-col" data-group-members>
      <h3 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Members')} — {members.length}</h3>
      <div className="space-y-0.5">
        {members.map((u) => (
          <div key={u.id} className={`group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3 ${nameplateClass(plateOf(u))} ${isAssetNameplate(plateOf(u)) ? 'relative isolate overflow-hidden' : ''}`} data-group-member={u.id} data-nameplate={plateOf(u) || undefined}>
            <NameplateVideo value={plateOf(u)} />
            <button onClick={(e) => openModal({ kind: 'profile', userId: u.id, anchor: anchorOf(e) })} className="flex items-center gap-3 min-w-0 flex-1 text-left">
              <Avatar user={u} size={32} presence />
              <span className="truncate text-[15px] font-medium text-text-1">{nameOf(u, notes)}</span>
              {dm.owner_id === u.id && <span title={t('Group owner')} className="shrink-0 flex"><Crown size={14} className="text-warn" /></span>}
            </button>
            {isOwner && u.id !== me?.id && <button onClick={() => transfer(u)} title={t('Transfer ownership')} className="opacity-0 group-hover:opacity-100 text-text-2 hover:text-warn" data-transfer-owner><Crown size={16} /></button>}
            {isOwner && u.id !== me?.id && <button onClick={() => remove(u)} title={t('Remove from group')} className="opacity-0 group-hover:opacity-100 text-text-2 hover:text-danger" data-remove-member><X size={16} /></button>}
          </div>
        ))}
      </div>
      <div className="mt-auto p-2 space-y-1">
        <button onClick={() => openModal({ kind: 'groupMembers', channelId: dm.id })} className="w-full btn-ghost justify-center"><UserPlus size={16} /> {t('Add Friends')}</button>
        <button onClick={leave} className="w-full btn-ghost justify-center text-danger" data-leave-group><LogOut size={16} /> {t('Leave Group')}</button>
      </div>
    </aside>
  )
}

type BookmarkedMessage = Message & { guild_id: string | null; channel_name: string; folder: string; position: number; remind_at?: string | null }

/** Every message the user bookmarked, across channels; Jump navigates when it lives elsewhere. */
function BookmarksPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [list, setList] = useState<BookmarkedMessage[] | null>(null)
  const pushToast = useStore((s) => s.pushToast)
  const setBookmark = useStore((s) => s.setBookmark)
  const navigate = useNavigate()
  const t = useT()
  useEscape(onClose)
  useEffect(() => { api.get<BookmarkedMessage[]>('/users/@me/bookmarks').then(setList).catch(() => setList([])) }, [])
  const remove = async (m: Message) => {
    try { await api.delete(`/users/@me/bookmarks/${m.id}`); setBookmark(m.id, false); setList((l) => (l ?? []).filter((x) => x.id !== m.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const jump = (m: BookmarkedMessage) => {
    onClose()
    if (m.channel_id !== channelId) navigate(`/channels/${m.guild_id ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') })
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
      <div className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl phone:fixed phone:inset-x-0 phone:top-auto phone:bottom-0 phone:mt-0 phone:w-auto phone:max-w-none phone:rounded-b-none phone:pb-[var(--sab)]" data-bookmarks-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Bookmark size={16} className="text-text-2" /><span className="font-bold">{t('Bookmarks')}</span><button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
        <div className="overflow-y-auto p-3 space-y-2">
          {list === null && <p className="text-sm text-text-2 p-3">{t('Loading…')}</p>}
          {list?.length === 0 && <div className="p-6 text-center text-sm text-text-2">{t('No bookmarks yet.')}<br />{t('Right-click a message and choose Bookmark Message.')}</div>}
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
                    <span className="truncate flex-1">{m.guild_id ? `#${m.channel_name}` : t('Direct Message')}</span>
                    {m.remind_at && <button type="button" onClick={() => setReminder(m.id, null).then(() => setList((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, remind_at: null } : x)))).catch((e: Error) => pushToast(e.message, 'error'))} title={t('Clear reminder')} className="flex items-center gap-1 rounded bg-bg-3 px-1.5 py-0.5 text-text-1 hover:text-danger" data-bookmark-reminder={m.remind_at}><AlarmClock size={11} />{remindLabel(m.remind_at)}</button>}
                    {newFolderFor === m.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); const name = newFolder.trim(); setNewFolderFor(null); if (name) patch(m, { folder: name, position: inFolder(name).length }) }} className="flex items-center gap-1">
                        <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={40} placeholder={t('Folder name')} className="input w-32 py-0.5 text-xs" data-bookmark-new-folder />
                        <button className="btn-ghost py-0.5 text-xs" data-bookmark-new-folder-save>{t('Save')}</button>
                      </form>
                    ) : (
                      <select value={m.folder} onChange={(e) => moveTo(m, e.target.value)} title={t('Move to folder')} className="rounded bg-bg-0 border border-line px-1 py-0.5 text-[11px] text-text-1" data-bookmark-move>
                        <option value="">{t('No folder')}</option>
                        {folders.filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}
                        <option value="__new__">{t('New folder…')}</option>
                      </select>
                    )}
                    <button type="button" onClick={() => shift(m, -1)} disabled={i === 0} title={t('Move up')} className="rounded px-1 text-text-2 hover:text-text-0 disabled:opacity-30" data-bookmark-up>▲</button>
                    <button type="button" onClick={() => shift(m, 1)} disabled={i === arr.length - 1} title={t('Move down')} className="rounded px-1 text-text-2 hover:text-text-0 disabled:opacity-30" data-bookmark-down>▼</button>
                  </div>
                  <MessageCard m={m} onJump={() => jump(m)} action={<button onClick={() => remove(m)} title={t('Remove bookmark')} className="rounded p-0.5 text-text-2 hover:text-danger" data-unbookmark><BookmarkMinus size={14} /></button>} />
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
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useEffect(() => { api.get<Message[]>(`/channels/${channel.id}/pins`).then(setPins).catch(() => setPins([])) }, [channel.id])
  const unpin = async (m: Message) => {
    try { await api.delete(`/channels/${channel.id}/pins/${m.id}`); setPins((ps) => (ps ?? []).filter((x) => x.id !== m.id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div ref={ref} className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl phone:fixed phone:inset-x-0 phone:top-auto phone:bottom-0 phone:mt-0 phone:w-auto phone:max-w-none phone:rounded-b-none phone:pb-[var(--sab)]" data-pins-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Pin size={16} className="text-text-2" /><span className="font-bold">{t('Pinned Messages')}</span><button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
        <div className="overflow-y-auto p-3 space-y-2">
          {pins === null && <p className="text-sm text-text-2 p-3">{t('Loading…')}</p>}
          {pins?.length === 0 && <div className="p-6 text-center text-sm text-text-2">{t('This channel doesn\'t have any pinned messages yet.')}<br />{t('Pin one from a message\'s "⋯" menu.')}</div>}
          {pins?.map((m) => <MessageCard key={m.id} m={m} onJump={() => { onClose(); void jumpToMessageAsync(channel.id, m.id).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') }) }}
            action={canUnpin ? <button onClick={() => unpin(m)} title={t('Unpin')} className="rounded p-0.5 text-text-2 hover:text-danger" data-unpin><PinOff size={14} /></button> : undefined} />)}
        </div>
      </div>
    </>
  )
}

type SearchScope = 'channel' | 'guild' | 'all'
type SearchHit = Message & { guild_id: string | null; channel_name: string; context_before?: Message; context_after?: Message }
interface SearchResult { total: number; offset: number; results: SearchHit[] }
const SEARCH_HINTS = ['from:user', 'in:channel', 'has:link', 'has:image', 'has:file', 'has:poll', 'during:2026-01-15', 'before:2026-01-31', 'after:2026-01-01', 'pinned:true']

/** Global search: this channel, this server or everywhere, with Discord-style filters parsed server-side. */
function SearchPanel({ channel, query, onClose, onMiss }: { channel: Channel | DmChannel; query: string; onClose: () => void; onMiss: () => void }) {
  const isDm = channel.guild_id === null
  const [scope, setScope] = useState<SearchScope>(isDm ? 'channel' : 'guild')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const [sort, setSort] = useState<'newest' | 'oldest' | 'relevant'>('newest')
  const [context, setContext] = useState(false)
  const t = useT()
  const url = (offset: number) => `/search?q=${encodeURIComponent(query)}&offset=${offset}&sort=${sort}${context ? '&context=true' : ''}${scope === 'channel' ? `&channel_id=${channel.id}` : scope === 'guild' ? `&guild_id=${channel.guild_id}` : ''}`
  useEffect(() => { setRes(null); api.get<SearchResult>(url(0)).then(setRes).catch(() => setRes({ total: 0, offset: 0, results: [] })) }, [channel.id, query, scope, sort, context]) // eslint-disable-line react-hooks/exhaustive-deps
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
    <aside className="w-[420px] shrink-0 bg-bg-1 border-l border-line flex flex-col phone:hidden" data-search-panel>
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <Search size={16} className="text-text-2" /><span className="font-bold truncate">{t('Results for "{query}"', { query })}</span>
        {res && <span className="text-xs text-text-2" data-search-total>{res.total}</span>}
        <button onClick={onClose} className="ml-auto text-text-2 hover:text-text-0" title={t('Close search')}><X size={18} /></button>
      </div>
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line">
        {chip('channel', isDm ? t('This conversation') : t('This channel'))}
        {!isDm && chip('guild', t('This server'))}
        {chip('all', t('Everywhere'))}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="ml-auto rounded bg-bg-3 px-1.5 py-0.5 text-xs text-text-1" aria-label={t('Sort results')} data-search-sort>
          <option value="newest">{t('Newest')}</option><option value="oldest">{t('Oldest')}</option><option value="relevant">{t('Most relevant')}</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-text-2 cursor-pointer" title={t('Show the message before and after each result')}><input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={context} onChange={(e) => setContext(e.target.checked)} data-search-context /> {t('Context')}</label>
      </div>
      <div className="overflow-y-auto p-3 space-y-2">
        {res === null && <p className="text-sm text-text-2 p-3">{t('Searching…')}</p>}
        {res?.results.length === 0 && (
          <div className="p-6 text-center text-sm text-text-2" data-search-empty>
            {t('No results found.')}
            <div className="mt-3 text-left text-xs">{t('Try a filter:')} {SEARCH_HINTS.map((h) => <code key={h} className="mr-1.5 rounded bg-bg-0 px-1 py-0.5">{h}</code>)}</div>
          </div>
        )}
        {res?.results.map((m) => (
          <div key={m.id} data-search-hit={m.id} data-search-channel={m.channel_id}>
            <div className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-2 truncate" data-search-hit-channel>{m.guild_id ? `# ${m.channel_name}` : m.channel_name || t('Direct message')}</div>
            {m.context_before && <ContextLine m={m.context_before} />}
            <MessageCard m={m} onJump={() => jump(m)} />
            {m.context_after && <ContextLine m={m.context_after} />}
          </div>
        ))}
        {res && res.results.length < res.total && <button type="button" className="btn-ghost w-full" disabled={busy} onClick={more} data-search-more>{t('Load more ({n} left)', { n: res.total - res.results.length })}</button>}
      </div>
    </aside>
  )
}
