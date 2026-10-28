import { CheckCheck, Hash, Inbox, MessageSquare, X } from 'lucide-react'
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
import { notificationText } from '../lib/desktopNotify'

const HIDDEN_KEY = `${STORAGE_PREFIX}inboxHidden`
const loadHidden = (): string[] => { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

/** Header Inbox: Mentions (last 30 days, each removable) and Unreads (channels with new messages, mark read). */
export default function InboxButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'mentions' | 'unreads' | 'highlights'>('mentions')
  const [highlights, setHighlights] = useState<(Message & { guild_name?: string; channel_name?: string })[] | null>(null)
  const [list, setList] = useState<Message[] | null>(null)
  const [hidden, setHidden] = useState(loadHidden)
  const hide = (id: string) => { const next = [...hidden, id].slice(-500); setHidden(next); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch { /* ignore */ } }
  const readStates = useStore((s) => s.readStates)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const notifSettings = useStore((s) => s.notifSettings)
  const markRead = useStore((s) => s.markRead)
  const channels = useStore((s) => s.channels)
  const dms = useStore((s) => s.dms)
  const guilds = useStore((s) => s.guilds)
  const count = useStore(() => badgeCount())
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Viewport position under the button. The panel is portalled to <body> because headers scroll
  // horizontally on phones (overflow-x-auto), which would clip an absolutely positioned child.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = ref.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }
  useEffect(() => { if (open) api.get<Message[]>('/users/@me/mentions').then(setList).catch(() => setList([])) }, [open])
  useEffect(() => { if (open && tab === 'highlights') { setHighlights(null); api.get<(Message & { guild_name?: string; channel_name?: string })[]>('/users/@me/highlights').then(setHighlights).catch(() => setHighlights([])) } }, [open, tab])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { const node = e.target as Node; if (!ref.current?.contains(node) && !panel.current?.contains(node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onResize = () => setOpen(false)
    window.addEventListener('pointerdown', onDown); window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
  }, [open])
  const whereOf = (m: Message) => {
    const ch = channels[m.channel_id]
    if (ch) return `#${ch.name}${ch.guild_id && guilds[ch.guild_id] ? ` · ${guilds[ch.guild_id].name}` : ''}`
    const dm = dms[m.channel_id]
    return dm ? (dm.recipients.length > 1 ? t('Group') : t('Direct message')) : t('Unknown channel')
  }
  const unreads = Object.keys(lastMessageId).filter((id) => (channels[id] || dms[id]) && showsUnread({ readStates, lastMessageId, channels, dms, notifSettings, guilds }, id))
    .sort((a, b) => (lastMessageId[b] ?? '').localeCompare(lastMessageId[a] ?? ''))
  const openChannel = (id: string) => { setOpen(false); navigate(`/channels/${channels[id]?.guild_id ?? '@me'}/${id}`) }
  const nameOf = (id: string) => { const ch = channels[id]; if (ch) return ch.name; const dm = dms[id]; return dm ? (dm.name || dm.recipients.map((r) => r.display_name).join(', ')) : '' }
  const shown = (list ?? []).filter((m) => !hidden.includes(m.id))
  const jump = (m: Message) => {
    setOpen(false)
    const ch = channels[m.channel_id]
    navigate(`/channels/${ch?.guild_id ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) pushToast(t('That message could not be found'), 'error') })
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} title={t('Inbox')} className={`relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${open ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-inbox-toggle>
            <Inbox size={20} />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-bg-1" data-inbox-count>{count > 99 ? '99+' : count}</span>}
          </button>
      {open && pos && createPortal(
        <div ref={panel} style={{ top: pos.top, right: pos.right }} className={`pop fixed z-50 w-[420px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-bg-1 shadow-2xl`} data-inbox>
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-line">
            <Inbox size={16} className="text-text-2" /><span className="font-bold mr-2">{t('Inbox')}</span>
            {(['mentions', 'unreads', 'highlights'] as const).map((id) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-md px-2 py-0.5 text-sm ${tab === id ? 'bg-bg-4 text-text-0' : 'text-text-2 hover:text-text-0'}`} data-inbox-tab={id} aria-pressed={tab === id}>
                {id === 'mentions' ? t('Mentions') : id === 'unreads' ? t('Unreads') : t('Highlights')}{id === 'unreads' && unreads.length > 0 && <span className="ml-1 text-[11px] text-text-2">{unreads.length}</span>}
              </button>
            ))}
            {tab === 'unreads' && unreads.length > 0 && <button type="button" onClick={() => { for (const id of unreads) void markRead(id) }} className="ml-auto flex items-center gap-1 text-xs text-sky-400 hover:underline" data-inbox-read-all><CheckCheck size={14} /> {t('Mark all read')}</button>}
          </div>
          {tab === 'highlights' ? (
            <div className={`max-h-[60vh] overflow-y-auto`} data-inbox-highlights>
              {highlights === null && <p className="px-4 py-6 text-sm text-text-2">{t('Loading…')}</p>}
              {highlights?.length === 0 && <p className="px-4 py-6 text-sm text-text-2">{t('Nothing stood out in your servers in the last two days.')}</p>}
              {highlights?.map((m) => (
                <button key={m.id} type="button" onClick={() => jump(m)} className="w-full text-left flex gap-3 px-4 py-2.5 hover:bg-bg-3 border-b border-line/60" data-inbox-highlight={m.id}>
                  <Avatar user={m.author} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><span className="font-semibold truncate">{m.author.display_name}</span><span className="text-[11px] text-text-2 truncate">#{m.channel_name} · {m.guild_name}</span></span>
                    <span className="block text-sm text-text-1 truncate">{m.content ? notificationText(m.content, channels[m.channel_id]?.guild_id ?? null) : m.attachments?.length ? `📎 ${t('Attachment')}` : ''}</span>
                    <span className="text-[11px] text-text-2">{t('{n} reactions', { n: m.reactions.reduce((n, r) => n + r.count, 0) })}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : tab === 'unreads' ? (
            <div className={`max-h-[60vh] overflow-y-auto`} data-inbox-unreads>
              {unreads.length === 0 && <p className="px-4 py-6 text-sm text-text-2">{t("You're all caught up.")}</p>}
              {unreads.map((id) => (
                <div key={id} className="group flex items-center gap-3 px-4 py-2 hover:bg-bg-3 border-b border-line/60" data-inbox-unread={id}>
                  <button type="button" onClick={() => openChannel(id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {channels[id] ? <Hash size={16} className="shrink-0 text-text-2" /> : <MessageSquare size={16} className="shrink-0 text-text-2" />}
                    <span className="min-w-0"><span className="block truncate font-semibold">{nameOf(id)}</span>{channels[id]?.guild_id && <span className="block truncate text-[11px] text-text-2">{guilds[channels[id].guild_id!]?.name}</span>}</span>
                  </button>
                  <button type="button" onClick={() => void markRead(id)} title={t('Mark as read')} className="rounded p-1 text-text-2 hover:bg-bg-4 hover:text-text-0" data-inbox-mark-read={id}><CheckCheck size={16} /></button>
                </div>
              ))}
            </div>
          ) : (
          <div className={`max-h-[60vh] overflow-y-auto`}>
            {list === null && <p className="px-4 py-6 text-sm text-text-2">{t('Loading…')}</p>}
            {list !== null && shown.length === 0 && <p className="px-4 py-6 text-sm text-text-2">{t('Nobody has mentioned you in the last 30 days.')}</p>}
            {shown.map((m) => (
              <div key={m.id} className="group relative" data-inbox-row={m.id}>
              <button type="button" onClick={() => jump(m)} className="w-full text-left flex gap-3 px-4 py-2.5 pr-10 hover:bg-bg-3 border-b border-line/60" data-inbox-item={m.id}>
                <Avatar user={m.author} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2"><span className="font-semibold truncate">{m.author.display_name}</span><span className="text-[11px] text-text-2 truncate">{whereOf(m)}</span><span className="ml-auto text-[11px] text-text-2 shrink-0">{new Date(m.created_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</span></span>
                  <span className="block text-sm text-text-1 truncate">{m.content ? notificationText(m.content, channels[m.channel_id]?.guild_id ?? null) : m.attachments?.length ? `📎 ${t('Attachment')}` : ''}</span>
                </span>
              </button>
              <button type="button" onClick={() => hide(m.id)} title={t('Remove from inbox')} className="absolute right-2 top-2 rounded p-1 text-text-2 opacity-0 hover:bg-bg-4 hover:text-text-0 group-hover:opacity-100 focus:opacity-100" data-inbox-remove={m.id}><X size={14} /></button>
              </div>
            ))}
          </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
