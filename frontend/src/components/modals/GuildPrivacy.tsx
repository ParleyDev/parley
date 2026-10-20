import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import Modal from '../Modal'
import { Toggle } from './SettingsShell'

interface GuildPrivacy { allow_dms: boolean | null; effective: boolean; default: boolean }

/** Server menu → Privacy Settings: allow direct messages from this server's members (or fall back to your default). */
export default function GuildPrivacyModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [p, setP] = useState<GuildPrivacy | null>(null)
  useEffect(() => { api.get<GuildPrivacy>(`/guilds/${guildId}/members/@me/privacy`).then(setP).catch((e) => pushToast((e as Error).message, 'error')) }, [guildId, pushToast])
  const set = async (allow_dms: boolean | null) => {
    try { setP(await api.patch<GuildPrivacy>(`/guilds/${guildId}/members/@me/privacy`, { allow_dms })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <Modal title={`Privacy Settings · ${guild?.name ?? 'Server'}`} onClose={onClose} footer={<button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-3" data-guild-privacy={p ? (p.allow_dms === null ? 'default' : p.allow_dms ? 'on' : 'off') : 'loading'}>
        <span data-guild-privacy-toggle><Toggle label="Allow direct messages from server members" checked={p?.effective ?? true} onChange={(v) => set(v)} disabled={!p} /></span>
        <p className="text-xs text-text-2">People you share this server with can message you even if you are not friends (when your DM setting is "Friends and server members"). Friends can always message you.</p>
        {p && p.allow_dms !== null && <button type="button" onClick={() => set(null)} className="text-xs text-sky-400 hover:underline" data-guild-privacy-reset>Use my default ({p.default ? 'allowed' : 'not allowed'})</button>}
        {p && p.allow_dms === null && <p className="text-xs text-text-2">Using your default from Settings → Content & Social ({p.default ? 'allowed' : 'not allowed'}).</p>}
      </div>
    </Modal>
  )
}
