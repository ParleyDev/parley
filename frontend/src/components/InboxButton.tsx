import { Inbox } from 'lucide-react'
import { locale } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useStore } from '../store'
import type { Message } from '../lib/types'
import Avatar from './Avatar'
import { jumpToMessageAsync } from './ChatView'
import { badgeCount } from '../lib/badge'

/** Header Inbox: your recent mentions (last 30 days) with a jump to each. */
export default function InboxButton() {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Message[] | null>(null)
  const channels = useStore((s) => s.channels)
  const dms = useStore((s) => s.dms)
  const guilds = useStore((s) => s.guilds)
  const count = useStore(() => badgeCount())
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) api.get<Message[]>('/users/@me/mentions').then(setList).catch(() => setList([])) }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onDown); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  const whereOf = (m: Message) => {
    const ch = channels[m.channel_id]
    if (ch) return `#${ch.name}${ch.guild_id && guilds[ch.guild_id] ? ` · ${guilds[ch.guild_id].name}` : ''}`
    const dm = dms[m.channel_id]
    return dm ? (dm.recipients.length > 1 ? 'Group' : 'Direct message') : 'Unknown channel'
  }
  const jump = (m: Message) => {
    setOpen(false)
    const ch = channels[m.channel_id]
    navigate(`/channels/${ch?.guild_id ?? '@me'}/${m.channel_id}`)
    void jumpToMessageAsync(m.channel_id, m.id).then((found) => { if (!found) pushToast('That message could not be found', 'error') })
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Inbox" className={`relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${open ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-inbox-toggle>
        <Inbox size={20} />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-bg-1" data-inbox-count>{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="pop absolute right-0 top-11 z-40 w-[420px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-bg-1 shadow-2xl" data-inbox>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line"><Inbox size={16} className="text-text-2" /><span className="font-bold">Inbox</span><span className="text-xs text-text-2">Recent mentions</span></div>
          <div className="max-h-[60vh] overflow-y-auto">
            {list === null && <p className="px-4 py-6 text-sm text-text-2">Loading…</p>}
            {list?.length === 0 && <p className="px-4 py-6 text-sm text-text-2">Nobody has mentioned you in the last 30 days.</p>}
            {list?.map((m) => (
              <button key={m.id} type="button" onClick={() => jump(m)} className="w-full text-left flex gap-3 px-4 py-2.5 hover:bg-bg-3 border-b border-line/60" data-inbox-item={m.id}>
                <Avatar user={m.author} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2"><span className="font-semibold truncate">{m.author.display_name}</span><span className="text-[11px] text-text-2 truncate">{whereOf(m)}</span><span className="ml-auto text-[11px] text-text-2 shrink-0">{new Date(m.created_at).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</span></span>
                  <span className="block text-sm text-text-1 truncate">{m.content || (m.attachments?.length ? '📎 Attachment' : '')}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
