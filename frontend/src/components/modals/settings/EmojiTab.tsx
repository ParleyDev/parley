import { Check, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { postMultipart } from '../../../lib/upload'
import type { Emoji } from '../../../lib/types'
import { useStore } from '../../../store'
import Modal from '../../Modal'
import ImageCrop from '../../ImageCrop'
import { useT } from '../../../lib/i18n'

const MAX = 100
const MAX_BYTES = 512 * 1024

/** Derive a valid emoji name from a filename: letters, digits and underscores, 2-32 chars. */
export function emojiNameFrom(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  return base.length >= 2 ? base : `emoji_${base}`.slice(0, 32)
}

/** Server Settings › Emoji: upload, rename and delete custom emoji (needs Manage Server). */
export default function EmojiTab({ guildId }: { guildId: string }) {
  const t = useT()
  const emojis = useStore((s) => s.emojis[guildId] ?? EMPTY)
  const members = useStore((s) => s.members[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // One still image: crop it first (and name it). Several files, or an animated GIF, upload as they are.
  const [cropping, setCropping] = useState<{ file: File; name: string } | null>(null)
  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length === 1 && /^image\/(png|jpeg|webp)$/.test(list[0].type)) { setCropping({ file: list[0], name: emojiNameFrom(list[0].name) }); return }
    void upload(list)
  }
  const upload = async (files: File[], name?: string) => {
    if (!files.length) return
    setBusy(true)
    let ok = 0
    for (const f of files) {
      if (f.size > MAX_BYTES) { pushToast(t('{name}: emoji must be under 512 KB', { name: f.name }), 'error'); continue }
      try { await postMultipart<Emoji>(`/guilds/${guildId}/emojis`, f, { name: name ?? emojiNameFrom(f.name) }); ok++ } catch (e) { pushToast(`${f.name}: ${(e as Error).message}`, 'error') }
    }
    if (ok) pushToast(ok === 1 ? t('Emoji uploaded') : t('{n} emoji uploaded', { n: ok }))
    setBusy(false)
  }
  const rename = async (e: Emoji) => {
    const name = draft.trim()
    setEditing(null)
    if (!name || name === e.name) return
    try { await api.patch(`/guilds/${guildId}/emojis/${e.id}`, { name }) } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const del = (e: Emoji) => openModal({
    kind: 'confirm', title: t('Delete :{name}:', { name: e.name }), body: t('Messages and reactions using this emoji will show a broken image. This cannot be undone.'), danger: true, confirmLabel: t('Delete'),
    action: async () => { try { await api.delete(`/guilds/${guildId}/emojis/${e.id}`) } catch (err) { pushToast((err as Error).message, 'error') } },
  })
  const animated = emojis.filter((e) => e.animated), stills = emojis.filter((e) => !e.animated)

  return (
    <div className="space-y-5" data-emoji-tab>
      <div>
        <h1 className="text-xl font-bold">{t('Emoji')}</h1>
        <p className="text-sm text-text-2 mt-1">{t('Add up to {max} custom emoji that anyone in this server can use. Emoji names must be 2-32 characters of letters, numbers or underscores. Files must be PNG, JPEG, GIF or WebP under 512 KB; GIF, APNG and WebP animations are kept.', { max: MAX })}</p>
      </div>
      <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/apng" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} data-emoji-file />
      {cropping && (
        <Modal title={t('Crop emoji')} onClose={() => setCropping(null)} width="max-w-sm">
          <ImageCrop file={cropping.file} onCancel={() => setCropping(null)} onCrop={(f) => { const n = cropping.name; setCropping(null); void upload([f], n) }}>
            <div><label className="label" htmlFor="crop-name">{t('Name')}</label><input id="crop-name" className="input" value={cropping.name} maxLength={32} onChange={(e) => setCropping({ ...cropping, name: e.target.value.replace(/[^\w]/g, '_') })} data-crop-name /></div>
          </ImageCrop>
        </Modal>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="btn-primary" disabled={busy || emojis.length >= MAX} onClick={() => fileRef.current?.click()} data-upload-emoji><Upload size={16} /> {busy ? t('Uploading…') : t('Upload Emoji')}</button>
        <span className="text-sm text-text-2">{t('{used} / {max} slots used', { used: emojis.length, max: MAX })}</span>
      </div>
      {emojis.length === 0 && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">{t("No custom emoji yet. Upload a few and they will appear in the emoji picker under this server's name.")}</div>}
      {[{ title: 'Emoji', list: stills }, { title: 'Animated Emoji', list: animated }].map(({ title, list }) => list.length > 0 && (
        <section key={title}>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-2 mb-2">{t(title)} — {list.length}</h2>
          <div className="rounded-xl border border-line overflow-hidden divide-y divide-line">
            <div className="grid grid-cols-[48px_1fr_1fr_80px] gap-3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-2 bg-bg-0/40"><span>{t('Image')}</span><span>{t('Name')}</span><span>{t('Uploaded by')}</span><span /></div>
            {list.map((e) => (
              <div key={e.id} className="grid grid-cols-[48px_1fr_1fr_80px] gap-3 items-center px-3 py-2 hover:bg-bg-3/40" data-emoji-row={e.name}>
                <img src={e.url} alt={e.name} className="h-8 w-8 object-contain" draggable={false} />
                {editing === e.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-text-2">:</span>
                    <input autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') rename(e); if (ev.key === 'Escape') setEditing(null) }} maxLength={32} className="input py-1 px-2 text-sm font-mono" data-emoji-rename />
                    <span className="text-text-2">:</span>
                    <button type="button" onClick={() => rename(e)} className="text-success" title={t('Save')}><Check size={16} /></button>
                    <button type="button" onClick={() => setEditing(null)} className="text-text-2" title={t('Cancel')}><X size={16} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setEditing(e.id); setDraft(e.name) }} className="group flex items-center gap-2 text-left min-w-0" title={t('Rename')}>
                    <span className="font-mono text-sm truncate">:{e.name}:</span><Pencil size={13} className="text-text-2 opacity-0 group-hover:opacity-100 shrink-0" />
                  </button>
                )}
                <span className="text-sm text-text-1 truncate">{(e.creator_id && members?.[e.creator_id]?.display_name) || (e.creator_id ? t('A member') : t('Unknown'))}</span>
                <button type="button" onClick={() => del(e)} className="justify-self-end h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:text-danger hover:bg-bg-3" title={t('Delete')} data-delete-emoji><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const EMPTY: Emoji[] = []
