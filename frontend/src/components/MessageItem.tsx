import { Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { myChannelPerms, useStore } from '../store'
import { has, memberColor, P } from '../lib/perms'
import type { Message } from '../lib/types'
import { formatShortTime, formatTime, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import Attachments from './Attachments'
import { api } from '../lib/api'
import { useParams } from 'react-router-dom'

const QUICK = ['👍', '❤️', '😂', '🔥', '👀', '🎉']

interface Props { message: Message; grouped: boolean; isOwn: boolean; onReply: () => void; replyTarget: Message | null }

export default function MessageItem({ message: m, grouped, isOwn, onReply, replyTarget }: Props) {
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const { guildId } = useParams()
  const perms = useStore((s) => myChannelPerms(s, m.channel_id))
  const canDelete = isOwn || has(perms, P.MANAGE_MESSAGES)
  const canReact = has(perms, P.ADD_REACTIONS)
  const authorColor = useStore((s) => (guildId ? memberColor(s.roles[guildId] ?? {}, s.members[guildId]?.[m.author.id]) : null))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [picker, setPicker] = useState(false)
  // Phones have no hover: tapping the message body toggles the action bar.
  const [tapped, setTapped] = useState(false)

  const saveEdit = async () => {
    const c = draft.trim()
    setEditing(false)
    if (!c || c === m.content) return
    try { await api.patch(`/channels/${m.channel_id}/messages/${m.id}`, { content: c }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
    if (e.key === 'Escape') { setEditing(false); setDraft(m.content) }
  }
  const del = () => openModal({
    kind: 'confirm', title: 'Delete Message', body: 'Are you sure you want to delete this message?', danger: true, confirmLabel: 'Delete',
    action: async () => { try { await api.delete(`/channels/${m.channel_id}/messages/${m.id}`) } catch (e) { pushToast((e as Error).message, 'error') } },
  })
  const react = async (emoji: string, has: boolean) => {
    setPicker(false)
    const path = `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`
    try { has ? await api.delete(path) : await api.put(path) } catch (e) { pushToast((e as Error).message, 'error') }
  }

  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, textarea')) setTapped((t) => !t) }} className={`group relative px-4 max-md:px-3 hover:bg-bg-0/30 ${tapped ? 'max-md:bg-bg-0/30' : ''} ${grouped ? 'py-0.5' : 'mt-[17px] py-0.5'} ${m.reply_to ? 'pt-1' : ''}`}>
      {replyTarget !== null && m.reply_to && (
        <div className="ml-14 mb-0.5 flex items-center gap-1.5 text-xs text-text-2 before:content-[''] before:absolute before:left-9 before:top-2 before:h-3 before:w-6 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-bg-4">
          {replyTarget ? (<><Avatar user={replyTarget.author} size={16} /><span className="font-semibold text-text-1">{replyTarget.author.display_name}</span><span className="truncate max-w-md">{replyTarget.content || (replyTarget.attachments?.length ? '📎 Attachment' : '')}</span></>) : <i>Original message was deleted</i>}
        </div>
      )}
      <div className="flex gap-4 max-md:gap-3">
        {grouped ? (
          <div className="w-10 max-md:w-8 shrink-0 text-right text-[10px] text-text-2 opacity-0 group-hover:opacity-100 pt-1 select-none">{formatShortTime(m.created_at)}</div>
        ) : (
          <button onClick={() => openModal({ kind: 'profile', userId: m.author.id })} className="shrink-0 mt-0.5"><Avatar user={m.author} size={40} /></button>
        )}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <button onClick={() => openModal({ kind: 'profile', userId: m.author.id })} className="font-semibold hover:underline" style={{ color: authorColor ?? undefined }}>{m.author.display_name}</button>
              <span className="text-[11px] text-text-2">{formatTime(m.created_at)}</span>
            </div>
          )}
          {editing ? (
            <div>
              <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKey} className="input mt-1 resize-none" rows={Math.min(8, draft.split('\n').length + 1)} />
              <p className="text-[11px] text-text-2 mt-1">escape to <button className="text-sky-400 hover:underline" onClick={() => { setEditing(false); setDraft(m.content) }}>cancel</button> • enter to <button className="text-sky-400 hover:underline" onClick={saveEdit}>save</button></p>
            </div>
          ) : (
            <>
              {(m.content || m.edited_at) && (
                <div className="msg-content text-[15px] leading-[1.375rem] text-text-0 break-words whitespace-pre-wrap">
                  {renderMarkdown(m.content)}
                  {m.edited_at && <span className="ml-1 text-[10px] text-text-2">(edited)</span>}
                </div>
              )}
              <Attachments items={m.attachments ?? []} />
            </>
          )}
          {m.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.reactions.map((r) => (
                <button key={r.emoji} disabled={!canReact && !r.me} onClick={() => react(r.emoji, r.me)} className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm ${r.me ? 'border-accent bg-accent/20' : 'border-line bg-bg-3 hover:border-text-2'}`}>
                  <span>{r.emoji}</span><span className="text-xs font-semibold text-text-1">{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!editing && (
        <div className={`absolute -top-3 right-4 max-md:right-2 hidden group-hover:flex ${tapped ? 'max-md:flex' : ''} items-center rounded-lg bg-bg-1 border border-line shadow-lg overflow-visible`}>
          {canReact && <div className="relative">
            <Tool label="Add Reaction" onClick={() => setPicker((p) => !p)}><SmilePlus size={16} /></Tool>
            {picker && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setPicker(false)} />
                <div className="pop absolute right-0 top-full mt-1 z-40 flex gap-1 rounded-lg bg-bg-0 border border-line p-1 shadow-2xl">
                  {QUICK.map((e) => <button key={e} onClick={() => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} className="h-8 w-8 rounded-md text-lg hover:bg-bg-3">{e}</button>)}
                </div>
              </>
            )}
          </div>}
          <Tool label="Reply" onClick={onReply}><Reply size={16} /></Tool>
          {isOwn && <Tool label="Edit" onClick={() => { setDraft(m.content); setEditing(true) }}><Pencil size={16} /></Tool>}
          {canDelete && <Tool label="Delete" onClick={del} danger><Trash2 size={16} /></Tool>}
        </div>
      )}
    </div>
  )
}

function Tool({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button title={label} onClick={onClick} className={`h-8 w-8 flex items-center justify-center hover:bg-bg-3 first:rounded-l-lg last:rounded-r-lg ${danger ? 'text-danger' : 'text-text-1 hover:text-text-0'}`}>{children}</button>
}
