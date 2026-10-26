import { BarChart3, Check, Lock } from 'lucide-react'
import Avatar from './Avatar'
import Emoji from './Emoji'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Message, Poll } from '../lib/types'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'

const remaining = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'closing…'
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
  if (h >= 48) return `${Math.round(h / 24)} days left`
  if (h >= 1) return `${h}h ${m}m left`
  return `${Math.max(1, m)}m left`
}

/** A poll inside a message: vote (toggle), live bars, close early, final results. */
export default function PollCard({ m, poll }: { m: Message; poll: Poll }) {
  const me = useStore((s) => s.user?.id)
  const pushToast = useStore((s) => s.pushToast)
  const perms = useStore((s) => myChannelPerms(s, m.channel_id))
  const channel = useStore((s) => s.channels[m.channel_id] ?? s.dms[m.channel_id])
  const applyPollUpdate = useStore((s) => s.applyPollUpdate)
  const [busy, setBusy] = useState(false)
  // "View votes": who picked each answer, one answer at a time.
  const [votersFor, setVotersFor] = useState<string | null>(null)
  const [voters, setVoters] = useState<{ id: string; display_name: string; avatar_url: string | null }[] | null>(null)
  useEffect(() => {
    if (!votersFor) return
    let live = true
    setVoters(null)
    api.get<{ id: string; display_name: string; avatar_url: string | null }[]>(`/channels/${m.channel_id}/messages/${m.id}/poll/${votersFor}/voters`).then((v) => { if (live) setVoters(v) }).catch((e: Error) => pushToast(e.message, 'error'))
    return () => { live = false }
  }, [votersFor, m.channel_id, m.id, poll.total_votes, pushToast])
  const [, tick] = useState(0)
  useEffect(() => { if (!poll.expires_at || poll.closed) return; const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [poll.expires_at, poll.closed])
  const expired = !!poll.expires_at && new Date(poll.expires_at).getTime() <= Date.now()
  const closed = poll.closed || expired
  const voted = poll.options.some((o) => o.me)
  const showResults = closed || voted
  const canClose = !closed && (m.author.id === me || (!!channel && channel.guild_id !== null && has(perms, P.MANAGE_MESSAGES)))
  const apply = (p: Poll) => applyPollUpdate(m.channel_id, m.id, { ...p, options: p.options.map((o) => ({ ...o, me: false })) }) // then restore me from the response below
  const setFromResponse = (p: Poll) => useStore.setState((s) => ({ messages: { ...s.messages, [m.channel_id]: (s.messages[m.channel_id] ?? []).map((x) => (x.id === m.id ? { ...x, poll: p } : x)) } }))
  const vote = async (oid: string, isMine: boolean) => {
    if (closed || busy) return
    setBusy(true)
    try { setFromResponse(isMine ? await api.delete<Poll>(`/channels/${m.channel_id}/messages/${m.id}/poll/${oid}`) : await api.put<Poll>(`/channels/${m.channel_id}/messages/${m.id}/poll/${oid}`)) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const close = async () => {
    setBusy(true)
    try { setFromResponse(await api.post<Poll>(`/channels/${m.channel_id}/messages/${m.id}/poll/close`)) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  void apply
  return (
    <div className="mt-1 max-w-[520px] rounded-xl border border-line bg-bg-1 p-3" data-poll data-poll-closed={closed ? '1' : '0'} data-poll-votes={poll.total_votes}>
      <div className="flex items-start gap-2">
        <BarChart3 size={18} className="text-text-2 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] break-words" data-poll-question>{poll.question}</div>
          <div className="text-xs text-text-2">{poll.multi ? 'Select one or more' : 'Select one answer'}</div>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((o) => {
          const pct = poll.total_votes > 0 ? Math.round((o.votes / poll.total_votes) * 100) : 0
          return (
            <button key={o.id} type="button" disabled={closed || busy} onClick={() => vote(o.id, o.me)} aria-pressed={o.me}
              className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition ${o.me ? 'border-accent' : 'border-line'} ${closed ? 'cursor-default' : 'hover:bg-bg-3'}`} data-poll-option={o.id} data-poll-option-votes={o.votes} data-poll-mine={o.me ? '1' : '0'}>
              {showResults && <span className={`absolute inset-y-0 left-0 ${o.me ? 'bg-accent/30' : 'bg-bg-4'}`} style={{ width: `${pct}%` }} aria-hidden />}
              <span className="relative flex items-center gap-2">
                <span className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${o.me ? 'border-accent bg-accent text-white' : 'border-text-2'}`}>{o.me && <Check size={11} />}</span>
                {o.emoji && <span className="shrink-0" data-poll-option-emoji={o.emoji}><Emoji value={o.emoji} size={20} /></span>}
                <span className="flex-1 break-words">{o.text}</span>
                {showResults && <span className="text-xs text-text-2 tabular-nums">{pct}%</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-text-2">
        <span data-poll-summary>{poll.voters} vote{poll.voters === 1 ? '' : 's'}</span>
        <span>·</span>
        {closed ? <span className="flex items-center gap-1" data-poll-final><Lock size={11} /> Final results</span> : poll.expires_at ? <span>{remaining(poll.expires_at)}</span> : <span>No end time</span>}
        {showResults && poll.total_votes > 0 && <button type="button" onClick={() => setVotersFor(votersFor ? null : (poll.options.find((o) => o.votes > 0) ?? poll.options[0]).id)} className="text-sky-400 hover:underline" data-poll-view-votes>{votersFor ? 'Hide votes' : 'View votes'}</button>}
        {canClose && <button type="button" onClick={close} disabled={busy} className="ml-auto text-sky-400 hover:underline" data-poll-close>Close poll</button>}
      </div>
      {votersFor && (
        <div className="mt-2 flex gap-2 rounded-lg border border-line bg-bg-2 p-2 text-sm" data-poll-voters>
          <div className="w-36 shrink-0 space-y-0.5">
            {poll.options.map((o) => (
              <button key={o.id} type="button" onClick={() => setVotersFor(o.id)} className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left ${o.id === votersFor ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'}`} data-poll-voters-tab={o.id}>
                {o.emoji && <Emoji value={o.emoji} size={16} />}<span className="min-w-0 flex-1 truncate">{o.text}</span><span className="text-xs text-text-2 tabular-nums">{o.votes}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 max-h-48 overflow-y-auto">
            {!voters ? <p className="px-2 py-1 text-text-2">Loading…</p> : voters.length === 0 ? <p className="px-2 py-1 text-text-2">No votes for this answer.</p>
              : voters.map((u) => <div key={u.id} className="flex items-center gap-2 px-2 py-1" data-poll-voter={u.display_name}><Avatar user={u} size={20} /><span className="truncate">{u.display_name}</span></div>)}
          </div>
        </div>
      )}
    </div>
  )
}
