import { AlarmClock, Bookmark, CheckCheck, Hash, Inbox, MessageSquare, X } from 'lucide-react'
import { STORAGE_PREFIX } from '../lib/brand'
import { locale, useT } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { showsUnread, useStore } from '../store'
import type { Message } from '../lib/types'
import Avatar from './Avatar'
import { jumpToMessageAsync } from './ChatView'
import { badgeCount } from '../lib/badge'
import { renderMarkdown } from '../lib/markdown'
import { remindLabel, setReminder } from '../lib/reminders'

const HIDDEN_KEY = `${STORAGE_PREFIX}inboxHidden`
const TAB_KEY = `${STORAGE_PREFIX}inboxTab`
const loadHidden = (): string[] => { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const TABS = ['unreads', 'mentions', 'bookmarks', 'reminders', 'highlights'] as const
type Tab = (typeof TABS)[number]
const loadTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY) as Tab | null; return v && TABS.includes(v) ? v : 'mentions' } catch { return 'mentions' } }

type Placed = Message & { guild_id?: string | null; guild_name?: string; channel_name?: string; remind_at?: string | null }

/**
 * The header Inbox, like Discord's: a tall panel under the button with Unreads (the new messages in each channel, mark
 * read one by one or all at once), Mentions (last 30 days), Bookmarks, Reminders (bookmarks with a Remind Me time) and
 * Highlights. Every message shows in full with who wrote it and where, and a Jump button.
 */
