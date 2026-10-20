import { ArrowLeftFromLine, Bookmark, BookmarkMinus, Copy, Flag, Forward, Hash, ImageIcon, Link2, MailOpen, MessagesSquare, MoreHorizontal, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2, UserMinus, UserPlus, Volume2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { canHover } from './GuildBar'
import { useEmojiHover } from './EmojiHover'
import { parseCustom, unicodeInfo } from '../lib/emoji'
import { frequentEmoji, recordEmoji } from '../lib/recentEmoji'
import { anchorOf } from '../lib/anchor'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isBlocked, mentionsMe, myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { useAppearance } from '../lib/appearance'
import PollCard from './PollCard'
import LinkEmbed, { firstLink } from './LinkEmbed'
import InviteCard, { inviteCodes } from './InviteCard'
import StyledName from './StyledName'
import type { Message } from '../lib/types'
import { formatShortTime, formatTime, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import Attachments from './Attachments'
import Emoji from './Emoji'
import ExpressionPicker from './ExpressionPicker'
import { isJumbo } from '../lib/emoji'
import { api } from '../lib/api'
import { shortcutFormat, toggleWrap } from '../lib/editor'
import FormatToolbar from './FormatToolbar'
import { useParams } from 'react-router-dom'

interface Props { message: Message; grouped: boolean; isOwn: boolean; onReply: () => void; replyTarget: Message | null
  /** Reply header click: scroll to (and if needed load) the original message. */
  onJumpToReply?: () => void
}

export default function MessageItem({ message: m, grouped, isOwn, onReply, replyTarget, onJumpToReply }: Props) {
  const openModal = useStore((s) => s.openModal)
  const compact = useAppearance().density === 'compact'
  const setOpenThread = useStore((s) => s.setOpenThread)
  const chanKind = useStore((s) => s.channels[m.channel_id]?.kind)
  const pushToast = useStore((s) => s.pushToast)
  const setReadState = useStore((s) => s.setReadState)
  const bookmarked = useStore((s) => !!s.bookmarks[m.id])
  const setBookmark = useStore((s) => s.setBookmark)
  const { guildId } = useParams()
  const ctx = useContextMenu()
  const userMenu = useUserMenu(guildId ?? null)
  const emojiHover = useEmojiHover()
  const mentioned = useStore((s) => mentionsMe(s, m))
  const perms = useStore((s) => myChannelPerms(s, m.channel_id))
  // Moderation only exists inside servers; in DMs and group chats you can delete just your own messages.
  const canDelete = isOwn || (guildId !== undefined && has(perms, P.MANAGE_MESSAGES))
  const canReact = has(perms, P.ADD_REACTIONS)
  const canPin = m.channel_id && (guildId === undefined || has(perms, P.MANAGE_MESSAGES))
  const [more, setMore] = useState(false)
  const frequent = frequentEmoji(3)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  // The full emoji picker is portalled beside the hover bar so the scrolling list never clips it.
  const [picker, setPicker] = useState<DOMRect | null>(null)
  const [pickerUp, setPickerUp] = useState(true)
  const pickerAnchor = useRef<HTMLDivElement>(null)
  const togglePicker = () => setPicker((p) => (p ? null : pickerAnchor.current?.getBoundingClientRect() ?? null))
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
    setPicker(null)
    const path = `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`
    if (!has) recordEmoji(emoji)
    try { has ? await api.delete(path) : await api.put(path) } catch (e) { pushToast((e as Error).message, 'error') }
  }

  const media = soleMediaUrl(m.content)
  const link = media ? null : firstLink(m.content)

  /** Right-click menu (Discord layout): quick reactions, Add Reaction, Reply, Edit, Copy Text, Pin, Mark Unread, Copy Link, Speak, Delete, Copy ID. */
  const contextItems = (e: React.MouseEvent): MenuEntry[] => {
    const quick = frequentEmoji(4)
    const anchorRect = new DOMRect(e.clientX, e.clientY, 0, 0)
    const markUnread = async () => {
      const list = useStore.getState().messages[m.channel_id] ?? []
      const i = list.findIndex((x) => x.id === m.id)
      const prev = i > 0 ? list[i - 1].id : null
      setReadState(m.channel_id, prev)
      try { if (prev) await api.put(`/channels/${m.channel_id}/read`, { message_id: prev }) } catch (err) { pushToast((err as Error).message, 'error') }
    }
    const link = `${location.origin}/channels/${guildId ?? '@me'}/${m.channel_id}?message=${m.id}`
    const toggleBookmark = async () => {
      try { bookmarked ? await api.delete(`/users/@me/bookmarks/${m.id}`) : await api.put(`/users/@me/bookmarks/${m.id}`); setBookmark(m.id, !bookmarked); pushToast(bookmarked ? 'Bookmark removed' : 'Message bookmarked') } catch (err) { pushToast((err as Error).message, 'error') }
    }
    return [
      ...(canReact ? [{ node: (
        <div className="flex items-center gap-1.5 px-1 py-1" data-quick-row>
          {quick.map((q) => <button key={q} type="button" onClick={() => { ctx.close(); react(q, !!m.reactions.find((r) => r.emoji === q && r.me)) }} className="h-10 w-10 rounded-lg bg-[#2b2d31] hover:bg-[#3f4147] flex items-center justify-center" title={`React with ${q}`}><Emoji value={q} size={24} /></button>)}
        </div>
      ) }] : []),
      ...(canReact ? [{ label: 'Add Reaction', icon: <SmilePlus size={16} />, onClick: () => setPicker(anchorRect) }] : []),
      'sep' as const,
      { label: 'Reply', icon: <Reply size={16} />, onClick: onReply },
      ...(guildId && chanKind === 'text' && !m.thread && m.kind !== 'default' ? [] : guildId && chanKind === 'text' && !m.thread ? [{ label: 'Create Thread', icon: <MessagesSquare size={16} />, onClick: () => openModal({ kind: 'createThread', channelId: m.channel_id, messageId: m.id, suggested: m.content.replace(/\s+/g, ' ').trim().slice(0, 60) }) }] : []),
      { label: 'Forward', icon: <Forward size={16} />, onClick: () => openModal({ kind: 'forward', message: m }) },
      ...(isOwn ? [{ label: 'Edit Message', icon: <Pencil size={16} />, onClick: () => { setDraft(m.content); setEditing(true) } }] : []),
      'sep' as const,
      { label: 'Copy Text', icon: <Copy size={16} />, onClick: () => copy('Text', m.content) },
      bookmarked ? { label: 'Remove Bookmark', icon: <BookmarkMinus size={16} />, onClick: toggleBookmark } : { label: 'Bookmark Message', icon: <Bookmark size={16} />, onClick: toggleBookmark },
      ...(canPin ? [{ label: m.pinned_at ? 'Unpin Message' : 'Pin Message', icon: m.pinned_at ? <PinOff size={16} /> : <Pin size={16} />, onClick: togglePin }] : []),
      { label: 'Mark Unread', icon: <MailOpen size={16} />, onClick: markUnread },
      { label: 'Copy Message Link', icon: <Link2 size={16} />, onClick: () => copy('Message link', link) },
      ...(m.content && 'speechSynthesis' in window ? [{ label: 'Speak Message', icon: <Volume2 size={16} />, onClick: () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(`${m.author.display_name} said ${m.content}`)) } }] : []),
      ...(canDelete ? ['sep' as const, { label: 'Delete Message', icon: <Trash2 size={16} />, danger: true, onClick: del }] : []),
      ...(!isOwn ? [{ label: 'Report Message', icon: <Flag size={16} />, danger: true, onClick: () => openModal({ kind: 'report', messageId: m.id, userId: m.author.id, name: m.author.display_name }) }] : []),
      'sep' as const,
      { label: 'Copy Message ID', icon: <Hash size={16} />, onClick: () => copy('Message ID', m.id) },
    ]
  }

  if (m.kind && m.kind !== 'default') {
    const icon = m.kind === 'recipient_add' ? <UserPlus size={16} className="text-success" /> : m.kind === 'recipient_remove' || m.kind === 'recipient_leave' ? <UserMinus size={16} className="text-danger" /> : m.kind === 'channel_icon_change' ? <ImageIcon size={16} className="text-text-2" /> : <ArrowLeftFromLine size={16} className="text-text-2" />
    return (
      <div className="px-4 max-md:px-3 py-1.5 mt-2 flex items-center gap-3 text-[15px] text-text-2" data-msg-id={m.id} data-system={m.kind}>
        <span className="w-10 flex justify-center shrink-0">{icon}</span>
        <span className="min-w-0"><button type="button" className="font-medium text-text-0 hover:underline" onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, w: 0, h: 0 } })} data-msg-author>{m.author.display_name}</button> {m.content}</span>
        <span className="ml-auto text-xs text-text-2 shrink-0" title={new Date(m.created_at).toLocaleString()}>{new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    )
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
    <div data-msg-id={m.id} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest('a, textarea, input, [data-msg-avatar], [data-msg-author]')) ctx.open(e, contextItems(e)) }} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, textarea, .uemoji, img.emoji')) setTapped((t) => !t) }} className={`group relative px-4 max-md:px-3 hover:bg-bg-0/30 ${mentioned ? 'msg-mentioned' : ''} ${tapped ? 'max-md:bg-bg-0/30' : ''} ${grouped || compact ? 'py-0.5' : 'mt-[17px] py-0.5'} ${m.reply_to ? 'pt-1' : ''}`}>
      {m.reply_to && (
        <div role="button" onClick={(e) => { if (onJumpToReply) { e.stopPropagation(); onJumpToReply() } }} data-reply-link={m.reply_to} className="ml-14 mb-0.5 flex items-center gap-1.5 text-xs text-text-2 cursor-pointer hover:text-text-0 before:content-[''] before:absolute before:left-9 before:top-2 before:h-3 before:w-6 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-bg-4" title="Jump to the original message">
          {replyTarget ? (<><Avatar user={replyTarget.author} size={16} /><span className="font-semibold text-text-1">{replyTarget.author.display_name}</span><span className="truncate max-w-md">{replyTarget.content || (replyTarget.attachments?.length ? '📎 Attachment' : '')}</span></>) : <i>Replying to an earlier message · click to jump</i>}
        </div>
      )}
      <div className={`flex ${compact ? 'gap-2' : 'gap-4 max-md:gap-3'}`}>
        {compact ? (
          <div className="w-12 max-md:w-10 shrink-0 text-right text-[11px] text-text-2 pt-[3px] select-none" data-msg-compact>{formatShortTime(m.created_at)}</div>
        ) : grouped ? (
          <div className="w-10 max-md:w-8 shrink-0 text-right text-[10px] text-text-2 opacity-0 group-hover:opacity-100 pt-1 select-none">{formatShortTime(m.created_at)}</div>
        ) : (
          <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} className="shrink-0 self-start" data-msg-avatar><Avatar user={m.author} size={40} /></button>
        )}
        <div className="min-w-0 flex-1">
          {!grouped && !compact && (
            <div className="flex items-baseline gap-2 leading-[1.375rem] h-[1.375rem]" data-msg-header>
              <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} data-msg-author className="font-semibold hover:underline leading-[1.375rem]"><StyledName userId={m.author.id} guildId={guildId}>{m.author.display_name}</StyledName></button>
              <span className="text-[11px] text-text-2">{formatTime(m.created_at)}</span>
            </div>
          )}
          {compact && (
            <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} data-msg-author className="float-left mr-2 font-semibold hover:underline leading-[1.375rem]"><StyledName userId={m.author.id} guildId={guildId}>{m.author.display_name}</StyledName></button>
          )}
          {editing ? (
            <div className="relative">
              <FormatToolbar textarea={editRef} onChange={setDraft} className="absolute -top-9 left-0 z-20" />
              <textarea ref={editRef} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKey} className="input mt-1 resize-none" rows={Math.min(8, draft.split('\n').length + 1)} />
              <p className="text-[11px] text-text-2 mt-1">escape to <button className="text-sky-400 hover:underline" onClick={() => { setEditing(false); setDraft(m.content) }}>cancel</button> • enter to <button className="text-sky-400 hover:underline" onClick={saveEdit}>save</button></p>
            </div>
          ) : (
            <>
              {m.forwarded_from && <div className="flex items-center gap-1 text-xs text-text-2 mt-0.5" data-forwarded><Forward size={13} /> Forwarded</div>}
              {(m.content || m.edited_at) && !media && (
                <div onClick={emojiHover.onClick} className={`msg-content text-[15px] leading-[1.375rem] text-text-0 break-words whitespace-pre-wrap ${isJumbo(m.content) ? 'jumbo' : ''}`}>
                  {renderMarkdown(m.content)}
                  {m.edited_at && <button type="button" onClick={(e) => { e.stopPropagation(); openModal({ kind: 'editHistory', channelId: m.channel_id, messageId: m.id }) }} title={`Edited ${new Date(m.edited_at).toLocaleString()} — click to see the history`} className="ml-1 text-[10px] text-text-2 hover:underline" data-edited>(edited)</button>}
                </div>
              )}
              {media && <MediaEmbed url={media} />}
              {link && <LinkEmbed url={link} />}
              {inviteCodes(m.content).map((code) => <InviteCard key={code} code={code} />)}
              {m.poll && <PollCard m={m} poll={m.poll} />}
              {m.thread && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setOpenThread(m.thread!.id) }} className="mt-1 flex max-w-[520px] items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-2 text-left text-sm hover:border-text-2" data-thread-card={m.thread.id} data-thread-count={m.thread.message_count}>
                  <MessagesSquare size={16} className="text-text-2 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{m.thread.name}</span>
                  <span className="text-xs text-text-2 shrink-0">{m.thread.message_count} message{m.thread.message_count === 1 ? '' : 's'}{m.thread.archived ? ' · archived' : ''}</span>
                  <span className="text-xs text-sky-400 shrink-0">View Thread ›</span>
                </button>
              )}
              {m.sticker && (
                <img src={m.sticker.url} alt={m.sticker.name} title={m.sticker.name} className="mt-1 h-40 w-40 object-contain" draggable={false} loading="lazy" data-msg-sticker={m.sticker.name} />
              )}
              <Attachments items={m.attachments ?? []} mine={isOwn} />
            </>
          )}
          {m.reactions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1" data-reactions>
              {m.reactions.map((r) => <ReactionChip key={r.emoji} r={r} message={m} canReact={canReact} onToggle={() => react(r.emoji, r.me)} />)}
              {canReact && (
                <button type="button" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} title="Add Reaction" data-add-reaction-chip
                  className="h-[26px] w-[34px] rounded-lg bg-[#2b2d31] border border-transparent text-text-2 hover:border-[#4e5058] hover:text-text-0 flex items-center justify-center">
                  <SmilePlus size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} label="Message" />}
      {emojiHover.tip}
      {!editing && (
        <div className={`absolute -top-3 right-4 max-md:right-2 hidden group-hover:flex ${tapped ? 'max-md:flex' : ''} items-center rounded-lg bg-bg-1 border border-line shadow-lg overflow-visible`}>
          {m.pinned_at && <span className="h-8 px-1.5 flex items-center text-text-2" title="Pinned"><Pin size={13} /></span>}
          {canReact && frequent.map((e) => <button key={e} title={`React with ${e}`} onClick={() => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} className="h-8 w-8 flex items-center justify-center text-base hover:bg-bg-3 first:rounded-l-lg" data-quick-react><Emoji value={e} size={20} /></button>)}
          {canReact && <div className="relative" ref={pickerAnchor}>
            <Tool label="Add Reaction" onClick={togglePicker}><SmilePlus size={16} /></Tool>
            {picker && (
              <ExpressionPicker tabs={['emoji']} anchor={picker} guildId={guildId ?? null} onClose={() => setPicker(null)}
                onEmoji={(e) => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} />
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

/** A message that is nothing but a link to an image/GIF (e.g. from the GIF picker) renders as the image. */
const MEDIA_HOSTS = /^https?:\/\/(media\.tenor\.com|c\.tenor\.com|media[0-9]*\.giphy\.com|i\.giphy\.com|i\.imgur\.com)\//i
function soleMediaUrl(content: string): string | null {
  const t = content.trim()
  if (!t || /\s/.test(t) || !/^https?:\/\//i.test(t)) return null
  const path = t.split(/[?#]/)[0]
  return /\.(gif|png|jpe?g|webp|avif)$/i.test(path) || MEDIA_HOSTS.test(t) ? t : null
}

function MediaEmbed({ url }: { url: string }) {
  const openModal = useStore((s) => s.openModal)
  const [failed, setFailed] = useState(false)
  if (failed) return <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">{url}</a>
  return (
    <button onClick={() => openModal({ kind: 'image', url, name: url.split('/').pop() ?? 'image' })} className="mt-1 block overflow-hidden rounded-lg bg-bg-0/40 border border-line hover:border-text-2 max-w-full" title={url} data-media-embed>
      <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="block max-h-[300px] max-w-[400px] object-contain" />
    </button>
  )
}

/** Discord-style reaction chip: emoji + count, highlighted when it's yours; hovering lists who reacted. */
function ReactionChip({ r, message: m, canReact, onToggle }: { r: { emoji: string; count: number; me: boolean }; message: Message; canReact: boolean; onToggle: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [who, setWho] = useState<{ id: string; display_name: string }[] | null>(null)
  const me = useStore((s) => s.user)
  useEffect(() => {
    if (!rect) return
    let live = true
    api.get<{ id: string; display_name: string }[]>(`/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(r.emoji)}`).then((u) => { if (live) setWho(u) }).catch(() => { if (live) setWho([]) })
    return () => { live = false }
  }, [rect, m.channel_id, m.id, r.emoji, r.count])
  const c = parseCustom(r.emoji)
  const name = c ? `:${c.name}:` : (() => { const i = unicodeInfo(r.emoji); return i ? `:${i.slug}:` : r.emoji })()
  // The chip's own `me` flag is authoritative; the fetched list can lag a toggle by a round trip.
  const others = (who ?? []).filter((u) => u.id !== me?.id).map((u) => u.display_name)
  const names = r.me ? [...others, 'You'] : others
  const text = names.length === 0 ? '' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : names.length === 3 ? `${names[0]}, ${names[1]}, and ${names[2]}` : `${names[0]}, ${names[1]}, and ${names.length - 2} others`
  return (
    <>
      <button type="button" disabled={!canReact && !r.me} onClick={() => { setRect(null); onToggle() }} data-reaction={r.emoji} onMouseEnter={(e) => { if (canHover()) setRect(e.currentTarget.getBoundingClientRect()) }} onMouseLeave={() => setRect(null)} onTouchStart={() => setRect(null)}
        className={`h-[26px] flex items-center gap-1.5 rounded-lg border px-1.5 text-sm transition ${r.me ? 'border-accent bg-accent/15 hover:bg-accent/25' : 'border-transparent bg-[#2b2d31] hover:border-[#4e5058]'}`}>
        <Emoji value={r.emoji} size={16} /><span className={`text-[13px] font-semibold ${r.me ? 'text-text-0' : 'text-text-1'}`}>{r.count}</span>
      </button>
      {rect && who && createPortal(
        <div role="tooltip" data-reaction-tip className="pop pointer-events-none fixed z-[150] max-w-[280px] rounded-lg bg-[#111214] border border-white/5 shadow-2xl p-3 flex items-center gap-3 text-sm"
          style={{ left: Math.min(Math.max(8, rect.left + rect.width / 2 - 140), window.innerWidth - 288), ...(rect.top > 120 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) }}>
          <Emoji value={r.emoji} size={40} />
          <div className="min-w-0"><span className="font-semibold text-text-0">{text}</span> <span className="text-text-1">reacted with {name}</span></div>
        </div>,
        document.body,
      )}
    </>
  )
}
