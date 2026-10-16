import { ChevronLeft, Compass, Hash, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import MessageItem from '../components/MessageItem'
import SplitLayout, { useShowContent } from '../components/SplitLayout'
import { MobileBack } from '../components/HeaderBits'
import { api } from '../lib/api'
import type { Listing } from '../lib/discover'
import { formatDateDivider, sameDay, colorFor, initials } from '../lib/format'
import type { Channel, Guild, Message } from '../lib/types'
import { useStore } from '../store'

interface Preview { guild: Guild; channels: Channel[]; listing: Listing | null; joined: boolean }

/**
 * Discord's server preview: a non-member can browse the public channels and read history, with a
 * "preview mode" bar in place of the composer. Members are sent to the real server view.
 */
export default function GuildPreviewPage() {
  const { guildId = '', channelId } = useParams()
  const navigate = useNavigate()
  const member = useStore((s) => !!s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const [pv, setPv] = useState<Preview | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const showContent = useShowContent()
  useEffect(() => { api.get<Preview>(`/discover/${guildId}/preview`).then(setPv).catch(() => setPv(null)) }, [guildId])
  if (member) return <Navigate to={`/channels/${guildId}`} replace />
  if (pv === null) return <Navigate to="/discover" replace />
  const channel = pv?.channels.find((c) => c.id === channelId) ?? pv?.channels[0]
  if (pv && channel && channel.id !== channelId) return <Navigate to={`/discover/${guildId}/${channel.id}`} replace />
  const join = async () => {
    setJoining(true)
    try { const g = await api.post<Guild & { channels: Channel[] }>(`/discover/${guildId}/join`, {}); upsertGuild(g); pushToast(`Welcome to ${g.name}!`); navigate(`/channels/${g.id}`) } catch (e) { pushToast((e as Error).message, 'error'); setJoining(false) }
  }
  return (
    <SplitLayout defaultPane="content" testid={{ 'data-guild-preview': guildId }} sidebar={
          <aside className="w-[272px] max-md:flex-1 shrink-0 bg-bg-1 flex flex-col">
            {pv ? (
              <>
                {pv.guild.banner_url ? (
                  <div className="relative h-[135px] bg-cover bg-center" style={{ backgroundImage: `url(${pv.guild.banner_url})` }}>
                    <div className="absolute inset-x-0 top-0 h-12 px-4 flex items-center font-bold text-white bg-gradient-to-b from-black/60 to-transparent drop-shadow truncate">{pv.guild.name}</div>
                  </div>
                ) : <div className="h-12 px-4 flex items-center font-bold border-b border-line truncate">{pv.guild.name}</div>}
                <div className="px-4 py-3 border-b border-line flex items-center gap-2 text-xs text-text-2" data-preview-badge><Compass size={14} /> Previewing from Discover</div>
                <div className="flex-1 overflow-y-auto px-2 pt-3">
                  <div className="px-1 mb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Text Channels</div>
                  <div className="space-y-0.5">
                    {pv.channels.map((c) => (
                      <button key={c.id} type="button" onClick={() => { navigate(`/discover/${guildId}/${c.id}`); showContent() }} data-preview-channel={c.name} className={`w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] text-left ${c.id === channel?.id ? 'bg-bg-4 text-text-0' : 'text-text-2 hover:bg-bg-3 hover:text-text-1'}`}>
                        <Hash size={18} className="text-text-2" /><span className="truncate">{c.name}</span>
                      </button>
                    ))}
                    {pv.channels.length === 0 && <p className="px-2 py-4 text-sm text-text-2">This server has no public channels to preview.</p>}
                  </div>
                </div>
              </>
            ) : <div className="p-4 text-sm text-text-2">Loading…</div>}
          </aside>
    }>
        <header className="h-12 shrink-0 px-4 max-md:px-2 flex items-center gap-2 border-b border-line shadow-sm">
          <MobileBack />
          <button type="button" onClick={() => navigate('/discover')} className="h-8 w-8 -ml-2 max-md:ml-0 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" title="Back to Discover"><ChevronLeft size={20} /></button>
          {channel ? <><Hash size={22} className="text-text-2 shrink-0" /><span className="font-bold truncate">{channel.name}</span>{channel.topic && <><span className="mx-2 h-6 w-px bg-line" /><span className="text-sm text-text-2 truncate">{channel.topic}</span></>}</> : <span className="font-bold">Preview</span>}
          {pv?.listing && <span className="ml-auto flex items-center gap-3 text-xs text-text-2 max-md:hidden"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />{pv.listing.online_count.toLocaleString()} Online</span><span className="flex items-center gap-1.5"><Users size={12} />{pv.listing.member_count.toLocaleString()} Members</span></span>}
        </header>
        {pv && channel ? <PreviewMessages guildId={guildId} channel={channel} guild={pv.guild} /> : <div className="flex-1" />}
        <div className="shrink-0 m-4 mt-0 rounded-xl bg-bg-1 border border-line px-4 py-3 flex items-center gap-4 max-md:flex-col max-md:items-stretch" data-preview-bar>
          <span className="h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center text-white font-bold shrink-0" style={{ background: pv?.guild.icon_url ? undefined : colorFor(guildId) }}>{pv?.guild.icon_url ? <img src={pv.guild.icon_url} alt="" className="h-full w-full object-cover" /> : initials(pv?.guild.name ?? '?')}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">You are currently in preview mode.</div>
            <div className="text-sm text-text-2">Join this server to start chatting{pv?.listing?.description ? ` — ${pv.listing.description}` : '.'}</div>
          </div>
          <button type="button" onClick={join} disabled={joining || !pv} className="btn-primary bg-success hover:bg-success/80 text-black whitespace-nowrap max-md:justify-center" data-preview-join>{joining ? 'Joining…' : `Join ${pv?.guild.name ?? 'Server'}`}</button>
        </div>
    </SplitLayout>
  )
}

function PreviewMessages({ guildId, channel, guild }: { guildId: string; channel: Channel; guild: Guild }) {
  const me = useStore((s) => s.user)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setMessages(null)
    api.get<Message[]>(`/discover/${guildId}/channels/${channel.id}/messages`).then((ms) => { setMessages(ms); setMore(ms.length >= 50) }).catch(() => setMessages([]))
  }, [guildId, channel.id])
  useEffect(() => { const el = document.querySelector('[data-preview-scroll]'); if (el && messages) el.scrollTop = el.scrollHeight }, [messages])
  const loadMore = async () => {
    if (!messages?.length || loading) return
    setLoading(true)
    try { const older = await api.get<Message[]>(`/discover/${guildId}/channels/${channel.id}/messages?before=${messages[0].id}`); setMessages([...older, ...messages]); setMore(older.length >= 50) } catch { /* ignore */ } finally { setLoading(false) }
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-preview-scroll>
      {messages === null && <p className="p-4 text-sm text-text-2">Loading…</p>}
      {messages && (
        <>
          {more ? <div className="p-3 text-center"><button type="button" onClick={loadMore} disabled={loading} className="btn-ghost">{loading ? 'Loading…' : 'Load older messages'}</button></div> : (
            <div className="px-4 pt-12 pb-4">
              <div className="h-16 w-16 rounded-full bg-bg-4 flex items-center justify-center text-text-1"><Hash size={34} /></div>
              <h1 className="mt-3 text-3xl font-extrabold">Welcome to #{channel.name}!</h1>
              <p className="text-text-2">This is the start of the #{channel.name} channel in {guild.name}.</p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || !sameDay(prev.created_at, m.created_at)
            const grouped = !!prev && !newDay && prev.author.id === m.author.id && !m.reply_to
            return (
              <div key={m.id}>
                {newDay && <div className="mx-4 my-3 flex items-center"><div className="h-px flex-1 bg-line" /><span className="px-2 text-[11px] font-semibold text-text-2">{formatDateDivider(m.created_at)}</span><div className="h-px flex-1 bg-line" /></div>}
                <MessageItem message={m} grouped={grouped} isOwn={m.author.id === me?.id} onReply={() => {}} replyTarget={m.reply_to ? messages.find((x) => x.id === m.reply_to) ?? null : null} />
              </div>
            )
          })}
          {messages.length === 0 && <p className="px-4 pb-6 text-sm text-text-2">No messages here yet.</p>}
        </>
      )}
    </div>
  )
}
