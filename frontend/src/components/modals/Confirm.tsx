import { useState } from 'react'
import { STORAGE_PREFIX } from '../../lib/brand'
import Modal from '../Modal'

interface Props { onClose: () => void; title: string; body: string; action: () => Promise<void> | void; danger?: boolean; confirmLabel?: string; dontAskKey?: string }

export default function ConfirmModal({ onClose, title, body, action, danger, confirmLabel = 'Confirm', dontAskKey }: Props) {
  const [busy, setBusy] = useState(false)
  const [dontAsk, setDontAsk] = useState(false)
  const go = async () => { if (dontAsk && dontAskKey) skipConfirm(dontAskKey); setBusy(true); try { await action() } finally { setBusy(false); onClose() } }
  return (
    <Modal title={title} onClose={onClose} width="max-w-sm"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className={danger ? 'btn-danger' : 'btn-primary'} onClick={go} disabled={busy} autoFocus>{confirmLabel}</button></>}>
      <p className="text-sm text-text-1">{body}</p>
      {dontAskKey && <label className="mt-4 flex items-center gap-2 text-sm text-text-1 cursor-pointer"><input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} className="h-4 w-4 accent-accent" data-dont-ask /> Don't ask again</label>}
    </Modal>
  )
}

const KEY = `${STORAGE_PREFIX}skipConfirm`
/** Confirmations the user asked not to see again. */
export function confirmSkipped(key: string): boolean { try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]).includes(key) } catch { return false } }
function skipConfirm(key: string) { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]; if (!v.includes(key)) localStorage.setItem(KEY, JSON.stringify([...v, key])) } catch { /* ignore */ } }
