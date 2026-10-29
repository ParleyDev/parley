import { ArrowDown, Hash, Volume2 } from 'lucide-react'
import { usePhone } from '../lib/swipe'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { t as tr, useT, tn } from '../lib/i18n'

/** Longer histories than this render only the rows near the viewport. */
const VIRTUALIZE_AT = 120
/** How far above and below the viewport (px) rows stay in the DOM. */
const OVERSCAN = 1200
/** Measured row heights by message id (ids are unique everywhere), kept across channel switches. */
const rowHeights = new Map<string, number>()
/** Where the reader left each channel when scrolled up: the topmost visible row and its offset from the top. */
const savedPos = new Map<string, { id: string; offset: number }>()

/**
 * Message history + composer for any channel (text, DM, or a voice channel's chat).
 * No header: the parent decides how to frame it.
 */
export default function ChatPane({ channel, readOnly: lockedNote }: { channel: Channel | DmChannel; /** Shown instead of the composer (e.g. a locked thread). */ readOnly?: string }) {
  // A 1:1 DM with a deleted account stays readable, but nothing can be sent to them.
  const other = channel.guild_id === null && (channel as DmChannel).kind === 'dm' ? (channel as DmChannel).recipients?.[0] : undefined
  const readOnly = lockedNote ?? (other?.deleted ? tr("You can't send messages to this user.") : other?.system ? tr("This is an official message from this Parley server. Replies aren't read.") : undefined)
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
  // Where the reader was when they opened the channel: everything after it is "new" until they leave.
  const [openedAt, setOpenedAt] = useState<{ ch: string; read: string | null } | null>(null)
  const readAtOpen = openedAt?.ch === channel.id ? openedAt.read : undefined
  const initialScrollDone = useRef(false)
  // Opened on a stale window that is being replaced by the newest page: land once that page is here, not on the old one.
  const relanding = useRef(false)

  useEffect(() => {
    setActiveChannel(channel.id)
    setReply(null)
    relanding.current = false
    // Capture before the mark-read effect below moves the pointer to the newest message.
    setOpenedAt({ ch: channel.id, read: useStore.getState().readStates[channel.id] ?? null })
    if (!messages) loadMessages(channel.id)
    // A window kept from earlier that stops short of the newest messages (opened at an old message before): start
    // from the newest again, unless this visit follows a link to a particular message.
    // A spot remembered from the last visit wins: the reader comes back to what they were reading.
    else if (useStore.getState().hasNewer[channel.id] && !new URLSearchParams(location.search).has('message') && !messages.some((m) => m.id === savedPos.get(channel.id)?.id)) {
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

  // Rows on screen: every message in short histories; past VIRTUALIZE_AT only those within OVERSCAN of the viewport,
  // with spacers (measured heights, or estimates for rows never shown) standing in for the rest.
  const list = messages ?? []
  const rows = list.map((m, i) => {
    const prev = list[i - 1]
    const newDay = !prev || !sameDay(prev.created_at, m.created_at)
    const grouped = !!prev && !newDay && firstUnreadId !== m.id && prev.author.id === m.author.id && !m.reply_to && !m.interaction && !m.webhook_id && (!prev.kind || prev.kind === 'default')
      && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60 * 1000
    return { m, newDay, grouped }
  })
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const virtual = rows.length > VIRTUALIZE_AT
  const [range, setRange] = useState<{ ch: string; start: string; end: string } | null>(null)
  const indexOf = (id: string | undefined) => (id ? rows.findIndex((r) => r.m.id === id) : -1)
  let first = 0, last = rows.length - 1
  if (virtual) {
    if (range?.ch === channel.id && indexOf(range.start) >= 0) {
      first = indexOf(range.start)
      const e = indexOf(range.end)
      last = e >= first ? e : rows.length - 1
    } else {
      // Before the first measurement: around where the channel opens (a remembered spot, the NEW line, or the end).
      const at = Math.max(indexOf(savedPos.get(channel.id)?.id), indexOf(firstUnreadId ?? undefined))
      first = Math.max(0, (at >= 0 ? at : rows.length) - 30)
      last = at >= 0 ? Math.min(rows.length - 1, at + 30) : rows.length - 1
    }
  }
  const heightOf = (i: number) => rowHeights.get(rows[i].m.id) ?? (rows[i].grouped ? 26 : 62) + (rows[i].newDay ? 40 : 0)
  let topPad = 0, bottomPad = 0
  if (virtual) { for (let i = 0; i < first; i++) topPad += heightOf(i); for (let i = last + 1; i < rows.length; i++) bottomPad += heightOf(i) }

  const listRef = useRef<HTMLDivElement>(null)
  /** The row the reader is looking at (topmost visible) and where it sits: kept in place whenever anything changes. */
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const recordAnchor = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    for (const r of el.querySelectorAll<HTMLElement>('[data-row-id]')) {
      const b = r.getBoundingClientRect()
      if (b.bottom > top) { anchor.current = { id: r.dataset.rowId!, top: b.top }; return }
    }
    anchor.current = null
  }, [])
  /** The list's height when it was last settled or scrolled: a scroll event at another height came from the content
   *  changing (the browser clamping the position), not from the reader. */
  const seenHeight = useRef(0)
  /** Pinned: follow the bottom. Otherwise put the anchored row back where it was. */
  const settle = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    seenHeight.current = el.scrollHeight
    if (stickBottom.current) { el.scrollTop = el.scrollHeight; return }
    const a = anchor.current
    if (!a) return
    const node = el.querySelector<HTMLElement>(`[data-row-id="${a.id}"]`)
    // The anchored row left the DOM (the rendered range moved past it): anchor on what is there now.
    if (!node) { recordAnchor(); return }
    const d = node.getBoundingClientRect().top - a.top
    if (Math.abs(d) >= 0.5) el.scrollTop += d
  }, [recordAnchor])
  /** Which rows should be in the DOM for the current scroll position. The rendered rows are kept while they still
   *  cover at least half the overscan on both sides (and aren't far too many), so measuring them can't make the range
   *  flip back and forth. */
  const updateRange = useCallback(() => {
    const el = scrollRef.current, lst = listRef.current, rs = rowsRef.current
    if (!el || !lst || rs.length <= VIRTUALIZE_AT) return
    const shown = lst.querySelectorAll<HTMLElement>('[data-row-id]')
    const view = el.getBoundingClientRect()
    if (shown.length) {
      const top = shown[0].getBoundingClientRect().top, bottom = shown[shown.length - 1].getBoundingClientRect().bottom
      const atStart = shown[0].dataset.rowId === rs[0].m.id, atEnd = shown[shown.length - 1].dataset.rowId === rs[rs.length - 1].m.id
      const covered = (atStart || top <= view.top - OVERSCAN / 2) && (atEnd || bottom >= view.bottom + OVERSCAN / 2)
      if (covered && bottom - top <= view.height + OVERSCAN * 4 && (atEnd || !stickBottom.current)) return
    }
    const viewTop = el.scrollTop - lst.offsetTop - OVERSCAN, viewBottom = el.scrollTop - lst.offsetTop + el.clientHeight + OVERSCAN
    let y = 0, s = -1, e = rs.length - 1
    for (let i = 0; i < rs.length; i++) {
      const h = rowHeights.get(rs[i].m.id) ?? (rs[i].grouped ? 26 : 62) + (rs[i].newDay ? 40 : 0)
      if (s < 0 && y + h > viewTop) s = i
      if (y > viewBottom) { e = i - 1; break }
      y += h
    }
    if (s < 0) s = Math.max(0, rs.length - 1)
    if (stickBottom.current) e = rs.length - 1
    const next = { ch: channelRef.current, start: rs[s].m.id, end: rs[Math.max(s, e)].m.id }
    setRange((r) => (r && r.ch === next.ch && r.start === next.start && r.end === next.end ? r : next))
  }, [])
  const channelRef = useRef(channel.id)
  channelRef.current = channel.id
  const landedOn = useRef<string | null>(null)

  // First paint of a channel: land where the reader left it, on the first unread message (Discord's "NEW" line), or
  // at the bottom. After that every change (new messages, older history prepended, rows measured, images loading) is
  // settled against the pinned bottom or the anchored row; the browser's own scroll anchoring is off.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Another channel in the same pane: land afresh (this runs before the channel effect resets the rest).
    if (landedOn.current !== channel.id) { landedOn.current = channel.id; initialScrollDone.current = false; stickBottom.current = true; anchor.current = null }
    if (!initialScrollDone.current && (readAtOpen === undefined || (messages && relanding.current && hasNewer))) {
      // wait for the channel effect (where the reader had read up to), or for the newest page
    } else if (!initialScrollDone.current && messages) {
      initialScrollDone.current = true
      const saved = savedPos.get(channel.id)
      const savedNode = saved ? el.querySelector<HTMLElement>(`[data-row-id="${saved.id}"]`) : null
      const divider = firstUnreadId ? el.querySelector<HTMLElement>('[data-unread-divider]') : null
      if (savedNode && saved) {
        el.scrollTop += savedNode.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset
        stickBottom.current = false
      } else if (divider) {
        el.scrollTop = Math.max(0, divider.offsetTop - el.offsetTop - 24)
        stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      } else {
        el.scrollTop = el.scrollHeight
        stickBottom.current = true
      }
      recordAnchor()
    } else {
      settle()
    }
    if (stickBottom.current && messages?.length) setSeenAtBottom(messages[messages.length - 1].id)
    const f = requestAnimationFrame(updateRange)
    return () => cancelAnimationFrame(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, messages, firstUnreadId, readAtOpen, hasNewer, hasMore, loading, first, last, topPad, bottomPad])

  // Late-loading content (images, link cards, poll results), rows measured for the first time, the message box
  // growing and the on-screen keyboard all change sizes after the paint: settle again each time, before the frame.
  const ro = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    const el = scrollRef.current, content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset?.rowId
        if (id) rowHeights.set(id, (e.target as HTMLElement).offsetHeight)
      }
      settle()
      requestAnimationFrame(updateRange)
    })
    ro.current = obs
    obs.observe(content)
    obs.observe(el)
    el.querySelectorAll<HTMLElement>('[data-row-id]').forEach((r) => obs.observe(r))
    return () => { obs.disconnect(); ro.current = null }
  }, [channel.id, settle, updateRange])
  const observeRow = useCallback((node: HTMLDivElement | null) => { if (node) { rowHeights.set(node.dataset.rowId!, node.offsetHeight); ro.current?.observe(node) } }, [])

  // "You're viewing older messages" once the reader is well up the history: about a screen and a half above the newest
  // message, not as soon as they nudge the list. Messages arriving while scrolled up are counted instead of scrolled to.
  const [away, setAway] = useState(false)
  const [seenAtBottom, setSeenAtBottom] = useState<string | null>(null)
  const phone = usePhone()
  useEffect(() => { setAway(false); setSeenAtBottom(null) }, [channel.id])
  useEffect(() => { if (hasNewer) stickBottom.current = false }, [hasNewer])
  const unseen = seenAtBottom === null || !messages ? 0 : messages.filter((m) => m.id > seenAtBottom && !m.local && m.author.id !== myId).length
  const frame = useRef(0)
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Scroll events are dispatched before resize observers run: when the content just changed height, put things back
    // first instead of reading the browser's clamped position as the reader scrolling.
    if (el.scrollHeight !== seenHeight.current) settle()
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickBottom.current = !hasNewer && fromBottom < 40
    recordAnchor()
    // Remember where the reader is in this conversation for when they come back to it.
    if (stickBottom.current || !anchor.current) savedPos.delete(channel.id)
    else savedPos.set(channel.id, { id: anchor.current.id, offset: anchor.current.top - el.getBoundingClientRect().top })
    if (stickBottom.current && messages?.length) setSeenAtBottom(messages[messages.length - 1].id)
    setAway(fromBottom > Math.max(600, el.clientHeight * 1.5))
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(updateRange)
    if (el.scrollTop < 120 && hasMore !== false && !loading && messages?.length) loadMessages(channel.id, messages[0].id)
    if (hasNewer && fromBottom < 160 && !loading) loadNewer(channel.id)
  }, [channel.id, hasMore, hasNewer, loading, messages, loadMessages, loadNewer, recordAnchor, updateRange])

  // Still at the top when a page finishes loading (the reader got there while it was in flight, so no scroll event
  // is coming): load the next one.
  useEffect(() => {
    const el = scrollRef.current
    if (loading || !el || !initialScrollDone.current || hasMore === false || !messages?.length) return
    if (el.scrollTop < 120 && el.scrollHeight > el.clientHeight) loadMessages(channel.id, messages[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Jumping to a message that is loaded but not on screen (virtualized away): show the rows around it first.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const i = rowsRef.current.findIndex((r) => r.m.id === id)
      if (i < 0) return
      const rs = rowsRef.current
      stickBottom.current = false
      flushSync(() => setRange({ ch: channel.id, start: rs[Math.max(0, i - 20)].m.id, end: rs[Math.min(rs.length - 1, i + 20)].m.id }))
    }
    window.addEventListener('parley:reveal', on)
    return () => window.removeEventListener('parley:reveal', on)
  }, [channel.id])

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

  const jumpToPresent = async () => {
    if (hasNewer) { await loadLatest(channel.id); stickBottom.current = true; requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }); return }
    const el = scrollRef.current
    stickBottom.current = true
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: unseen > 0 && !away ? 'smooth' : 'auto' })
  }

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col">
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-live-region>{announce}</div>
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} onScroll={onScroll} role="log" aria-label={t('Messages in {name}', { name: channel.name || t('this conversation') })} tabIndex={0} className="flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" data-message-list={channel.id}>
        <div ref={contentRef} className="relative min-h-full flex flex-col justify-end">
          {hasMore === false || (messages && messages.length < 50 && !loading) ? (
            <ChannelIntro channel={channel} />
          ) : loading ? (
            <div className="py-4 text-center text-xs text-text-2">{t('Loading history…')}</div>
          ) : null}
          <div ref={listRef} className="pb-8" data-virtual={virtual ? `${first}-${last}` : undefined}>
            {topPad > 0 && <div style={{ height: topPad }} aria-hidden data-virtual-pad="top" />}
            {rows.slice(first, last + 1).map(({ m, newDay, grouped }) => {
              const sys = !!m.kind && m.kind !== 'default'
              return (
                <div key={m.id} ref={observeRow} className="msg-row" data-row-id={m.id} data-sys-row={sys ? '' : undefined}>
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
                  <MessageItem message={m} grouped={grouped} isOwn={m.author.id === user?.id} onReply={() => setReply(m)} replyTarget={m.reply_to ? list.find((x) => x.id === m.reply_to) ?? m.referenced ?? null : null} onJumpToReply={m.reply_to ? () => jumpTo(m.reply_to!) : undefined} />
                  {(() => { const r = readersOf(m.id); if (!r.length) return null; const names = r.map((id) => users[id]?.display_name ?? t('Someone')); return (
                    <div className="flex items-center justify-end gap-1 px-4 pb-1 -mt-0.5" data-read-by={r.join(',')}>
                      <Tooltip tip={t('Seen by {names}', { names: names.join(', ') })}><span className="flex items-center gap-1 text-[11px] text-text-2">{isDm ? t('Seen') : null}<span className="flex -space-x-1">{r.slice(0, 4).map((id) => { const u = users[id]; return u ? <Avatar key={id} user={u} size={14} /> : null })}</span>{r.length > 4 ? <span>+{r.length - 4}</span> : null}</span></Tooltip>
                    </div>) })()}
                </div>
              )
            })}
            {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden data-virtual-pad="bottom" />}
          </div>
        </div>
      </div>
      {(away || hasNewer || unseen > 0) && (phone ? (
        // Phones: a small round button at the right instead of the bar across the chat.
        <button type="button" onClick={jumpToPresent} title={t('Jump to Present')} aria-label={t('Jump to Present')}
          className="pop absolute right-3 bottom-3 z-20 h-10 w-10 rounded-full border border-line bg-bg-1/95 text-text-0 shadow-lg flex items-center justify-center" data-older-bar data-jump-present>
          <ArrowDown size={18} />
          {unseen > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-danger px-1 text-[11px] font-bold leading-5 text-white text-center" data-new-count={unseen}>{unseen > 99 ? '99+' : unseen}</span>}
        </button>
      ) : (
        <div className="pointer-events-none absolute inset-x-4 bottom-2 z-20 flex justify-center" data-older-bar>
          <button type="button" onClick={jumpToPresent}
            className="pointer-events-auto pop flex items-center gap-3 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-xl hover:bg-accent-hover" data-jump-present>
            <span data-new-count={unseen || undefined}>{unseen > 0 ? (unseen === 1 ? t('1 new message') : t('{n} new messages', { n: unseen > 99 ? '99+' : unseen })) : t("You're viewing older messages")}</span>
            <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">{t('Jump to Present')} <ArrowDown size={12} /></span>
          </button>
        </div>
      ))}
      </div>
      <div className="relative shrink-0" data-chat-bottom>
      {readOnly ? <div className="mx-4 mb-4 rounded-lg bg-bg-3 px-4 py-3 text-sm text-text-2" data-readonly-note>{readOnly}</div> : channel.guild_id === null && isRequest(channel as DmChannel) ? <RequestBanner dm={channel as DmChannel} /> : <Composer channel={channel} reply={reply} onCancelReply={() => setReply(null)} onSent={scrollToBottom} />}
      </div>
      </div>
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
