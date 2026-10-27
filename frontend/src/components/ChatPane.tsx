import { ArrowDown, Hash, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import Tooltip from './Tooltip'
import { jumpToMessage, jumpToMessageAsync } from './ChatView'
import type { Channel, DmChannel, Message } from '../lib/types'
import { formatDateDivider, sameDay } from '../lib/format'
import MessageItem from './MessageItem'
import Composer from './Composer'
import { RequestBanner } from './RequestsView'
import { isRequest } from '../store'
import Avatar from './Avatar'
import GroupIcon from './GroupIcon'
import { dmName, isGroup } from '../lib/dm'
import { useT, tn } from '../lib/i18n'

/**
 * Message history + composer for any channel (text, DM, or a voice channel's chat).
 * No header: the parent decides how to frame it.
 */
export default function ChatPane({ channel, readOnly }: { channel: Channel | DmChannel; /** Shown instead of the composer (e.g. a locked thread). */ readOnly?: string }) {
  const t = useT()
  const messages = useStore((s) => s.messages[channel.id])
  // App commands here (the / menu and the Apps menus on messages and people).
  const appCmdsLoaded = useStore((s) => !!s.appCommands[channel.id])
  const loadAppCommands = useStore((s) => s.loadAppCommands)
  useEffect(() => { if (!appCmdsLoaded) void loadAppCommands(channel.id) }, [appCmdsLoaded, channel.id, loadAppCommands])
  // Screen readers: announce messages from other people as they arrive.
  const myId = useStore((s) => s.user?.id)
  const lastMsg = messages?.[messages.length - 1]
  const [announce, setAnnounce] = useState('')
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (!lastMsg) return
    if (seen.current !== null && lastMsg.id !== seen.current && lastMsg.author.id !== myId && (!lastMsg.kind || lastMsg.kind === 'default')) setAnnounce(`${lastMsg.author.display_name}: ${lastMsg.content || t('sent an attachment')}`)
    seen.current = lastMsg.id
  }, [lastMsg, myId])
  const hasMore = useStore((s) => s.hasMore[channel.id])
  const hasNewer = useStore((s) => s.hasNewer[channel.id])
  const loadNewer = useStore((s) => s.loadNewer)
  const loadLatest = useStore((s) => s.loadLatest)
  const loading = useStore((s) => !!s.loadingMessages[channel.id])
  const readyCount = useStore((s) => s.readyCount)
  const loadMessages = useStore((s) => s.loadMessages)
  const markRead = useStore((s) => s.markRead)
  const setActiveChannel = useStore((s) => s.setActiveChannel)
  const lastId = useStore((s) => s.lastMessageId[channel.id])
  const user = useStore((s) => s.user)
  const receipts = useStore((s) => s.receipts[channel.id])
  const users = useStore((s) => s.users)
  const setReceipts = useStore((s) => s.setReceipts)
  const pushToast = useStore((s) => s.pushToast)
  const [reply, setReply] = useState<Message | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const prevHeight = useRef(0)
  const prevFirst = useRef<string | null>(null)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  // Where the reader was when they opened the channel: everything after it is "new" until they leave.
  const [readAtOpen, setReadAtOpen] = useState<string | null | undefined>(undefined)
  const initialScrollDone = useRef(false)
  // Opened on a stale window that is being replaced by the newest page: land once that page is here, not on the old one.
  const relanding = useRef(false)

  useEffect(() => {
    setActiveChannel(channel.id)
    setReply(null)
    stickBottom.current = true
    initialScrollDone.current = false
    relanding.current = false
    // Capture before the mark-read effect below moves the pointer to the newest message.
    setReadAtOpen(useStore.getState().readStates[channel.id] ?? null)
    if (!messages) loadMessages(channel.id)
    // A window kept from earlier that stops short of the newest messages (opened at an old message before): start
    // from the newest again, unless this visit follows a link to a particular message.
    else if (useStore.getState().hasNewer[channel.id] && !new URLSearchParams(location.search).has('message')) {
      relanding.current = true
      void loadLatest(channel.id).finally(() => { relanding.current = false })
    }
    api.get<{ user_id: string; message_id: string }[]>(`/channels/${channel.id}/receipts`).then((l) => setReceipts(channel.id, l)).catch(() => {})
    return () => setActiveChannel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id])
  // A full reconnect (READY) may have missed events: refetch the newest window of the channel on screen. The rows
  // stayed on screen meanwhile, so nothing blanks.
  const seenReady = useRef(readyCount)
  useEffect(() => {
    if (readyCount === seenReady.current) return
    seenReady.current = readyCount
    stickBottom.current = true
    void loadLatest(channel.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyCount])
  // If this pane's cache was dropped (a thread or secondary pane during a reconnect), load it again from scratch.
  const hadRows = useRef(false)
  useEffect(() => {
    if (messages) { hadRows.current = true; return }
    if (!hadRows.current) return
    hadRows.current = false
    initialScrollDone.current = false; stickBottom.current = true
    loadMessages(channel.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // First message the reader has not seen (from someone else), if any is loaded.
  const firstUnreadId = (() => {
    if (readAtOpen === undefined || !messages?.length) return null
    const m = messages.find((x) => (readAtOpen === null || x.id > readAtOpen) && (x.author.id !== user?.id || !!x.webhook_id) && !x.local)
    // With no read state at all (never opened), everything is "new"; only mark when there is history before it.
    if (!m || (readAtOpen === null && messages[0].id === m.id)) return null
    return m.id
  })()

  // Mark read when viewing and tab visible.
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible') markRead(channel.id) }
    mark()
    document.addEventListener('visibilitychange', mark)
    window.addEventListener('focus', mark)
    return () => { document.removeEventListener('visibilitychange', mark); window.removeEventListener('focus', mark) }
  }, [channel.id, lastId, markRead])

  // First paint of a channel: land on the first unread message (Discord's "NEW" line) or the bottom.
  // After that: stay pinned to the bottom on new messages, or hold position when history is prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!initialScrollDone.current && messages && relanding.current && hasNewer) {
      // wait for the newest page
    } else if (!initialScrollDone.current && messages) {
      initialScrollDone.current = true
      const divider = firstUnreadId ? el.querySelector<HTMLElement>('[data-unread-divider]') : null
      if (divider) {
        el.scrollTop = Math.max(0, divider.offsetTop - el.offsetTop - 24)
        stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      } else {
        el.scrollTop = el.scrollHeight
        stickBottom.current = true
      }
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight
    } else if (anchor.current) {
      // Older history was prepended (and maybe the newest rows trimmed): keep the row the reader was looking at
      // exactly where it was, whatever happened to the total height.
      const node = el.querySelector<HTMLElement>(`[data-msg-id="${anchor.current.id}"]`)
      if (node) el.scrollTop += node.getBoundingClientRect().top - anchor.current.top
      anchor.current = null
    } else if (prevHeight.current && el.scrollHeight > prevHeight.current && messages?.[0]?.id !== prevFirst.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    }
    prevHeight.current = el.scrollHeight
    prevFirst.current = messages?.[0]?.id ?? null
  }, [messages, firstUnreadId, hasNewer])

  // Late-loading content (thumbnails, link cards, poll results) grows the list after the first paint;
  // when pinned to the bottom, follow it so the view never drifts up.
  useEffect(() => {
    const el = scrollRef.current, content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickBottom.current) el.scrollTop = el.scrollHeight
      prevHeight.current = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [channel.id])

  // "You're viewing older messages" once the reader is well above the bottom.
  const [away, setAway] = useState(false)
  useEffect(() => { setAway(false) }, [channel.id])
  useEffect(() => { if (hasNewer) stickBottom.current = false }, [hasNewer])
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickBottom.current = !hasNewer && fromBottom < 40
    setAway(fromBottom > 300)
    if (el.scrollTop < 120 && hasMore !== false && !loading && messages?.length) {
      prevHeight.current = el.scrollHeight
      const first = el.querySelector<HTMLElement>('[data-msg-id]')
      anchor.current = first ? { id: first.getAttribute('data-msg-id')!, top: first.getBoundingClientRect().top } : null
      loadMessages(channel.id, messages[0].id)
    }
    if (hasNewer && fromBottom < 160 && !loading) loadNewer(channel.id)
  }, [channel.id, hasMore, hasNewer, loading, messages, loadMessages, loadNewer])

  const scrollToBottom = () => { stickBottom.current = true; const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }
  /** Reply header click: scroll to the original, loading older history if needed. */
  const jumpTo = async (id: string) => {
    if (jumpToMessage(id)) return
    stickBottom.current = false
    if (!(await jumpToMessageAsync(channel.id, id))) pushToast(t('The original message could not be found'), 'error')
  }
  // Read receipts: for each message, who has read exactly up to it (one marker per reader).
  const readersOf = (id: string) => Object.entries(receipts ?? {}).filter(([uid, mid]) => mid === id && uid !== user?.id).map(([uid]) => uid)
  const isDm = channel.guild_id === null && !('recipients' in channel && (channel as DmChannel).recipients.length > 1)

  return (
    <>
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-live-region>{announce}</div>
      <div ref={scrollRef} onScroll={onScroll} role="log" aria-label={t('Messages in {name}', { name: channel.name || t('this conversation') })} tabIndex={0} className="flex-1 min-h-0 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" data-message-list={channel.id}>
        <div ref={contentRef} className="min-h-full flex flex-col justify-end">
          {hasMore === false || (messages && messages.length < 50 && !loading) ? (
            <ChannelIntro channel={channel} />
          ) : loading ? (
            <div className="py-4 text-center text-xs text-text-2">{t('Loading history…')}</div>
          ) : null}
          <div className="pb-4">
            {messages?.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || !sameDay(prev.created_at, m.created_at)
              const grouped = !!prev && !newDay && firstUnreadId !== m.id && prev.author.id === m.author.id && !m.reply_to && !m.interaction && !m.webhook_id && (!prev.kind || prev.kind === 'default')
                && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60 * 1000
              return (
                <div key={m.id} className="msg-row">
                  {newDay && (
                    <div className="relative my-4 mx-4 flex items-center">
                      <div className="h-px flex-1 bg-line" /><span className="px-2 text-[11px] font-semibold text-text-2">{formatDateDivider(m.created_at)}</span><div className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  {firstUnreadId === m.id && (
                    <div className="relative mx-4 my-1 flex items-center" data-unread-divider>
                      <div className="h-px flex-1 bg-danger" /><span className="rounded-sm bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{t('New')}</span>
                    </div>
                  )}
                  <MessageItem message={m} grouped={grouped} isOwn={m.author.id === user?.id} onReply={() => setReply(m)} replyTarget={m.reply_to ? messages.find((x) => x.id === m.reply_to) ?? m.referenced ?? null : null} onJumpToReply={m.reply_to ? () => jumpTo(m.reply_to!) : undefined} />
                  {(() => { const r = readersOf(m.id); if (!r.length) return null; const names = r.map((id) => users[id]?.display_name ?? t('Someone')); return (
                    <div className="flex items-center justify-end gap-1 px-4 pb-1 -mt-0.5" data-read-by={r.join(',')}>
                      <Tooltip tip={t('Seen by {names}', { names: names.join(', ') })}><span className="flex items-center gap-1 text-[11px] text-text-2">{isDm ? t('Seen') : null}<span className="flex -space-x-1">{r.slice(0, 4).map((id) => { const u = users[id]; return u ? <Avatar key={id} user={u} size={14} /> : null })}</span>{r.length > 4 ? <span>+{r.length - 4}</span> : null}</span></Tooltip>
                    </div>) })()}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {(away || hasNewer) && (
        <div className="pointer-events-none absolute inset-x-4 bottom-2 flex justify-center" data-older-bar>
          <button type="button" onClick={async () => { if (hasNewer) { await loadLatest(channel.id); stickBottom.current = true; requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }); return } const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); stickBottom.current = true }}
            className="pointer-events-auto pop flex items-center gap-3 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-xl hover:bg-accent-hover" data-jump-present>
            <span>{t("You're viewing older messages")}</span>
            <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">{t('Jump to Present')} <ArrowDown size={12} /></span>
          </button>
        </div>
      )}
      </div>

      {readOnly ? <div className="mx-4 mb-4 rounded-lg bg-bg-3 px-4 py-3 text-sm text-text-2" data-readonly-note>{readOnly}</div> : channel.guild_id === null && isRequest(channel as DmChannel) ? <RequestBanner dm={channel as DmChannel} /> : <Composer channel={channel} reply={reply} onCancelReply={() => setReply(null)} onSent={scrollToBottom} />}
    </>
  )
}

