import { CalendarDays, Check, ImagePlus, MapPin, Pencil, Play, Plus, Repeat, Square, Trash2, Users, Volume2, X } from 'lucide-react'
import { locale, t as tr, useT } from '../../lib/i18n'
import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import { uploadImage } from '../../lib/upload'
import type { GuildEvent } from '../../lib/types'
import { myGuildPerms, useStore } from '../../store'

const fmt = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const repeatOptions = (): [NonNullable<GuildEvent['recurrence']>, string][] => [['', tr('Does not repeat')], ['daily', tr('Every day')], ['weekly', tr('Every week')], ['biweekly', tr('Every other week')], ['monthly', tr('Every month')]]
type Draft = { name: string; description: string; starts: string; ends: string; where: string; location: string; cover: string | null; recurrence: NonNullable<GuildEvent['recurrence']> }
const blank = (): Draft => ({ name: '', description: '', starts: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)), ends: '', where: '', location: '', cover: null, recurrence: '' })
const fromEvent = (e: GuildEvent): Draft => ({ name: e.name, description: e.description, starts: toLocalInput(new Date(e.starts_at)), ends: e.ends_at ? toLocalInput(new Date(e.ends_at)) : '', where: e.channel_id ?? '', location: e.location, cover: e.cover_url ?? null, recurrence: e.recurrence ?? '' })

