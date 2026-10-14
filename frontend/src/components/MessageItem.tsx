import { Copy, Hash, MoreHorizontal, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { frequentEmoji, recordEmoji } from '../lib/recentEmoji'
import { anchorOf } from '../lib/anchor'
import { useRef, useState, type KeyboardEvent } from 'react'
import { isBlocked, myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import StyledName from './StyledName'
import type { Message } from '../lib/types'
import { formatShortTime, formatTime, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import Attachments from './Attachments'
import { api } from '../lib/api'
import { shortcutFormat, toggleWrap } from '../lib/editor'
import FormatToolbar from './FormatToolbar'
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
  const canPin = m.channel_id && (guildId === undefined || has(perms, P.MANAGE_MESSAGES))
  const [more, setMore] = useState(false)
  const frequent = frequentEmoji(3)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [picker, setPicker] = useState(false)
  // The picker opens upward (over older messages) so it is never clipped by the bottom of the
  // scrolling list; only when the message sits right under the header does it open downward.
  const [pickerUp, setPickerUp] = useState(true)
  const pickerAnchor = useRef<HTMLDivElement>(null)
  const togglePicker = () => {
    const top = pickerAnchor.current?.getBoundingClientRect().top ?? 999
    setPickerUp(top > 140)
    setPicker((p) => !p)
  }
  // Phones have no hover: tapping the message body toggles the action bar.
  const [tapped, setTapped] = useState(false)
  const blocked = useStore((s) => isBlocked(s, m.author.id))
  const [revealed, setRevealed] = useState(false)

  const saveEdit = async () => {
    const c = draft.trim()
    setEditing(false)
    if (!c || c === m.content) return
    try { await api.patch(`/channels/${m.channel_id}/messages/${m.id}`, { content: c }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
    if (e.key === 'Escape') { setEditing(false); setDraft(m.content) }
    const f = shortcutFormat(e)
    if (f && editRef.current) { e.preventDefault(); setDraft(toggleWrap(editRef.current, f)) }
  }
  const del = () => openModal({
    kind: 'confirm', title: 'Delete Message', body: 'Are you sure you want to delete this message?', danger: true, confirmLabel: 'Delete',
    action: async () => { try { await api.delete(`/channels/${m.channel_id}/messages/${m.id}`) } catch (e) { pushToast((e as Error).message, 'error') } },
  })
  const togglePin = async () => {
    try { m.pinned_at ? await api.delete(`/channels/${m.channel_id}/pins/${m.id}`) : await api.put(`/channels/${m.channel_id}/pins/${m.id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const copy = async (label: string, text: string) => { try { await navigator.clipboard.writeText(text); pushToast(`${label} copied`) } catch { pushToast('Clipboard unavailable', 'error') } }
  const react = async (emoji: string, has: boolean) => {
    setPicker(false)
    const path = `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`
    if (!has) recordEmoji(emoji)
    try { has ? await api.delete(path) : await api.put(path) } catch (e) { pushToast((e as Error).message, 'error') }
  }

  if (blocked && !revealed) {
    return (
      <div className="px-4 max-md:px-3 py-1 flex items-center gap-2 text-xs text-text-2" data-msg-id={m.id}>
        <span className="flex-1 border-t border-line" />
        <span>1 blocked message</span>
        <button onClick={() => setRevealed(true)} className="text-sky-400 hover:underline">Show message</button>
        <span className="flex-1 border-t border-line" />
      </div>
    )
  }
  return (
    <div data-msg-id={m.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, textarea')) setTapped((t) => !t) }} className={`group relative px-4 max-md:px-3 hover:bg-bg-0/30 ${tapped ? 'max-md:bg-bg-0/30' : ''} ${grouped ? 'py-0.5' : 'mt-[17px] py-0.5'} ${m.reply_to ? 'pt-1' : ''}`}>
      {replyTarget !== null && m.reply_to && (
        <div className="ml-14 mb-0.5 flex items-center gap-1.5 text-xs text-text-2 before:content-[''] before:absolute before:left-9 before:top-2 before:h-3 before:w-6 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-bg-4">
          {replyTarget ? (<><Avatar user={replyTarget.author} size={16} /><span className="font-semibold text-text-1">{replyTarget.author.display_name}</span><span className="truncate max-w-md">{replyTarget.content || (replyTarget.attachments?.length ? '📎 Attachment' : '')}</span></>) : <i>Original message was deleted</i>}
        </div>
      )}
      <div className="flex gap-4 max-md:gap-3">
        {grouped ? (
          <div className="w-10 max-md:w-8 shrink-0 text-right text-[10px] text-text-2 opacity-0 group-hover:opacity-100 pt-1 select-none">{formatShortTime(m.created_at)}</div>
        ) : (
          <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} className="shrink-0 mt-0.5"><Avatar user={m.author} size={40} /></button>
        )}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} className="font-semibold hover:underline"><StyledName userId={m.author.id} guildId={guildId}>{m.author.display_name}</StyledName></button>
              <span className="text-[11px] text-text-2">{formatTime(m.created_at)}</span>
            </div>
          )}
          {editing ? (
            <div className="relative">
              <FormatToolbar textarea={editRef} onChange={setDraft} className="absolute -top-9 left-0 z-20" />
              <textarea ref={editRef} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKey} className="input mt-1 resize-none" rows={Math.min(8, draft.split('\n').length + 1)} />
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
          {m.pinned_at && <span className="h-8 px-1.5 flex items-center text-text-2" title="Pinned"><Pin size={13} /></span>}
          {canReact && frequent.map((e) => <button key={e} title={`React with ${e}`} onClick={() => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} className="h-8 w-8 flex items-center justify-center text-base hover:bg-bg-3 first:rounded-l-lg" data-quick-react>{e}</button>)}
          {canReact && <div className="relative" ref={pickerAnchor}>
            <Tool label="Add Reaction" onClick={togglePicker}><SmilePlus size={16} /></Tool>
            {picker && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setPicker(false)} />
                <div className={`pop absolute right-0 z-40 flex gap-1 rounded-lg bg-bg-0 border border-line p-1 shadow-2xl ${pickerUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                  {QUICK.map((e) => <button key={e} onClick={() => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} className="h-8 w-8 rounded-md text-lg hover:bg-bg-3">{e}</button>)}
                </div>
              </>
            )}
          </div>}
          <Tool label="Reply" onClick={onReply}><Reply size={16} /></Tool>
          {isOwn && <Tool label="Edit" onClick={() => { setDraft(m.content); setEditing(true) }}><Pencil size={16} /></Tool>}
          <div className="relative">
            <Tool label="More" onClick={() => { const top = pickerAnchor.current?.getBoundingClientRect().top ?? 999; setPickerUp(top > 220); setMore((o) => !o) }}><MoreHorizontal size={16} /></Tool>
            {more && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMore(false)} />
                <div className={`pop absolute right-0 z-40 min-w-[190px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5 ${pickerUp ? 'bottom-full mb-1' : 'top-full mt-1'}`} role="menu" data-msg-menu>
                  {canPin && <MenuBtn onClick={() => { setMore(false); togglePin() }} icon={m.pinned_at ? <PinOff size={16} /> : <Pin size={16} />}>{m.pinned_at ? 'Unpin Message' : 'Pin Message'}</MenuBtn>}
                  <MenuBtn onClick={() => { setMore(false); copy('Text', m.content) }} icon={<Copy size={16} />}>Copy Text</MenuBtn>
                  <MenuBtn onClick={() => { setMore(false); copy('Message ID', m.id) }} icon={<Hash size={16} />}>Copy Message ID</MenuBtn>
                  {canDelete && <><div className="my-1 h-px bg-white/10" /><MenuBtn danger onClick={() => { setMore(false); del() }} icon={<Trash2 size={16} />}>Delete Message</MenuBtn></>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MenuBtn({ children, icon, onClick, danger }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-left ${danger ? 'text-[#f23f43] hover:bg-[#f23f43] hover:text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'}`}>{icon}{children}</button>
}

function Tool({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button title={label} onClick={onClick} className={`h-8 w-8 flex items-center justify-center hover:bg-bg-3 first:rounded-l-lg last:rounded-r-lg ${danger ? 'text-danger' : 'text-text-1 hover:text-text-0'}`}>{children}</button>
}
