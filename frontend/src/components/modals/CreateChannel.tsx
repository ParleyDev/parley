import { FolderOpen, Hash, Image as ImageIcon, LayoutGrid, Lock, Megaphone, MessageSquareText, Users, Volume2, Radio, Disc3 } from 'lucide-react'
import { has, P } from '../../lib/perms'
import { slugFromName } from '../../lib/communities'
import { communityPath } from '../../lib/communityPage'
import { Toggle } from './SettingsShell'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { myGuildPerms, useStore } from '../../store'
import type { Channel, Community } from '../../lib/types'
import { useT } from '../../lib/i18n'
import Dropdown from '../Dropdown'

type Kind = 'text' | 'announcement' | 'voice' | 'stage' | 'studio' | 'category' | 'forum' | 'media' | 'directory' | 'community'

export default function CreateChannelModal({ onClose, guildId, parentId = null, stay = false, initialKind }: { onClose: () => void; guildId: string; parentId?: string | null; stay?: boolean; initialKind?: 'community' }) {
  const t = useT()
  const [name, setName] = useState('')
  // A community needs server-level Manage Channels (a manager of one category cannot make another) and is never made inside a category.
  const canCommunity = useStore((s) => has(myGuildPerms(s, guildId), P.MANAGE_CHANNELS)) && !parentId
  const [kind, setKind] = useState<Kind>(initialKind === 'community' && canCommunity ? 'community' : 'text')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [parent, setParent] = useState<string>(parentId ?? '')
  const allChannels = useStore((s) => s.channels)
  const categories = Object.values(allChannels).filter((c) => c.guild_id === guildId && c.kind === 'category').sort((a, b) => a.position - b.position)
  const [isPrivate, setPrivate] = useState(false)
  const me = useStore((s) => s.user)
  const guild = useStore((s) => s.guilds[guildId])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const upsertChannel = useStore((s) => s.upsertChannel)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      if (kind === 'community') {
        const c = await api.post<Community>(`/guilds/${guildId}/communities`, { slug, name: name.trim() })
        const st = useStore.getState()
        // The creator follows it automatically; the gateway says so too, this just shows it without waiting.
        st.upsertCommunity({ id: c.id, guild_id: c.guild_id, slug: c.slug, name: c.name, icon_url: c.icon_url, banner_url: c.banner_url, description: c.description, category_id: c.category_id })
        st.setCommunityFollow(guildId, c.id, true)
        onClose(); navigate(`${communityPath(guildId, c.slug)}?edit=1`)
        return
      }
      const c = await api.post<Channel>(`/guilds/${guildId}/channels`, { name, kind, parent_id: kind === 'category' || !parent ? null : parent })
      if (isPrivate) {
        await api.put(`/channels/${c.id}/permissions/${guildId}`, { kind: 'role', allow: 0, deny: P.VIEW_CHANNEL })
        if (me && guild?.owner_id !== me.id) await api.put(`/channels/${c.id}/permissions/${me.id}`, { kind: 'member', allow: P.VIEW_CHANNEL, deny: 0 })
      }
      upsertChannel(c); onClose(); if (kind !== 'category' && !stay) navigate(`/channels/${guildId}/${c.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Create" onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button form="create-channel" className="btn-primary" disabled={busy || !name.trim() || (kind === 'community' && !slug)}>{kind === 'community' ? t('Create') : t('Create Channel')}</button></>}>
      <form id="create-channel" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">{t(kind === 'community' ? 'Type' : 'Channel type')}</label>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1" data-channel-kinds>
            {([...(canCommunity ? [['community', t('Community'), t('A place with its own page and channels'), Users] as const] : []), ['text', t('Text'), t('Send messages, images, GIFs, emoji, opinions, and puns'), Hash], ['announcement', t('Announcement'), t('Important updates people can follow into their own servers'), Megaphone], ['voice', t('Voice'), t('Hang out together with voice, video, and screen share'), Volume2], ['stage', t('Stage'), t('Speakers on stage, everyone else listens and can raise a hand'), Radio], ['studio', t('Recording Studio'), t('Projects for your songs: each with its own DAW, takes, chat and live sessions'), Disc3], ['forum', t('Forum'), t('Organised posts with tags instead of a running chat'), MessageSquareText], ['media', t('Media'), t('A gallery of posts that each lead with an image or video'), ImageIcon], ['directory', t('Directory'), t('A list of servers members can browse and join'), LayoutGrid], ['category', t('Category'), t('Group channels under a collapsible heading'), FolderOpen]] as const).map(([v, label, d, Icon]) => (
              <button type="button" key={v} onClick={() => setKind(v)} data-channel-kind={v} data-create-type={v} aria-pressed={kind === v} className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${kind === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-3 hover:bg-bg-4'}`}>
                <Icon size={22} className="text-text-1" />
                <div><div className="font-semibold">{label}</div><div className="text-xs text-text-2">{d}</div></div>
                <span className={`ml-auto h-5 w-5 rounded-full border-2 ${kind === v ? 'border-accent bg-accent' : 'border-text-2'}`} />
              </button>
            ))}
          </div>
        </div>
        {err && <p className="text-sm text-danger" role="alert" data-create-error>{err}</p>}
        {kind === 'community' ? (
          <>
            <div>
              <label className="label" htmlFor="create-community-name">{t('Name')}</label>
              <input id="create-community-name" className="input" autoFocus value={name} maxLength={100} required data-create-community-name
                onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugFromName(e.target.value)) }} />
            </div>
            <div>
              <label className="label" htmlFor="create-community-slug">{t('Address')}</label>
              <input id="create-community-slug" className="input font-mono" value={slug} maxLength={63} required data-create-community-slug
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
              <p className="mt-1 text-xs text-text-2">{t('Lower-case letters, digits and hyphens.')}</p>
            </div>
          </>
        ) : (
          <>
        <div>
          <label className="label">{t('Channel name')}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2">{kind === 'text' || kind === 'forum' || kind === 'announcement' || kind === 'media' || kind === 'directory' ? <Hash size={16} /> : kind === 'voice' ? <Volume2 size={16} /> : <FolderOpen size={16} />}</span>
            <input className="input pl-9" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'category' ? t('New Category') : 'new-channel'} maxLength={100} required data-channel-name />
          </div>
        </div>
        {kind !== 'category' && categories.length > 0 && (
          <div>
            <label className="label">{t('Category')}</label>
            <Dropdown className="input" value={parent} onChange={(e) => setParent(e.target.value)} data-channel-parent>
              <option value="">{t('No category')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Dropdown>
          </div>
        )}
        <div className="rounded-lg border border-line bg-bg-3 p-3">
          <Toggle label={kind === 'category' ? 'Private category' : 'Private channel'} checked={isPrivate} onChange={setPrivate} />
          <p className="text-xs text-text-2 mt-1 flex items-center gap-1"><Lock size={12} /> {t('Only you and roles you add in channel permissions will see it.')}</p>
        </div>
          </>
        )}
      </form>
    </Modal>
  )
}
