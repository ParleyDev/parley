import { ArrowDown, CheckCheck, CornerUpLeft, Hash, RotateCw, Volume2 } from 'lucide-react'
import { previewText } from '../lib/desktopNotify'
import { usePhone } from '../lib/swipe'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { isLooking } from '../lib/ws'
import Tooltip from './Tooltip'
import { jumpToMessage, jumpToMessageAsync } from './ChatView'
import type { Channel, DmChannel, Message } from '../lib/types'
import { formatDateDivider, formatShortTime, formatTime, sameDay } from '../lib/format'
import MessageItem from './MessageItem'
import Composer from './Composer'
import { RequestBanner } from './RequestsView'
import { isRequest } from '../store'
import Avatar from './Avatar'
import GroupIcon from './GroupIcon'
import { dmName, isGroup } from '../lib/dm'
import { t as tr, useT, tn } from '../lib/i18n'
import { globalName, nameIn, shownName } from '../lib/names'

/** How near the top or the bottom of what is loaded (px) the next page of history is asked for: well before the edge
 *  is on screen, so a steady scroll rarely reaches it. */
const LOAD_AHEAD = 600
/** Where the reader left each channel when reading back through history (half a screen or more up): the topmost visible row,
 *  its offset from the top, and when. Coming back soon after returns there, unless something new arrived meanwhile
 *  (then the NEW line wins); otherwise the channel opens at the newest message, as on Discord. */
const savedPos = new Map<string, { id: string; offset: number; at: number }>()
const SAVED_FOR_MS = 10 * 60_000
const savedSpot = (ch: string) => {
  const p = savedPos.get(ch)
  if (p && Date.now() - p.at > SAVED_FOR_MS) { savedPos.delete(ch); return undefined }
  return p
}

/** Touch screens. */
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
/**
 * Move the list by `d` to keep the reader's row in place. WebKit (iOS) ignores a script setting the scroll position
 * while a fling or the top bounce is still moving the list: after older messages were added above, the list stayed
 * at the top and loaded page after page in a flash. On touch screens a big move (a page added, not a row measured)
 * stops the list scrolling for the write, which ends the fling and makes it stick.
 */
