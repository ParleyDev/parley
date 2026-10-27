import { Pencil, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { postMultipart } from '../../../lib/upload'
import type { Sticker } from '../../../lib/types'
import { useStore } from '../../../store'
import { useT } from '../../../lib/i18n'

const MAX = 60
const MAX_BYTES = 1024 * 1024

/** Server Settings › Stickers: upload (with name, description, tags), edit and delete. */
export default function StickersTab({ guildId }: { guildId: string }) {
  const t = useT()
  const stickers = useStore((s) => s.stickers[guildId] ?? EMPTY)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [editing, setEditing] = useState<Sticker | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_BYTES) { pushToast(t('Stickers must be under 1 MB'), 'error'); return }
    if (preview) URL.revokeObjectURL(preview)
    setFile(f); setPreview(URL.createObjectURL(f)); setEditing(null)
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 30))
  }
  const reset = () => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(null); setName(''); setDescription(''); setTags(''); setEditing(null) }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (editing) {
        await api.patch(`/guilds/${guildId}/stickers/${editing.id}`, { name, description, tags }); pushToast(t('Sticker updated'))
      } else {
        if (!file) return
        await postMultipart<Sticker>(`/guilds/${guildId}/stickers`, file, { name, description, tags }); pushToast(t('Sticker uploaded'))
      }
      reset()
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const startEdit = (s: Sticker) => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(s.url); setEditing(s); setName(s.name); setDescription(s.description); setTags(s.tags) }
  const del = (s: Sticker) => openModal({
    kind: 'confirm', title: t('Delete {name}', { name: s.name }), body: t('Messages sent with this sticker will lose it. This cannot be undone.'), danger: true, confirmLabel: t('Delete'),
    action: async () => { try { await api.delete(`/guilds/${guildId}/stickers/${s.id}`) } catch (err) { pushToast((err as Error).message, 'error') } },
  })

  return (
    <div className="space-y-5" data-stickers-tab>
      <div>
        <h1 className="text-xl font-bold">{t('Stickers')}</h1>
        <p className="text-sm text-text-2 mt-1">{t('Upload up to {n} stickers for this server. PNG, JPEG, GIF or WebP under 1 MB; 320×320 works best. Animated files stay animated.', { n: MAX })}</p>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} data-sticker-file />
      {(file || editing) ? (
        <form onSubmit={submit} className="rounded-xl border border-line bg-bg-0/40 p-4 flex gap-4 max-md:flex-col" data-sticker-form>
          <div className="h-32 w-32 shrink-0 rounded-lg bg-bg-3 flex items-center justify-center overflow-hidden">{preview && <img src={preview} alt="" className="max-h-full max-w-full object-contain" />}</div>
          <div className="flex-1 space-y-3 min-w-0">
            <div><label className="label">{t('Name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} minLength={2} required data-sticker-name /></div>
            <div><label className="label">{t('Description')}</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={100} placeholder={t('Shown when hovering the sticker')} /></div>
            <div><label className="label">{t('Related emoji / tags')}</label><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} placeholder={t('e.g. happy, wave, hello')} /></div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={reset}>{t('Cancel')}</button>
              <button className="btn-primary" disabled={busy || name.trim().length < 2} data-sticker-submit>{busy ? t('Saving…') : editing ? t('Save Changes') : t('Upload')}</button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn-primary" disabled={stickers.length >= MAX} onClick={() => fileRef.current?.click()} data-upload-sticker><Upload size={16} /> {t('Upload Sticker')}</button>
          <span className="text-sm text-text-2">{t('{n} / {max} slots used', { n: stickers.length, max: MAX })}</span>
        </div>
      )}
      {stickers.length === 0 && !file && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">{t("No stickers yet. Upload one and it will appear in the sticker picker under this server's name.")}</div>}
      {stickers.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {stickers.map((s) => (
            <div key={s.id} className="group relative rounded-xl border border-line bg-bg-0/40 p-3 flex flex-col items-center gap-2" data-sticker-row={s.name}>
              <img src={s.url} alt={s.name} className="h-24 w-24 object-contain" draggable={false} />
              <div className="text-sm font-semibold truncate max-w-full">{s.name}</div>
              {s.description && <div className="text-xs text-text-2 truncate max-w-full" title={s.description}>{s.description}</div>}
              <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 bg-bg-1 border border-line rounded-md">
                <button type="button" onClick={() => startEdit(s)} className="h-7 w-7 flex items-center justify-center text-text-2 hover:text-text-0" title={t('Edit')}><Pencil size={14} /></button>
                <button type="button" onClick={() => del(s)} className="h-7 w-7 flex items-center justify-center text-text-2 hover:text-danger" title={t('Delete')} data-delete-sticker><Trash2 size={14} /></button>
              </div>
              {editing?.id === s.id && <button type="button" onClick={reset} className="absolute left-1.5 top-1.5 text-text-2" title={t('Stop editing')}><X size={14} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const EMPTY: Sticker[] = []
