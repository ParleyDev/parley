import { useState } from 'react'
import Modal from '../Modal'

interface Props { onClose: () => void; title: string; body: string; action: () => Promise<void> | void; danger?: boolean; confirmLabel?: string }

export default function ConfirmModal({ onClose, title, body, action, danger, confirmLabel = 'Confirm' }: Props) {
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await action() } finally { setBusy(false); onClose() } }
  return (
    <Modal title={title} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className={danger ? 'btn-danger' : 'btn-primary'} onClick={go} disabled={busy} autoFocus>{confirmLabel}</button></>}>
      <p className="text-sm text-text-1">{body}</p>
    </Modal>
  )
}
