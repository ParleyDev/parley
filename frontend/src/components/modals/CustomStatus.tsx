import { Smile } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { ManualActivity, PrivateUser } from '../../lib/types'
import { QUICK_EMOJI } from '../../lib/emoji'
import { useT } from '../../lib/i18n'

/** Set the free-text status shown under your name in DMs, member lists and your profile card. */
export default function CustomStatusModal({ onClose }: { onClose: () => void }) {
  const t = useT()
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
  // An activity next to your name ("Playing Factorio"), shown while Spotify isn't.
  const [actType, setActType] = useState<ManualActivity['type']>(user?.custom_activity?.type ?? 'playing')
  const [actName, setActName] = useState(user?.custom_activity?.name ?? '')
  const saveActivity = async (clear: boolean) => {
    setBusy(true)
    try {
      if (clear) await api.delete('/users/@me/activity'); else await api.put('/users/@me/activity', { type: actType, name: actName.trim() })
      const u = await api.get<PrivateUser>('/users/@me'); const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
      if (clear) setActName('')
      pushToast(clear ? t('Activity cleared') : t('Activity set'))
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const save = async (value: string) => {
    setBusy(true)
    const secs = value.trim() ? clearSecs() : undefined
    try {
      const u = await api.patch<PrivateUser>('/users/@me', { custom_status: value.trim(), ...(secs ? { custom_status_for_secs: secs } : {}) })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
      pushToast(value.trim() ? t('Status updated') : t('Status cleared')); onClose() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={t('Set a custom status')} onClose={onClose} width="max-w-sm"
      footer={<>{user?.custom_status && <button className="btn-ghost mr-auto" onClick={() => save('')} disabled={busy}>{t('Clear Status')}</button>}<button className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn-primary" onClick={() => save(text)} disabled={busy}>{t('Save')}</button></>}>
      <label className="label">{t("What's cookin', {name}?", { name: user?.display_name ?? '' })}</label>
      <div className="relative">
        <input className="input pr-10" value={text} onChange={(e) => setText(e.target.value)} maxLength={128} placeholder={t('Support has arrived!')} autoFocus data-custom-status-input
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(text) } }} />
        <button type="button" onClick={() => setEmoji((v) => !v)} title={t('Emoji')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-2 hover:text-text-0"><Smile size={18} /></button>
        {emoji && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setEmoji(false)} />
            <div className="pop absolute top-full right-0 mt-2 z-[70] grid grid-cols-[repeat(8,2rem)] gap-1 rounded-xl bg-bg-0 border border-line p-2 shadow-2xl">
              {QUICK_EMOJI.map((e) => <button key={e} onClick={() => { setText((v) => (v.startsWith(e) ? v : e + ' ' + v)); setEmoji(false) }} className="h-8 w-8 rounded-md text-xl hover:bg-bg-3">{e}</button>)}
            </div>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-text-2">{t('Shown next to your name in DMs, member lists and your profile.')}</p>
      <label className="label mt-4" htmlFor="clear-after">{t('Clear after')}</label>
      <select id="clear-after" className="input" value={clearAfter} onChange={(e) => setClearAfter(e.target.value)} data-clear-after>
        <option value="today">{t('Today')}</option>
        <option value={String(4 * 3600)}>{t('4 hours')}</option>
        <option value="3600">{t('1 hour')}</option>
        <option value="1800">{t('30 minutes')}</option>
        <option value="never">{t("Don't clear")}</option>
      </select>
      {user?.custom_status && user.custom_status_expires_at && <p className="mt-1 text-xs text-text-2" data-clears-at>{t('Your current status clears {when}.', { when: new Date(user.custom_status_expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })}</p>}
      <div className="h-px bg-line my-4" />
      <label className="label" htmlFor="activity-name">{t('Activity')}</label>
      <div className="flex gap-2" data-custom-activity>
        <select className="input w-36 shrink-0" value={actType} onChange={(e) => setActType(e.target.value as ManualActivity['type'])} aria-label={t('Activity type')} data-activity-type-select>
          <option value="playing">{t('Playing')}</option>
          <option value="watching">{t('Watching')}</option>
          <option value="listening">{t('Listening to')}</option>
          <option value="competing">{t('Competing in')}</option>
        </select>
        <input id="activity-name" className="input" value={actName} onChange={(e) => setActName(e.target.value)} maxLength={128} placeholder="Factorio" data-activity-name-input />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-ghost bg-bg-3" onClick={() => saveActivity(false)} disabled={busy || !actName.trim()} data-activity-save>{t('Set activity')}</button>
        {user?.custom_activity && <button type="button" className="btn-ghost" onClick={() => saveActivity(true)} disabled={busy} data-activity-clear>{t('Clear activity')}</button>}
      </div>
      <p className="mt-1 text-xs text-text-2">{user?.share_activity === false ? t('Activity sharing is off in Data & Privacy, so nobody sees it.') : t('Shown under your name while Spotify isn\'t playing.')}</p>
    </Modal>
  )
}
