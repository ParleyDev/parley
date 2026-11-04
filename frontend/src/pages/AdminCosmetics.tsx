import { useEffect, useState } from 'react'
import { FolderPlus, ImagePlus, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { api, ApiError, getToken } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES, frameClass, nameplateClass, type CosmeticKind, type CosmeticRow } from '../lib/cosmetics'
import { DECORATIONS } from '../lib/types'
import Avatar from '../components/Avatar'
import ProfileEffect from '../components/ProfileEffect'
import { NameplateVideo } from '../components/Nameplate'

type Source = 'builtin' | 'folder' | 'custom'
interface EffectLayer { file: string; start_ms: number; duration_ms: number; loop: boolean; loop_delay_ms: number; z_index: number; random_variants?: string[] }
interface FrameLayer { file: string; order: 'front' | 'back'; type: 'staple' | 'rail' | 'border'; anchor: 'top' | 'bottom' | 'center'; responsive: boolean }
interface Layout { inner_width: number; overflow_top: number; overflow_bottom: number; overflow_horizontal: number }
interface FolderData { file?: string; layers?: (EffectLayer | FrameLayer)[]; layout?: Layout; still?: string; thumbnail?: string }
interface Item { value: string; source: Source; name: string | null; description: string | null; enabled: boolean; deleted: boolean; data: CosmeticRow['data'] & FolderData; users: number }

const BUILTIN_LABELS: Record<CosmeticKind, Record<string, string>> = {
  decoration: Object.fromEntries(DECORATIONS.map((d) => [d.id, d.label])),
  nameplate: Object.fromEntries(NAMEPLATES.map((d) => [d.id, d.label])),
  effect: Object.fromEntries(PROFILE_EFFECTS.map((d) => [d.id, d.label])),
  frame: Object.fromEntries(PROFILE_FRAMES.map((d) => [d.id, d.label])),
}
const FOLDER: Record<CosmeticKind, string> = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }
const assetId = (value: string) => value.slice('asset:'.length)
/** A file name the folder accepts: letters, digits, '.', '_' and '-'. */
const safeName = (name: string) => name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file.png'

/** Multipart to the admin API (folder items: their fields as `meta`, each file under its own name). */
async function sendForm(method: 'POST' | 'PATCH', path: string, meta: object, files: [string, File][]) {
  const form = new FormData()
  form.append('meta', JSON.stringify(meta))
  for (const [name, f] of files) form.append('file', f, name)
  const token = getToken()
  const res = await fetch(`/api${path}`, { method, body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error ?? msg } catch { /* keep */ } throw new ApiError(res.status, msg) }
  return res.json()
}

type Editing = { mode: 'parley'; item?: Item } | { mode: 'folder'; item?: Item }

/**
 * Admin console → Cosmetics: the avatar decorations, nameplates, profile effects and profile frames everyone can put on
 * their profile. Items with pictures live in the instance's assets folder: adding or editing one writes its files and
 * its entry in that kind's metadata.json (which fails when the folder is mounted read-only). Parley's own colour and
 * emoji ones, built-ins' names, and turning anything off or deleting it are Parley's alone (deleting a folder item
 * hides it everywhere and leaves its files; it can be restored).
 */
