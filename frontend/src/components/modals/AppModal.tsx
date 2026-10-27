import { useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import Modal from '../Modal'
import { useT } from '../../lib/i18n'

export interface AppForm { title: string; custom_id: string; components: { type: 1; components: { type: 4; custom_id: string; label: string; style: 1 | 2; required: boolean; min_length: number; max_length: number; placeholder?: string | null; value?: string | null }[] }[] }

/** A form an app opened in answer to something you did; submitting it sends the answers to the app. */
export default function AppModal({ onClose, interactionId, modal }: { onClose: () => void; interactionId: string; modal: AppForm }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const inputs = modal.components.flatMap((r) => r.components)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map((i) => [i.custom_id, i.value ?? ''])))
  const [busy, setBusy] = useState(false)
  const missing = inputs.some((i) => i.required && !values[i.custom_id]?.trim())
  const submit = async () => {
    setBusy(true)
    try { await api.post('/interactions/modal', { interaction_id: interactionId, custom_id: modal.custom_id, fields: inputs.map((i) => ({ custom_id: i.custom_id, value: values[i.custom_id] ?? '' })) }); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={modal.title} onClose={onClose} width="max-w-md" footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={busy || missing} onClick={submit} data-app-modal-submit>{t('Submit')}</button></>}>
      <div className="space-y-3" data-app-modal={modal.custom_id}>
        {inputs.map((i) => (
          <div key={i.custom_id}>
            <label className="label" htmlFor={`am-${i.custom_id}`}>{i.label}{i.required && <span className="text-danger"> *</span>}</label>
            {i.style === 2
              ? <textarea id={`am-${i.custom_id}`} className="input resize-none" rows={4} minLength={i.min_length} maxLength={i.max_length} placeholder={i.placeholder ?? undefined} value={values[i.custom_id]} onChange={(e) => setValues({ ...values, [i.custom_id]: e.target.value })} data-app-modal-input={i.custom_id} />
              : <input id={`am-${i.custom_id}`} className="input" minLength={i.min_length} maxLength={i.max_length} placeholder={i.placeholder ?? undefined} value={values[i.custom_id]} onChange={(e) => setValues({ ...values, [i.custom_id]: e.target.value })} data-app-modal-input={i.custom_id} />}
          </div>
        ))}
      </div>
    </Modal>
  )
}
