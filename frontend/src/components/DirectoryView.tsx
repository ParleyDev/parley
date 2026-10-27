import { Handshake, Plus, Search, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { colorFor, initials } from '../lib/format'
import { has, P } from '../lib/perms'
import type { Channel, Guild } from '../lib/types'
import { markJoined } from '../lib/welcome'
import { myChannelPerms, myGuildPerms, useStore } from '../store'
import Modal from './Modal'
import { t as tr, useT } from '../lib/i18n'

interface Entry { guild_id: string; name: string; icon_url: string | null; description: string; category: string; invite_code: string; member_count: number; joined: boolean; partnered: boolean }
const CATEGORIES = ['gaming', 'music', 'education', 'science', 'entertainment', 'creative', 'community', 'other']
const categoryLabel = (c: string) => (({ gaming: tr('gaming'), music: tr('music'), education: tr('education'), science: tr('science'), entertainment: tr('entertainment'), creative: tr('creative'), community: tr('community'), other: tr('other') }) as Record<string, string>)[c] ?? c

/** A directory channel: servers listed here, searchable by name and category, joinable in one click. */
export default function DirectoryView({ channel }: { channel: Channel }) {
  const t = useT()
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  const guilds = useStore((s) => s.guilds)
  const version = useStore((s) => s.directoryVersion[channel.id] ?? 0)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [list, setList] = useState<Entry[] | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => { const h = setTimeout(() => api.get<Entry[]>(`/channels/${channel.id}/directory?q=${encodeURIComponent(q)}${cat ? `&category=${cat}` : ''}`).then(setList).catch(() => setList([])), q ? 250 : 0); return () => clearTimeout(h) }, [channel.id, q, cat, version])
  const join = async (e: Entry) => {
    if (e.joined) { navigate(`/channels/${e.guild_id}`); return }
    try { const g = await api.post<Guild & { channels: Channel[] }>(`/invites/${e.invite_code}`); upsertGuild(g); markJoined(g.id); const first = g.channels.find((c) => c.kind === 'text'); navigate(first ? `/channels/${g.id}/${first.id}` : `/channels/${g.id}`) } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const remove = async (e: Entry) => { try { await api.delete(`/channels/${channel.id}/directory/${e.guild_id}`); setList((l) => l?.filter((x) => x.guild_id !== e.guild_id) ?? null) } catch (err) { pushToast((err as Error).message, 'error') } }
  const canRemove = (e: Entry) => has(perms, P.MANAGE_CHANNELS) || (guilds[e.guild_id] && has(myGuildPerms(useStore.getState(), e.guild_id), P.MANAGE_GUILD))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 max-md:px-3" data-directory={channel.id}>
      {channel.topic && <p className="mb-3 text-sm text-text-1">{channel.topic}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {has(perms, P.SEND_MESSAGES) && <button type="button" className="btn-primary py-1.5" onClick={() => setAdding(true)} data-directory-add><Plus size={16} /> {t('Add Your Server')}</button>}
        <span className="relative"><input className="input w-56 py-1.5 pl-7 text-sm" placeholder={t('Search servers')} value={q} onChange={(e) => setQ(e.target.value)} data-directory-search /><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-2" /></span>
        {['', ...CATEGORIES].map((c) => <button key={c || 'all'} type="button" onClick={() => setCat(c)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cat === c ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-directory-cat={c || 'all'}>{c ? categoryLabel(c) : t('All')}</button>)}
      </div>
      {list === null ? <p className="text-sm text-text-2">{t('Loading…')}</p> : list.length === 0 ? <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-text-2" data-directory-empty>{q || cat ? t('No servers listed match.') : t('No servers listed yet.')}</div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {list.map((e) => (
            <div key={e.guild_id} className="flex flex-col gap-2 rounded-xl border border-line bg-bg-1 p-4" data-directory-entry={e.guild_id}>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-bold text-white" style={{ background: e.icon_url ? undefined : colorFor(e.guild_id) }}>{e.icon_url ? <img src={e.icon_url} alt="" className="h-full w-full object-cover" /> : initials(e.name)}</div>
                <div className="min-w-0"><div className="flex items-center gap-1 truncate font-bold">{e.name}{e.partnered && <Handshake size={14} className="shrink-0 text-accent" />}</div><div className="flex items-center gap-1 text-xs text-text-2"><Users size={12} />{e.member_count} · <span className="capitalize">{categoryLabel(e.category)}</span></div></div>
              </div>
              {e.description && <p className="line-clamp-3 text-sm text-text-1">{e.description}</p>}
              <div className="mt-auto flex items-center gap-2 pt-1">
                <button type="button" className={e.joined ? 'btn-ghost flex-1' : 'btn-primary flex-1'} onClick={() => join(e)} data-directory-join={e.guild_id}>{e.joined ? t('Open') : t('Join')}</button>
                {canRemove(e) && <button type="button" className="text-text-2 hover:text-danger" title={t('Remove from the directory')} onClick={() => remove(e)} data-directory-remove={e.guild_id}><Trash2 size={16} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <AddServer channel={channel} onClose={() => setAdding(false)} />}
    </div>
  )
}

/** Pick one of the servers you manage, describe it, and list it. */
function AddServer({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT()
  const guilds = useStore((s) => s.guilds)
  const pushToast = useStore((s) => s.pushToast)
  const bump = useStore((s) => s.bumpDirectory)
  const mine = Object.values(guilds).filter((g) => g.id !== channel.guild_id && has(myGuildPerms(useStore.getState(), g.id), P.MANAGE_GUILD))
  const [gid, setGid] = useState(mine[0]?.id ?? '')
  const [description, setDescription] = useState(mine[0]?.description ?? '')
  const [category, setCategory] = useState('community')
  const add = async () => { try { await api.post(`/channels/${channel.id}/directory`, { guild_id: gid, description, category }); bump(channel.id); onClose() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <Modal title={t('Add your server')} subtitle={t('to #{name}', { name: channel.name })} onClose={onClose} width="max-w-md" footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn-primary" disabled={!gid} onClick={add} data-directory-add-confirm>{t('Add')}</button></>}>
      {mine.length === 0 ? <p className="text-sm text-text-2">{t('You need Manage Server in a server to list it here.')}</p> : (
        <div className="space-y-3" data-directory-add-form>
          <div><label className="label">{t('Server')}</label><select className="input" value={gid} onChange={(e) => { setGid(e.target.value); setDescription(guilds[e.target.value]?.description ?? '') }} data-directory-pick>{mine.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><label className="label">{t('Category')}</label><select className="input capitalize" value={category} onChange={(e) => setCategory(e.target.value)} data-directory-category>{CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></div>
          <div><label className="label">{t('Description')}</label><textarea className="input resize-none" rows={3} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("What's your server about?")} data-directory-desc /></div>
          <p className="text-xs text-text-2">{t("Listing makes an invite that doesn't expire, so members here can join from the directory.")}</p>
        </div>
      )}
    </Modal>
  )
}
