import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { splitCrop } from '../lib/crop'
import { colorFor } from '../lib/format'
import { useT } from '../lib/i18n'
import { MAX_LINKS, validatePage } from '../lib/communityPage'
import { splashBackground } from '../lib/splash'
import type { Community } from '../lib/types'
import { useStore } from '../store'
import { CropLayer } from './CropImg'
import { MobileBack } from './HeaderBits'
import ImagePicker from './modals/ImagePicker'

interface Draft { name: string; slug: string; description: string; about: string; links: { key: number; label: string; url: string }[]; icon: string | null; banner: string | null }

let linkKey = 0
const toDraft = (c: Community): Draft => ({ name: c.name, slug: c.slug, description: c.description, about: c.about, links: c.links.map((l) => ({ key: ++linkKey, ...l })), icon: c.icon_url, banner: c.banner_url })
const plainLinks = (d: Draft) => d.links.map((l) => ({ label: l.label.trim(), url: l.url }))

/** The fields that differ from the page as it was when editing began (only these are sent). */
function changes(d: Draft, base: Community): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (d.name.trim() !== base.name) body.name = d.name.trim()
  if (d.slug !== base.slug) body.slug = d.slug
  if (d.description !== base.description) body.description = d.description
  if (d.about.trimEnd() !== base.about.trimEnd()) body.about = d.about
  if (JSON.stringify(plainLinks(d)) !== JSON.stringify(base.links.map((l) => ({ label: l.label, url: l.url })))) body.links = plainLinks(d)
  if ((d.icon ?? '') !== (base.icon_url ?? '')) body.icon_url = d.icon ?? ''
  if ((d.banner ?? '') !== (base.banner_url ?? '')) body.banner_url = d.banner ?? ''
  return body
}

/**
 * A community's page with its content shown as fields in place. Save sends only what changed; leaving with unsaved
 * changes (Cancel, another page, Back, closing the tab) asks first. The server decides what is allowed and its message
 * is shown when it refuses.
 */
