import { Smile } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { PrivateUser } from '../../lib/types'
import { QUICK_EMOJI } from '../../lib/emoji'

/** Set the free-text status shown under your name in DMs, member lists and your profile card. */
export default function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [text, setText] = useState(user?.custom_status ?? '')
  const [emoji, setEmoji] = useState(false)
  const [busy, setBusy] = useState(false)
  // "Clear after" (Discord's choices): today means midnight, local time.
  const [clearAfter, setClearAfter] = useState('today')
  const clearSecs = (): number | undefined => {
    if (clearAfter === 'never') return undefined
    if (clearAfter === 'today') { const end = new Date(); end.setHours(24, 0, 0, 0); return Math.max(60, Math.round((end.getTime() - Date.now()) / 1000)) }
    return Number(clearAfter)
  }
  const save = async (value: string) => {
    setBusy(true)
    const secs = value.trim() ? clearSecs() : undefined
    try {
      const u = await api.patch<PrivateUser>('/users/@me', { custom_status: value.trim(), ...(secs ? { custom_status_for_secs: secs } : {}) })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
      pushToast(value.trim() ? 'Status updated' : 'Status cleared'); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
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
      <label className="label mt-4" htmlFor="clear-after">Clear after</label>
      <select id="clear-after" className="input" value={clearAfter} onChange={(e) => setClearAfter(e.target.value)} data-clear-after>
        <option value="today">Today</option>
        <option value={String(4 * 3600)}>4 hours</option>
        <option value="3600">1 hour</option>
        <option value="1800">30 minutes</option>
        <option value="never">Don't clear</option>
      </select>
      {user?.custom_status && user.custom_status_expires_at && <p className="mt-1 text-xs text-text-2" data-clears-at>Your current status clears {new Date(user.custom_status_expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</p>}
    </Modal>
  )
}
