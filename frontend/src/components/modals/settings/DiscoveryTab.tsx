import { Compass } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { CATEGORIES, type Listing } from '../../../lib/discover'
import type { Guild } from '../../../lib/types'
import { useStore } from '../../../store'
import ImagePicker from '../ImagePicker'
import { useT } from '../../../lib/i18n'

const MAX_DESC = 300

/** Server Settings › Discovery: submit the server to Discover, see its review status, update or withdraw. */
export default function DiscoveryTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [listing, setListing] = useState<Listing | null | undefined>(undefined)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('community')
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = useT()
  useEffect(() => {
    api.get<Listing | null>(`/guilds/${guildId}/discovery`).then((l) => { setListing(l); if (l) { setDescription(l.description); setCategory(l.category); setBanner(l.banner_url) } else setBanner(useStore.getState().guilds[guildId]?.banner_url ?? null) }).catch(() => setListing(null))
  }, [guildId])
  if (!guild) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const l = await api.put<Listing>(`/guilds/${guildId}/discovery`, { description, category, banner_url: banner ?? '' })
      // A banner chosen here also becomes the server banner (top of the channel list) when the server has none yet.
      if (banner && !guild.banner_url) { try { upsertGuild(await api.patch<Guild>(`/guilds/${guildId}`, { banner_url: banner })) } catch { /* listing saved regardless */ } }
      setListing(l); pushToast(l.status === 'approved' ? t('Listing updated') : t('Submitted for review'))
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const withdraw = () => openModal({ kind: 'confirm', title: t('Remove from Discover'), body: t('Your server will no longer be listed. You can submit it again later.'), danger: true, confirmLabel: t('Remove'),
    action: async () => { try { await api.delete(`/guilds/${guildId}/discovery`); setListing(null); setDescription(''); setBanner(null) } catch (err) { pushToast((err as Error).message, 'error') } } })
  const status = listing?.status
  const badge = status === 'approved' ? 'bg-success/20 text-success' : status === 'rejected' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'
  return (
    <form onSubmit={submit} className="space-y-6" data-discovery-tab>
      <div>
        <h1 className="text-xl font-bold">{t('Discovery')}</h1>
        <p className="text-sm text-text-2 mt-1">{t('List {name} in Discover so anyone on this Parley instance can find and join it. A Parley admin reviews every submission.', { name: guild.name })}</p>
      </div>
      {listing === undefined ? <p className="text-sm text-text-2">{t('Loading…')}</p> : listing && (
        <div className="rounded-xl bg-bg-0/50 border border-line p-4 flex items-start gap-3" data-discovery-status={status}>
          <Compass size={20} className="text-text-2 mt-0.5" />
          <div className="text-sm">
            <div className="flex items-center gap-2 font-semibold">{t('Status')} <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${badge}`}>{status}</span></div>
            <p className="text-text-2 mt-1">{status === 'approved' ? t('Your server is live in Discover. Edits apply immediately.') : status === 'rejected' ? t('Not approved. Adjust your listing and submit again.') : t('Waiting for an admin to review it.')}</p>
            {listing.note && <p className="mt-1 text-text-1"><b>{t('Admin note:')}</b> {listing.note}</p>}
          </div>
        </div>
      )}
      <div>
        <label className="label">{t('Category')}</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} data-discovery-category>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
        </select>
      </div>
      <div>
        <label className="label">{t('Description')}</label>
        <textarea className="input resize-none" rows={4} maxLength={MAX_DESC} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Tell people what your server is about (10–300 characters)')} data-discovery-description />
        <div className="text-right text-[11px] text-text-2 mt-1">{description.length}/{MAX_DESC}</div>
      </div>
      <div>
        <label className="label">{t('Banner')}</label>
        <div className="flex items-center gap-4"><ImagePicker value={banner} onChange={setBanner} label={guild.name} id={guildId} round={false} kind="banner" /><p className="text-xs text-text-2">{t('Shown on your Discover card; it also becomes the server banner above the channel list if you haven\'t set one in Overview. Without one, a colour gradient is used.')}</p></div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy || description.trim().length < 10} data-discovery-submit>{busy ? t('Saving…') : status === 'approved' ? t('Update Listing') : status ? t('Resubmit') : t('Submit for Review')}</button>
        {listing && <button type="button" className="btn-ghost text-danger" onClick={withdraw} data-discovery-withdraw>{t('Remove from Discover')}</button>}
      </div>
    </form>
  )
}
