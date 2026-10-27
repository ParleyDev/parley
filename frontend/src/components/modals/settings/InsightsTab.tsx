import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { locale, t as tr, useT } from '../../../lib/i18n'

interface Day { day: string; joins: number; leaves: number; messages: number; communicators: number }
interface Insights {
  days: number
  totals: { members: number; joins: number; leaves: number; messages: number; communicators: number }
  daily: Day[]
  top_channels: { id: string; name: string; messages: number }[]
  join_sources: { via: string; count: number }[]
  retention: { cohort: number; stayed: number; talked_first_week: number }
}

const sources = (): Record<string, string> => ({ invite: tr('Invite links'), vanity: tr('Vanity link'), discover: tr('Discovery'), template: tr('Template'), other: tr('Other') })
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' })
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')

/** One measure per day as thin bars (single series: the title names it, no legend). Hover shows the day's value. */
function DailyBars({ title, data, field }: { title: string; data: Day[]; field: keyof Omit<Day, 'day'> }) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d[field]))
  const h = hover !== null ? data[hover] : null
  return (
    <figure className="rounded-xl border border-line bg-bg-1 p-3" data-insights-chart={field}>
      <figcaption className="mb-2 flex items-baseline justify-between text-sm"><span className="font-semibold">{title}</span><span className="text-xs text-text-2" data-insights-hover>{h ? `${dayLabel(h.day)}: ${h[field].toLocaleString()}` : t('peak {n}', { n: max.toLocaleString() })}</span></figcaption>
      <div className="flex h-24 items-end gap-0.5 border-b border-line" role="img" aria-label={t('{title} per day', { title })} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} data-insights-day={d.day}>
            {d[field] > 0 && <div className={`w-full max-w-6 rounded-t ${hover === i ? 'bg-accent' : 'bg-accent/70'}`} style={{ height: `${Math.max(3, (d[field] / max) * 100)}%` }} />}
          </div>
        ))}
      </div>
      {data.length > 0 && <div className="mt-1 flex justify-between text-[11px] text-text-2"><span>{dayLabel(data[0].day)}</span><span>{dayLabel(data[data.length - 1].day)}</span></div>}
    </figure>
  )
}

/** Server Settings › Insights: growth, engagement and retention. */
export default function InsightsTab({ guildId }: { guildId: string }) {
  const t = useT()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Insights | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setData(null); api.get<Insights>(`/guilds/${guildId}/insights?days=${days}`).then(setData).catch((e) => setErr((e as Error).message)) }, [guildId, days])
  const tile = (label: string, value: string, note?: string, key?: string) => (
    <div className="rounded-xl border border-line bg-bg-1 p-3" data-insights-tile={key}>
      <div className="text-xs text-text-2">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {note && <div className="text-xs text-text-2">{note}</div>}
    </div>
  )
  const maxCh = Math.max(1, ...(data?.top_channels.map((c) => c.messages) ?? [1]))
  return (
    <div className="space-y-5" data-insights-tab>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-bold">{t('Server Insights')}</h1><p className="mt-1 text-sm text-text-2">{t('How the server is growing and how active it is. Days are in UTC.')}</p></div>
        <div className="flex gap-1" data-insights-range>{[7, 30, 90].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full px-3 py-1 text-xs font-semibold ${days === d ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-insights-days={d}>{t('{n} days', { n: d })}</button>)}</div>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      {!data ? !err && <p className="text-sm text-text-2">{t('Loading…')}</p> : (
        <>
          <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
            {tile(t('Members'), data.totals.members.toLocaleString(), undefined, 'members')}
            {tile(t('Net growth'), `${data.totals.joins - data.totals.leaves >= 0 ? '+' : ''}${(data.totals.joins - data.totals.leaves).toLocaleString()}`, t('{joined} joined · {left} left', { joined: data.totals.joins, left: data.totals.leaves }), 'net')}
            {tile(t('Messages'), data.totals.messages.toLocaleString(), undefined, 'messages')}
            {tile(t('Members who talked'), data.totals.communicators.toLocaleString(), t('{pct} of members', { pct: pct(data.totals.communicators, data.totals.members) }), 'communicators')}
          </div>
          <DailyBars title={t('New members')} data={data.daily} field="joins" />
          <DailyBars title={t('Messages')} data={data.daily} field="messages" />
          <DailyBars title={t('Members who talked')} data={data.daily} field="communicators" />
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <section className="rounded-xl border border-line bg-bg-1 p-3" data-insights-channels>
              <h2 className="mb-2 text-sm font-semibold">{t('Busiest channels')}</h2>
              {data.top_channels.length === 0 ? <p className="text-sm text-text-2">{t('No messages yet.')}</p> : data.top_channels.map((c) => (
                <div key={c.id} className="mb-1.5 text-sm" data-insights-channel={c.name}>
                  <div className="flex justify-between"><span className="truncate">#{c.name}</span><span className="tabular-nums text-text-2">{c.messages.toLocaleString()}</span></div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-bg-3"><div className="h-full rounded-full bg-accent/70" style={{ width: `${(c.messages / maxCh) * 100}%` }} /></div>
                </div>
              ))}
            </section>
            <section className="rounded-xl border border-line bg-bg-1 p-3 space-y-3">
              <div data-insights-sources>
                <h2 className="mb-1 text-sm font-semibold">{t('How people joined')}</h2>
                {data.join_sources.length === 0 ? <p className="text-sm text-text-2">{t('Nobody joined in this period.')}</p> : data.join_sources.map((s) => <div key={s.via} className="flex justify-between text-sm"><span>{sources()[s.via] ?? s.via}</span><span className="tabular-nums text-text-2">{s.count}</span></div>)}
              </div>
              <div data-insights-retention>
                <h2 className="mb-1 text-sm font-semibold">{t('New member retention')}</h2>
                {data.retention.cohort === 0 ? <p className="text-sm text-text-2">{t('Not enough newcomers yet (people who joined at least a week ago).')}</p> : <>
                  <div className="flex justify-between text-sm"><span>{t('Still here')}</span><span className="tabular-nums">{pct(data.retention.stayed, data.retention.cohort)}</span></div>
                  <div className="flex justify-between text-sm"><span>{t('Talked in their first week')}</span><span className="tabular-nums">{pct(data.retention.talked_first_week, data.retention.cohort)}</span></div>
                  <p className="text-xs text-text-2">{t('Of {n} who joined at least a week ago.', { n: data.retention.cohort })}</p>
                </>}
              </div>
            </section>
          </div>
          <details className="text-sm"><summary className="cursor-pointer text-text-2">{t('Show as a table')}</summary>
            <table className="mt-2 w-full text-left text-xs tabular-nums" data-insights-table>
              <thead className="text-text-2"><tr><th className="py-1">{t('Day')}</th><th>{t('Joined')}</th><th>{t('Left')}</th><th>{t('Messages')}</th><th>{t('Talked')}</th></tr></thead>
              <tbody>{data.daily.map((d) => <tr key={d.day} className="border-t border-line"><td className="py-1">{dayLabel(d.day)}</td><td>{d.joins}</td><td>{d.leaves}</td><td>{d.messages}</td><td>{d.communicators}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </div>
  )
}
