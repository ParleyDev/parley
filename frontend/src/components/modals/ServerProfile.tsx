import { ImagePlus, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import type { Member } from '../../lib/types'
import { uploadImage } from '../../lib/upload'
import { myGuildPerms, useStore } from '../../store'
import Avatar from '../Avatar'
import Modal from '../Modal'
import { useT } from '../../lib/i18n'

/** Edit Server Profile: a nickname, avatar, banner, pronouns and bio that only show in this server. */
export default function ServerProfileModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const me = useStore((s) => s.user)
  const member = useStore((s) => (me ? s.members[guildId]?.[me.id] : undefined))
  const canNick = useStore((s) => has(myGuildPerms(s, guildId), P.CHANGE_NICKNAME))
  const pushToast = useStore((s) => s.pushToast)
  const [nickname, setNickname] = useState(member?.nickname ?? '')
  const [avatar, setAvatar] = useState<string | null>(member?.guild_avatar ?? null)
  const [banner, setBanner] = useState<string | null>(member?.guild_banner ?? null)
  const [pronouns, setPronouns] = useState(member?.guild_pronouns ?? '')
  const [bio, setBio] = useState(member?.guild_bio ?? '')
  const [busy, setBusy] = useState(false)
  if (!guild || !me) return null
  const upload = async (kind: 'avatar' | 'banner', f: File | undefined, set: (u: string) => void) => {
    if (!f) return
    try { set((await uploadImage(kind, f)).url) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const save = async () => {
    setBusy(true)
    try {
      await api.patch<Member>(`/guilds/${guildId}/members/${me.id}`, { ...(canNick ? { nickname: nickname.trim() || null } : {}), guild_avatar: avatar ?? '', guild_banner: banner ?? '', guild_pronouns: pronouns, guild_bio: bio })
      pushToast(t('Server profile saved')); onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const pick = (kind: 'avatar' | 'banner', set: (u: string) => void, testid: string) => (
    <label className="btn-ghost flex cursor-pointer items-center gap-1 py-1 text-sm"><ImagePlus size={14} />{t('Change')}<input type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(kind, e.target.files?.[0], set); e.target.value = '' }} data-sp-upload={testid} /></label>
  )
  return (
    <Modal title={t('Edit Server Profile')} subtitle={t('Only shows in {name}. Anything you leave empty uses your main profile.', { name: guild.name })} onClose={onClose} width="max-w-lg"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={busy} onClick={save} data-sp-save>{t('Save')}</button></>}>
      <div className="space-y-4" data-server-profile>
        <div className="overflow-hidden rounded-xl border border-line bg-bg-1">
          <div className="h-20 bg-cover bg-center" style={{ background: banner ? `center/cover url(${banner})` : (me.banner_url ? `center/cover url(${me.banner_url})` : 'var(--color-accent, #5865f2)') }} data-sp-banner-preview={banner ?? ''} />
          <div className="-mt-8 flex items-end gap-3 px-4 pb-3">
            <span className="rounded-full border-4 border-bg-1"><Avatar user={{ ...me, avatar_url: avatar ?? me.avatar_url }} size={64} /></span>
            <div className="pb-1"><div className="font-bold">{nickname.trim() || me.display_name}</div><div className="text-xs text-text-2">{pronouns || me.pronouns}</div></div>
          </div>
        </div>
        {canNick && <div><label className="label" htmlFor="sp-nick">{t('Server nickname')}</label><input id="sp-nick" className="input" value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} placeholder={me.display_name} data-sp-nick /></div>}
        <div className="flex items-center gap-2"><span className="label mb-0 flex-1">{t('Server avatar')}</span>{pick('avatar', setAvatar, 'avatar')}{avatar && <button type="button" className="text-text-2 hover:text-danger" title={t('Use main avatar')} onClick={() => setAvatar(null)} data-sp-clear="avatar"><X size={16} /></button>}</div>
        <div className="flex items-center gap-2"><span className="label mb-0 flex-1">{t('Server banner')}</span>{pick('banner', setBanner, 'banner')}{banner && <button type="button" className="text-text-2 hover:text-danger" title={t('Use main banner')} onClick={() => setBanner(null)} data-sp-clear="banner"><X size={16} /></button>}</div>
        <div><label className="label" htmlFor="sp-pronouns">{t('Pronouns')}</label><input id="sp-pronouns" className="input" value={pronouns} maxLength={40} onChange={(e) => setPronouns(e.target.value)} placeholder={me.pronouns || t('Add your pronouns')} data-sp-pronouns /></div>
        <div><label className="label" htmlFor="sp-bio">{t('About me')}</label><textarea id="sp-bio" className="input resize-none" rows={3} value={bio} maxLength={190} onChange={(e) => setBio(e.target.value)} placeholder={me.bio || t('Tell this server about yourself')} data-sp-bio /></div>
      </div>
    </Modal>
  )
}