function ChannelIntro({ channel }: { channel: Channel | DmChannel }) {
  const t = useT()
  const isDm = channel.guild_id === null
  const group = isDm && isGroup(channel as DmChannel)
  const other = isDm && !group ? (channel as DmChannel).recipients[0] : null
  const isVoice = !isDm && (channel as Channel).kind === 'voice'
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  return (
    <div className="px-4 pt-12 pb-4 fade-in">
      {group ? (
        <>
          <GroupIcon dm={channel as DmChannel} size={80} />
          <h1 className="mt-3 text-3xl font-extrabold">{dmName(channel as DmChannel, users, notes)}</h1>
          <p className="mt-2 text-text-2 text-sm">{tn('Welcome to the beginning of the {name} group.', { name: <b>{dmName(channel as DmChannel, users, notes)}</b> })}</p>
        </>
      ) : other ? (
        <>
          <Avatar user={other} size={80} />
          <h1 className="mt-3 text-3xl font-extrabold">{other.display_name}</h1>
          <p className="text-text-1">@{other.username}</p>
          <p className="mt-2 text-text-2 text-sm">{tn('This is the beginning of your direct message history with {name}.', { name: <b>{other.display_name}</b> })}</p>
        </>
      ) : isVoice ? (
        <>
          <div className="h-16 w-16 rounded-full bg-bg-4 flex items-center justify-center"><Volume2 size={36} /></div>
          <h1 className="mt-3 text-2xl font-extrabold">{channel.name}</h1>
          <p className="text-text-2 text-sm">{tn('This is the start of the chat for the {name} voice channel. Messages here stay even after everyone leaves.', { name: <b>{channel.name}</b> })}</p>
        </>
      ) : (
        <>
          <div className="h-16 w-16 rounded-full bg-bg-4 flex items-center justify-center"><Hash size={40} /></div>
          <h1 className="mt-3 text-3xl font-extrabold">{t('Welcome to #{name}!', { name: channel.name })}</h1>
          <p className="text-text-2">{t('This is the start of the #{name} channel.', { name: channel.name })}{channel.topic ? ` ${channel.topic}` : ''}</p>
        </>
      )}
    </div>
  )
}
