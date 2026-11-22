import { ImagePlus, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { uploadImage } from '../lib/upload'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { customBadgeTip, type CustomBadge } from '../lib/customBadges'
import { CustomBadgeIcon } from '../components/Flair'
import { NetAvatar } from './AdminNetwork'

type Row = CustomBadge & { holders: number }
interface Holder { user_id: string; username: string; display_name: string; avatar_url: string | null; awarded_at: string; note: string; awarded_by: string | null }
interface Found { id: string; username: string; display_name: string; bot?: boolean; guest?: boolean; account_state?: string }
interface Draft { id?: string; name: string; description: string; emoji: string; icon_url: string; color: string }
const BLANK: Draft = { name: '', description: '', emoji: '⭐', icon_url: '', color: '#a78bfa' }

/**
 * Admin › Badges: the instance's own profile badges. Admins make one (name, why people have it, an emoji or a small
 * picture, a colour) and give it to people; it shows on their profile after the built-in badges.
 */
export default function BadgesPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = () => api.get<Row[]>('/admin/badges').then(setList).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (b: Row) => {
    const who = b.holders === 1 ? t('1 person has it.') : b.holders > 1 ? t('{n} people have it.', { n: b.holders }) : ''
    if (!confirm([t('Delete the badge {name}?', { name: b.name }), who].filter(Boolean).join(' '))) return
    try { await api.delete(`/admin/badges/${b.id}`); if (open === b.id) setOpen(null); await load() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <div className="max-w-3xl space-y-5" data-admin-badges>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold">{t('Badges')}</h1>
          <p className="mt-1 text-sm text-text-2">{t('Make badges for things that are rare and mean something here, and give them to people. They show on their profile next to the built-in badges, and everyone can see them.')}</p>
        </div>
        {!draft && <button type="button" className="btn-primary inline-flex shrink-0 items-center gap-1.5" onClick={() => setDraft({ ...BLANK })} data-badge-new><Plus size={15} />{t('New badge')}</button>}
      </div>
      {draft && !draft.id && <BadgeForm draft={draft} onCancel={() => setDraft(null)} onSaved={async () => { setDraft(null); await load() }} />}
      <div className="space-y-2">
        {list === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
        {list?.length === 0 && !draft && <p className="rounded-xl border border-dashed border-line p-4 text-sm text-text-2">{t('No badges yet.')}</p>}
        {list?.map((b) => (
          <div key={b.id} className="rounded-xl border border-line bg-bg-1" data-badge-row={b.name}>
            {draft?.id === b.id ? (
              <div className="p-3"><BadgeForm draft={draft} onCancel={() => setDraft(null)} onSaved={async () => { setDraft(null); await load() }} /></div>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5">
                <CustomBadgeIcon badge={b} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-text-0">{b.name}</div>
                  {b.description && <div className="truncate text-sm text-text-2">{b.description}</div>}
                </div>
                <button type="button" className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm ${open === b.id ? 'bg-bg-3 text-text-0' : 'text-text-1 hover:bg-bg-3'}`} onClick={() => setOpen(open === b.id ? null : b.id)} data-badge-holders={b.name}>
                  <Users size={14} />{b.holders}
                </button>
                <button type="button" className="text-text-2 hover:text-text-0" title={t('Edit')} onClick={() => setDraft({ id: b.id, name: b.name, description: b.description, emoji: b.emoji, icon_url: b.icon_url ?? '', color: b.color })} data-badge-edit={b.name}><Pencil size={15} /></button>
                <button type="button" className="text-text-2 hover:text-danger" title={t('Delete')} onClick={() => remove(b)} data-badge-delete={b.name}><Trash2 size={15} /></button>
              </div>
            )}
            {open === b.id && <Holders badge={b} onChange={load} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function BadgeForm({ draft: start, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [d, setD] = useState(start)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { const img = await uploadImage('icon', f); set({ icon_url: img.url }) } catch (e) { pushToast((e as Error).message, 'error') }
    setBusy(false)
  }
  const save = async () => {
    setBusy(true)
    const body = { name: d.name, description: d.description, emoji: d.icon_url ? '' : d.emoji, icon_url: d.icon_url, color: d.color }
    try {
      if (d.id) await api.patch(`/admin/badges/${d.id}`, body); else await api.post('/admin/badges', body)
      pushToast(d.id ? t('Badge saved') : t('Badge made'))
      onSaved()
    } catch (e) { pushToast((e as Error).message, 'error') }
    setBusy(false)
  }
  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg-1 p-4" data-badge-form>
      <div className="flex items-center gap-3">
        <CustomBadgeIcon badge={{ emoji: d.emoji, icon_url: d.icon_url || null, color: d.color }} size={40} />
        <div className="min-w-0 text-sm text-text-2">{d.name ? customBadgeTip(d) : t('How it looks on a profile')}</div>
      </div>
      <label className="block space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-text-2">{t('Name')}</span>
        <input className="input w-full" maxLength={40} placeholder={t('Bug hunter')} value={d.name} onChange={(e) => set({ name: e.target.value })} data-badge-name /></label>
      <label className="block space-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-text-2">{t('Why people have it')}</span>
        <input className="input w-full" maxLength={200} placeholder={t('Found and reported a security bug')} value={d.description} onChange={(e) => set({ description: e.target.value })} data-badge-description /></label>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-text-2">{t('Icon')}</span>
          <div className="flex items-center gap-2">
            {d.icon_url ? (
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5" onClick={() => set({ icon_url: '' })} data-badge-icon-clear><X size={14} />{t('Use an emoji instead')}</button>
            ) : (
              <>
                <input className="input w-20 text-center text-lg" value={d.emoji} onChange={(e) => set({ emoji: e.target.value })} aria-label={t('Emoji')} data-badge-emoji />
                <span className="text-sm text-text-2">{t('or')}</span>
                <button type="button" className="btn-ghost inline-flex items-center gap-1.5" disabled={busy} onClick={() => file.current?.click()}><ImagePlus size={15} />{t('Upload a picture')}</button>
                <input ref={file} type="file" accept="image/png,image/webp,image/gif,image/jpeg" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} data-badge-icon-file />
              </>
            )}
          </div>
        </div>
        <label className="space-y-1"><span className="block text-xs font-semibold uppercase tracking-wide text-text-2">{t('Colour')}</span>
          <input type="color" className="h-9 w-14 cursor-pointer rounded border border-line bg-transparent" value={d.color} onChange={(e) => set({ color: e.target.value })} data-badge-color /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="btn-primary" disabled={busy || !d.name.trim() || (!d.icon_url && !d.emoji.trim())} onClick={save} data-badge-save>{d.id ? t('Save') : t('Make badge')}</button>
      </div>
    </div>
  )
}

/** Who has a badge, and giving it to someone else. */
function Holders({ badge, onChange }: { badge: Row; onChange: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [rows, setRows] = useState<Holder[] | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [note, setNote] = useState('')
  const load = () => api.get<Holder[]>(`/admin/badges/${badge.id}/holders`).then(setRows).catch(() => setRows([]))
  useEffect(() => { void load() }, [badge.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!q.trim()) { setFound([]); return }
    const h = setTimeout(() => { api.get<Found[]>(`/admin/users?${new URLSearchParams({ q: q.trim(), limit: '8', kind: 'people' })}`).then((l) => setFound(l.filter((u) => !u.bot && !u.guest && (u.account_state ?? 'active') === 'active'))).catch(() => setFound([])) }, 200)
    return () => clearTimeout(h)
  }, [q])
  const give = async (u: Found) => {
    try { await api.put(`/admin/users/${u.id}/badges/${badge.id}`, { note }); pushToast(t('Gave {badge} to @{username}', { badge: badge.name, username: u.username })); setQ(''); setNote(''); await load(); onChange() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const take = async (h: Holder) => {
    try { await api.delete(`/admin/users/${h.user_id}/badges/${badge.id}`); await load(); onChange() } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const has = new Set(rows?.map((r) => r.user_id))
  return (
    <div className="space-y-3 border-t border-line px-3 py-3" data-badge-holder-list={badge.name}>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-48 flex-1" placeholder={t('Give it to… (search people)')} value={q} onChange={(e) => setQ(e.target.value)} data-badge-give-search />
        <input className="input min-w-40 flex-1" placeholder={t('Note for admins (optional)')} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-badge-give-note />
      </div>
      {found.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {found.map((u) => (
            <button key={u.id} type="button" disabled={has.has(u.id)} onClick={() => give(u)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-3 disabled:opacity-50" data-badge-give={u.username}>
              <UserPlus size={14} className="text-text-2" /><span className="font-medium text-text-0">{u.display_name || u.username}</span><span className="text-text-2">@{u.username}</span>
              {has.has(u.id) && <span className="ml-auto text-xs text-text-2">{t('Has it')}</span>}
            </button>
          ))}
        </div>
      )}
      {rows === null && <p className="text-sm text-text-2">{t('Loading…')}</p>}
      {rows?.length === 0 && <p className="text-sm text-text-2">{t('Nobody has it yet.')}</p>}
      {rows?.map((h) => (
        <div key={h.user_id} className="flex items-center gap-2 text-sm" data-badge-holder={h.username}>
          <NetAvatar id={h.user_id} name={h.display_name || h.username} url={h.avatar_url} size={24} />
          <Link to={`/admin/users/${h.user_id}`} className="font-medium text-text-0 hover:underline">{h.display_name || h.username}</Link>
          <span className="truncate text-text-2">{[new Date(h.awarded_at).toLocaleDateString(), h.awarded_by && t('by @{username}', { username: h.awarded_by }), h.note].filter(Boolean).join(' · ')}</span>
          <span className="flex-1" />
          <button type="button" className="text-text-2 hover:text-danger" title={t('Take it back')} onClick={() => take(h)} data-badge-take={h.username}><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}

/** The badges card on an account's admin page: what they have, taking one back, giving another. */
export function UserBadgesCard({ userId }: { userId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [all, setAll] = useState<Row[] | null>(null)
  const [mine, setMine] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const load = async () => {
    try {
      const [l, m] = await Promise.all([api.get<Row[]>('/admin/badges'), api.get<{ badge_id: string }[]>(`/admin/users/${userId}/badges`)])
      setAll(l); setMine(m.map((x) => x.badge_id))
    } catch { setAll([]) }
  }
  useEffect(() => { void load() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (p: Promise<unknown>) => { try { await p; setPick(''); await load() } catch (e) { pushToast((e as Error).message, 'error') } }
  if (!all) return null
  const has = all.filter((b) => mine.includes(b.id))
  const rest = all.filter((b) => !mine.includes(b.id))
  return (
    <section className="min-w-0 rounded-xl border border-line bg-bg-1 p-4" data-admin-card="badges">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-2">{t('Badges')}<Link to="/admin/badges" className="ml-auto text-xs normal-case tracking-normal text-accent hover:underline">{t('Manage badges')}</Link></h2>
      {all.length === 0 ? <p className="text-sm text-text-2">{t('This instance has no badges yet.')}</p> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {has.length === 0 && <span className="text-sm text-text-2">{t('None')}</span>}
            {has.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5 rounded-full bg-bg-3 py-0.5 pl-0.5 pr-2 text-sm" title={customBadgeTip(b)} data-user-badge={b.name}>
                <CustomBadgeIcon badge={b} />{b.name}
                <button type="button" className="text-text-2 hover:text-danger" title={t('Take it back')} onClick={() => act(api.delete(`/admin/users/${userId}/badges/${b.id}`))} data-user-badge-take={b.name}><X size={13} /></button>
              </span>
            ))}
          </div>
          {rest.length > 0 && (
            <div className="flex gap-2">
              <select className="input flex-1" value={pick} onChange={(e) => setPick(e.target.value)} data-user-badge-pick>
                <option value="">{t('Give a badge…')}</option>
                {rest.map((b) => <option key={b.id} value={b.id}>{b.emoji ? `${b.emoji} ` : ''}{b.name}</option>)}
              </select>
              <button type="button" className="btn-primary" disabled={!pick} onClick={() => act(api.put(`/admin/users/${userId}/badges/${pick}`, {}))} data-user-badge-give>{t('Give')}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
