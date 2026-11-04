import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { uploadImage } from '../lib/upload'
import { NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES, frameClass, nameplateClass, type CosmeticKind, type CosmeticRow } from '../lib/cosmetics'
import { DECORATIONS } from '../lib/types'
import Avatar from '../components/Avatar'
import ProfileEffect from '../components/ProfileEffect'
import { NameplateVideo } from '../components/Nameplate'

interface Item { value: string; source: 'builtin' | 'folder' | 'custom'; name: string | null; description: string | null; enabled: boolean; data: CosmeticRow['data']; users: number }
type Look = CosmeticRow['data']
interface Draft { value?: string; source: Item['source']; name: string; description: string; data: Look }

const BUILTIN_LABELS: Record<CosmeticKind, Record<string, string>> = {
  decoration: Object.fromEntries(DECORATIONS.map((d) => [d.id, d.label])),
  nameplate: Object.fromEntries(NAMEPLATES.map((d) => [d.id, d.label])),
  effect: Object.fromEntries(PROFILE_EFFECTS.map((d) => [d.id, d.label])),
  frame: Object.fromEntries(PROFILE_FRAMES.map((d) => [d.id, d.label])),
}
const FRESH: Record<CosmeticKind, Look> = {
  decoration: {},
  nameplate: { colors: ['#5865f2', '#eb459e'] },
  effect: { glyph: '🌸', fall: true },
  frame: { colors: ['#5865f2', '#eb459e'] },
}

/**
 * Admin console → Cosmetics: the avatar decorations, nameplates, profile effects and profile frames everyone can put on
 * their profile. Built-in ones and the assets folder's can be renamed and turned off; admins can also make their own (a
 * picture, colours or an emoji), edit and delete them. Turning one off hides it on every profile until it's back on;
 * deleting a custom one takes it off everyone who had it.
 */
