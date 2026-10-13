import { Hash, Users } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Channel, DmChannel, Message } from '../lib/types'
import { formatDateDivider, sameDay } from '../lib/format'
import MessageItem from './MessageItem'
import Composer from './Composer'
import Avatar from './Avatar'

export default function ChatView({ channel }: { channel: Channel | DmChannel }) {
  const messages = useStore((s) => s.messages[channel.id])
  const hasMore = useStore((s) => s.hasMore[channel.id])
  const loading = useStore((s) => !!s.loadingMessages[channel.id])
  const loadMessages = useStore((s) => s.loadMessages)
  const markRead = useStore((s) => s.markRead)
  const setActiveChannel = useStore((s) => s.setActiveChannel)
  const lastId = useStore((s) => s.lastMessageId[channel.id])
  const user = useStore((s) => s.user)
  const [reply, setReply] = useState<Message | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const prevHeight = useRef(0)
  const isDm = channel.guild_id === null
  const other = isDm ? (channel as DmChannel).recipients[0] : null

  useEffect(() => {
    setActiveChannel(channel.id)
    setReply(null)
    stickBottom.current = true
    if (!messages) loadMessages(channel.id)
    return () => setActiveChannel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id])

  // Mark read when viewing and tab visible.
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible') markRead(channel.id) }
    mark()
    document.addEventListener('visibilitychange', mark)
    window.addEventListener('focus', mark)
    return () => { document.removeEventListener('visibilitychange', mark); window.removeEventListener('focus', mark) }
  }, [channel.id, lastId, markRead])

  // Keep scroll pinned to bottom on new messages, or preserve position when prepending history.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickBottom.current) {
      el.scrollTop = el.scrollHeight
    } else if (prevHeight.current && el.scrollHeight > prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current
    }
    prevHeight.current = el.scrollHeight
  }, [messages])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (el.scrollTop < 120 && hasMore !== false && !loading && messages?.length) {
      prevHeight.current = el.scrollHeight
      loadMessages(channel.id, messages[0].id)
    }
  }, [channel.id, hasMore, loading, messages, loadMessages])

  const scrollToBottom = () => { stickBottom.current = true; const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-2">
      <header className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-line shadow-sm">
        {isDm && other ? (
          <><Avatar user={other} size={24} presence /><span className="font-bold">{other.display_name}</span><span className="text-text-2 text-sm">@{other.username}</span></>
        ) : (
          <>
            <Hash size={22} className="text-text-2" />
            <span className="font-bold">{channel.name}</span>
            {channel.topic && <><span className="mx-2 h-6 w-px bg-line" /><span className="text-sm text-text-2 truncate">{channel.topic}</span></>}
          </>
        )}
        {!isDm && <span className="ml-auto text-text-2" title="Member List"><Users size={20} /></span>}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col justify-end">
          {hasMore === false || (messages && messages.length < 50 && !loading) ? (
            <ChannelIntro channel={channel} />
          ) : loading ? (
            <div className="py-4 text-center text-xs text-text-2">Loading history…</div>
          ) : null}
          <div className="pb-4">
            {messages?.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || !sameDay(prev.created_at, m.created_at)
              const grouped = !!prev && !newDay && prev.author.id === m.author.id && !m.reply_to
                && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60 * 1000
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="relative my-4 mx-4 flex items-center">
                      <div className="h-px flex-1 bg-line" /><span className="px-2 text-[11px] font-semibold text-text-2">{formatDateDivider(m.created_at)}</span><div className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <MessageItem message={m} grouped={grouped} isOwn={m.author.id === user?.id} onReply={() => setReply(m)} replyTarget={m.reply_to ? messages.find((x) => x.id === m.reply_to) ?? null : null} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Composer channel={channel} reply={reply} onCancelReply={() => setReply(null)} onSent={scrollToBottom} />
    </main>
  )
}

function ChannelIntro({ channel }: { channel: Channel | DmChannel }) {
  const isDm = channel.guild_id === null
  const other = isDm ? (channel as DmChannel).recipients[0] : null
  return (
    <div className="px-4 pt-12 pb-4 fade-in">
      {other ? (
        <>
          <Avatar user={other} size={80} />
          <h1 className="mt-3 text-3xl font-extrabold">{other.display_name}</h1>
          <p className="text-text-1">@{other.username}</p>
          <p className="mt-2 text-text-2 text-sm">This is the beginning of your direct message history with <b>{other.display_name}</b>.</p>
        </>
      ) : (
        <>
          <div className="h-16 w-16 rounded-full bg-bg-4 flex items-center justify-center"><Hash size={40} /></div>
          <h1 className="mt-3 text-3xl font-extrabold">Welcome to #{channel.name}!</h1>
          <p className="text-text-2">This is the start of the #{channel.name} channel.{channel.topic ? ` ${channel.topic}` : ''}</p>
        </>
      )}
    </div>
  )
}