export default function CommunityPageEdit({ community, guildId, channels, managers, onClose, onSaved }: { community: Community; guildId: string; channels: ReactNode; managers: ReactNode; onClose: () => void; onSaved: (c: Community) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const openModal = useStore((s) => s.openModal)
  const modal = useStore((s) => s.modal)
  const base = useRef(community).current
  const [d, setD] = useState<Draft>(() => toDraft(base))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const inFlight = useRef(false)
  const dirty = Object.keys(changes(d, base)).length > 0
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const set = (p: Partial<Draft>) => { setD((cur) => ({ ...cur, ...p })); setErrors({}); setServerError('') }
  const setLink = (i: number, p: Partial<Draft['links'][number]>) => set({ links: d.links.map((l, j) => (j === i ? { ...l, ...p } : l)) })
  const move = (i: number, by: number) => { const to = i + by; if (to < 0 || to >= d.links.length) return; const next = [...d.links]; [next[i], next[to]] = [next[to], next[i]]; set({ links: next }) }

  // Another page or the Back button while there are unsaved changes: ask, then go on or stay.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname && !(nextLocation.state as { keepEdit?: boolean } | null)?.keepEdit)
  const asked = useRef(false)
  useEffect(() => {
    if (blocker.state !== 'blocked') { asked.current = false; return }
    if (!asked.current) {
      asked.current = true
      openModal({ kind: 'confirm', title: t('Discard your changes?'), body: t('Your edits to this page have not been saved.'), danger: true, confirmLabel: t('Discard'), action: () => blocker.proceed() })
    } else if (!modal) blocker.reset()
  }, [blocker, modal, openModal, t])
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const cancel = () => {
    if (!dirtyRef.current) { onClose(); return }
    openModal({ kind: 'confirm', title: t('Discard your changes?'), body: t('Your edits to this page have not been saved.'), danger: true, confirmLabel: t('Discard'), action: () => { dirtyRef.current = false; onClose() } })
  }

  const save = async () => {
    if (inFlight.current) return
    const errs = validatePage({ name: d.name, slug: d.slug, description: d.description, about: d.about, links: plainLinks(d) }, t)
    setErrors(errs)
    if (Object.keys(errs).length) { setServerError(''); return }
    const body = changes(d, base)
    if (!Object.keys(body).length) { onClose(); return }
    inFlight.current = true; setSaving(true); setServerError('')
    try {
      const updated = await api.patch<Community>(`/guilds/${guildId}/communities/${base.slug}`, body)
      dirtyRef.current = false
      onSaved(updated)
    } catch (e) { setServerError((e as Error).message) }
    inFlight.current = false; setSaving(false)
  }

  const remove = async () => {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true); setServerError('')
    try {
      await api.delete(`/guilds/${guildId}/communities/${base.slug}`)
      dirtyRef.current = false
      navigate(`/channels/${guildId}`)
      useStore.getState().removeCommunity(guildId, base.id)
    } catch (e) { setServerError((e as Error).message); setConfirming(false) }
    inFlight.current = false; setSaving(false)
  }

  const tint = colorFor(base.id)
  const bannerCrop = splitCrop(d.banner).crop
  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-danger" id={`err-${k}`} role="alert">{errors[k]}</p>
  const a11y = (k: string) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `err-${k}` : undefined })

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-2" data-community-editing={base.slug}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg-1 px-4 py-1.5 phone:px-2">
        <MobileBack />
        <p className="min-w-0 flex-1 text-sm text-text-1">{t('Editing this page. Members see changes when you save.')}</p>
        <button type="button" className="btn-ghost border border-line" onClick={cancel} data-community-cancel>{t('Cancel')}</button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving} data-community-save>{t('Save')}</button>
      </header>
      {serverError && <p className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger" role="alert" data-community-error>{serverError}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative isolate h-36 w-full bg-cover bg-center" style={d.banner && !bannerCrop ? { backgroundImage: splashBackground(d.banner) } : d.banner ? undefined : { background: `linear-gradient(135deg, ${tint}, ${tint}55)` }}>
          <CropLayer url={d.banner} />
          <div className="absolute right-3 top-2 rounded-lg bg-black/50 p-1.5 text-white" role="group" aria-label={t('Header image')} data-edit-banner>
            <ImagePicker value={d.banner} onChange={(v) => set({ banner: v })} label={d.name} id={base.id} round={false} kind="banner" />
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl items-end gap-4 px-6 phone:flex-col phone:items-start phone:px-4">
          <div className="-mt-10 shrink-0 rounded-2xl bg-bg-2 p-1" role="group" aria-label={t('Icon')} data-edit-icon>
            <ImagePicker value={d.icon} onChange={(v) => set({ icon: v })} label={d.name} id={base.id} round={false} kind="icon" />
          </div>
          <div className="w-full min-w-0 flex-1 space-y-2 pt-2">
            <div>
              <input className="input text-xl font-bold" value={d.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} aria-label={t('Name')} placeholder={t('Name')} {...a11y('name')} data-edit-name />
              {err('name')}
            </div>
            <div>
              <input className="input" value={d.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} aria-label={t('Description')} placeholder={t('Description')} {...a11y('description')} data-edit-description />
              {err('description')}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-xs text-text-2" htmlFor="community-edit-slug">{t('Address')}</label>
                <input id="community-edit-slug" className="input font-mono" value={d.slug} maxLength={63} onChange={(e) => set({ slug: e.target.value })} {...a11y('slug')} data-edit-slug />
              </div>
              {err('slug')}
            </div>
          </div>
        </div>
        <div className="mx-auto grid max-w-5xl gap-6 px-6 pb-10 pt-5 phone:px-4 wide:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('About')}</h2>
              <textarea className="input min-h-40 w-full resize-y" value={d.about} onChange={(e) => set({ about: e.target.value })} aria-label={t('About')} aria-invalid={errors.about ? true : undefined} aria-describedby={errors.about ? 'err-about edit-about-hint' : 'edit-about-hint'} data-edit-about />
              <p className="mt-1 text-xs text-text-2" id="edit-about-hint">{t('Same formatting as messages.')}</p>
              {err('about')}
            </section>
            {channels}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Links')}</h2>
              <ul className="flex flex-col gap-2">
                {d.links.map((l, i) => (
                  <li key={l.key} className="rounded-lg border border-line bg-bg-1 p-2" data-edit-link>
                    <div className="flex items-center gap-1">
                      <input className="input min-w-0 flex-1" value={l.label} maxLength={80} onChange={(e) => setLink(i, { label: e.target.value })} aria-label={t('Link label')} placeholder={t('Label')} data-edit-link-label />
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('Move up')} title={t('Move up')} className="shrink-0 rounded p-1 text-text-2 hover:text-text-0 disabled:opacity-30"><ArrowUp size={14} aria-hidden /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === d.links.length - 1} aria-label={t('Move down')} title={t('Move down')} className="shrink-0 rounded p-1 text-text-2 hover:text-text-0 disabled:opacity-30"><ArrowDown size={14} aria-hidden /></button>
                      <button type="button" onClick={() => set({ links: d.links.filter((_, j) => j !== i) })} aria-label={t('Remove link')} title={t('Remove link')} className="shrink-0 rounded p-1 text-text-2 hover:text-danger" data-edit-link-remove><X size={14} aria-hidden /></button>
                    </div>
                    <input className="input mt-1 w-full" value={l.url} maxLength={600} onChange={(e) => setLink(i, { url: e.target.value })} aria-label={t('Link address')} placeholder="https://" inputMode="url" aria-invalid={errors[`links.${i}`] ? true : undefined} data-edit-link-url />
                    {err(`links.${i}`)}
                  </li>
                ))}
              </ul>
              {err('links')}
              <button type="button" onClick={() => set({ links: [...d.links, { key: ++linkKey, label: '', url: '' }] })} disabled={d.links.length >= MAX_LINKS} className="mt-2 flex items-center gap-1 text-sm font-medium text-accent hover:underline disabled:opacity-50" data-edit-link-add><Plus size={14} aria-hidden />{t('Add link')}</button>
            </section>
            {managers}
            {community.can_delete && (
              <section>
                {!confirming
                  ? <button type="button" className="btn-ghost text-danger" onClick={() => setConfirming(true)} data-community-delete>{t('Delete community')}</button>
                  : (
                    <div className="space-y-2 rounded-lg border border-danger/40 bg-bg-0/50 p-3">
                      <p className="text-sm">{t('Delete {name} and its {n} channels? Messages in them are deleted too.', { name: base.name, n: community.channel_ids.length })}</p>
                      <div className="flex gap-2">
                        <button type="button" className="btn-danger" onClick={() => void remove()} disabled={saving} data-community-delete-confirm>{t('Delete')}</button>
                        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
                      </div>
                    </div>
                  )}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
