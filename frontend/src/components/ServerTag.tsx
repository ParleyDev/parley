import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/** Profile: wear one of your servers' tags instead of typing your own. */
export function WearServerTag() {
  const t = useT()
  const me = useStore((s) => s.user)
  const guilds = useStore((s) => s.guilds)
  const pushToast = useStore((s) => s.pushToast)
  const tagged = Object.values(guilds).filter((g) => g.tag)
  const current = (me as { clan_tag_guild?: string | null } | null)?.clan_tag_guild ?? ''
  if (!tagged.length) return null
  const wear = async (gid: string) => { try { await api.put('/users/@me/server-tag', { guild_id: gid || null }); pushToast(gid ? t('Wearing the server tag') : t('Server tag removed')) } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <div data-wear-server-tag>
      <label className="label">{t("Or wear a server's tag")}</label>
      <select className="input w-auto" value={current} onChange={(e) => wear(e.target.value)} data-wear-tag-select>
        <option value="">{t('None')}</option>
        {tagged.map((g) => <option key={g.id} value={g.id}>{g.tag_badge ? `${g.tag_badge} ` : ''}{g.tag} · {g.name}</option>)}
      </select>
    </div>
  )
}
