import { useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'
import ProfileCard from '../../ProfileCard'
import MfaSection from './MfaSection'
import PasskeysSection from './PasskeysSection'
import StorageSection from './StorageSection'
import DeleteAccountSection from './DeleteAccountSection'
import { AccountChanges, StandingCard } from './AccountChanges'
import RecapModal from '../Recap'
import { AgeSection, MyBans } from '../../AgeSafety'

export default function AccountTab({ onClose, onEditProfile }: { onClose: () => void; onEditProfile: () => void }) {
  const user = useStore((s) => s.user)
  const [recap, setRecap] = useState(false)
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const pushToast = useStore((s) => s.pushToast)
  const [display, setDisplay] = useState(user?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const dirty = display !== user.display_name
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', { display_name: display })
      if (token) setAuth(token, u)
      pushToast('Saved'); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-6">
    <form onSubmit={submit} className="space-y-6">
      <h2 className="text-xl font-bold">My Account</h2>
      <ProfileCard user={user} compact actions={<button type="button" onClick={onEditProfile} className="btn-primary py-1.5">Edit User Profile</button>} />
      <div className="rounded-xl bg-bg-0/50 p-4 space-y-4">
        <div><label className="label">Display name</label><input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} required /></div>
      </div>
      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-lg bg-bg-0 border border-line px-4 py-3 shadow-xl">
          <span className="text-sm text-text-1">Careful — you have unsaved changes!</span>
          <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => setDisplay(user.display_name)}>Reset</button><button className="btn-primary" disabled={busy || !display.trim()}>Save Changes</button></div>
        </div>
      )}
    </form>
    <AccountChanges />
    <section className="flex items-center gap-3 rounded-xl bg-bg-0/50 p-4" data-recap-card><div className="flex-1"><h3 className="font-bold">Your year in review</h3><p className="text-sm text-text-2">Messages, favourite servers and more from {new Date().getFullYear()}.</p></div><button type="button" className="btn-primary" onClick={() => setRecap(true)} data-open-recap>Open</button></section>
    {recap && <RecapModal onClose={() => setRecap(false)} />}
    <StandingCard />
    <MyBans />
    <AgeSection />
    <MfaSection />
    <PasskeysSection />
    <StorageSection />
    <DeleteAccountSection />
    </div>
  )
}
