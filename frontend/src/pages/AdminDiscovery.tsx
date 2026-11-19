import { Check, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bgUrl } from '../lib/crop'
import { CropLayer } from '../components/CropImg'
import { api } from '../lib/api'
import { categoryLabel, type Listing } from '../lib/discover'
import { colorFor } from '../lib/format'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** Admin: pending submissions with Approve / Reject (optional note), plus tabs for the other states. */
export default function ReviewQueue({ onChange }: { onChange?: (pending: number) => void }) {
  const t = useT()
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [list, setList] = useState<Listing[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const pushToast = useStore((s) => s.pushToast)
  const load = useMemo(() => () => api.get<Listing[]>(`/admin/discovery?status=${status}`).then((l) => { setList(l); if (status === 'pending') onChange?.(l.length) }).catch(() => setList([])), [status, onChange])
  useEffect(() => { setList(null); load() }, [load])
  const decide = async (l: Listing, next: 'approved' | 'rejected' | 'pending') => {
    try { await api.post(`/admin/discovery/${l.guild_id}/review`, { status: next, note: notes[l.guild_id] ?? '' }); pushToast(t('{name} {status}', { name: l.name, status: t(next) })); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const flag = async (l: Listing, patch: { featured_order?: number | null; verified?: boolean; partnered?: boolean }) => {
    try { await api.patch(`/admin/discovery/${l.guild_id}`, patch); load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div data-review-queue>
      <h1 className="text-2xl font-bold">{t('Discovery Queue')}</h1>
      <p className="text-sm text-text-2 mt-1">{t('Servers submitted for Discover. Approved servers are public to everyone on this Parley instance.')}</p>
      <div className="mt-4 flex gap-1 border-b border-line">
        {(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} type="button" onClick={() => setStatus(s)} data-review-tab={s} className={`px-3 py-2 text-sm font-semibold capitalize border-b-2 -mb-px ${status === s ? 'text-text-0 border-text-0' : 'text-text-1 border-transparent hover:text-text-0'}`}>{t(s)}</button>)}
      </div>
      <div className="mt-4 space-y-3">
        {list === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
        {list?.length === 0 && <p className="text-sm text-text-2 py-6">{t('Nothing {status} right now.', { status: t(status) })}</p>}
        {list?.map((l) => (
          <div key={l.guild_id} className="rounded-xl border border-line bg-bg-1 p-4 flex gap-4 phone:flex-col" data-review-item={l.guild_id}>
            <div className="relative isolate h-20 w-32 shrink-0 rounded-lg bg-cover bg-center" style={{ backgroundImage: `${bgUrl(l.banner_url) ? `${bgUrl(l.banner_url)}, ` : ''}linear-gradient(135deg, ${colorFor(l.guild_id)}, #1a1b23)` }}><CropLayer url={l.banner_url} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-bold">{l.name}<span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold uppercase text-text-1">{t(categoryLabel(l.category))}</span><span className="text-xs font-normal text-text-2">{t('{n} members', { n: l.member_count })}</span></div>
              <p className="text-sm text-text-1 mt-1">{l.description}</p>
              <p className="text-xs text-text-2 mt-1">{t('Submitted {date}', { date: new Date(l.submitted_at).toLocaleString() })}{l.note ? ` · ${t('Note: {note}', { note: l.note })}` : ''}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <input value={notes[l.guild_id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [l.guild_id]: e.target.value }))} placeholder={t('Note to the server owner (optional)')} maxLength={500} data-review-note className="input py-1.5 text-sm flex-1 min-w-[200px]" />
                {status !== 'approved' && <button type="button" onClick={() => decide(l, 'approved')} className="btn-primary bg-success hover:bg-success/80 text-black py-1.5" data-approve><Check size={16} /> {t('Approve')}</button>}
                {status !== 'rejected' && <button type="button" onClick={() => decide(l, 'rejected')} className="btn-danger py-1.5" data-reject><X size={16} /> {t('Reject')}</button>}
                {status !== 'pending' && <button type="button" onClick={() => decide(l, 'pending')} className="btn-ghost py-1.5">{t('Back to pending')}</button>}
              </div>
              {status === 'approved' && (
                <div className="mt-3 flex items-center gap-4 flex-wrap text-sm" data-review-flags>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={l.verified} onChange={(e) => flag(l, { verified: e.target.checked })} className="h-4 w-4 accent-accent" data-review-verified /> {t('Verified badge')}</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!l.partnered} onChange={(e) => flag(l, { partnered: e.target.checked })} className="h-4 w-4 accent-accent" data-review-partnered /> {t('Partnered')}</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={l.featured_order !== null} onChange={(e) => flag(l, { featured_order: e.target.checked ? 0 : null })} className="h-4 w-4 accent-accent" data-review-featured /> {t('Featured')}</label>
                  {l.featured_order !== null && <label className="flex items-center gap-2">{t('order')} <input type="number" min={0} max={1000} defaultValue={l.featured_order} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== l.featured_order) flag(l, { featured_order: n }) }} className="input w-20 py-1 text-xs" data-review-featured-order /></label>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
