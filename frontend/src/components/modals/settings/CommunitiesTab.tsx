import { useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { slugFromName } from '../../../lib/communities'
import { useT } from '../../../lib/i18n'
import type { Community } from '../../../lib/types'
import { useStore } from '../../../store'
import ImagePicker from '../ImagePicker'

const PAGE = 50
/** Up to this many unknown communities are fetched one by one; more than that marks the list stale instead. */
const FETCH_EACH = 5
interface Page { items: Community[]; next: string | null }
type Editing = 'new' | Community | null

const byName = (a: Community, b: Community) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** Server Settings › Communities: named groups of channels, each backed by one category. Needs Manage Channels. */
export default function CommunitiesTab({ guildId }: { guildId: string }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [items, setItems] = useState<Community[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  // Many communities appeared at once (a bot creating them, or the store filling after the tab opened): reloading the first page beats one request each.
  const [stale, setStale] = useState(false)
  // A ref guards against a second submit before the first one's state update has rendered.
  const inFlight = useRef(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const editingRef = useRef(editing)
  editingRef.current = editing
  const stored = useStore((s) => s.communities[guildId])
  const knownIds = useRef<Set<string> | null>(null)
  // Bumped on every reload and on unmount: an older answer never replaces a newer one.
  const seq = useRef(0)

  const url = (after?: string | null) => `/guilds/${guildId}/communities?${new URLSearchParams({ sort: 'name', limit: String(PAGE), ...(after ? { after } : {}) })}`
  const load = () => {
    const id = ++seq.current
    setBusy(true); setFailed(false); setStale(false)
    api.get<Page>(url())
      .then((r) => { if (id === seq.current) { setItems(r.items); setNext(r.next); setLoaded(true) } })
      .catch(() => { if (id === seq.current) setFailed(true) })
      .finally(() => { if (id === seq.current) setBusy(false) })
  }
  useEffect(() => { load(); return () => { seq.current++ } }, [guildId]) // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    const id = seq.current
    setBusy(true)
    try {
      const r = await api.get<Page>(url(next))
      if (id === seq.current) { setItems((cur) => [...cur, ...r.items.filter((c) => !cur.some((x) => x.id === c.id))]); setNext(r.next) }
    } catch (e) { if (id === seq.current) pushToast((e as Error).message, 'error') }
    if (id === seq.current) setBusy(false)
  }

  // Keep the rows in step with the store (gateway events): renames and deletions apply to what is listed, and a
  // community another admin creates is fetched on its own. Nothing here refetches the whole list.
  useEffect(() => {
    const list = stored ?? []
    const prev = knownIds.current
    knownIds.current = new Set(list.map((c) => c.id))
    if (!prev) return
    const gone = [...prev].filter((id) => !knownIds.current!.has(id))
    if (gone.length) {
      setItems((cur) => cur.filter((x) => !gone.includes(x.id)))
      const e = editingRef.current
      if (e && e !== 'new' && gone.includes(e.id)) { setEditing(null); setConfirming(false); setNotice(t('This community was deleted')) }
    }
    const byId = new Map(list.map((c) => [c.id, c]))
    setItems((cur) => cur.map((x) => { const n = byId.get(x.id); return n && (n.name !== x.name || n.slug !== x.slug || n.description !== x.description || n.icon_url !== x.icon_url) ? { ...x, name: n.name, slug: n.slug, description: n.description, icon_url: n.icon_url } : x }).sort(byName))
    const fresh = list.filter((c) => !prev.has(c.id) && !itemsRef.current.some((x) => x.id === c.id))
    if (fresh.length > FETCH_EACH) { setStale(true); return }
    for (const c of fresh) {
      api.get<Community>(`/guilds/${guildId}/communities/${c.slug}`).then((full) => setItems((cur) => (cur.some((x) => x.id === full.id) ? cur : [...cur, full].sort(byName)))).catch(() => { /* the next full load shows it */ })
    }
  }, [stored]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (target: Editing) => {
    setEditing(target); setError(''); setNotice(''); setConfirming(false)
    const c = target && target !== 'new' ? target : null
    setName(c?.name ?? ''); setSlug(c?.slug ?? ''); setSlugTouched(!!c); setDescription(c?.description ?? ''); setIcon(c?.icon_url ?? null)
  }

  /** Put a saved community in the list (by id, so the gateway event and this answer never double it) and in the store. */
  const apply = (c: Community) => {
    setItems((cur) => (cur.some((x) => x.id === c.id) ? cur.map((x) => (x.id === c.id ? c : x)) : [...cur, c]).sort(byName))
    useStore.getState().upsertCommunity({ id: c.id, guild_id: c.guild_id, slug: c.slug, name: c.name, icon_url: c.icon_url, description: c.description, category_id: c.category_id })
  }

  const save = async () => {
    if (!editing || inFlight.current) return
    inFlight.current = true; setSaving(true); setError('')
    try {
      const body = { slug, name: name.trim(), description, icon_url: icon }
      if (editing === 'new') {
        apply(await api.post<Community>(`/guilds/${guildId}/communities`, { ...body, icon_url: icon ?? undefined }))
        setEditing(null)
      } else {
        const c = await api.patch<Community>(`/guilds/${guildId}/communities/${editing.slug}`, body)
        apply(c); setEditing(c)
      }
      pushToast(t('Saved'))
    } catch (e) { setError((e as Error).message) }
    inFlight.current = false; setSaving(false)
  }

  const remove = async () => {
    if (!editing || editing === 'new' || inFlight.current) return
    inFlight.current = true; setSaving(true)
    try {
      await api.delete(`/guilds/${guildId}/communities/${editing.slug}`)
      setItems((cur) => cur.filter((x) => x.id !== editing.id))
      useStore.getState().removeCommunity(guildId, editing.id)
      setEditing(null); setConfirming(false)
    } catch (e) { setError((e as Error).message) }
    inFlight.current = false; setSaving(false)
  }

  const current = editing && editing !== 'new' ? editing : null
  return (
    <div className="space-y-6" data-communities-tab>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{t('Communities')}</h1>
          <p className="mt-1 text-sm text-text-2">{t('Communities are named groups of channels. Members follow the ones they care about.')}</p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => open('new')} data-community-new>{t('New community')}</button>
      </div>

      {stale && (
        <p className="flex items-center gap-3 text-sm text-text-2" role="status" data-communities-stale>
          {t('New communities were added')}
          <button type="button" className="btn-ghost" onClick={load} data-communities-refresh>{t('Refresh')}</button>
        </p>
      )}
      {notice && <p className="text-sm text-text-2" role="status" data-community-notice>{notice}</p>}
      {editing && (
        <form className="space-y-4 rounded-xl border border-line bg-bg-1 p-4" onSubmit={(e) => { e.preventDefault(); void save() }} data-community-form>
          <h2 className="font-semibold">{current ? t('Edit community') : t('New community')}</h2>
          <div className="flex items-start gap-4 phone:flex-col">
            <div data-community-icon><ImagePicker value={icon} onChange={setIcon} label={name || t('Communities')} id={current?.id ?? guildId} kind="icon" /></div>
            <div className="w-full flex-1 space-y-3">
              <div>
                <label className="label" htmlFor="community-name">{t('Name')}</label>
                <input id="community-name" className="input" value={name} maxLength={100} required onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugFromName(e.target.value)) }} data-community-name />
              </div>
              <div>
                <label className="label" htmlFor="community-slug">{t('Address')}</label>
                <input id="community-slug" className="input font-mono" value={slug} maxLength={63} required onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} data-community-slug />
                <p className="mt-1 text-xs text-text-2">{t('Lower-case letters, digits and hyphens.')}</p>
              </div>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="community-description">{t('Description')}</label>
            <textarea id="community-description" className="input resize-none" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} data-community-description />
          </div>
          {error && <p className="text-sm text-danger" role="alert" data-community-error>{error}</p>}
          {confirming && current && (
            <div className="space-y-2 rounded-lg border border-danger/40 bg-bg-0/50 p-3">
              <p className="text-sm">{t('Delete {name} and its {n} channels? Messages in them are deleted too.', { name: current.name, n: current.channel_ids.length })}</p>
              <div className="flex gap-2">
                <button type="button" className="btn-danger" onClick={remove} disabled={saving} data-community-delete-confirm>{t('Delete')}</button>
                <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary" disabled={saving || !name.trim() || !slug} data-community-save>{current ? t('Save Changes') : t('Create community')}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
            {current && !confirming && <button type="button" className="btn-ghost ml-auto text-danger" onClick={() => setConfirming(true)} data-community-delete>{t('Delete')}</button>}
          </div>
        </form>
      )}

      {failed && !loaded && (
        <p className="text-sm text-text-2">{t("Couldn't load communities")} <button type="button" className="btn-ghost" onClick={load}>{t('Try again')}</button></p>
      )}
      {loaded && items.length === 0 && <p className="text-sm text-text-2">{t('No communities yet.')}</p>}
      <div className="space-y-1.5">
        {items.map((c) => (
          <button key={c.id} type="button" onClick={() => open(c)} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-bg-3 ${current?.id === c.id ? 'border-accent bg-bg-3' : 'border-line bg-bg-1'}`} data-community-row={c.slug}>
            <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block truncate font-mono text-xs text-text-2">{c.slug}</span></span>
            <span className="shrink-0 text-xs text-text-2">{t('{n} followers', { n: c.follower_count })}</span>
          </button>
        ))}
      </div>
      {next && <div className="flex justify-center"><button type="button" className="btn-ghost" onClick={more} disabled={busy} data-community-more>{t('Load more')}</button></div>}
    </div>
  )
}