function shiftBy(el: HTMLElement, d: number) {
  if (!coarse || Math.abs(d) < 50) { el.scrollTop += d; return }
  const o = el.style.overflowY
  el.style.overflowY = 'hidden'
  el.scrollTop += d
  void el.offsetHeight
  el.style.overflowY = o
}

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
    if (seen.current !== null && lastMsg.id !== seen.current && lastMsg.author.id !== myId && (!lastMsg.kind || lastMsg.kind === 'default')) setAnnounce(`${nameIn(useStore.getState(), lastMsg.author.id, channel.guild_id) || globalName(lastMsg.author)}: ${(lastMsg.content && previewText(lastMsg.content, lastMsg.channel_id)) || t('sent an attachment')}`)
    seen.current = lastMsg.id
  }, [lastMsg, myId])
  const hasMore = useStore((s) => s.hasMore[channel.id])
  const hasNewer = useStore((s) => s.hasNewer[channel.id])
  const loadNewer = useStore((s) => s.loadNewer)
  const loadLatest = useStore((s) => s.loadLatest)
  const loading = useStore((s) => !!s.loadingMessages[channel.id])
  const loadError = useStore((s) => !!s.messageLoadError[channel.id])
  const loadAround = useStore((s) => s.loadAround)
  const readyCount = useStore((s) => s.readyCount)
  const loadMessages = useStore((s) => s.loadMessages)
  const markRead = useStore((s) => s.markRead)
  const setActiveChannel = useStore((s) => s.setActiveChannel)
  const lastId = useStore((s) => s.lastMessageId[channel.id])
  const user = useStore((s) => s.user)
  const receipts = useStore((s) => s.receipts[channel.id])
  const users = useStore((s) => s.users)
  const members = useStore((s) => (channel.guild_id ? s.members[channel.guild_id] : undefined))
  const notes = useStore((s) => s.notes)
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
    // That old window's spot is dropped too: as on Discord, coming back after a jump returns to the present.
    else if (useStore.getState().hasNewer[channel.id] && !new URLSearchParams(location.search).has('message')) {
      savedPos.delete(channel.id)
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

  // First message the reader has not seen (from someone else), if any is loaded: after their read pointer and after
  // their own latest message (writing in a chat means having read it). No read pointer at all (never opened): no line.
  const firstUnreadId = (() => {
    if (!readAtOpen || !messages?.length) return null
    const mine = messages.findLast((x) => x.author.id === user?.id && !x.webhook_id && !x.local)?.id
    const floor = mine && mine > readAtOpen ? mine : readAtOpen
    return messages.find((x) => x.id > floor && (x.author.id !== user?.id || !!x.webhook_id) && !x.local)?.id ?? null
  })()

  // "N new messages since …" over the top of the chat while there is a New divider, until dismissed.
  const [bannerOff, setBannerOff] = useState<string | null>(null)
  const unread = (() => {
    if (!firstUnreadId || !messages || bannerOff === channel.id) return null
    const from = messages.findIndex((x) => x.id === firstUnreadId)
    const n = messages.slice(from).filter((x) => (x.author.id !== user?.id || !!x.webhook_id) && !x.local).length
    const at = messages[from].created_at
    return { n, more: !!hasNewer, since: sameDay(at, new Date().toISOString()) ? formatShortTime(at) : formatTime(at) }
  })()
  const toDivider = () => scrollRef.current?.querySelector<HTMLElement>('[data-unread-divider]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })


  // Every loaded message is rendered: the store keeps the loaded window bounded (MAX_LOADED in store.ts, trimming the
  // side the reader is moving away from), so the list never stands in for rows with guessed heights. Guesses made the
  // scrollbar jump and, at trackpad speeds, lost the reader's place.
  const list = messages ?? []
  const rows = list.map((m, i) => {
    const prev = list[i - 1]
    const newDay = !prev || !sameDay(prev.created_at, m.created_at)
    const grouped = !!prev && !newDay && firstUnreadId !== m.id && prev.author.id === m.author.id && !m.reply_to && !m.status_reply && !m.interaction && !m.webhook_id && (!prev.kind || prev.kind === 'default')
      && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60 * 1000
    return { m, newDay, grouped }
  }).map((r, i, all) => ({ ...r, endsRun: !all[i + 1]?.grouped, dividerNext: !!all[i + 1] && (all[i + 1].newDay || all[i + 1].m.id === firstUnreadId) }))
  const rowsRef = useRef(rows)
  rowsRef.current = rows

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
   *  changing (the browser clamping the position), not from the reader. Likewise the visible height: the keyboard
   *  opening shrinks the list, and the scroll events of that resize are not the reader scrolling up. */
  const seenHeight = useRef(0)
  const seenClient = useRef(0)
  /** Pinned: follow the bottom. Otherwise put the anchored row back where it was. */
  const settle = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    seenHeight.current = el.scrollHeight
    seenClient.current = el.clientHeight
    if (stickBottom.current) { el.scrollTop = el.scrollHeight; return }
    const a = anchor.current
    if (!a) return
    const node = el.querySelector<HTMLElement>(`[data-row-id="${a.id}"]`)
    // The anchored row is gone (deleted, or trimmed from the far end of the loaded window): anchor on what is there now.
    if (!node) { recordAnchor(); return }
    const d = node.getBoundingClientRect().top - a.top
    if (Math.abs(d) >= 0.5) shiftBy(el, d)
  }, [recordAnchor])
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
      // A spot the reader was reading back at (unless new messages above it arrived since: the NEW line), the NEW line,
      // or the end.
      const divider = firstUnreadId ? el.querySelector<HTMLElement>('[data-unread-divider]') : null
      const spot = savedSpot(channel.id)
      const saved = spot && (!firstUnreadId || spot.id > firstUnreadId) ? spot : undefined
      const savedNode = saved ? el.querySelector<HTMLElement>(`[data-row-id="${saved.id}"]`) : null
      if (savedNode && saved) {
        el.scrollTop += savedNode.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset
        stickBottom.current = false
      } else if (divider) {
        // Measured on screen: offsetTop is relative to the nearest positioned wrapper, not to the scrolling list.
        el.scrollTop += divider.getBoundingClientRect().top - el.getBoundingClientRect().top - 24
        stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        setLandedAtUnread(!stickBottom.current)
      } else {
        el.scrollTop = el.scrollHeight
        stickBottom.current = true
      }
      recordAnchor()
    } else {
      settle()
    }
    if (stickBottom.current && messages?.length) setSeenAtBottom(messages[messages.length - 1].id)
    // Landed (or settled) at the newest message: that counts as seeing it.
    if (initialScrollDone.current) markIfSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, messages, firstUnreadId, readAtOpen, hasNewer, hasMore, loading])

  // Late-loading content (images, link cards, poll results), rows measured for the first time, the message box
  // growing and the on-screen keyboard all change sizes after the paint: settle again each time, before the frame.
  useEffect(() => {
    const el = scrollRef.current, content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => settle())
    obs.observe(content)
    obs.observe(el)
    return () => obs.disconnect()
  }, [channel.id, settle])

  // "You're viewing older messages" once the reader is well up the history: about a screen and a half above the newest
  // message, not as soon as they nudge the list. Messages arriving while scrolled up are counted instead of scrolled to.
  const [away, setAway] = useState(false)
  const [seenAtBottom, setSeenAtBottom] = useState<string | null>(null)
  const phone = usePhone()
  // A new visit starts clean: in particular a bar dismissed last time shows again for what is new this time.
  useEffect(() => { setAway(false); setSeenAtBottom(null); setLandedAtUnread(false); setOrigin(null); setBannerOff(null) }, [channel.id])
  useEffect(() => { if (hasNewer) stickBottom.current = false }, [hasNewer])
  const unseen = seenAtBottom === null || !messages ? 0 : messages.filter((m) => m.id > seenAtBottom && !m.local && m.author.id !== myId).length
  // The "N new messages" banner goes once the reader has reached the newest message, as on Discord: soon after they
  // scroll down to it, or after a few seconds when everything new already fit on screen (time to notice it).
  const readerScrolled = useRef(false)
  /** When the reader last moved the list themselves (wheel, touch, key): for a moment after, the list is theirs. */
  const lastInput = useRef(0)
  /** Landed on the NEW line and not moved since: the top bar says what is new, so the "older messages" bar stays away. */
  const [landedAtUnread, setLandedAtUnread] = useState(false)
  const noteInput = useCallback(() => { readerScrolled.current = true; lastInput.current = performance.now(); setLandedAtUnread(false) }, [])
  /** Where the reader was before following a reply to its original: Escape or Back returns there. */
  const [origin, setOrigin] = useState<{ id: string | null; offset: number; pinned: boolean } | null>(null)
  const bannerTimer = useRef(0)
  useEffect(() => { readerScrolled.current = false; return () => { clearTimeout(bannerTimer.current); bannerTimer.current = 0 } }, [channel.id])
  const showingBanner = !!unread
  useEffect(() => {
    const el = scrollRef.current
    const atBottom = !!el && !hasNewer && initialScrollDone.current && el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!showingBanner || !atBottom) { clearTimeout(bannerTimer.current); bannerTimer.current = 0; return }
    if (bannerTimer.current) return
    const id = channel.id
    bannerTimer.current = window.setTimeout(() => { bannerTimer.current = 0; setBannerOff(id) }, readerScrolled.current ? 600 : 4000)
  }, [showingBanner, seenAtBottom, away, messages, hasNewer, channel.id])
  // Mark read only what the reader has seen, as Discord does: the window in front and focused, the reader not away, and
  // the newest message on screen (at the bottom, with nothing newer to load). Otherwise new messages stay unread, with
  // the New line, until they come back, focus the window or scroll down to them.
  const latest = useRef({ hasNewer, newest: messages?.[messages.length - 1]?.id })
  latest.current = { hasNewer, newest: messages?.[messages.length - 1]?.id }
  const markIfSeen = useCallback(() => {
    const el = scrollRef.current, { hasNewer, newest } = latest.current
    const last = useStore.getState().lastMessageId[channel.id]
    if (!el || !initialScrollDone.current || hasNewer || !newest || (last && newest < last)) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight >= 40 || !isLooking()) return
    markRead(channel.id)
  }, [channel.id, markRead])
  useEffect(() => {
    markIfSeen()
    document.addEventListener('visibilitychange', markIfSeen)
    window.addEventListener('focus', markIfSeen)
    window.addEventListener('parley:present', markIfSeen)
    return () => { document.removeEventListener('visibilitychange', markIfSeen); window.removeEventListener('focus', markIfSeen); window.removeEventListener('parley:present', markIfSeen) }
  }, [lastId, messages, hasNewer, markIfSeen])
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Scroll events are dispatched before resize observers run: when the content just changed height, put things back
    // first instead of reading the browser's clamped position as the reader scrolling.
    // Not while the reader is moving the list: this scroll is theirs, and settling first (on what was true before it)
    // would undo it.
    if ((el.scrollHeight !== seenHeight.current || el.clientHeight !== seenClient.current) && performance.now() - lastInput.current > 150) settle()
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickBottom.current = !hasNewer && fromBottom < 40
    recordAnchor()
    // Remember where the reader is in this conversation for when they come back to it.
    // Only reading back counts, not a nudge or the keyboard shifting the list. Not before landing either: the scroll
    // events of a channel being put on screen would wipe the spot it is about to land on.
    if (!initialScrollDone.current) { /* landing */ }
    else if (!anchor.current || fromBottom < Math.max(300, el.clientHeight / 2)) savedPos.delete(channel.id)
    else savedPos.set(channel.id, { id: anchor.current.id, offset: anchor.current.top - el.getBoundingClientRect().top, at: Date.now() })
    if (stickBottom.current && messages?.length) setSeenAtBottom(messages[messages.length - 1].id)
    if (stickBottom.current) markIfSeen()
    setAway(fromBottom > Math.max(600, el.clientHeight * 1.5))
    // The next page is asked for while its edge is still LOAD_AHEAD away from the screen (measured to the rows, so the
    // placeholder rows above and below them don't count). Not after a failure: that waits for Try again.
    const lst = listRef.current?.getBoundingClientRect(), view = el.getBoundingClientRect()
    if (lst && !loading && !loadError && messages?.length) {
      if (hasMore !== false && view.top - lst.top < LOAD_AHEAD) loadMessages(channel.id, messages[0].id)
      else if (hasNewer && lst.bottom - view.bottom < LOAD_AHEAD) loadNewer(channel.id)
    }
  }, [channel.id, hasMore, hasNewer, loading, loadError, messages, loadMessages, loadNewer, recordAnchor, markIfSeen])

  // Still at the top when a page finishes loading (the reader got there while it was in flight, so no scroll event
  // is coming): load the next one.
  useEffect(() => {
    const el = scrollRef.current
    const lst = listRef.current
    if (loading || loadError || !el || !lst || !initialScrollDone.current || hasMore === false || !messages?.length) return
    if (el.getBoundingClientRect().top - lst.getBoundingClientRect().top < LOAD_AHEAD && el.scrollHeight > el.clientHeight) loadMessages(channel.id, messages[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Jumping to a message in this list: the reader is no longer following the newest messages.
  useEffect(() => {
    const on = (e: Event) => { if (rowsRef.current.some((r) => r.m.id === (e as CustomEvent<string>).detail)) stickBottom.current = false }
    window.addEventListener('parley:reveal', on)
    return () => window.removeEventListener('parley:reveal', on)
  }, [channel.id])

  // The message box changing size (many lines pasted at once, a restored draft): note whether the list was at the
  // bottom before, and put it back there right after, in the same frame, rather than relying on the resize observer.
  const keepPinned = useCallback((apply: () => void) => {
    const el = scrollRef.current
    const pinned = !!el && !hasNewer && (stickBottom.current || el.scrollHeight - el.scrollTop - el.clientHeight < 40)
    apply()
    if (!el) return
    if (pinned) { stickBottom.current = true; el.scrollTop = el.scrollHeight; seenHeight.current = el.scrollHeight; seenClient.current = el.clientHeight } else settle()
  }, [hasNewer, settle])
  const scrollToBottom = () => { stickBottom.current = true; const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }
  /** Reply header click: scroll to the original, loading older history if needed. */
  const jumpTo = async (id: string) => {
    // Remember where the reader is, so they can come back after looking at the original.
    const el = scrollRef.current
    recordAnchor()
    const from = { id: anchor.current?.id ?? null, offset: anchor.current && el ? anchor.current.top - el.getBoundingClientRect().top : 0, pinned: stickBottom.current }
    if (jumpToMessage(id)) { setOrigin((o) => o ?? from); return }
    stickBottom.current = false
    if (await jumpToMessageAsync(channel.id, id)) setOrigin((o) => o ?? from)
    else pushToast(t('The original message could not be found'), 'error')
  }
  /** Back to where the reader was before the jump (loading that part of the history again if it has gone). */
  const returnToOrigin = async () => {
    const o = origin
    setOrigin(null)
    if (!o) return
    if (o.pinned || !o.id) { await jumpToPresent(); return }
    const place = () => {
      const el = scrollRef.current, node = el?.querySelector<HTMLElement>(`[data-row-id="${o.id}"]`)
      if (!el || !node) return false
      stickBottom.current = false
      el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - o.offset
      recordAnchor()
      return true
    }
    if (place()) return
    await loadAround(channel.id, o.id)
    for (let i = 0; i < 20; i++) { if (place()) return; await new Promise((r) => setTimeout(r, 50)) }
  }
  // Read receipts: each reader's marker sits under the last of your runs they have read up to. Their receipt is often a
  // later message (their own reply, or someone else's), so this can't be an exact id match.
  const seenAt = (() => {
    const at: Record<string, string[]> = {}
    const ends = rows.filter((r) => r.endsRun && r.m.author.id === user?.id && !r.m.local).map((r) => r.m.id)
    for (const [uid, mid] of Object.entries(receipts ?? {})) {
      if (uid === user?.id) continue
      let hit: string | undefined
      for (const id of ends) { if (id <= mid) hit = id; else break }
      if (hit) (at[hit] ??= []).push(uid)
    }
    return at
  })()
  const readersOf = (id: string) => seenAt[id] ?? []
  const isDm = channel.guild_id === null && !('recipients' in channel && (channel as DmChannel).recipients.length > 1)

  const jumpToPresent = async () => {
    setOrigin(null)
    if (hasNewer) { await loadLatest(channel.id); stickBottom.current = true; requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }); return }
    const el = scrollRef.current
    stickBottom.current = true
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: unseen > 0 && !away ? 'smooth' : 'auto' })
  }
  /** Mark As Read (the top bar's button, Escape): go to the newest message, mark the channel read, and take the NEW line away. */
  const markAllRead = async () => {
    setBannerOff(channel.id)
    await jumpToPresent()
    await markRead(channel.id)
    const st = useStore.getState()
    setOpenedAt({ ch: channel.id, read: st.readStates[channel.id] ?? st.lastMessageId[channel.id] ?? null })
  }
  /** The oldest unread message: the NEW line when it is loaded, otherwise the part of the history where the reader stopped. */
  const jumpToOldestUnread = () => {
    if (scrollRef.current?.querySelector('[data-unread-divider]')) { stickBottom.current = false; toDivider(); return }
    if (readAtOpen && messages?.length && readAtOpen < messages[0].id) { stickBottom.current = false; void jumpToMessageAsync(channel.id, readAtOpen) }
  }
  // Keys, as on Discord: Escape goes back from a jump, or else marks the channel read and returns to the newest
  // message; Shift+PageUp goes to the oldest unread message; End, while newer messages aren't loaded, goes to the present.
  // Escape belongs to whatever else is open first: a dialog or menu, an edit or a search with text in it, a reply being
  // written. (Shift+Escape, the whole server, is the message box's: Composer.)
  const keys = useRef({ markAllRead, returnToOrigin, jumpToOldestUnread, jumpToPresent, origin, reply, hasNewer })
  keys.current = { markAllRead, returnToOrigin, jumpToOldestUnread, jumpToPresent, origin, reply, hasNewer }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const col = scrollRef.current?.closest('[data-chat-column]')
      if (!col || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const inPane = !!target && col.contains(target)
      // With nothing focused the keys go to the main conversation, not to a thread or second pane beside it.
      if (!inPane && !((!target || target === document.body) && document.querySelector('[data-chat-column]') === col)) return
      const k = keys.current
      if (e.key === 'PageUp' && e.shiftKey) { e.preventDefault(); k.jumpToOldestUnread(); return }
      if (e.key === 'End' && !e.shiftKey && k.hasNewer && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'INPUT') { e.preventDefault(); void k.jumpToPresent(); return }
      if (e.key !== 'Escape' || e.shiftKey || e.defaultPrevented) return
      if (useStore.getState().modal || document.querySelector('[data-context-menu], [data-call-menu], [role="dialog"], [role="menu"], [role="listbox"]')) return
      // A field with something in it keeps its Escape (an edit under way, a search), except the message box: marking
      // read from there loses nothing that was typed.
      const field = !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      if (field && !target.closest('[data-chat-bottom]') && ((target as HTMLTextAreaElement).value ?? target.textContent ?? '').length) return
      if (k.reply) return
      if (k.origin) void k.returnToOrigin(); else void k.markAllRead()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [channel.id])

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col" data-chat-column>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-live-region>{announce}</div>
      <div className="relative flex-1 min-h-0 flex flex-col">
      {unread && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center bg-accent text-white shadow-md phone:shadow-none wide:inset-x-4 wide:rounded-b-lg" data-unread-banner>
          <button type="button" onClick={toDivider} className="min-w-0 flex-1 truncate px-4 py-1.5 text-left text-sm font-semibold phone:py-2.5 phone:text-[15px]" data-unread-jump>
            {unread.n === 1 && !unread.more ? t('1 new message since {time}', { time: unread.since }) : t('{n} new messages since {time}', { n: `${unread.n}${unread.more ? '+' : ''}`, time: unread.since })}
          </button>
          {phone
            ? <button type="button" onClick={() => { void markAllRead() }} aria-label={t('Mark As Read')} title={t('Mark As Read')} className="h-11 w-11 shrink-0 flex items-center justify-center" data-unread-dismiss><CheckCheck size={22} /></button>
            : <button type="button" onClick={() => { void markAllRead() }} className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold hover:underline" data-unread-dismiss>{t('Mark As Read')}<CheckCheck size={16} /></button>}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} onWheel={noteInput} onTouchMove={noteInput} onKeyDown={noteInput} onPointerDown={(e) => { if (e.target === e.currentTarget) noteInput() /* the scrollbar */ }} role="log" aria-label={t('Messages in {name}', { name: channel.name || t('this conversation') })} tabIndex={0} className="scroller-auto flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" data-message-list={channel.id}>
        <div ref={contentRef} className="relative min-h-full flex flex-col justify-end">
          {/* Above the oldest loaded message: the channel's beginning, or rows standing in for the history still to
              load, so scrolling towards it never shows an empty gap. A channel not loaded yet is all such rows. */}
          {hasMore === false || (messages && messages.length < 50 && !loading) ? (
            <ChannelIntro channel={channel} />
          ) : loadError && !messages ? null : (
            <HistoryPlaceholder rows={messages ? 6 : 14} label={t('Loading history…')} where="older" />
          )}
          <div ref={listRef} className="pb-8" data-rows={rows.length}>
            {rows.map(({ m, newDay, grouped, endsRun, dividerNext }) => {
              const sys = !!m.kind && m.kind !== 'default'
              return (
                <div key={m.id} className="msg-row relative" data-row-id={m.id} data-sys-row={sys ? '' : undefined}>
                  {newDay && (
                    <div className="relative my-4 mx-4 flex items-center">
                      <div className="h-px flex-1 bg-line" /><span className="px-2 text-[11px] font-semibold text-text-2">{formatDateDivider(m.created_at)}</span><div className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  {firstUnreadId === m.id && (
                    // Desktop: a red line ending in a NEW tag. Phones: NEW MESSAGES centred between two lines, like Discord mobile.
                    <div className="relative mx-4 my-1 flex items-center phone:mx-3 phone:my-3 phone:gap-3" data-unread-divider>
                      <div className="h-px flex-1 bg-danger" />
                      {phone
                        ? <><span className="text-[13px] font-semibold uppercase tracking-wide text-danger">{t('New messages')}</span><div className="h-px flex-1 bg-danger" /></>
                        : <span className="rounded-sm bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{t('New')}</span>}
                    </div>
                  )}
                  <MessageItem message={m} grouped={grouped} isOwn={m.author.id === user?.id} onReply={() => setReply(m)} replyTarget={m.reply_to ? list.find((x) => x.id === m.reply_to) ?? m.referenced ?? null : null} onJumpToReply={m.reply_to ? () => jumpTo(m.reply_to!) : undefined} />
                  {/* Seen: only under your own message, at the end of a run. Out of the flow, hanging into the space before
                      the next group, so it never changes the spacing of the chat; above a date or NEW divider, which it
                      would cover, it takes its own line instead. */}
                  {(() => { const r = m.author.id === user?.id && endsRun ? readersOf(m.id) : []; if (!r.length) return null; const names = r.map((id) => shownName(users[id] ?? members?.[id], members?.[id], notes[id]?.nickname) || t('Someone')); return (
                    <div className={dividerNext ? 'flex items-center justify-end gap-1 px-4 pt-0.5 phone:px-3' : 'absolute right-4 top-full z-10 -mt-1 flex items-center gap-1 phone:right-3'} data-read-by={r.join(',')}>
                      <Tooltip tip={t('Seen by {names}', { names: names.join(', ') })}><span className="flex items-center gap-1 text-[11px] text-text-2">{isDm ? t('Seen') : null}<span className="flex -space-x-1">{r.slice(0, 4).map((id) => { const u = users[id]; return u ? <Avatar key={id} user={u} size={14} /> : null })}</span>{r.length > 4 ? <span>+{r.length - 4}</span> : null}</span></Tooltip>
                    </div>) })()}
                </div>
              )
            })}
          </div>
          {/* Below the newest loaded message when the present is not loaded: more rows standing in. */}
          {hasNewer && messages && !loadError && <HistoryPlaceholder rows={4} label={t('Loading history…')} where="newer" />}
        </div>
      </div>
      {loadError && (
        <div className={`absolute inset-x-0 z-20 flex justify-center ${messages ? 'top-12' : 'top-1/3'}`} role="alert" data-load-failed>
          <div className="pop flex items-center gap-3 rounded-xl border border-line bg-bg-1 py-1.5 pl-4 pr-1.5 shadow-xl">
            <span className="text-sm font-semibold text-text-1">{t('Messages failed to load')}</span>
            <button type="button" disabled={loading} onClick={() => { const el = scrollRef.current; const nearEnd = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < el.scrollTop; if (!messages?.length) void loadMessages(channel.id); else if (hasNewer && nearEnd) void loadNewer(channel.id); else void loadMessages(channel.id, messages[0].id) }}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50" data-load-retry><RotateCw size={14} />{t('Try again')}</button>
          </div>
        </div>
      )}
      {/* The bar over the bottom of the chat: away from the newest messages, new ones arrived, or a way back from a jump.
          Not while the reader sits on the NEW line they just landed on: the bar at the top is saying what is new. */}
      {(away || hasNewer || unseen > 0 || origin) && !(landedAtUnread && !!unread && !hasNewer && unseen === 0 && !origin) && (phone ? (
        // Phones: a small round button at the right instead of the bar across the chat.
        <div className="absolute right-3 bottom-3 z-20 flex flex-col items-end gap-2" data-older-bar>
          {origin && <button type="button" onClick={() => { void returnToOrigin() }} title={t('Back to where you were')} aria-label={t('Back to where you were')} className="pop h-10 w-10 rounded-full border border-line bg-bg-1/95 text-text-0 shadow-lg flex items-center justify-center" data-jump-back><CornerUpLeft size={18} /></button>}
          <button type="button" onClick={jumpToPresent} title={t('Jump to Present')} aria-label={t('Jump to Present')}
            className="pop relative h-10 w-10 rounded-full border border-line bg-bg-1/95 text-text-0 shadow-lg flex items-center justify-center" data-jump-present>
            <ArrowDown size={18} />
            {unseen > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-danger px-1 text-[11px] font-bold leading-5 text-white text-center" data-new-count={unseen}>{unseen > 99 ? '99+' : unseen}</span>}
          </button>
        </div>
      ) : (
        // Discord's bar: a dark strip floating over the chat, what you're looking at on the left, the jump on the right.
        <div className="pointer-events-none absolute inset-x-4 bottom-2 z-20 flex justify-center" data-older-bar>
          <div className="pointer-events-auto pop flex items-center gap-4 rounded-xl border border-line bg-bg-1/95 py-1.5 pl-4 pr-1.5 shadow-xl backdrop-blur-sm">
            <span className="text-sm font-semibold text-text-1" data-new-count={unseen || undefined}>{unseen > 0 ? (unseen === 1 ? t('1 New Message') : t('{n} New Messages', { n: unseen > 99 ? '99+' : unseen })) : t("You're Viewing Older Messages")}</span>
            <span className="flex items-center gap-1.5">
              {origin && <button type="button" onClick={() => { void returnToOrigin() }} title={t('Back to where you were')} className="flex items-center gap-1.5 rounded-lg bg-bg-3 px-3 py-1.5 text-sm font-semibold text-text-0 hover:bg-bg-4" data-jump-back><CornerUpLeft size={14} />{t('Back')}</button>}
              <button type="button" onClick={jumpToPresent} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-jump-present>{t('Jump To Present')}</button>
            </span>
          </div>
        </div>
      ))}
      </div>
      <div className="relative shrink-0" data-chat-bottom>
      {readOnly ? <div className="mx-4 mb-4 rounded-lg bg-bg-3 px-4 py-3 text-sm text-text-2" data-readonly-note>{readOnly}</div> : channel.guild_id === null && isRequest(channel as DmChannel) ? <RequestBanner dm={channel as DmChannel} /> : <Composer channel={channel} reply={reply} onCancelReply={() => setReply(null)} onSent={scrollToBottom} onResize={keepPinned} />}
      </div>
      </div>
    </>
  )
}

/**
 * Rows shaped like messages, standing in for history that is not loaded yet (above the oldest message, below the
 * newest one of a window that stops short of the present, or the whole list before its first page arrives). Widths
 * vary by position so the block does not look like a table; it is still while motion is reduced.
 */
function HistoryPlaceholder({ rows, label, where }: { rows: number; label: string; where: 'older' | 'newer' }) {
  const widths = [72, 46, 88, 60, 34, 80, 52, 68]
  return (
    <div className="px-4 py-2 phone:px-3" role="status" aria-label={label} data-history-placeholder={where}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 py-2.5 animate-pulse" aria-hidden>
          <span className="h-10 w-10 shrink-0 rounded-full bg-bg-3" />
          <span className="min-w-0 flex-1 space-y-2 pt-0.5">
            <span className="block h-3.5 rounded bg-bg-3" style={{ width: `${18 + (i * 7) % 14}%` }} />
            <span className="block h-3.5 rounded bg-bg-3/70" style={{ width: `${widths[i % widths.length]}%` }} />
            {i % 3 === 1 && <span className="block h-3.5 rounded bg-bg-3/70" style={{ width: `${widths[(i + 3) % widths.length]}%` }} />}
          </span>
        </div>
      ))}
    </div>
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
          <h1 className="mt-3 text-3xl font-extrabold">{shownName(other, null, notes[other.id]?.nickname)}</h1>
          <p className="text-text-1">@{other.username}</p>
          <p className="mt-2 text-text-2 text-sm">{tn('This is the beginning of your direct message history with {name}.', { name: <b>{shownName(other, null, notes[other.id]?.nickname)}</b> })}</p>
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
