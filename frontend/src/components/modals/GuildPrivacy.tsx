import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import Modal from '../Modal'
import { Toggle } from './SettingsShell'
import { useT } from '../../lib/i18n'

interface GuildPrivacy { allow_dms: boolean | null; effective: boolean; default: boolean }

/** Server menu → Privacy Settings: allow direct messages from this server's members (or fall back to your default). */
export default function GuildPrivacyModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const [p, setP] = useState<GuildPrivacy | null>(null)
  useEffect(() => { api.get<GuildPrivacy>(`/guilds/${guildId}/members/@me/privacy`).then(setP).catch((e) => pushToast((e as Error).message, 'error')) }, [guildId, pushToast])
  const set = async (allow_dms: boolean | null) => {
    try { setP(await api.patch<GuildPrivacy>(`/guilds/${guildId}/members/@me/privacy`, { allow_dms })) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <Modal title={t('Privacy Settings · {name}', { name: guild?.name ?? t('Server') })} onClose={onClose} footer={<button type="button" className="btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <div className="space-y-3" data-guild-privacy={p ? (p.allow_dms === null ? 'default' : p.allow_dms ? 'on' : 'off') : 'loading'}>
        <span data-guild-privacy-toggle><Toggle label={t('Allow direct messages from server members')} checked={p?.effective ?? true} onChange={(v) => set(v)} disabled={!p} /></span>
        <p className="text-xs text-text-2">{t('People you share this server with can message you even if you are not friends (when your DM setting is "Friends and server members"). Friends can always message you.')}</p>
        {p && p.allow_dms !== null && <button type="button" onClick={() => set(null)} className="text-xs text-sky-400 hover:underline" data-guild-privacy-reset>{t('Use my default ({state})', { state: p.default ? t('allowed') : t('not allowed') })}</button>}
        {p && p.allow_dms === null && <p className="text-xs text-text-2">{t('Using your default from Settings → Content & Social ({state}).', { state: p.default ? t('allowed') : t('not allowed') })}</p>}
      </div>
    </Modal>
  )
}
