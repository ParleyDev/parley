import { useState, type FormEvent } from 'react'
import ImagePicker from '../ImagePicker'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { PrivateUser } from '../../../lib/types'

export default function AccountTab({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user)
  const setAuth = useStore((s) => s.setAuth)
  const token = useStore((s) => s.token)
  const pushToast = useStore((s) => s.pushToast)
  const [display, setDisplay] = useState(user?.display_name ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatar, setAvatar] = useState<string | null>(user?.avatar_url ?? null)
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const dirty = display !== user.display_name || bio !== user.bio || (avatar ?? null) !== (user.avatar_url ?? null)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const u = await api.patch<PrivateUser>('/users/@me', { display_name: display, bio, avatar_url: avatar ?? '' })
      if (token) setAuth(token, u)
      pushToast('Profile saved'); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <h2 className="text-xl font-bold">My Account</h2>
      <div className="flex items-center gap-5 rounded-xl bg-bg-0/50 p-4">
        <ImagePicker value={avatar} onChange={setAvatar} label={display} id={user.id} />
        <div className="min-w-0"><div className="text-lg font-bold truncate">{display || user.display_name}</div><div className="text-sm text-text-2">@{user.username}</div><div className="text-xs text-text-2 mt-1">{user.email}</div></div>
      </div>
      <div><label className="label">Display name</label><input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={32} required /></div>
      <div><label className="label">About me</label><textarea className="input resize-none" rows={3} maxLength={190} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people a bit about yourself" /><div className="text-right text-[11px] text-text-2">{bio.length}/190</div></div>
      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-between rounded-lg bg-bg-0 border border-line px-4 py-3 shadow-xl">
          <span className="text-sm text-text-1">Careful — you have unsaved changes!</span>
          <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => { setDisplay(user.display_name); setBio(user.bio); setAvatar(user.avatar_url) }}>Reset</button><button className="btn-primary" disabled={busy || !display.trim()}>Save Changes</button></div>
        </div>
      )}
    </form>
  )
}