/** Server events: the upcoming list with RSVP and who's interested; Manage Events creates, edits, starts and ends them. */
export default function EventsModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const t = useT()
  const guild = useStore((s) => s.guilds[guildId])
  const events = useStore((s) => s.events[guildId])
  const loadEvents = useStore((s) => s.loadEvents)
  const channels = useStore((s) => Object.values(s.channels).filter((c) => c.guild_id === guildId && (c.kind === 'voice' || c.kind === 'stage')).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name, kind: c.kind })).map((c) => JSON.stringify(c)).join('|'))
  const voiceChannels = channels ? channels.split('|').map((c) => JSON.parse(c) as { id: string; name: string; kind: string }) : []
  const canManage = useStore((s) => has(myGuildPerms(s, guildId), P.MANAGE_GUILD) || has(myGuildPerms(s, guildId), P.MANAGE_EVENTS))
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  // null: not editing; 'new': creating; an id: editing that event.
  const [editing, setEditing] = useState<string | null>(null)
  const [d, setD] = useState<Draft>(blank)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<{ id: string; list: { id: string; display_name: string; avatar_url: string | null; nickname: string | null }[] } | null>(null)
  useEffect(() => { loadEvents(guildId) }, [guildId, loadEvents])
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const toggle = async (e: GuildEvent) => { try { await api[e.me_rsvp ? 'delete' : 'put'](`/guilds/${guildId}/events/${e.id}/rsvp`) } catch (err) { pushToast((err as Error).message, 'error') } }
  const del = (e: GuildEvent) => openModal({ kind: 'confirm', title: t('Delete {name}', { name: e.name }), body: t('Everyone who RSVPed loses the event.'), danger: true, confirmLabel: t('Delete'), action: async () => { try { await api.delete(`/guilds/${guildId}/events/${e.id}`) } catch (err) { pushToast((err as Error).message, 'error') } } })
  const act = async (e: GuildEvent, what: 'start' | 'end') => { try { await api.post(`/guilds/${guildId}/events/${e.id}/${what}`, {}); pushToast(what === 'start' ? t('{name} has started', { name: e.name }) : e.recurrence ? t('{name} moved to its next date', { name: e.name }) : e.status === 'active' ? t('{name} has ended', { name: e.name }) : t('{name} canceled', { name: e.name })) } catch (err) { pushToast((err as Error).message, 'error') } }
  const showPeople = async (e: GuildEvent) => { if (people?.id === e.id) { setPeople(null); return } try { setPeople({ id: e.id, list: await api.get(`/guilds/${guildId}/events/${e.id}/rsvps`) }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const submit = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true)
    const body = { name: d.name, description: d.description, starts_at: new Date(d.starts).toISOString(), ends_at: d.ends ? new Date(d.ends).toISOString() : null, channel_id: d.where || null, location: d.where ? '' : d.location, cover_url: d.cover ?? '', recurrence: d.recurrence }
    try {
      if (editing === 'new') await api.post(`/guilds/${guildId}/events`, body)
      else await api.patch(`/guilds/${guildId}/events/${editing}`, body)
      pushToast(editing === 'new' ? t('Event scheduled') : t('Event updated')); setEditing(null); setD(blank())
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const cover = async (f: File | undefined) => { if (!f) return; try { set({ cover: (await uploadImage('banner', f)).url }) } catch (err) { pushToast((err as Error).message, 'error') } }
  const list = events ?? []
  return (
    <Modal title={t('Events · {name}', { name: guild?.name ?? '' })} onClose={onClose} width="max-w-lg">
      <div className="space-y-3" data-events-modal>
        {canManage && !editing && <button type="button" className="btn-primary" onClick={() => { setD(blank()); setEditing('new') }} data-event-new><Plus size={16} /> {t('Create Event')}</button>}
        {editing && (
          <form onSubmit={submit} className="rounded-xl border border-line bg-bg-0/40 p-4 space-y-3" data-event-form={editing}>
            <div className="relative h-24 overflow-hidden rounded-lg border border-dashed border-line bg-bg-2" style={d.cover ? { background: `center/cover url(${d.cover})` } : undefined} data-event-cover-preview={d.cover ?? ''}>
              <label className="absolute inset-0 flex cursor-pointer items-center justify-center gap-1 text-sm text-text-2 hover:bg-black/20"><ImagePlus size={18} />{d.cover ? t('Change cover') : t('Add a cover image')}<input type="file" accept="image/*" className="hidden" onChange={(e) => { void cover(e.target.files?.[0]); e.target.value = '' }} data-event-cover /></label>
              {d.cover && <button type="button" className="absolute right-1 top-1 rounded-full bg-bg-0/80 p-1" title={t('Remove cover')} onClick={() => set({ cover: null })}><X size={14} /></button>}
            </div>
            <div><label className="label">{t('Name')}</label><input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} minLength={2} required data-event-name /></div>
            <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
              <div><label className="label">{t('Starts')}</label><input type="datetime-local" className="input" value={d.starts} onChange={(e) => set({ starts: e.target.value })} required data-event-starts /></div>
              <div><label className="label">{t('Ends (optional)')}</label><input type="datetime-local" className="input" value={d.ends} onChange={(e) => set({ ends: e.target.value })} data-event-ends /></div>
            </div>
            <div><label className="label">{t('Repeats')}</label><select className="input" value={d.recurrence} onChange={(e) => set({ recurrence: e.target.value as Draft['recurrence'] })} data-event-repeat>{repeatOptions().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="label">{t('Where')}</label>
              <select className="input" value={d.where} onChange={(e) => set({ where: e.target.value })} data-event-channel>
                <option value="">{t('Somewhere else (enter a location)')}</option>
                {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.kind === 'stage' ? '🎙 ' : '🔊 '}{c.name}</option>)}
              </select>
            </div>
            {!d.where && <div><label className="label">{t('Location')}</label><input className="input" value={d.location} onChange={(e) => set({ location: e.target.value })} maxLength={200} placeholder={t('A link or an address')} required data-event-location /></div>}
            <div><label className="label">{t('Description')}</label><textarea className="input resize-none" rows={3} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={1000} data-event-description /></div>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button><button className="btn-primary" disabled={busy} data-event-submit>{busy ? t('Saving…') : editing === 'new' ? t('Schedule') : t('Save')}</button></div>
          </form>
        )}
        {events === undefined && <p className="text-sm text-text-2">{t('Loading…')}</p>}
        {list.length === 0 && events && !editing && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2"><CalendarDays size={28} className="mx-auto mb-2 text-text-2" />{t('No upcoming events.')}</div>}
        {list.map((e) => {
          const active = e.status === 'active'
          const ch = voiceChannels.find((c) => c.id === e.channel_id)
          return (
            <div key={e.id} className="overflow-hidden rounded-xl border border-line bg-bg-1" data-event={e.id} data-event-status={e.status ?? 'scheduled'} data-event-live={active ? '1' : '0'}>
              {e.cover_url && <img src={e.cover_url} alt="" className="h-28 w-full object-cover" data-event-cover-img />}
              <div className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] font-bold uppercase tracking-wider ${active ? 'text-success' : 'text-accent'}`}>{active ? t('● Happening now') : fmt(e.starts_at)}{!active && e.ends_at ? ` → ${fmt(e.ends_at)}` : ''}</div>
                  <div className="font-bold truncate">{e.name}</div>
                  {e.description && <p className="text-sm text-text-1 mt-0.5 whitespace-pre-wrap">{e.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
                    {ch ? <><Volume2 size={12} /> {ch.name}</> : <><MapPin size={12} /> {e.location}</>}
                    {e.recurrence && <><span>·</span><Repeat size={12} /><span data-event-repeats>{repeatOptions().find(([v]) => v === e.recurrence)?.[1]}</span></>}
                    <span>·</span><button type="button" className="flex items-center gap-1 hover:underline" onClick={() => showPeople(e)} data-event-people={e.id}><Users size={12} /><span data-event-count>{t('{n} interested', { n: e.rsvp_count })}</span></button>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button type="button" onClick={() => toggle(e)} className={`rounded-md px-2.5 py-1 text-xs font-semibold flex items-center gap-1 ${e.me_rsvp ? 'bg-success text-black' : 'bg-bg-3 hover:bg-bg-4'}`} data-event-rsvp aria-pressed={e.me_rsvp}>{e.me_rsvp ? <><Check size={12} /> {t('Interested')}</> : t('Interested?')}</button>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      {!active && <button type="button" onClick={() => act(e, 'start')} className="text-text-2 hover:text-success" title={t('Start event')} data-event-start><Play size={14} /></button>}
                      <button type="button" onClick={() => act(e, 'end')} className="text-text-2 hover:text-warn" title={active ? t('End event') : t('Cancel event')} data-event-end><Square size={14} /></button>
                      <button type="button" onClick={() => { setD(fromEvent(e)); setEditing(e.id) }} className="text-text-2 hover:text-text-0" title={t('Edit event')} data-event-edit><Pencil size={14} /></button>
                      <button type="button" onClick={() => del(e)} className="text-text-2 hover:text-danger" title={t('Delete event')} data-event-delete><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              </div>
              {people?.id === e.id && (
                <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2" data-event-people-list>
                  {people.list.map((u) => <span key={u.id} className="flex items-center gap-1 rounded-full bg-bg-3 py-0.5 pl-0.5 pr-2 text-xs"><Avatar user={u} size={18} />{u.nickname ?? u.display_name}</span>)}
                  {people.list.length === 0 && <span className="text-xs text-text-2">{t('Nobody yet.')}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