export default function CosmeticsPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [kind, setKind] = useState<CosmeticKind>('decoration')
  const [loaded, setLoaded] = useState<{ kind: CosmeticKind; items: Item[] } | null>(null)
  // Only the list of the kind on show (switching kinds shows Loading… until its own list arrives).
  const list = loaded?.kind === kind ? loaded.items : null
  const [draft, setDraft] = useState<Draft | null>(null)
  const load = (k = kind) => api.get<Item[]>(`/admin/cosmetics/${k}`).then((items) => setLoaded({ kind: k, items })).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { setDraft(null); void load(kind) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); await load(); if (done) pushToast(done); return true } catch (e) { pushToast((e as Error).message, 'error'); return false } }
  const KINDS: [CosmeticKind, string][] = [['decoration', t('Avatar decorations')], ['nameplate', t('Nameplates')], ['effect', t('Profile effects')], ['frame', t('Profile frames')]]
  const nameOf = (it: Item) => it.name ?? BUILTIN_LABELS[kind][it.value] ?? it.value
  const enc = encodeURIComponent

  const save = async () => {
    if (!draft) return
    const body = { name: draft.name, description: draft.description, ...(draft.source === 'custom' ? { data: draft.data } : {}) }
    if (await act(() => (draft.value ? api.patch(`/admin/cosmetics/${kind}/${enc(draft.value)}`, body) : api.post(`/admin/cosmetics/${kind}`, body)), t('Saved'))) setDraft(null)
  }
  const toggle = (it: Item) => act(() => api.patch(`/admin/cosmetics/${kind}/${enc(it.value)}`, { enabled: !it.enabled }))
  const remove = (it: Item) => {
    const who = it.users ? t('{n} people have it on their profile; it comes off theirs.', { n: it.users }) : ''
    if (confirm(`${t('Delete {name}?', { name: nameOf(it) })} ${who}`.trim())) void act(() => api.delete(`/admin/cosmetics/${kind}/${enc(it.value)}`), t('Deleted'))
  }

  return (
    <div className="max-w-4xl space-y-6" data-admin-cosmetics>
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">{t('Cosmetics')}</h1><p className="text-sm text-text-2 mt-1">{t('What everyone can put on their profile. Turning one off hides it on every profile until it is back on.')}</p></div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setDraft({ source: 'custom', name: '', description: '', data: FRESH[kind] })} data-cosmetic-new><Plus size={16} /> {t('Add')}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, label]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-sm font-semibold ${kind === k ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} aria-pressed={kind === k} data-cosmetic-kind={k}>{label}</button>)}
      </div>
      {draft && <Editor kind={kind} draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} />}
      {!list ? <p className="text-text-2">{t('Loading…')}</p> : list.length === 0 ? <p className="text-text-2">{t('None yet.')}</p> : (
        <ul className="space-y-2" data-cosmetic-list={kind}>
          {list.map((it) => (
            <li key={it.value} className={`flex items-center gap-3 rounded-xl border border-line bg-bg-1 p-3 ${it.enabled ? '' : 'opacity-60'}`} data-cosmetic-row={it.value} data-cosmetic-enabled={it.enabled ? '1' : '0'}>
              <Preview kind={kind} value={it.value} name={nameOf(it)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold" data-cosmetic-name>{nameOf(it)}</span>
                  <span className="rounded bg-bg-3 px-1.5 text-[10px] font-bold uppercase text-text-2" data-cosmetic-source={it.source}>{{ builtin: t('Built-in'), folder: t('Assets folder'), custom: t('Custom') }[it.source]}</span>
                </div>
                <div className="truncate text-xs text-text-2">{[it.description, it.users === 1 ? t('1 person uses it') : it.users ? t('{n} people use it', { n: it.users }) : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={it.enabled} onChange={() => void toggle(it)} data-cosmetic-toggle={it.value} />{t('On')}</label>
              <button type="button" onClick={() => setDraft({ value: it.value, source: it.source, name: it.source === 'builtin' ? (it.name ?? '') : nameOf(it), description: it.description ?? '', data: it.source === 'custom' ? it.data : {} })} title={t('Edit')} aria-label={t('Edit {name}', { name: nameOf(it) })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-cosmetic-edit={it.value}><Pencil size={15} /></button>
              <button type="button" onClick={() => remove(it)} disabled={it.source !== 'custom'} title={it.source === 'custom' ? t('Delete') : t('Built-in and assets-folder ones can be turned off, not deleted')} aria-label={t('Delete {name}', { name: nameOf(it) })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent" data-cosmetic-delete={it.value}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What it looks like on a profile (drawn even while it's off: `data-cosmetic-preview`). */
function Preview({ kind, value, name }: { kind: CosmeticKind; value: string; name: string }) {
  const me = useStore((s) => s.user)
  const box = 'relative shrink-0 overflow-hidden rounded-lg bg-bg-3'
  if (kind === 'decoration') return <div className="shrink-0 p-1.5" data-cosmetic-preview>{me && <Avatar user={me} decoration={value} size={40} animate />}</div>
  if (kind === 'nameplate') return (
    <div className={`${box} isolate flex h-11 w-40 items-center px-2.5 text-sm font-semibold ${nameplateClass(value)}`} data-cosmetic-preview>
      <NameplateVideo value={value} always /><span className="relative truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>{name}</span>
    </div>
  )
  if (kind === 'effect') return <div className={`${box} h-16 w-24`} data-cosmetic-preview><ProfileEffect id={value} /></div>
  if (value.startsWith('asset:')) return <div className={`${box} h-16 w-24`} data-cosmetic-preview><img src={`/api/assets/profile-frames/${encodeURIComponent(value.slice(6))}/preview`} alt="" className="h-full w-full object-contain" /></div>
  return <div className="shrink-0 p-2" data-cosmetic-preview><div className={`h-12 w-20 rounded-lg bg-bg-3 ${frameClass(value)}`} /></div>
}

/** Name and description for any; the look (picture, colours, emoji, motion) for custom ones. */
function Editor({ kind, draft, onChange, onSave, onCancel }: { kind: CosmeticKind; draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const look = draft.data
  const setLook = (l: Look) => onChange({ ...draft, data: l })
  const upload = async (f: File) => {
    setBusy(true)
    try { const img = await uploadImage('cosmetic', f); setLook({ ...look, image: img.url, colors: kind === 'nameplate' ? undefined : look.colors, glyph: kind === 'effect' ? undefined : look.glyph }) } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const color = (i: number, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="color" value={look.colors?.[i] ?? '#5865f2'} onChange={(e) => { const c = [...(look.colors ?? ['#5865f2', '#eb459e'])]; c[i] = e.target.value; setLook({ ...look, colors: c, image: undefined }) }} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" data-cosmetic-color={i} />{label}
    </label>
  )
  const custom = draft.source === 'custom'
  const picture = (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => file.current?.click()} disabled={busy} className="btn-ghost" data-cosmetic-upload><ImagePlus size={16} /> {busy ? t('Uploading…') : look.image ? t('Change picture') : t('Upload picture')}</button>
      {look.image && <img src={look.image} alt="" className="h-10 w-10 rounded object-contain bg-bg-3" data-cosmetic-image />}
      <input ref={file} type="file" accept="image/png,image/gif,image/webp,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} data-cosmetic-file />
    </div>
  )
  return (
    <div className="rounded-xl border border-accent/50 bg-bg-1 p-4 space-y-4" data-cosmetic-draft={draft.value ?? 'new'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block text-xs font-bold uppercase text-text-2">{t('Name')}</span><input className="input" value={draft.name} maxLength={40} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder={custom ? '' : t('Keep its own name')} data-cosmetic-name-input /></label>
        <label className="block text-sm"><span className="mb-1 block text-xs font-bold uppercase text-text-2">{t('Description')}</span><input className="input" value={draft.description} maxLength={200} onChange={(e) => onChange({ ...draft, description: e.target.value })} data-cosmetic-description-input /></label>
      </div>
      {custom && kind === 'decoration' && <div className="space-y-1">{picture}<p className="text-xs text-text-2">{t('A square picture with a see-through middle, drawn around the avatar. PNG, APNG, GIF or WebP; animated ones play.')}</p></div>}
      {custom && kind === 'nameplate' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-4">{color(0, t('Start'))}{color(1, t('End'))}<span className="text-xs text-text-2">{t('or')}</span>{picture}</div>
          <p className="text-xs text-text-2">{t('Two colours fading out behind the name, or a picture on the right of the row.')}</p>
        </div>
      )}
      {custom && kind === 'frame' && <div className="flex flex-wrap items-center gap-4">{color(0, t('Ring'))}{color(1, t('Glow'))}</div>}
      {custom && kind === 'effect' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">{t('Emoji')}<input className="input w-20 text-center" value={look.glyph ?? ''} maxLength={8} onChange={(e) => setLook({ ...look, glyph: e.target.value, image: undefined })} data-cosmetic-glyph /></label>
            <span className="text-xs text-text-2">{t('or')}</span>{picture}
          </div>
          <div className="flex gap-2">
            {([true, false] as const).map((fall) => <button key={String(fall)} type="button" onClick={() => setLook({ ...look, fall })} className={`rounded-lg border px-2.5 py-1 text-sm ${(look.fall !== false) === fall ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} aria-pressed={(look.fall !== false) === fall} data-cosmetic-motion={fall ? 'fall' : 'rise'}>{fall ? t('Falls down') : t('Floats up')}</button>)}
          </div>
        </div>
      )}
      <div className="flex gap-2"><button type="button" className="btn-primary" onClick={onSave} disabled={busy} data-cosmetic-save>{t('Save')}</button><button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button></div>
    </div>
  )
}
