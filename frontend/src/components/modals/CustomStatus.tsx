import { Smile } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { QUICK_EMOJI } from '../../lib/emoji'

/** Set the free-text status shown under your name in DMs, member lists and your profile card. */
export default function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [text, setText] = useState(user?.custom_status ?? '')
  const [emoji, setEmoji] = useState(false)
  const [busy, setBusy] = useState(false)
  const save = async (value: string) => {
    setBusy(true)
    try { await api.patch('/users/@me', { custom_status: value.trim() }); pushToast(value.trim() ? 'Status updated' : 'Status cleared'); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Set a custom status" onClose={onClose} width="max-w-sm"
      footer={<>{user?.custom_status && <button className="btn-ghost mr-auto" onClick={() => save('')} disabled={busy}>Clear Status</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => save(text)} disabled={busy}>Save</button></>}>
      <label className="label">What's cookin', {user?.display_name}?</label>
      <div className="relative">
        <input className="input pr-10" value={text} onChange={(e) => setText(e.target.value)} maxLength={128} placeholder="Support has arrived!" autoFocus data-custom-status-input
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(text) } }} />
        <button type="button" onClick={() => setEmoji((v) => !v)} title="Emoji" className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 hover:text-text-0"><Smile size={18} /></button>
        {emoji && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setEmoji(false)} />
            <div className="pop absolute top-full right-0 mt-2 z-[70] grid grid-cols-[repeat(8,2rem)] gap-1 rounded-xl bg-bg-0 border border-line p-2 shadow-2xl">
              {QUICK_EMOJI.map((e) => <button key={e} onClick={() => { setText((v) => (v.startsWith(e) ? v : e + ' ' + v)); setEmoji(false) }} className="h-8 w-8 rounded-md text-xl hover:bg-bg-3">{e}</button>)}
            </div>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-text-2">Shown next to your name in DMs, member lists and your profile.</p>
    </Modal>
  )
}
