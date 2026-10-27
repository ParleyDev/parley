import { ChevronRight } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import MfaSection from './MfaSection'
import PasskeysSection from './PasskeysSection'
import StorageSection from './StorageSection'
import DeleteAccountSection from './DeleteAccountSection'
import { AccountChanges, StandingCard } from './AccountChanges'
import RecapModal from '../Recap'
import { AgeSection, MyBans } from '../../AgeSafety'
import { WindowRow, WindowSection, windowButton } from '../SettingsWindow'
import { useT } from '../../../lib/i18n'

/** The Account page's sections, also listed under Account in the sidebar. */
export const accountSections = () => [
  { id: 'account-info', label: 'Account Info' },
  { id: 'security', label: 'Password & Security' },
  { id: 'status', label: 'Account Status' },
  { id: 'recap', label: 'Year in Review' },
  { id: 'storage', label: 'Storage' },
  { id: 'removal', label: 'Account Removal' },
]

/**
 * Settings › Account: account info (display name, username, email), password and security (two-factor, passkeys,
 * logged-in devices), account status (standing, age, bans), your year in review, storage and removal. Your profile
 * (avatar, banner, bio and the rest) lives in the profile editor.
 */
export default function AccountTab({ onDevices }: { onDevices: () => void }) {
  const t = useT()
  const user = useStore((s) => s.user)
  const [recap, setRecap] = useState(false)
  const [devices, setDevices] = useState<number | null>(null)
  useEffect(() => { api.get<unknown[]>('/users/@me/sessions').then((l) => setDevices(l.length)).catch(() => {}) }, [])
  if (!user) return null
  const titles = Object.fromEntries(accountSections().map((s) => [s.id, t(s.label)]))
  return (
    <div data-account-page>
      <WindowSection id="account-info" title={titles['account-info']}>
        <DisplayNameRow user={user} />
        <AccountChanges only={['username', 'email']} />
      </WindowSection>
      <WindowSection id="security" title={titles.security}>
        <AccountChanges only={['password']} />
        <MfaSection />
        <PasskeysSection />
        <WindowRow label={t('Logged-in Devices')} data-account-devices={devices === null ? undefined : String(devices)}
          action={<button type="button" onClick={onDevices} className="flex items-center gap-1 h-10 rounded-lg px-2 text-[15px] text-text-1 hover:text-text-0 hover:bg-bg-3" data-open-devices>{devices === null ? '' : devices === 1 ? t('1 device') : t('{n} devices', { n: devices })}<ChevronRight size={18} /></button>} />
      </WindowSection>
      <WindowSection id="status" title={titles.status}>
        <StandingCard />
        <AgeSection />
        <MyBans />
      </WindowSection>
      <WindowSection id="recap" title={titles.recap}>
        <WindowRow label={t('Your year in review')} hint={t('Messages, favourite servers and more from {year}.', { year: new Date().getFullYear() })}
          action={<button type="button" className={windowButton} onClick={() => setRecap(true)} data-open-recap>{t('Open')}</button>} data-recap-card="" />
        {recap && <RecapModal onClose={() => setRecap(false)} />}
      </WindowSection>
      <WindowSection id="storage" title={titles.storage}><StorageSection /></WindowSection>
      <WindowSection id="removal" title={titles.removal}><DeleteAccountSection /></WindowSection>
    </div>
  )
}

/** Display name: shown like the other rows, edited in place. */
function DisplayNameRow({ user }: { user: PrivateUser }) {
  const t = useT()
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const pushToast = useStore((s) => s.pushToast)
  const [edit, setEdit] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (edit === null || !edit.trim()) return
    setBusy(true)
    try { const u = await api.patch<PrivateUser>('/users/@me', { display_name: edit.trim() }); if (token) setAuth(token, u); pushToast(t('Saved')); setEdit(null) }
    catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  if (edit === null) return <WindowRow label={t('Display Name')} value={user.display_name} action={<button type="button" className={windowButton} onClick={() => setEdit(user.display_name)} data-display-name-edit>{t('Edit')}</button>} data-account-row="display" />
  return (
    <form onSubmit={save} className="flex items-center gap-3 min-h-10" data-account-row="display">
      <div className="text-[15px] font-semibold text-text-0 flex-1">{t('Display Name')}</div>
      <input className="input h-10 w-56" value={edit} onChange={(e) => setEdit(e.target.value)} maxLength={32} autoFocus required onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEdit(null) } }} data-display-name-input />
      <button type="button" className="text-sm text-text-1 hover:underline" onClick={() => setEdit(null)}>{t('Cancel')}</button>
      <button className="btn-primary h-10" disabled={busy || !edit.trim()} data-display-name-save>{t('Save')}</button>
    </form>
  )
}
