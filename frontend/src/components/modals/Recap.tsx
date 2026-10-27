import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { locale, useT, tn } from '../../lib/i18n'
import Emoji from '../Emoji'
import Modal from '../Modal'

interface Recap {
  year: number; years?: number[]; messages: number; active_days: number; characters: number; dm_messages: number
  months: { month: number; messages: number }[]; busiest_day: { day: string; messages: number } | null
  top_servers: { id: string; name: string; icon_url: string | null; messages: number }[]
  top_channels: { id: string; name: string; guild: string | null; messages: number }[]
  top_emoji: { emoji: string; count: number }[]; reactions_received: number; new_friends: number; servers_joined: number
}

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString(locale(), { month: 'short' })

/** Your year on the instance, counted from your own activity (only you see it). */
export default function RecapModal({ onClose, year: initial }: { onClose: () => void; year?: number }) {
  const t = useT()
  const [year, setYear] = useState(initial ?? new Date().getFullYear())
  const [r, setR] = useState<Recap | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // Years with activity (from the server), kept while another year loads so the picker never loses its way back.
  const [years, setYears] = useState<number[]>([new Date().getFullYear()])
  useEffect(() => { setR(null); api.get<Recap>(`/users/@me/recap?year=${year}`).then((x) => { setR(x); if (x.years?.length) setYears(x.years) }).catch(() => setR(null)) }, [year])
  const max = Math.max(1, ...(r?.months.map((m) => m.messages) ?? [1]))
  const big = (n: number, label: string, key: string) => <div className="rounded-xl bg-bg-0/60 p-3" data-recap-stat={key}><div className="text-2xl font-black tabular-nums">{n.toLocaleString()}</div><div className="text-xs text-text-2">{label}</div></div>
  return (
    <Modal title={t('Your {year} in review', { year })} subtitle={t('Only you can see this.')} onClose={onClose} width="max-w-lg">
      <div className="space-y-4" data-recap>
        {years.length > 1 && <div className="flex flex-wrap gap-1" data-recap-years>{[...years].sort((a, b) => a - b).map((y) => <button key={y} type="button" onClick={() => setYear(y)} aria-pressed={y === year} className={`rounded-full px-3 py-0.5 text-xs font-semibold ${y === year ? 'bg-accent text-white' : 'bg-bg-3'}`} data-recap-year={y}>{y}</button>)}</div>}
        {!r ? <p className="text-sm text-text-2">{t('Counting…')}</p> : r.messages === 0 ? <p className="text-sm text-text-2" data-recap-empty>{t('No messages in {year} yet.', { year: r.year })}</p> : <>
          <div className="grid grid-cols-3 gap-2">{big(r.messages, t('messages sent'), 'messages')}{big(r.active_days, t('days you chatted'), 'days')}{big(r.reactions_received, t('reactions you got'), 'reactions')}</div>
          <figure className="rounded-xl bg-bg-0/60 p-3" data-recap-months>
            <figcaption className="mb-2 flex justify-between text-sm"><span className="font-semibold">{t('Messages by month')}</span><span className="text-xs text-text-2">{hover !== null ? `${monthName(hover + 1)}: ${r.months[hover].messages.toLocaleString()}` : r.busiest_day ? t('busiest day: {day}', { day: new Date(`${r.busiest_day.day}T00:00:00`).toLocaleDateString(locale(), { month: 'long', day: 'numeric' }) }) : ''}</span></figcaption>
            <div className="flex h-24 items-end gap-1" onMouseLeave={() => setHover(null)}>
              {r.months.map((m, i) => <div key={m.month} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>{m.messages > 0 && <div className={`w-full rounded-t ${hover === i ? 'bg-accent' : 'bg-accent/70'}`} style={{ height: `${Math.max(3, (m.messages / max) * 100)}%` }} />}</div>)}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-text-2"><span>{monthName(1)}</span><span>{monthName(12)}</span></div>
          </figure>
          {r.top_servers.length > 0 && <div><h3 className="label">{t('Where you talked most')}</h3>{r.top_servers.map((s, i) => <div key={s.id} className="flex items-center gap-2 py-0.5 text-sm" data-recap-server={s.name}><span className="w-4 text-text-2">{i + 1}</span><span className="flex-1 truncate font-medium">{s.name}</span><span className="tabular-nums text-text-2">{s.messages.toLocaleString()}</span></div>)}</div>}
          {r.top_channels.length > 0 && <div><h3 className="label">{t('Favourite channels')}</h3>{r.top_channels.map((c) => <div key={c.id} className="flex items-center gap-2 py-0.5 text-sm"><span className="flex-1 truncate">#{c.name} <span className="text-text-2">· {c.guild}</span></span><span className="tabular-nums text-text-2">{c.messages.toLocaleString()}</span></div>)}</div>}
          {r.top_emoji.length > 0 && <div><h3 className="label">{t('Your go-to reactions')}</h3><div className="flex gap-3">{r.top_emoji.map((e) => <span key={e.emoji} className="flex items-center gap-1 text-sm"><Emoji value={e.emoji} size={24} /><span className="text-text-2">{e.count}</span></span>)}</div></div>}
          <p className="text-sm text-text-1">{tn('You made {friends}, joined {servers} and sent {messages}.', { friends: <><b>{r.new_friends}</b> {r.new_friends === 1 ? t('new friend') : t('new friends')}</>, servers: <><b>{r.servers_joined}</b> {r.servers_joined === 1 ? t('server') : t('servers')}</>, messages: <><b>{r.dm_messages.toLocaleString()}</b> {r.dm_messages === 1 ? t('direct message') : t('direct messages')}</> })}</p>
        </>}
      </div>
    </Modal>
  )
}
