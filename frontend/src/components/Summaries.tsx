import { Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import type { Channel } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import { jumpToMessageAsync } from './ChatView'

interface Topic { title: string; summary: string; message_ids: string[]; people: string[] }

/** Header button: AI summaries of the last two days in this channel, as topics you can jump into. */
export default function SummariesButton({ channel }: { channel: Channel }) {
  const on = useStore((s) => !!s.instance.summaries && !!channel.guild_id && s.guilds[channel.guild_id]?.summaries_enabled !== false && channel.kind === 'text')
  const [open, setOpen] = useState(false)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const users = useStore((s) => s.users)
  const members = useStore((s) => (channel.guild_id ? s.members[channel.guild_id] : undefined))
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    setTopics(null); setError(null)
    api.get<Topic[]>(`/channels/${channel.id}/summaries`).then(setTopics).catch((e) => setError((e as Error).message))
  }, [open, channel.id])
  if (!on) return null
  const r = btn.current?.getBoundingClientRect()
  const jump = (t: Topic) => { setOpen(false); void jumpToMessageAsync(channel.id, t.message_ids[0]) }
  const name = (id: string) => members?.[id]?.nickname || users[id]?.display_name || members?.[id]?.display_name || 'Someone'
  return (
    <>
      <button ref={btn} type="button" title="Summaries" onClick={() => setOpen((o) => !o)} className={`h-9 w-9 shrink-0 rounded-md flex items-center justify-center hover:bg-bg-3 ${open ? 'text-text-0' : 'text-text-2 hover:text-text-0'}`} data-summaries-toggle><Sparkles size={20} /></button>
      {open && r && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }} className="pop fixed z-50 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-bg-1 shadow-2xl" data-summaries>
            <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-bg-1 px-4 py-3"><Sparkles size={16} className="text-accent" /><span className="font-bold">Summaries</span><span className="text-xs text-text-2">last 48 hours</span>
              <button type="button" className="ml-auto text-text-2 hover:text-text-0" onClick={() => setOpen(false)} title="Close"><X size={16} /></button></div>
            {error && <p className="px-4 py-6 text-sm text-danger">{error}</p>}
            {!error && topics === null && <p className="px-4 py-6 text-sm text-text-2">Reading the conversation…</p>}
            {topics?.length === 0 && <p className="px-4 py-6 text-sm text-text-2" data-summaries-empty>Not much to summarize yet.</p>}
            {topics?.map((t, i) => (
              <button key={i} type="button" onClick={() => jump(t)} className="w-full border-b border-line/60 px-4 py-3 text-left hover:bg-bg-3" data-summary-topic={i}>
                <div className="font-semibold">{t.title}</div>
                <div className="mt-0.5 text-sm text-text-1">{t.summary}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-2">
                  <span className="flex -space-x-1.5">{t.people.slice(0, 4).map((p) => <span key={p} className="rounded-full ring-2 ring-bg-1"><Avatar user={users[p] ?? { id: p, display_name: name(p), avatar_url: null }} size={18} /></span>)}</span>
                  {t.people.slice(0, 3).map(name).join(', ')}{t.people.length > 3 ? ` +${t.people.length - 3}` : ''} · {t.message_ids.length} {t.message_ids.length === 1 ? 'message' : 'messages'}
                </div>
              </button>
            ))}
            <p className="px-4 py-2 text-[11px] text-text-2">Written by AI from this channel's messages; it can get things wrong.</p>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
