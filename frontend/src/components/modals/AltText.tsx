import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { isImage } from '../../lib/upload'
import type { Message } from '../../lib/types'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

/** Edit Alt Text on your own message's pictures after sending (read by screen readers, shown on hover). */
export default function AltTextModal({ onClose, message }: { onClose: () => void; message: Message }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const pictures = message.attachments.filter((a) => isImage(a.content_type))
  const [alts, setAlts] = useState<Record<string, string>>(() => Object.fromEntries(pictures.map((a) => [a.id, a.description ?? ''])))
  const [spoilers, setSpoilers] = useState<Record<string, boolean>>(() => Object.fromEntries(pictures.map((a) => [a.id, a.filename.startsWith('SPOILER_')])))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await api.patch(`/channels/${message.channel_id}/messages/${message.id}`, { attachment_descriptions: alts, attachment_spoilers: spoilers }); pushToast(t('Attachments updated')); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={t('Edit Attachments')} onClose={onClose} footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={save} disabled={busy} data-alt-save>{t('Save')}</button></>}>
      <p className="mb-3 text-sm text-text-2">{t("Describe each picture for people who use screen readers or can't see it.")}</p>
      <div className="space-y-3" data-alt-editor>
        {pictures.map((a) => (
          <div key={a.id} className="flex items-start gap-3">
            <img src={a.thumb_url ?? a.url} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <textarea className="input w-full resize-none text-sm" rows={3} maxLength={1024} value={alts[a.id] ?? ''} placeholder={t('Describe this picture')} aria-label={t('Alt text for {name}', { name: a.filename })}
                onChange={(e) => setAlts((m) => ({ ...m, [a.id]: e.target.value }))} data-alt-edit={a.id} />
              <label className="flex items-center gap-2 text-sm text-text-1 cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-accent" checked={!!spoilers[a.id]} onChange={(e) => setSpoilers((m) => ({ ...m, [a.id]: e.target.checked }))} data-spoiler-edit={a.id} /> {t('Mark as spoiler')}</label>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
