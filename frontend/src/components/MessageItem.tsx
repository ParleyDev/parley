import { AlarmClock, AppWindow, Check, Megaphone, Sparkles, ShieldAlert, ArrowLeftFromLine, ArrowRight, ChevronDown, Bookmark, BookmarkMinus, Copy, Flag, Forward, Hash, ImageIcon, Link2, Lock, MailOpen, MessagesSquare, MoreHorizontal, Pencil, Phone, PhoneMissed, Pin, PinOff, Reply, RotateCw, SmilePlus, Trash2, UserMinus, UserPlus, Volume2, Captions, EyeOff, X } from 'lucide-react'
import { isImage } from '../lib/upload'
import RoleIcon from './RoleIcon'
import { locale } from '../lib/i18n'
import { createPortal } from 'react-dom'
import { useLongPress } from '../lib/longPress'
import ContextMenu, { useContextMenu, type MenuEntry } from './ContextMenu'
import { useUserMenu } from './UserContextMenu'
import { ClanTag } from './Flair'
import { canHover } from './GuildBar'
import { useEmojiHover } from './EmojiHover'
import { emojiLabel, parseCustom } from '../lib/emoji'
import { recordEmoji } from '../lib/recentEmoji'
import { anchorOf } from '../lib/anchor'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { isBlocked, mentionsMe, myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { useAppearance } from '../lib/appearance'
import PollCard from './PollCard'
import LinkEmbed, { previewLinks } from './LinkEmbed'
import { remindLabel, remindPresets, setReminder } from '../lib/reminders'
import MessageLinkPreview, { messageLinks } from './MessageLinkPreview'
import { suggestReactions } from '../lib/suggestReactions'
import InviteCard, { inviteCodes } from './InviteCard'
import StyledName from './StyledName'
import { AvatarMotion, useHoverMotion } from '../lib/motion'
import type { SensitiveLevel, Message, ReplyRef } from '../lib/types'
import { formatShortTime, formatTime, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import Attachments, { MaybeBlurred } from './Attachments'
import { getPrefs, usePrefs } from '../lib/prefs'
import FrozenGif from './FrozenGif'
import Emoji from './Emoji'
import ExpressionPicker from './ExpressionPicker'
import RichEmbed from './RichEmbed'
import MessageComponents from './MessageComponents'
import { isJumbo } from '../lib/emoji'
import { api } from '../lib/api'
import { shortcutFormat, toggleWrap } from '../lib/editor'
import FormatToolbar from './FormatToolbar'
import { useParams } from 'react-router-dom'

interface Props { message: Message; grouped: boolean; isOwn: boolean; onReply: () => void; replyTarget: ReplyRef | null
  /** Reply header click: scroll to (and if needed load) the original message. */
  onJumpToReply?: () => void
}

export default function MessageItem({ message: m, grouped, isOwn, onReply, replyTarget, onJumpToReply }: Props) {
  const openModal = useStore((s) => s.openModal)
  const compact = useAppearance().density === 'compact'
  const setOpenThread = useStore((s) => s.setOpenThread)
  const chanKind = useStore((s) => s.channels[m.channel_id]?.kind)
  const chanNews = useStore((s) => !!s.channels[m.channel_id]?.news)
  const removeMessage = useStore((s) => s.removeMessage)
  const msgApps = useStore((s) => s.appCommands[m.channel_id])?.filter((c) => c.type === 3) ?? []
  const pushToast = useStore((s) => s.pushToast)
  const setReadState = useStore((s) => s.setReadState)
  const bookmarked = useStore((s) => !!s.bookmarks[m.id])
  const setBookmark = useStore((s) => s.setBookmark)
  const { guildId } = useParams()
  // Server profile avatar for the author, in this server.
  const serverAvatar = useStore((s) => (guildId ? s.members[guildId]?.[m.author.id]?.guild_avatar : undefined))
  // In a server, people show under their server nickname (like the member list).
  const serverNick = useStore((s) => (guildId ? s.members[guildId]?.[m.author.id]?.nickname : undefined))
  const authorName = serverNick || m.author.display_name
  const replyNick = useStore((s) => (guildId && replyTarget ? s.members[guildId]?.[replyTarget.author.id]?.nickname : undefined))
  const authorShown = serverAvatar ? { ...m.author, avatar_url: serverAvatar } : m.author
  const ctx = useContextMenu()
  const userMenu = useUserMenu(guildId ?? null)
  const emojiHover = useEmojiHover()
  const mentioned = useStore((s) => mentionsMe(s, m))
  const appUrl = useStore((s) => s.instance.app_url)
  const perms = useStore((s) => myChannelPerms(s, m.channel_id))
  // Moderation only exists inside servers; in DMs and group chats you can delete just your own messages.
  const canDelete = isOwn || (guildId !== undefined && has(perms, P.MANAGE_MESSAGES))
  const canReact = has(perms, P.ADD_REACTIONS)
  const canPin = m.channel_id && (guildId === undefined || has(perms, P.MANAGE_MESSAGES))
  // Announcement channels: publish a post to the channels following this one (your own, or anyone's with Manage Messages).
  const canPublish = chanNews && (!m.kind || m.kind === 'default') && !m.crosspost?.published && !m.local && (isOwn || has(perms, P.MANAGE_MESSAGES))
  const publish = async () => { try { const r = await api.post<{ channels: number }>(`/channels/${m.channel_id}/messages/${m.id}/crosspost`); pushToast(r.channels ? `Published to ${r.channels} channel${r.channels === 1 ? '' : 's'}` : 'Published') } catch (e) { pushToast((e as Error).message, 'error') } }
  const [more, setMore] = useState(false)
  const frequent = useMemo(() => suggestReactions(m, 3, 1), [m])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  // The full emoji picker is portalled beside the hover bar so the scrolling list never clips it.
  const [picker, setPicker] = useState<DOMRect | null>(null)
  const [superPicker, setSuperPicker] = useState<DOMRect | null>(null)
  const [pickerUp, setPickerUp] = useState(true)
  const pickerAnchor = useRef<HTMLDivElement>(null)
  const togglePicker = () => setPicker((p) => (p ? null : pickerAnchor.current?.getBoundingClientRect() ?? null))
  // Phones have no hover: tapping the message body toggles the action bar. Only one message is selected at a time, and
  // a tap anywhere outside it (another message, the composer, the header) closes it.
  const tapped = useStore((s) => s.tappedMessage === m.id)
  const setTappedMessage = useStore((s) => s.setTappedMessage)
  // Avatars and decorations play while the message is hovered, focused, tapped (phones) or flashed after a jump.
  const [hovering, motionBind] = useHoverMotion()
  const [flash, setFlash] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rowRef.current; if (!el) return
    let t: ReturnType<typeof setTimeout> | undefined
    const on = () => { setFlash(true); clearTimeout(t); t = setTimeout(() => setFlash(false), 1800) }
    el.addEventListener('msgflash', on)
    return () => { el.removeEventListener('msgflash', on); clearTimeout(t) }
  }, [])
  useEffect(() => {
    if (!tapped) return
    const outside = (e: PointerEvent) => {
      // The emoji picker and the More menu handle their own dismissal.
      if (picker || more || rowRef.current?.contains(e.target as Node)) return
      setTappedMessage(null)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [tapped, picker, more, setTappedMessage])
  // Leaving the channel (or the message being deleted) drops the selection with it.
  useEffect(() => () => { if (useStore.getState().tappedMessage === m.id) useStore.getState().setTappedMessage(null) }, [m.id])
  const motion = hovering || flash || (tapped && !canHover())
  const blocked = useStore((s) => isBlocked(s, m.author.id))
  const ignored = useStore((s) => !!s.user?.ignored_users?.includes(m.author.id))
  const [revealed, setRevealed] = useState(false)
  // Join notices can offer "Wave to say hi" (Server Settings › Overview); a wave is a 👋 reply to the notice.
  const joinWave = useStore((s) => (guildId ? s.guilds[guildId]?.join_wave ?? true : false))
  const sendMessage = useStore((s) => s.sendMessage)
  const [waved, setWaved] = useState(false)
  const wave = async () => { setWaved(true); try { await sendMessage(m.channel_id, '👋', m.id) } catch (e) { setWaved(false); pushToast((e as Error).message, 'error') } }

  // "Remove embeds": the author, or a moderator in a server.
  const canSuppress = isOwn || (guildId !== undefined && has(perms, P.MANAGE_MESSAGES))
  const setSuppressed = async (on: boolean) => { try { await api.patch(`/channels/${m.channel_id}/messages/${m.id}`, { suppress_embeds: on }) } catch (e) { pushToast((e as Error).message, 'error') } }
  const pictures = (m.attachments ?? []).filter((a) => isImage(a.content_type))
  // Up arrow in an empty composer opens your last message here, with the caret at the end.
  const editRequested = useStore((s) => s.editTarget === m.id)
  useEffect(() => {
    if (!editRequested) return
    useStore.getState().setEditTarget(null)
    setDraft(m.content); setEditing(true)
    requestAnimationFrame(() => {
      const el = editRef.current; if (!el) return
      el.focus(); el.setSelectionRange(el.value.length, el.value.length)
      rowRef.current?.scrollIntoView({ block: 'nearest' })
    })
  }, [editRequested, m.content])
  // Finishing an edit from the keyboard goes back to the composer, as it does in Discord.
  const backToComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer-box] textarea')?.focus())
  const saveEdit = async () => {
    const c = draft.trim()
    setEditing(false)
    if (!c || c === m.content) return
    try { await api.patch(`/channels/${m.channel_id}/messages/${m.id}`, { content: c }) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); backToComposer() }
    if (e.key === 'Escape') { setEditing(false); setDraft(m.content); backToComposer() }
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
  const react = async (emoji: string, has: boolean, burst = false) => {
    setPicker(null); setSuperPicker(null)
    const path = `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}${burst ? '?burst=true' : ''}`
    if (!has) recordEmoji(emoji)
    try { has ? await api.delete(path) : await api.put(path) } catch (e) { pushToast((e as Error).message, 'error') }
  }

  const prefs = usePrefs()
  // Touch screens: double-tap a message to react with your quick reaction (Chat settings).
  const lastTap = useRef(0)
  // Phones: hold a message for its actions as a bottom sheet (ContextMenu renders as one on touch phones).
  const longPress = useLongPress((at) => { if (m.local || m.ephemeral) return; setTappedMessage(null); ctx.open(at, contextItems(at)) })
  const onTap = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !prefs.doubleTapReact || !canReact || m.local || m.ephemeral) return
    if ((e.target as HTMLElement).closest('button, a, textarea, input, img, video')) return
    const now = Date.now()
    if (now - lastTap.current < 320) { lastTap.current = 0; const q = prefs.quickReaction; void react(q, !!m.reactions.find((r) => r.emoji === q && r.me)) }
    else lastTap.current = now
  }
  const media = soleMediaUrl(m.content)
  const links = media ? [] : previewLinks(m.content)
  const link = links[0] ?? null
  // Sensitive media: blur pictures and videos from non-friends in DMs, and in age-restricted channels, by preference.
  // Spoiler channels hide every picture and video behind a click.
  const spoilerChannel = useStore((s) => !!s.channels[m.channel_id]?.spoiler)
  const mediaLevel = useStore((s): SensitiveLevel => {
    if (isOwn) return 'show'
    const pref = s.user?.sensitive_media ?? {}
    if (s.dms[m.channel_id]) return (s.relationships[m.author.id]?.kind === 'friend' ? pref.friend_dms : pref.non_friend_dms) ?? 'show'
    return (s.channels[m.channel_id]?.nsfw ? pref.restricted : pref.servers) ?? 'show'
  })
  const sensitive = mediaLevel === 'blur'
  const blockMedia = mediaLevel === 'block'
  // The server's explicit image filter: for everyone, or for members without roles.
  const enforcedFilter = useStore((s) => {
    const gid = s.channels[m.channel_id]?.guild_id
    if (!gid || isOwn) return false
    const f = s.guilds[gid]?.explicit_filter
    return f === 'all' || (f === 'no_roles' && !(s.members[gid]?.[m.author.id]?.roles?.length))
  })

  /** Right-click menu (Discord layout): quick reactions, Add Reaction, Reply, Edit, Copy Text, Pin, Mark Unread, Copy Link, Speak, Delete, Copy ID. */
  // Voice messages without a usable transcript (never attempted, failed, or empty) can be (re)transcribed.
  const voiceNeedingText = (m.attachments ?? []).filter((a) => a.duration_ms && a.transcript_status !== 'pending' && !(a.transcript_status === 'done' && a.transcript))
  const transcriptionOn = useStore((s) => s.instance.transcription)
  const contextItems = (e: { clientX: number; clientY: number }): MenuEntry[] => {
    const quick = suggestReactions(m, 4, 2)
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
      ...(canReact ? [{ label: 'Add Reaction', icon: <SmilePlus size={16} />, onClick: () => setPicker(anchorRect) }, { label: 'Add Super Reaction', icon: <Sparkles size={16} />, onClick: () => setSuperPicker(anchorRect) }] : []),
      'sep' as const,
      { label: 'Reply', icon: <Reply size={16} />, onClick: onReply },
      ...(guildId && chanKind === 'text' && !m.thread && m.kind !== 'default' ? [] : guildId && chanKind === 'text' && !m.thread ? [{ label: 'Create Thread', icon: <MessagesSquare size={16} />, onClick: () => openModal({ kind: 'createThread', channelId: m.channel_id, messageId: m.id, suggested: m.content.replace(/\s+/g, ' ').trim().slice(0, 60) }) }] : []),
      { label: 'Forward', icon: <Forward size={16} />, onClick: () => openModal({ kind: 'forward', message: m }) },
      ...(msgApps.length ? [{ label: 'Apps', icon: <AppWindow size={16} />, children: msgApps.map((c) => ({ label: c.name, onClick: () => { void api.post('/interactions', { command_id: c.id, channel_id: m.channel_id, target_id: m.id }).catch((e: Error) => pushToast(e.message, 'error')) } })) }] : []),
      ...(canPublish ? [{ label: 'Publish', icon: <Megaphone size={16} />, onClick: publish }] : []),
      ...(isOwn ? [{ label: 'Edit Message', icon: <Pencil size={16} />, onClick: () => { setDraft(m.content); setEditing(true) } }] : []),
      ...(isOwn && pictures.length ? [{ label: 'Edit Attachments', icon: <ImageIcon size={16} />, onClick: () => openModal({ kind: 'altText', message: m }) }] : []),
      ...(m.reactions.length ? [{ label: 'View Reactions', icon: <SmilePlus size={16} />, onClick: () => openModal({ kind: 'reactions', channelId: m.channel_id, messageId: m.id }) }] : []),
      ...(canSuppress && (link || media) ? [{ label: m.suppress_embeds ? 'Show Embeds' : 'Remove Embeds', icon: <EyeOff size={16} />, onClick: () => setSuppressed(!m.suppress_embeds) }] : []),
      'sep' as const,
      ...(voiceNeedingText.length ? [{ label: voiceNeedingText.some((a) => a.transcript_status === 'failed') ? 'Retry transcript' : 'Generate transcript', icon: <Captions size={16} />, disabled: transcriptionOn === false, onClick: () => { void Promise.all(voiceNeedingText.map((a) => api.post(`/attachments/${a.id}/transcribe`, {}))).then(() => pushToast('Transcribing…')).catch((e: Error) => pushToast(e.message, 'error')) } }] : []),
      { label: 'Copy Text', icon: <Copy size={16} />, onClick: () => copy('Text', m.content) },
      bookmarked ? { label: 'Remove Bookmark', icon: <BookmarkMinus size={16} />, onClick: toggleBookmark } : { label: 'Bookmark Message', icon: <Bookmark size={16} />, onClick: toggleBookmark },
      ...(canPin ? [{ label: m.pinned_at ? 'Unpin Message' : 'Pin Message', icon: m.pinned_at ? <PinOff size={16} /> : <Pin size={16} />, onClick: togglePin }] : []),
      { label: 'Remind Me', icon: <AlarmClock size={16} />, children: remindPresets().map((p) => ({ label: p.label, onClick: () => { setReminder(m.id, p.at).then((at) => pushToast(`I'll remind you ${at ? remindLabel(at) : ''}`)).catch((err: Error) => pushToast(err.message, 'error')) } })) },
      { label: 'Mark Unread', icon: <MailOpen size={16} />, onClick: markUnread },
      { label: 'Copy Message Link', icon: <Link2 size={16} />, onClick: () => copy('Message link', link) },
      ...(m.content && 'speechSynthesis' in window ? [{ label: 'Speak Message', icon: <Volume2 size={16} />, onClick: () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(`${authorName} said ${m.content}`)) } }] : []),
      ...(canDelete ? ['sep' as const, { label: 'Delete Message', icon: <Trash2 size={16} />, danger: true, onClick: del }] : []),
      ...(!isOwn ? [{ label: 'Report Message', icon: <Flag size={16} />, danger: true, onClick: () => openModal({ kind: 'report', messageId: m.id, userId: m.author.id, name: authorName, guildId: guildId ?? null }) }] : []),
      ...(prefs.developerMode ? ['sep' as const, { label: 'Copy Message ID', icon: <Hash size={16} />, onClick: () => copy('Message ID', m.id) }] : []),
    ]
  }

  if (m.kind === 'ribbit') return <RibbitNotice m={m} />

  if (m.kind === 'member_join') {
    const [before, after] = joinGreeting(m.id)
    const name = <button type="button" className="font-medium text-text-0 hover:underline" onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, w: 0, h: 0 } })} data-msg-author>{authorName}</button>
    return (
      <div className="group px-4 max-md:px-3 py-1.5 mt-2 flex items-center gap-3 text-[15px] text-text-2" data-msg-id={m.id} data-system={m.kind}>
        <span className="w-10 flex justify-center shrink-0"><UserPlus size={16} className="text-success" /></span>
        <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-join-greeting>{before}{name}{after}</span>
          {joinWave && !isOwn && canReact && (
            <button type="button" onClick={wave} disabled={waved} className="inline-flex items-center gap-1 rounded-md border border-line bg-bg-3 px-2 py-0.5 text-sm text-text-1 hover:bg-bg-4 disabled:opacity-60" data-wave>
              <span aria-hidden>👋</span> {waved ? 'Waved' : 'Wave to say hi!'}
            </button>
          )}
        </span>
        <span className="ml-auto text-xs text-text-2 shrink-0" title={new Date(m.created_at).toLocaleString()}>{new Date(m.created_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    )
  }

  if (m.kind && m.kind !== 'default') {
    const icon = m.kind === 'recipient_add' || m.kind === 'member_join' ? <UserPlus size={16} className="text-success" />
      : m.kind === 'recipient_remove' || m.kind === 'recipient_leave' ? <UserMinus size={16} className="text-danger" />
      : m.kind === 'channel_icon_change' ? <ImageIcon size={16} className="text-text-2" />
      : m.kind === 'pins_add' ? <Pin size={16} className="text-text-2" />
      : m.kind === 'call_e2ee_change' ? <Lock size={16} className="text-success" />
      : m.kind === 'thread_created' ? <MessagesSquare size={16} className="text-text-2" />
      : m.kind === 'channel_follow' ? <Megaphone size={16} className="text-text-2" />
      : m.kind === 'call_started' || m.kind === 'call_ended' ? <Phone size={16} className="text-success" />
      : m.kind === 'call_missed' ? <PhoneMissed size={16} className="text-danger" />
      : <ArrowLeftFromLine size={16} className="text-text-2" />
    // thread_created: "started a thread: <name>" with the name as a link that opens the thread.
    const threadName = m.kind === 'thread_created' ? m.content.replace(/^started a thread: /, '') : null
    // AutoMod alerts: the rule, who, where and what, with mentions rendered.
    if (m.kind === 'automod_alert') {
      return (
        <div className="mx-4 max-md:mx-3 my-1 flex items-start gap-3 rounded-lg border-l-4 border-warn bg-warn/5 px-3 py-2 text-[15px] text-text-1" data-msg-id={m.id} data-system={m.kind}>
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <span className="msg-content min-w-0 break-words">{renderMarkdown(m.content)}</span>
          <span className="ml-auto text-xs text-text-2 shrink-0">{new Date(m.created_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      )
    }
    // A missed call reads from the receiver's side: "You missed a call from Alice."
    if (m.kind === 'call_missed' && !isOwn) {
      return (
        <div className="px-4 max-md:px-3 py-1.5 mt-2 flex items-center gap-3 text-[15px] text-text-2" data-msg-id={m.id} data-system={m.kind}>
          <span className="w-10 flex justify-center shrink-0">{icon}</span>
          <span className="min-w-0">You missed a call from <button type="button" className="font-medium text-text-0 hover:underline" onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, w: 0, h: 0 } })} data-msg-author>{authorName}</button>.</span>
          <span className="ml-auto text-xs text-text-2 shrink-0" title={new Date(m.created_at).toLocaleString()}>{new Date(m.created_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      )
    }
    return (
      <div className="px-4 max-md:px-3 py-1.5 mt-2 flex items-center gap-3 text-[15px] text-text-2" data-msg-id={m.id} data-system={m.kind}>
        <span className="w-10 flex justify-center shrink-0">{icon}</span>
        <span className="min-w-0"><button type="button" className="font-medium text-text-0 hover:underline" onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, w: 0, h: 0 } })} data-msg-author>{authorName}</button>{' '}
          {m.kind === 'channel_follow' ? <span className="msg-content">{renderMarkdown(m.content)}</span> : threadName !== null ? (<>started a thread: <button type="button" className="font-medium text-text-0 hover:underline" onClick={() => m.ref_id && setOpenThread(m.ref_id)} data-system-thread={m.ref_id ?? ''}>{threadName}</button></>) : m.content}
          {m.kind === 'pins_add' && m.reply_to && onJumpToReply && (
            <button type="button" onClick={onJumpToReply} className="ml-2 inline-flex items-center gap-0.5 text-xs text-sky-400 hover:underline" data-system-jump={m.reply_to}>See the message <ArrowRight size={12} /></button>
          )}
        </span>
        <span className="ml-auto text-xs text-text-2 shrink-0" title={new Date(m.created_at).toLocaleString()}>{new Date(m.created_at).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    )
  }

  if ((blocked || ignored) && !revealed) {
    return (
      <div className="px-4 max-md:px-3 py-1 flex items-center gap-2 text-xs text-text-2" data-msg-id={m.id} data-hidden-msg={blocked ? 'blocked' : 'ignored'}>
        <span className="flex-1 border-t border-line" />
        <span>1 {blocked ? 'blocked' : 'ignored'} message</span>
        <button onClick={() => setRevealed(true)} className="text-sky-400 hover:underline">Show message</button>
        <span className="flex-1 border-t border-line" />
      </div>
    )
  }
  return (
    <AvatarMotion.Provider value={motion}>
    <div ref={rowRef} {...motionBind} tabIndex={-1} aria-label={`${authorName}: ${m.content.slice(0, 200)}`} onPointerDown={longPress.bind.onPointerDown} onPointerMove={longPress.bind.onPointerMove} onPointerCancel={longPress.bind.onPointerCancel} onPointerUp={(e) => { longPress.bind.onPointerUp(); onTap(e) }} data-msg-id={m.id} data-local={m.local} data-can-moderate={guildId !== undefined && has(perms, P.MANAGE_MESSAGES) ? '1' : '0'} onContextMenu={(e) => { if (m.local || m.ephemeral || longPress.isTouch()) { e.preventDefault(); return } if (!(e.target as HTMLElement).closest('a, textarea, input, [data-msg-avatar], [data-msg-author]')) ctx.open(e, contextItems(e)) }} onClick={(e) => { if (longPress.fired()) { e.preventDefault(); return } if (!(e.target as HTMLElement).closest('button, a, textarea, .uemoji, img.emoji')) setTappedMessage(tapped ? null : m.id) }} className={`group relative px-4 max-md:px-3 hover:bg-bg-0/30 ${mentioned ? 'msg-mentioned' : ''} ${tapped ? 'max-md:bg-bg-0/30' : ''} ${grouped || compact ? 'py-0.5' : 'msg-group-start py-0.5'} ${m.reply_to ? 'pt-1' : ''}`}>
      {m.interaction && (
        <div className="ml-14 mb-0.5 flex items-center gap-1.5 text-xs text-text-2 before:content-[''] before:absolute before:left-9 before:top-2 before:h-3 before:w-6 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-bg-4" data-interaction-header={m.interaction.name}>
          <span className="font-semibold text-text-1">{m.interaction.user.display_name}</span> used <span className="font-semibold text-sky-400">/{m.interaction.name}</span>
        </div>
      )}
      {m.reply_to && (
        <div role="button" onClick={(e) => { if (onJumpToReply) { e.stopPropagation(); onJumpToReply() } }} data-reply-link={m.reply_to} className="ml-14 mb-0.5 flex items-center gap-1.5 text-xs text-text-2 cursor-pointer hover:text-text-0 before:content-[''] before:absolute before:left-9 before:top-2 before:h-3 before:w-6 before:rounded-tl-md before:border-l-2 before:border-t-2 before:border-bg-4" title="Jump to the original message">
          {replyTarget ? (<><Avatar user={replyTarget.author} size={16} /><span className="font-semibold text-text-1">{replyNick || replyTarget.author.display_name}</span><span className="truncate max-w-md" data-reply-preview>{replyTarget.content || ((replyTarget.attachments?.length ?? replyTarget.attachment_count ?? 0) > 0 ? '📎 Attachment' : '')}</span></>) : <i data-reply-preview="deleted">Original message was deleted</i>}
        </div>
      )}
      <div className={`flex ${compact ? 'gap-2' : 'gap-4 max-md:gap-3'}`}>
        {compact ? (
          <div className="w-12 max-md:w-10 shrink-0 text-right text-[11px] text-text-2 pt-[3px] select-none" data-msg-compact>{formatShortTime(m.created_at)}</div>
        ) : grouped ? (
          <div className="w-10 max-md:w-8 shrink-0 text-right text-[10px] text-text-2 opacity-0 group-hover:opacity-100 pt-1 select-none">{formatShortTime(m.created_at)}</div>
        ) : (
          <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} className="shrink-0 self-start" data-msg-avatar><Avatar user={authorShown} size={40} /></button>
        )}
        <div className="min-w-0 flex-1">
          {!grouped && !compact && (
            <div className="flex items-baseline gap-2 leading-[1.375rem] h-[1.375rem]" data-msg-header>
              <button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} data-msg-author className="font-semibold hover:underline leading-[1.375rem]"><StyledName userId={m.author.id} guildId={guildId}>{authorName}</StyledName></button><RoleIcon guildId={guildId} userId={m.author.id} />
              <ClanTag userId={m.author.id} tag={m.author.clan_tag} tagGuild={m.author.clan_tag_guild} />
              {m.author.bot && <span className="inline-flex items-center gap-0.5 rounded bg-accent px-1 py-px text-[10px] font-bold uppercase text-white" data-bot-tag={m.author.verified_bot ? 'verified' : ''} title={m.author.verified_bot ? 'Verified bot' : undefined}>{m.author.verified_bot && <Check size={10} strokeWidth={3} />}Bot</span>}
              <span className="text-[11px] text-text-2">{formatTime(m.created_at)}</span>
            </div>
          )}
          {compact && prefs.compactAvatars && <span className="float-left mr-2 mt-0.5" data-compact-avatar><Avatar user={authorShown} size={20} /></span>}
          {compact && (
            <><button onClick={(e) => openModal({ kind: 'profile', userId: m.author.id, anchor: anchorOf(e) })} onContextMenu={(e) => ctx.open(e, userMenu(m.author, e.currentTarget.getBoundingClientRect()))} data-msg-author className="float-left mr-1.5 font-semibold hover:underline leading-[1.375rem]"><StyledName userId={m.author.id} guildId={guildId}>{authorName}</StyledName></button><span className="float-left mr-1.5"><RoleIcon guildId={guildId} userId={m.author.id} /></span></>
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
              {m.crosspost?.channel_name && <div className="flex items-center gap-1 text-xs text-text-2 mt-0.5" data-crosspost-from={m.crosspost.channel_id}><Megaphone size={13} /><span className="rounded bg-accent/80 px-1 text-[10px] font-bold uppercase text-white">Server</span> {m.crosspost.guild_name} · #{m.crosspost.channel_name}</div>}
              {(m.content || m.edited_at) && !media && (
                <div onClick={emojiHover.onClick} className={`msg-content text-[15px] leading-[1.375rem] break-words whitespace-pre-wrap ${m.local === 'failed' ? 'text-danger' : 'text-text-0'} ${isJumbo(m.content) ? 'jumbo' : ''}`}>
                  {renderMarkdown(m.content)}
                  {m.crosspost?.published && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-text-2" title="Published to following channels" data-published><Megaphone size={10} />published</span>}
                  {m.edited_at && <button type="button" onClick={(e) => { e.stopPropagation(); openModal({ kind: 'editHistory', channelId: m.channel_id, messageId: m.id }) }} title={`Edited ${new Date(m.edited_at).toLocaleString()} — click to see the history`} className="ml-1 text-[10px] text-text-2 hover:underline" data-edited>(edited)</button>}
                </div>
              )}
              {blockMedia && (media || links.length > 0 || (m.attachments ?? []).some((a) => /^(image|video)\//.test(a.content_type))) && <div className="mt-1 text-xs text-text-2 italic" data-media-blocked>Media hidden by your Content & Social settings.</div>}
              {media && !blockMedia && (prefs.linkMedia && !m.suppress_embeds ? <MaybeBlurred on={sensitive}><MediaEmbed url={media} /></MaybeBlurred> : <a href={media} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all" data-media-link>{media}</a>)}
              {m.interaction?.deferred && <div className="flex items-center gap-1.5 text-sm italic text-text-2" data-interaction-thinking><span className="inline-flex gap-0.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-2" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-2 [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-2 [animation-delay:300ms]" /></span>{authorName} is thinking…</div>}
              {m.embeds?.map((e, i) => <RichEmbed key={i} e={e} />)}
              {m.components && m.components.length > 0 && <MessageComponents m={m} />}
              {m.ephemeral && <div className="mt-1 flex items-center gap-1 text-xs text-text-2" data-ephemeral><EyeOff size={12} />Only you can see this · <button type="button" className="text-sky-400 hover:underline" onClick={() => removeMessage(m.channel_id, m.id)} data-ephemeral-dismiss>Dismiss message</button></div>}
              {link && !blockMedia && prefs.embeds && !m.suppress_embeds && (
                <div className="group/embed relative w-fit max-w-full" data-embed-wrap>
                  {links.map((l) => <MaybeBlurred key={l} on={sensitive}><LinkEmbed url={l} /></MaybeBlurred>)}
                  {canSuppress && <button type="button" onClick={() => setSuppressed(true)} className="absolute right-1 top-1 rounded bg-bg-0/80 p-1 text-text-2 opacity-0 hover:text-text-0 group-hover/embed:opacity-100 focus:opacity-100" title="Remove embed" aria-label="Remove embed" data-remove-embed><X size={14} /></button>}
                </div>
              )}
              {inviteCodes(m.content, [appUrl]).map((code) => <InviteCard key={code} code={code} />)}
              {!m.suppress_embeds && messageLinks(m.content).filter((l) => l.messageId !== m.id).map((l) => <MessageLinkPreview key={l.messageId} link={l} />)}
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
                m.sticker.animated && prefs.stickerAnimation !== 'always'
                  ? <FrozenGif src={m.sticker.url} alt={m.sticker.name} title={m.sticker.name} className="mt-1 h-40 w-40 object-contain" mode={prefs.stickerAnimation === 'never' ? 'never' : 'hover'} data-msg-sticker={m.sticker.name} />
                  : <img src={m.sticker.url} alt={m.sticker.name} title={m.sticker.name} className="mt-1 h-40 w-40 object-contain" draggable={false} loading="lazy" data-msg-sticker={m.sticker.name} />
              )}
              <Attachments items={blockMedia ? (m.attachments ?? []).filter((a) => !/^(image|video)\//.test(a.content_type)) : spoilerChannel ? (m.attachments ?? []).map((a) => (/^(image|video)\//.test(a.content_type) && !a.filename.startsWith('SPOILER_') ? { ...a, filename: `SPOILER_${a.filename}` } : a)) : m.attachments ?? []} mine={isOwn} sensitive={mediaLevel === 'filter' ? 'filter' : sensitive} enforced={enforcedFilter} />
            </>
          )}
          {m.reactions.length > 0 && prefs.showReactions && (
            <div className="mt-1.5 flex flex-wrap gap-1" data-reactions>
              {m.reactions.map((r) => <ReactionChip key={`${r.emoji}:${r.burst ? 1 : 0}`} r={r} message={m} canReact={canReact} onToggle={() => react(r.emoji, r.me, !!r.burst)} />)}
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
      {!editing && m.local === 'failed' && <FailedActions m={m} tapped={tapped} />}
      {!editing && !m.local && !m.ephemeral && (
        <div className={`absolute -top-3 right-4 max-md:right-2 hidden group-hover:flex ${tapped ? 'max-md:flex' : ''} items-center rounded-lg bg-bg-1 border border-line shadow-lg overflow-visible`}>
          {m.pinned_at && <span className="h-8 px-1.5 flex items-center text-text-2" title="Pinned"><Pin size={13} /></span>}
          {canReact && frequent.map((e) => <button key={e} title={`React with ${e}`} onClick={() => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} className="h-8 w-8 flex items-center justify-center text-base hover:bg-bg-3 first:rounded-l-lg" data-quick-react><Emoji value={e} size={20} /></button>)}
          {canReact && <div className="relative" ref={pickerAnchor}>
            <Tool label="Add Reaction" onClick={togglePicker}><SmilePlus size={16} /></Tool>
            {superPicker && (
              <ExpressionPicker tabs={['emoji']} anchor={superPicker} guildId={guildId ?? null} onClose={() => setSuperPicker(null)}
                onEmoji={(e) => react(e, !!m.reactions.find((r) => r.emoji === e && r.burst && r.me), true)} />
            )}
            {picker && (
              <ExpressionPicker tabs={['emoji']} anchor={picker} guildId={guildId ?? null} onClose={() => setPicker(null)}
                onEmoji={(e) => react(e, !!m.reactions.find((r) => r.emoji === e && r.me))} />
            )}
          </div>}
          {canPublish && <Tool label="Publish" onClick={publish}><span data-publish><Megaphone size={16} /></span></Tool>}
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
    </AvatarMotion.Provider>
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
      {(/\.gif(?:$|[?#])/i.test(url) || /tenor|giphy/i.test(url)) && !getPrefs().autoplayGifs
        ? <FrozenGif src={url} alt="" className="block max-h-[300px] max-w-[400px] object-contain" />
        : <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="block max-h-[300px] max-w-[400px] object-contain" />}
    </button>
  )
}

/** Discord-style reaction chip: emoji + count, highlighted when it's yours; hovering lists who reacted. */
function ReactionChip({ r, message: m, canReact, onToggle }: { r: { emoji: string; count: number; me: boolean; burst?: boolean }; message: Message; canReact: boolean; onToggle: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Super reactions burst when someone adds one (not when the chip first appears with history).
  const [bursting, setBursting] = useState(0)
  const lastCount = useRef(r.count)
  useEffect(() => {
    if (r.burst && r.count > lastCount.current) { setBursting((n) => n + 1); const t = setTimeout(() => setBursting(0), 900); lastCount.current = r.count; return () => clearTimeout(t) }
    lastCount.current = r.count
  }, [r.burst, r.count])
  const [who, setWho] = useState<{ id: string; display_name: string }[] | null>(null)
  const me = useStore((s) => s.user)
  useEffect(() => {
    if (!rect) return
    let live = true
    api.get<{ id: string; display_name: string }[]>(`/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(r.emoji)}${r.burst ? '?burst=true' : ''}`).then((u) => { if (live) setWho(u) }).catch(() => { if (live) setWho([]) })
    return () => { live = false }
  }, [rect, m.channel_id, m.id, r.emoji, r.count, r.burst])
  const c = parseCustom(r.emoji)
  const name = c ? `:${c.name}:` : emojiLabel(r.emoji)
  // The chip's own `me` flag is authoritative; the fetched list can lag a toggle by a round trip.
  const others = (who ?? []).filter((u) => u.id !== me?.id).map((u) => u.display_name)
  const names = r.me ? [...others, 'You'] : others
  const text = names.length === 0 ? '' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : names.length === 3 ? `${names[0]}, ${names[1]}, and ${names[2]}` : `${names[0]}, ${names[1]}, and ${names.length - 2} others`
  return (
    <>
      <button type="button" disabled={!canReact && !r.me} onClick={() => { setRect(null); onToggle() }} data-reaction={r.emoji} data-reaction-burst={r.burst ? '1' : undefined} onMouseEnter={(e) => { if (canHover()) setRect(e.currentTarget.getBoundingClientRect()) }} onMouseLeave={() => setRect(null)} onTouchStart={() => setRect(null)}
        className={`relative h-[26px] flex items-center gap-1.5 rounded-lg border px-1.5 text-sm transition ${r.burst ? 'super-reaction ' : ''}${r.me ? 'border-accent bg-accent/15 hover:bg-accent/25' : 'border-transparent bg-[#2b2d31] hover:border-[#4e5058]'}`}>
        <Emoji value={r.emoji} size={16} /><span className={`text-[13px] font-semibold ${r.me ? 'text-text-0' : 'text-text-1'}`}>{r.count}</span>
        {bursting > 0 && <span key={bursting} className="burst-fx pointer-events-none absolute inset-0" aria-hidden data-burst-fx>{Array.from({ length: 8 }, (_, i) => <span key={i} className="burst-particle" style={{ '--a': `${i * 45}deg` } as React.CSSProperties}><Emoji value={r.emoji} size={12} /></span>)}</span>}
      </button>
      {rect && who && createPortal(
        <div role="tooltip" data-reaction-tip className="pop pointer-events-none fixed z-[150] max-w-[280px] rounded-lg bg-[#111214] border border-white/5 shadow-2xl p-3 flex items-center gap-3 text-sm"
          style={{ left: Math.min(Math.max(8, rect.left + rect.width / 2 - 140), window.innerWidth - 288), ...(rect.top > 120 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) }}>
          <Emoji value={r.emoji} size={40} />
          <div className="min-w-0"><span className="font-semibold text-text-0">{text}</span> <span className="text-text-1">{r.burst ? 'super reacted with' : 'reacted with'} {name}</span></div>
        </div>,
        document.body,
      )}
    </>
  )
}


/** Hover bar for a message the server refused: send it again or drop it. */
function FailedActions({ m, tapped }: { m: Message; tapped: boolean }) {
  const retryLocal = useStore((s) => s.retryLocal)
  const discardLocal = useStore((s) => s.discardLocal)
  const [busy, setBusy] = useState(false)
  return (
    <div className={`absolute -top-3 right-4 max-md:right-2 hidden group-hover:flex ${tapped ? 'max-md:flex' : ''} items-center rounded-lg bg-bg-1 border border-line shadow-lg`} data-failed-actions>
      <Tool label={busy ? 'Retrying…' : 'Retry'} onClick={() => { if (busy) return; setBusy(true); retryLocal(m.channel_id, m.id).finally(() => setBusy(false)) }}><RotateCw size={16} className={busy ? 'animate-spin' : ''} /></Tool>
      <Tool label="Delete" danger onClick={() => discardLocal(m.channel_id, m.id)}><Trash2 size={16} /></Tool>
    </div>
  )
}

const DELIVERY_REASONS = [
  'The recipient has blocked you, or you have blocked them.',
  'You no longer share a server with the recipient and are not friends.',
  'The recipient only accepts direct messages from friends.',
  'The recipient\'s account was deleted or suspended.',
  'Your account is restricted from sending direct messages.',
]

/** Ribbit, the in-app helper: explains why a DM was not delivered. Only the sender sees it. */
function RibbitNotice({ m }: { m: Message }) {
  const discardLocal = useStore((s) => s.discardLocal)
  const [reasons, setReasons] = useState(false)
  return (
    <div className="group relative mt-[17px] py-2 pl-[14px] pr-4 max-md:pl-[10px] max-md:pr-3 border-l-2 border-accent bg-accent/10" data-msg-id={m.id} data-ribbit data-local="notice">
      <div className="flex gap-4 max-md:gap-3">
        <img src={m.author.avatar_url ?? ''} alt="" className="h-10 w-10 max-md:h-8 max-md:w-8 shrink-0 rounded-full" draggable={false} data-msg-avatar />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 leading-[1.375rem] h-[1.375rem]" data-msg-header>
            <span className="font-medium text-text-0">{m.author.display_name}</span>
            <span className="rounded bg-accent px-1 py-px text-[10px] font-bold uppercase leading-4 text-white" data-app-badge>App</span>
            <span className="text-[11px] text-text-2">{formatTime(m.created_at)}</span>
          </div>
          <div className="text-[15px] leading-[1.375rem] text-text-0 break-words">
            Your message could not be delivered. Send a friend request first and start the conversation once they've accepted.
          </div>
          <div className="mt-2 text-[15px] leading-[1.375rem] text-text-0">
            Here is the full list of reasons why your message could not be delivered:{' '}
            <button type="button" onClick={() => setReasons((v) => !v)} className="inline-flex items-center gap-0.5 text-sky-400 hover:underline" aria-expanded={reasons} data-ribbit-reasons>
              {reasons ? 'hide' : 'show'} <ChevronDown size={14} className={`transition-transform ${reasons ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {reasons && (
            <ul className="mt-1 list-disc pl-5 text-sm text-text-1 space-y-0.5" data-ribbit-list>
              {DELIVERY_REASONS.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-text-2">
            <span>Only you can see this</span><span>•</span>
            <button type="button" onClick={() => discardLocal(m.channel_id, m.id)} className="hover:underline hover:text-text-0" data-ribbit-dismiss>Dismiss message</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Join notices read like Discord's: one of a few greetings, picked by the message so everyone sees the same one. */
const GREETINGS: [string, string][] = [
  ['Welcome, ', '. We hope you brought pizza.'], ['', ' just showed up!'], ['', ' joined the party.'], ['Glad you\u2019re here, ', '.'],
  ['', ' hopped into the server.'], ['Everyone welcome ', '!'], ['A wild ', ' appeared.'], ['', ' just landed.'], ['Good to see you, ', '.'],
  ['Say hi to ', '!'],
]
export function joinGreeting(id: string): [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return GREETINGS[h % GREETINGS.length]
}