export default function InboxButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [tab, setTabState] = useState<Tab>(loadTab)
  const setTab = (x: Tab) => { setTabState(x); try { localStorage.setItem(TAB_KEY, x) } catch { /* ignore */ } }
  const [highlights, setHighlights] = useState<Placed[] | null>(null)
  const [list, setList] = useState<Message[] | null>(null)
  const [saved, setSaved] = useState<Placed[] | null>(null)
  const [recent, setRecent] = useState<Record<string, Message[]>>({})
  const [hidden, setHidden] = useState(loadHidden)
  const hide = (id: string) => { const next = [...hidden, id].slice(-500); setHidden(next); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch { /* ignore */ } }
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const notifSettings = useStore((s) => s.notifSettings)
  const markRead = useStore((s) => s.markRead)
  const channels = useStore((s) => s.channels)
  const dms = useStore((s) => s.dms)
  const guilds = useStore((s) => s.guilds)
  const setBookmark = useStore((s) => s.setBookmark)
  const count = useStore(() => badgeCount())
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Viewport position under the button, reaching most of the way down the window. The panel is portalled to <body>
  // because headers scroll horizontally on phones (overflow-x-auto), which would clip an absolutely positioned child.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = ref.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }
  const unreads = Object.keys(lastMessageId).filter((id) => (channels[id] || dms[id]) && showsUnread({ readStates, lastMessageId, channels, dms, notifSettings, guilds }, id))
    .sort((a, b) => (lastMessageId[b] ?? '').localeCompare(lastMessageId[a] ?? ''))
  useEffect(() => { if (open) api.get<Message[]>('/users/@me/mentions').then(setList).catch(() => setList([])) }, [open])
  useEffect(() => { if (open && tab === 'highlights') { setHighlights(null); api.get<Placed[]>('/users/@me/highlights').then(setHighlights).catch(() => setHighlights([])) } }, [open, tab])
  useEffect(() => { if (open && (tab === 'bookmarks' || tab === 'reminders')) { setSaved(null); api.get<Placed[]>('/users/@me/bookmarks').then(setSaved).catch(() => setSaved([])) } }, [open, tab])
  // Unreads: the newest few messages after the read mark in each of the first channels.
  const unreadKey = unreads.slice(0, 12).join(',')
  useEffect(() => {
    if (!open || tab !== 'unreads') return
    for (const id of unreadKey ? unreadKey.split(',') : []) {
      if (recent[id]) continue
      api.get<Message[]>(`/channels/${id}/messages?limit=4`).then((ms) => setRecent((r) => ({ ...r, [id]: ms.filter((m) => !readStates[id] || m.id > readStates[id]!).slice(-3) }))).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, unreadKey])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { const node = e.target as Node; if (!ref.current?.contains(node) && !panel.current?.contains(node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onResize = () => setOpen(false)
    window.addEventListener('pointerdown', onDown); window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
  }, [open])
  const guildOf = (m: Placed) => channels[m.channel_id]?.guild_id ?? m.guild_id ?? null
  const whereOf = (channelId: string, fallback?: Placed) => {
    const ch = channels[channelId]
    if (ch) return { icon: <Hash size={14} />, name: ch.name, sub: ch.guild_id ? guilds[ch.guild_id]?.name : undefined }
    const dm = dms[channelId]
    if (dm) return { icon: <MessageSquare size={14} />, name: dm.name || dm.recipients.map((r) => r.display_name).join(', '), sub: dm.recipients.length > 1 ? t('Group') : t('Direct message') }
    return { icon: <Hash size={14} />, name: fallback?.channel_name ?? t('Unknown channel'), sub: fallback?.guild_name }
  }
  const openChannel = (id: string) => { setOpen(false); navigate(`/channels/${channels[id]?.guild_id ?? '@me'}/${id}`) }
  const jump = (m: Placed) => {
    setOpen(false)
    navigate(`/channels/${guildOf(m) ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') })
  }
  const unbookmark = async (m: Placed) => { try { await api.delete(`/users/@me/bookmarks/${m.id}`); setBookmark(m.id, false); setSaved((l) => (l ?? []).filter((x) => x.id !== m.id)) } catch (e) { pushToast((e as Error).message, 'error') } }
  const clearReminder = async (m: Placed) => { try { await setReminder(m.id, null); setSaved((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, remind_at: null } : x))) } catch (e) { pushToast((e as Error).message, 'error') } }
  const mentions = (list ?? []).filter((m) => !hidden.includes(m.id))
  const reminders = (saved ?? []).filter((m) => m.remind_at).sort((a, b) => (a.remind_at! < b.remind_at! ? -1 : 1))
  const label: Record<Tab, string> = { unreads: t('Unreads'), mentions: t('Mentions'), bookmarks: t('Bookmarks'), reminders: t('Reminders'), highlights: t('Highlights') }
  const empty = (text: string) => <p className="px-4 py-10 text-center text-sm text-text-2">{text}</p>
  const loading = <p className="px-4 py-6 text-sm text-text-2">{t('Loading…')}</p>
  const iconBtn = 'h-8 w-8 rounded-full flex items-center justify-center text-text-2 bg-bg-2 hover:text-text-0 border border-line'

  /** One message in full: avatar, name, time and the text, with the actions on the right. */
  const card = (m: Placed, actions: React.ReactNode, attrs: Record<string, string>, extra?: React.ReactNode) => (
    <div key={m.id} role="button" tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) jump(m) }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) jump(m) }}
      className="group relative cursor-pointer rounded-lg bg-bg-2 border border-line/70 p-3 hover:border-line hover:bg-bg-3/60" {...attrs}>
      <div className="flex gap-3">
        <Avatar user={m.author} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className="font-semibold truncate">{m.author.display_name}</span><span className="text-[11px] text-text-2 shrink-0">{new Date(m.created_at).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
          <div className="msg-content text-sm text-text-1 break-words max-h-[9.5rem] overflow-hidden" data-inbox-text>{m.content ? renderMarkdown(m.content) : (m.attachments?.length ?? 0) > 0 ? `📎 ${t('Attachment')}` : ''}</div>
          {extra}
        </div>
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => jump(m)} className="h-7 rounded-full px-3 text-xs font-semibold bg-bg-4 text-text-0 hover:bg-accent hover:text-white" data-inbox-jump={m.id}>{t('Jump')}</button>
        {actions}
      </div>
    </div>
  )
  /** A channel heading over its messages: where they are, and (in Unreads) Mark as read. */
  const heading = (channelId: string, fallback?: Placed, action?: React.ReactNode) => {
    const w = whereOf(channelId, fallback)
    return (
      <div className="flex items-center gap-2 px-1 pt-2 pb-1.5">
        <button type="button" onClick={() => openChannel(channelId)} className="flex min-w-0 items-center gap-1.5 text-left text-text-1 hover:text-text-0">
          <span className="shrink-0 text-text-2">{w.icon}</span><span className="truncate font-semibold">{w.name}</span>{w.sub && <span className="truncate text-xs text-text-2">· {w.sub}</span>}
        </button>
        {action}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} title={t('Inbox')} className={`relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${open ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-inbox-toggle>
        <Inbox size={20} />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-bg-1" data-inbox-count>{count > 99 ? '99+' : count}</span>}
      </button>
      {open && pos && createPortal(
        <div ref={panel} style={{ top: pos.top, right: pos.right, height: `calc(100dvh - ${pos.top + 16}px)` }} className="pop fixed z-50 w-[480px] max-w-[calc(100vw-16px)] flex flex-col rounded-xl border border-line bg-bg-1 shadow-2xl" data-inbox>
          <div className="shrink-0 px-4 pt-3 border-b border-line">
            <div className="flex items-center gap-2 pb-2">
              <Inbox size={18} className="text-text-2" /><span className="text-lg font-bold">{t('Inbox')}</span>
              {tab === 'unreads' && unreads.length > 0 && <button type="button" onClick={() => { for (const id of unreads) void markRead(id) }} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-text-1 hover:bg-bg-3 hover:text-text-0" data-inbox-read-all><CheckCheck size={14} /> {t('Mark all read')}</button>}
            </div>
            <div className="flex gap-0.5 overflow-x-auto scrollbar-none" role="tablist">
              {TABS.map((id) => (
                <button key={id} type="button" role="tab" onClick={() => setTab(id)} className={`shrink-0 whitespace-nowrap px-2 pb-2 border-b-2 text-sm font-semibold ${tab === id ? 'border-accent text-text-0' : 'border-transparent text-text-2 hover:text-text-0'}`} data-inbox-tab={id} aria-selected={tab === id} aria-pressed={tab === id}>
                  {label[id]}{id === 'unreads' && unreads.length > 0 && <span className="ml-1 text-[11px] text-text-2">{unreads.length}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3" data-inbox-body={tab}>
            {tab === 'unreads' && (
              <div data-inbox-unreads>
                {unreads.length === 0 && empty(t("You're all caught up."))}
                {unreads.map((id) => (
                  <section key={id} className="mb-2" data-inbox-unread={id}>
                    {heading(id, undefined, <button type="button" onClick={() => void markRead(id)} title={t('Mark as read')} className={`ml-auto shrink-0 ${iconBtn}`} data-inbox-mark-read={id}><CheckCheck size={15} /></button>)}
                    <div className="space-y-1.5">{(recent[id] ?? []).map((m) => card(m, null, { 'data-inbox-unread-msg': m.id }))}</div>
                  </section>
                ))}
              </div>
            )}
            {tab === 'mentions' && (
              <div data-inbox-mentions>
                {list === null ? loading : mentions.length === 0 ? empty(t('Nobody has mentioned you in the last 30 days.')) : mentions.map((m) => (
                  <section key={m.id} className="mb-2" data-inbox-row={m.id}>
                    {heading(m.channel_id, m)}
                    {card(m, <button type="button" onClick={() => hide(m.id)} title={t('Remove from inbox')} className={iconBtn} data-inbox-remove={m.id}><X size={14} /></button>, { 'data-inbox-item': m.id })}
                  </section>
                ))}
              </div>
            )}
            {tab === 'bookmarks' && (
              <div data-inbox-bookmarks>
                {saved === null ? loading : saved.length === 0 ? empty(t('Right-click a message and choose Bookmark Message to keep it here.')) : saved.map((m) => (
                  <section key={m.id} className="mb-2" data-inbox-bookmark={m.id}>
                    {heading(m.channel_id, m)}
                    {card(m, <button type="button" onClick={() => void unbookmark(m)} title={t('Remove Bookmark')} className={iconBtn} data-inbox-unbookmark={m.id}><Bookmark size={14} /></button>, {})}
                  </section>
                ))}
              </div>
            )}
            {tab === 'reminders' && (
              <div data-inbox-reminders>
                {saved === null ? loading : reminders.length === 0 ? empty(t('Use Remind Me on a message and it shows up here.')) : reminders.map((m) => (
                  <section key={m.id} className="mb-2" data-inbox-reminder={m.id}>
                    {heading(m.channel_id, m)}
                    {card(m, <button type="button" onClick={() => void clearReminder(m)} title={t('Clear reminder')} className={iconBtn} data-inbox-clear-reminder={m.id}><X size={14} /></button>, {},
                      <div className={`mt-1 inline-flex items-center gap-1 text-xs ${new Date(m.remind_at!) <= new Date() ? 'text-warn' : 'text-text-2'}`}><AlarmClock size={12} />{remindLabel(m.remind_at!)}</div>)}
                  </section>
                ))}
              </div>
            )}
            {tab === 'highlights' && (
              <div data-inbox-highlights>
                {highlights === null ? loading : highlights.length === 0 ? empty(t('Nothing stood out in your servers in the last two days.')) : highlights.map((m) => (
                  <section key={m.id} className="mb-2" data-inbox-highlight={m.id}>
                    {heading(m.channel_id, m)}
                    {card(m, null, {}, <div className="mt-1 text-[11px] text-text-2">{t('{n} reactions', { n: m.reactions.reduce((n, r) => n + r.count, 0) })}</div>)}
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
