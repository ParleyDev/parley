import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

/**
 * Deleting a server: the owner re-enters their password (and a 2FA code when 2FA is on) and types the server's name.
 * The server disappears for everyone at once and can be restored by the owner until the grace period ends.
 */
export default function DeleteServerModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const mfa = useStore((s) => !!s.user?.mfa_enabled)
  const removeGuild = useStore((s) => s.removeGuild)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!guild) return null
  const ready = name.trim() === guild.name.trim() && password.length > 0 && (!mfa || code.trim().length >= 6)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const r = await api.post<{ scheduled_for: string }>(`/guilds/${guildId}/deletion`, { name: name.trim(), password, code: mfa ? code.trim() : undefined })
      removeGuild(guildId); navigate('/channels/@me'); onClose()
      pushToast(t('{name} will be deleted on {date}. You can restore it until then in User Settings › My Account.', { name: guild.name, date: new Date(r.scheduled_for).toLocaleDateString() }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={t("Delete '{name}'", { name: guild.name })} onClose={onClose} width="max-w-md"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="submit" form="delete-server" className="btn-danger" disabled={!ready || busy} data-delete-server-go>{t('Delete Server')}</button></>}>
      <form id="delete-server" onSubmit={submit} className="space-y-3" data-delete-server>
        <p className="text-sm text-text-1">{t("The server disappears for all its members right away: channels, messages and invites stop working. You can restore it for a while (the date is shown once it's done); after that it is deleted for good.")}</p>
        <label className="block"><span className="label">{t('Type the server name to confirm')}</span><input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={guild.name} autoFocus data-delete-server-name /></label>
        <label className="block"><span className="label">{t('Your password')}</span><input type="password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-delete-server-password /></label>
        {mfa && <label className="block"><span className="label">{t('Two-factor code')}</span><input className="input mt-1" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" data-delete-server-code /></label>}
        {error && <p className="text-sm text-danger" data-delete-server-error>{error}</p>}
      </form>
    </Modal>
  )
}