export default function CosmeticsPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [kind, setKind] = useState<CosmeticKind>('decoration')
  const [loaded, setLoaded] = useState<{ kind: CosmeticKind; items: Item[] } | null>(null)
  // Only the list of the kind on show (switching kinds shows Loading… until its own list arrives).
  const list = loaded?.kind === kind ? loaded.items : null
  const [editing, setEditing] = useState<Editing | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [writable, setWritable] = useState<boolean | null>(null)
  const load = (k = kind) => api.get<Item[]>(`/admin/cosmetics/${k}`).then((items) => setLoaded({ kind: k, items })).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { setEditing(null); void load(kind) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get<{ writable: boolean }>('/admin/cosmetics-folder').then((r) => setWritable(r.writable)).catch(() => setWritable(null)) }, [])
  const act = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); await load(); if (done) pushToast(done); return true } catch (e) { pushToast((e as Error).message, 'error'); return false } }
  const KINDS: [CosmeticKind, string][] = [['decoration', t('Avatar decorations')], ['nameplate', t('Nameplates')], ['effect', t('Profile effects')], ['frame', t('Profile frames')]]
  const nameOf = (it: Item) => it.name ?? BUILTIN_LABELS[kind][it.value] ?? it.value
  const enc = encodeURIComponent

  const toggle = (it: Item) => act(() => api.patch(`/admin/cosmetics/${kind}/${enc(it.value)}`, { enabled: !it.enabled }))
  const restore = (it: Item) => act(() => api.patch(`/admin/cosmetics/${kind}/${enc(it.value)}`, { deleted: false }), t('Restored'))
  const remove = (it: Item) => {
    const who = it.users ? t('{n} people have it on their profile; it comes off theirs.', { n: it.users }) : ''
    const what = it.source === 'custom' ? '' : it.source === 'folder' ? t('Its files stay in the assets folder; you can restore it.') : t('You can restore it.')
    if (confirm([t('Delete {name}?', { name: nameOf(it) }), who, what].filter(Boolean).join(' '))) void act(() => api.delete(`/admin/cosmetics/${kind}/${enc(it.value)}`), t('Deleted'))
  }
  const deleted = list?.filter((it) => it.deleted).length ?? 0
  const shown = list?.filter((it) => showDeleted || !it.deleted)
  const saved = async () => { setEditing(null); await load() }

  return (
    <div className="max-w-4xl space-y-6" data-admin-cosmetics>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-bold">{t('Cosmetics')}</h1><p className="text-sm text-text-2 mt-1">{t('What everyone can put on their profile. Turning one off hides it on every profile until it is back on.')}</p></div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-primary" onClick={() => setEditing({ mode: 'folder' })} disabled={writable === false} title={writable === false ? t('The assets folder is read-only') : undefined} data-cosmetic-new-folder><FolderPlus size={16} /> {t('Add to assets folder')}</button>
          {kind !== 'decoration' && <button type="button" className="btn-ghost" onClick={() => setEditing({ mode: 'parley' })} data-cosmetic-new><Plus size={16} /> {kind === 'effect' ? t('Add emoji effect') : t('Add colours')}</button>}
        </div>
      </div>
      {writable === false && <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-cosmetics-read-only>{t('The assets folder is mounted read-only, so items with pictures can\'t be added or edited here. Mount it read-write to manage them from the console. Turning items on and off and deleting them still work.')}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map(([k, label]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-sm font-semibold ${kind === k ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} aria-pressed={kind === k} data-cosmetic-kind={k}>{label}</button>)}
        {deleted > 0 && <label className="ml-auto flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} data-cosmetic-show-deleted />{t('Show deleted ({n})', { n: deleted })}</label>}
      </div>
      {editing?.mode === 'parley' && <ParleyEditor kind={kind} item={editing.item} onDone={() => void saved()} onCancel={() => setEditing(null)} />}
      {editing?.mode === 'folder' && <FolderEditor kind={kind} item={editing.item} onDone={() => void saved()} onCancel={() => setEditing(null)} />}
      {!shown ? <p className="text-text-2">{t('Loading…')}</p> : shown.length === 0 ? <p className="text-text-2">{t('None yet.')}</p> : (
        <ul className="space-y-2" data-cosmetic-list={kind}>
          {shown.map((it) => (
            <li key={it.value} className={`flex items-center gap-3 rounded-xl border border-line bg-bg-1 p-3 ${it.enabled && !it.deleted ? '' : 'opacity-60'}`} data-cosmetic-row={it.value} data-cosmetic-enabled={it.enabled ? '1' : '0'} data-cosmetic-deleted={it.deleted ? '1' : '0'}>
              <Preview kind={kind} item={it} name={nameOf(it)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold" data-cosmetic-name>{nameOf(it)}</span>
                  <span className="rounded bg-bg-3 px-1.5 text-[10px] font-bold uppercase text-text-2" data-cosmetic-source={it.source}>{{ builtin: t('Built-in'), folder: t('Assets folder'), custom: t('Parley') }[it.source]}</span>
                  {it.deleted && <span className="rounded bg-danger/20 px-1.5 text-[10px] font-bold uppercase text-danger">{t('Deleted')}</span>}
                </div>
                <div className="truncate text-xs text-text-2">{[it.description, it.users === 1 ? t('1 person uses it') : it.users ? t('{n} people use it', { n: it.users }) : ''].filter(Boolean).join(' · ')}</div>
              </div>
              {it.deleted ? (
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => void restore(it)} data-cosmetic-restore={it.value}><RotateCcw size={14} /> {t('Restore')}</button>
              ) : (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={it.enabled} onChange={() => void toggle(it)} data-cosmetic-toggle={it.value} />{t('On')}</label>
                  <button type="button" onClick={() => setEditing({ mode: it.source === 'folder' ? 'folder' : 'parley', item: it })} disabled={it.source === 'folder' && writable === false} title={it.source === 'folder' && writable === false ? t('The assets folder is read-only') : t('Edit')} aria-label={t('Edit {name}', { name: nameOf(it) })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0 disabled:opacity-30" data-cosmetic-edit={it.value}><Pencil size={15} /></button>
                  <button type="button" onClick={() => remove(it)} title={t('Delete')} aria-label={t('Delete {name}', { name: nameOf(it) })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger" data-cosmetic-delete={it.value}><Trash2 size={15} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What it looks like on a profile (drawn even while it's off or deleted: `data-cosmetic-preview`). */
function Preview({ kind, item, name }: { kind: CosmeticKind; item: Item; name: string }) {
  const me = useStore((s) => s.user)
  const value = item.value
  const box = 'relative shrink-0 overflow-hidden rounded-lg bg-bg-3'
  if (kind === 'decoration') return <div className="shrink-0 p-1.5" data-cosmetic-preview>{me && <Avatar user={me} decoration={value} size={40} animate />}</div>
  if (kind === 'nameplate') return (
    <div className={`${box} isolate flex h-11 w-40 items-center px-2.5 text-sm font-semibold ${nameplateClass(value)}`} data-cosmetic-preview>
      <NameplateVideo value={value} always /><span className="relative truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>{name}</span>
    </div>
  )
  if (kind === 'effect') {
    const still = item.data.thumbnail ?? item.data.still
    if (item.source === 'folder' && still) return <div className={`${box} h-16 w-24`} data-cosmetic-preview><img src={`/api/assets/profile-effects/${encodeURIComponent(assetId(value))}/${encodeURIComponent(still)}`} alt="" className="h-full w-full object-cover" /></div>
    return <div className={`${box} h-16 w-24`} data-cosmetic-preview><ProfileEffect id={value} /></div>
  }
  if (item.source === 'folder') return <div className={`${box} h-16 w-24`} data-cosmetic-preview><img src={`/api/assets/profile-frames/${encodeURIComponent(assetId(value))}/preview`} alt="" className="h-full w-full object-contain" /></div>
  return <div className="shrink-0 p-2" data-cosmetic-preview><div className={`h-12 w-20 rounded-lg bg-bg-3 ${frameClass(value)}`} /></div>
}

function NameFields({ name, description, onName, onDescription, keepOwn }: { name: string; description: string; onName: (v: string) => void; onDescription: (v: string) => void; keepOwn?: boolean }) {
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm"><span className="mb-1 block text-xs font-bold uppercase text-text-2">{t('Name')}</span><input className="input" value={name} maxLength={60} onChange={(e) => onName(e.target.value)} placeholder={keepOwn ? t('Keep its own name') : ''} data-cosmetic-name-input /></label>
      <label className="block text-sm"><span className="mb-1 block text-xs font-bold uppercase text-text-2">{t('Description')}</span><input className="input" value={description} maxLength={300} onChange={(e) => onDescription(e.target.value)} data-cosmetic-description-input /></label>
    </div>
  )
}

/** Parley's own: a built-in's name and description, or a colour / emoji one (made, renamed, restyled). */
function ParleyEditor({ kind, item, onDone, onCancel }: { kind: CosmeticKind; item?: Item; onDone: () => void; onCancel: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const custom = !item || item.source === 'custom'
  const [name, setName] = useState(item ? (item.source === 'builtin' ? (item.name ?? '') : (item.name ?? '')) : '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [look, setLook] = useState<CosmeticRow['data']>(item?.source === 'custom' ? item.data : kind === 'effect' ? { glyph: '🌸', fall: true } : { colors: ['#5865f2', '#eb459e'] })
  const save = async () => {
    const body = { name, description, ...(custom ? { data: look } : {}) }
    try {
      if (item) await api.patch(`/admin/cosmetics/${kind}/${encodeURIComponent(item.value)}`, body); else await api.post(`/admin/cosmetics/${kind}`, body)
      pushToast(t('Saved')); onDone()
    } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const color = (i: number, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="color" value={look.colors?.[i] ?? '#5865f2'} onChange={(e) => { const c = [...(look.colors ?? ['#5865f2', '#eb459e'])]; c[i] = e.target.value; setLook({ ...look, colors: c }) }} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" data-cosmetic-color={i} />{label}
    </label>
  )
  return (
    <div className="rounded-xl border border-accent/50 bg-bg-1 p-4 space-y-4" data-cosmetic-draft={item?.value ?? 'new'}>
      <NameFields name={name} description={description} onName={setName} onDescription={setDescription} keepOwn={item?.source === 'builtin'} />
      {custom && kind === 'nameplate' && <div className="flex flex-wrap items-center gap-4">{color(0, t('Start'))}{color(1, t('End'))}<span className="text-xs text-text-2">{t('Two colours fading out behind the name.')}</span></div>}
      {custom && kind === 'frame' && <div className="flex flex-wrap items-center gap-4">{color(0, t('Ring'))}{color(1, t('Glow'))}</div>}
      {custom && kind === 'effect' && (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">{t('Emoji')}<input className="input w-20 text-center" value={look.glyph ?? ''} maxLength={8} onChange={(e) => setLook({ ...look, glyph: e.target.value })} data-cosmetic-glyph /></label>
          {([true, false] as const).map((fall) => <button key={String(fall)} type="button" onClick={() => setLook({ ...look, fall })} className={`rounded-lg border px-2.5 py-1 text-sm ${(look.fall !== false) === fall ? 'border-accent bg-accent/15' : 'border-line hover:border-text-2'}`} aria-pressed={(look.fall !== false) === fall} data-cosmetic-motion={fall ? 'fall' : 'rise'}>{fall ? t('Falls down') : t('Floats up')}</button>)}
        </div>
      )}
      <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => void save()} data-cosmetic-save>{t('Save')}</button><button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button></div>
    </div>
  )
}

/** Pick a file; it's sent under a folder-safe version of its name. */
function FilePick({ label, accept, onPick, testid }: { label: string; accept: string; onPick: (f: File) => void; testid: string }) {
  return (
    <label className="btn-ghost cursor-pointer py-1 text-xs"><ImagePlus size={14} /> {label}
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} data-cosmetic-file={testid} />
    </label>
  )
}

const IMAGES = 'image/png,image/apng,image/gif,image/webp'
const num = (v: string) => Math.max(0, Math.round(Number(v) || 0))

/**
 * An assets-folder item: its name and description, and its file (decorations, nameplates) or its layers (effects:
 * files and timing; frames: files, placement and the card layout). Saving writes the files and metadata.json.
 */
function FolderEditor({ kind, item, onDone, onCancel }: { kind: CosmeticKind; item?: Item; onDone: () => void; onCancel: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const layered = kind === 'effect' || kind === 'frame'
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [files, setFiles] = useState<Record<string, File>>({})
  const [single, setSingle] = useState<File | null>(null)
  const freshLayer = (): EffectLayer | FrameLayer => (kind === 'effect' ? { file: '', start_ms: 0, duration_ms: 3000, loop: true, loop_delay_ms: 0, z_index: 100 } : { file: '', order: 'front', type: 'staple', anchor: 'top', responsive: false })
  const [layers, setLayers] = useState<(EffectLayer | FrameLayer)[]>(() => (item?.data.layers ?? []).map((l) => { const { width: _w, height: _h, ...rest } = l as typeof l & { width?: number; height?: number }; return rest }))
  const [layout, setLayout] = useState<Layout>(item?.data.layout ?? { inner_width: 1200, overflow_top: 304, overflow_bottom: 212, overflow_horizontal: 56 })
  const [busy, setBusy] = useState(false)
  const addFile = (f: File) => { const n = safeName(f.name); setFiles((m) => ({ ...m, [n]: f })); return n }
  const setLayer = (i: number, l: Partial<EffectLayer & FrameLayer>) => setLayers((ls) => ls.map((x, j) => (j === i ? ({ ...x, ...l } as EffectLayer | FrameLayer) : x)))
  const save = async () => {
    const meta: Record<string, unknown> = { name, description }
    if (layered) meta.layers = layers
    if (kind === 'frame') meta.layout = layout
    const upload: [string, File][] = layered ? Object.entries(files) : single ? [[safeName(single.name), single]] : []
    setBusy(true)
    try {
      await sendForm(item ? 'PATCH' : 'POST', item ? `/admin/cosmetics/${kind}/folder/${encodeURIComponent(assetId(item.value))}` : `/admin/cosmetics/${kind}/folder`, meta, upload)
      pushToast(t('Saved to the assets folder')); onDone()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const field = (label: string, value: number, on: (n: number) => void, testid: string) => (
    <label className="block text-xs text-text-2">{label}<input type="number" min={0} className="input mt-0.5 h-8 w-24 text-sm" value={value} onChange={(e) => on(num(e.target.value))} data-cosmetic-field={testid} /></label>
  )
  const select = <T extends string>(label: string, value: T, options: T[], on: (v: T) => void, testid: string) => (
    <label className="block text-xs text-text-2">{label}<select className="input mt-0.5 h-8 w-28 text-sm" value={value} onChange={(e) => on(e.target.value as T)} data-cosmetic-field={testid}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
  )
  return (
    <div className="rounded-xl border border-accent/50 bg-bg-1 p-4 space-y-4" data-cosmetic-folder-draft={item?.value ?? 'new'}>
      <p className="text-xs text-text-2">{t('Saved in the assets folder ({folder}) and its metadata.json.', { folder: FOLDER[kind] })}</p>
      <NameFields name={name} description={description} onName={setName} onDescription={setDescription} />
      {!layered && (
        <div className="flex flex-wrap items-center gap-3">
          <FilePick label={item ? t('Replace file') : t('Choose file')} accept={kind === 'nameplate' ? `${IMAGES},video/webm,video/mp4` : IMAGES} onPick={setSingle} testid="single" />
          <span className="text-sm text-text-2" data-cosmetic-file-name>{single ? safeName(single.name) : item?.data.file ?? t('No file yet')}</span>
          <span className="w-full text-xs text-text-2">{kind === 'decoration' ? t('A square picture with a see-through middle, drawn around the avatar. PNG, APNG, GIF or WebP up to 8 MB.') : t('A short WebM or MP4 loop, or a picture, shown behind the name. Up to 8 MB.')}</span>
        </div>
      )}
      {kind === 'frame' && (
        <div>
          <div className="mb-1 text-xs font-bold uppercase text-text-2">{t('Layout')}</div>
          <div className="flex flex-wrap gap-3">
            {field(t('Inner width'), layout.inner_width, (n) => setLayout({ ...layout, inner_width: n }), 'inner_width')}
            {field(t('Overflow top'), layout.overflow_top, (n) => setLayout({ ...layout, overflow_top: n }), 'overflow_top')}
            {field(t('Overflow bottom'), layout.overflow_bottom, (n) => setLayout({ ...layout, overflow_bottom: n }), 'overflow_bottom')}
            {field(t('Overflow sides'), layout.overflow_horizontal, (n) => setLayout({ ...layout, overflow_horizontal: n }), 'overflow_horizontal')}
          </div>
        </div>
      )}
      {layered && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase text-text-2">{t('Layers')}</div>
          {layers.map((l, i) => (
            <div key={i} className="rounded-lg border border-line p-2.5 space-y-2" data-cosmetic-layer={i}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold" data-cosmetic-layer-file>{l.file || t('No file yet')}</span>
                {files[l.file] && <span className="rounded bg-accent/20 px-1.5 text-[10px] font-bold uppercase text-accent">{t('New')}</span>}
                <FilePick label={l.file ? t('Replace') : t('Choose file')} accept={IMAGES} onPick={(f) => setLayer(i, { file: addFile(f) })} testid={`layer-${i}`} />
                <button type="button" className="ml-auto text-text-2 hover:text-danger" onClick={() => setLayers((ls) => ls.filter((_, j) => j !== i))} title={t('Remove layer')} aria-label={t('Remove layer')} data-cosmetic-layer-remove={i}><X size={16} /></button>
              </div>
              {kind === 'effect' ? (() => { const e = l as EffectLayer; return (
                <div className="flex flex-wrap items-end gap-3">
                  {field(t('Start (ms)'), e.start_ms, (n) => setLayer(i, { start_ms: n }), `start_ms-${i}`)}
                  {field(t('Duration (ms)'), e.duration_ms, (n) => setLayer(i, { duration_ms: n }), `duration_ms-${i}`)}
                  {field(t('Loop delay (ms)'), e.loop_delay_ms, (n) => setLayer(i, { loop_delay_ms: n }), `loop_delay_ms-${i}`)}
                  {field(t('Z-index'), e.z_index, (n) => setLayer(i, { z_index: n }), `z_index-${i}`)}
                  <label className="flex h-8 items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={e.loop} onChange={(ev) => setLayer(i, { loop: ev.target.checked })} data-cosmetic-field={`loop-${i}`} />{t('Loops')}</label>
                  <div className="flex w-full flex-wrap items-center gap-2 text-xs text-text-2">
                    {t('Variants:')}
                    {(e.random_variants ?? []).map((v) => <span key={v} className="flex items-center gap-1 rounded bg-bg-3 px-1.5 py-0.5">{v}<button type="button" onClick={() => setLayer(i, { random_variants: (e.random_variants ?? []).filter((x) => x !== v) })} aria-label={t('Remove')}><X size={12} /></button></span>)}
                    <FilePick label={t('Add variant')} accept={IMAGES} onPick={(f) => { const n = addFile(f); setLayer(i, { random_variants: [...(e.random_variants ?? []).filter((x) => x !== n), n] }) }} testid={`variant-${i}`} />
                  </div>
                </div>
              ) })() : (() => { const f = l as FrameLayer; return (
                <div className="flex flex-wrap items-end gap-3">
                  {select(t('Order'), f.order, ['front', 'back'], (v) => setLayer(i, { order: v }), `order-${i}`)}
                  {select(t('Type'), f.type, ['staple', 'rail', 'border'], (v) => setLayer(i, { type: v }), `type-${i}`)}
                  {select(t('Anchor'), f.anchor, ['top', 'bottom', 'center'], (v) => setLayer(i, { anchor: v }), `anchor-${i}`)}
                  <label className="flex h-8 items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={f.responsive} onChange={(ev) => setLayer(i, { responsive: ev.target.checked })} data-cosmetic-field={`responsive-${i}`} />{t('Stretches with the card')}</label>
                </div>
              ) })()}
            </div>
          ))}
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setLayers((ls) => [...ls, freshLayer()])} data-cosmetic-layer-add><Plus size={14} /> {t('Add layer')}</button>
          {kind === 'effect' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
              {t('Stills (optional):')}
              {(['thumbnail.png', 'static.png', 'reduced_motion.png'] as const).map((n) => (
                <FilePick key={n} label={`${n}${files[n] ? ' ✓' : ''}`} accept="image/png" onPick={(f) => setFiles((m) => ({ ...m, [n]: f }))} testid={n} />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || !name.trim()} data-cosmetic-save>{busy ? t('Saving…') : t('Save')}</button><button type="button" className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button></div>
    </div>
  )
}
