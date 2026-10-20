import { CalendarDays, Check, MapPin, Plus, Trash2, Volume2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import type { GuildEvent } from '../../lib/types'
import { myGuildPerms, useStore } from '../../store'

const fmt = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const toLocalInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }

/** Server events: the upcoming list with RSVP, and a create form for Manage Server. */
export default function EventsModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const events = useStore((s) => s.events[guildId])
  const loadEvents = useStore((s) => s.loadEvents)
  const channels = useStore((s) => Object.values(s.channels).filter((c) => c.guild_id === guildId && (c.kind === 'voice' || c.kind === 'stage')).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name, kind: c.kind })).map((c) => JSON.stringify(c)).join('|'))
  const voiceChannels = channels ? channels.split('|').map((c) => JSON.parse(c) as { id: string; name: string; kind: string }) : []
  const canManage = useStore((s) => has(myGuildPerms(s, guildId), P.MANAGE_GUILD))
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [starts, setStarts] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)))
  const [ends, setEnds] = useState('')
  const [where, setWhere] = useState<string>(() => '')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadEvents(guildId) }, [guildId, loadEvents])
  const toggle = async (e: GuildEvent) => { try { await api[e.me_rsvp ? 'delete' : 'put'](`/guilds/${guildId}/events/${e.id}/rsvp`) } catch (err) { pushToast((err as Error).message, 'error') } }
  const del = (e: GuildEvent) => openModal({ kind: 'confirm', title: `Delete ${e.name}`, body: 'Everyone who RSVPed loses the event.', danger: true, confirmLabel: 'Delete', action: async () => { try { await api.delete(`/guilds/${guildId}/events/${e.id}`) } catch (err) { pushToast((err as Error).message, 'error') } } })
  const submit = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true)
    try {
      await api.post(`/guilds/${guildId}/events`, { name, description, starts_at: new Date(starts).toISOString(), ends_at: ends ? new Date(ends).toISOString() : null, channel_id: where || null, location: where ? '' : location })
      pushToast('Event scheduled'); setCreating(false); setName(''); setDescription(''); setEnds(''); setLocation('')
    } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const list = events ?? []
  return (
    <Modal title={`Events · ${guild?.name ?? ''}`} onClose={onClose} width="max-w-lg">
      <div className="space-y-3" data-events-modal>
        {canManage && !creating && <button type="button" className="btn-primary" onClick={() => setCreating(true)} data-event-new><Plus size={16} /> Create Event</button>}
        {creating && (
          <form onSubmit={submit} className="rounded-xl border border-line bg-bg-0/40 p-4 space-y-3" data-event-form>
            <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} minLength={2} required data-event-name /></div>
            <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
              <div><label className="label">Starts</label><input type="datetime-local" className="input" value={starts} onChange={(e) => setStarts(e.target.value)} required data-event-starts /></div>
              <div><label className="label">Ends (optional)</label><input type="datetime-local" className="input" value={ends} onChange={(e) => setEnds(e.target.value)} data-event-ends /></div>
            </div>
            <div><label className="label">Where</label>
              <select className="input" value={where} onChange={(e) => setWhere(e.target.value)} data-event-channel>
                <option value="">Somewhere else (enter a location)</option>
                {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.kind === 'stage' ? '🎙 ' : '🔊 '}{c.name}</option>)}
              </select>
            </div>
            {!where && <div><label className="label">Location</label><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="A link or an address" required data-event-location /></div>}
            <div><label className="label">Description</label><textarea className="input resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} data-event-description /></div>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary" disabled={busy} data-event-submit>{busy ? 'Saving…' : 'Schedule'}</button></div>
          </form>
        )}
        {events === undefined && <p className="text-sm text-text-2">Loading…</p>}
        {list.length === 0 && events && !creating && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2"><CalendarDays size={28} className="mx-auto mb-2 text-text-2" />No upcoming events.</div>}
        {list.map((e) => {
          const live = new Date(e.starts_at).getTime() <= Date.now()
          const ch = voiceChannels.find((c) => c.id === e.channel_id)
          return (
            <div key={e.id} className="rounded-xl border border-line bg-bg-1 p-3" data-event={e.id} data-event-live={live ? '1' : '0'}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-accent">{live ? 'Happening now' : fmt(e.starts_at)}{e.ends_at ? ` → ${fmt(e.ends_at)}` : ''}</div>
                  <div className="font-bold truncate">{e.name}</div>
                  {e.description && <p className="text-sm text-text-1 mt-0.5 whitespace-pre-wrap">{e.description}</p>}
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-text-2">{ch ? <><Volume2 size={12} /> {ch.name}</> : <><MapPin size={12} /> {e.location}</>}<span>·</span><span data-event-count>{e.rsvp_count} going</span></div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button type="button" onClick={() => toggle(e)} className={`rounded-md px-2.5 py-1 text-xs font-semibold flex items-center gap-1 ${e.me_rsvp ? 'bg-success text-black' : 'bg-bg-3 hover:bg-bg-4'}`} data-event-rsvp aria-pressed={e.me_rsvp}>{e.me_rsvp ? <><Check size={12} /> Going</> : 'Interested'}</button>
                  {canManage && <button type="button" onClick={() => del(e)} className="text-text-2 hover:text-danger" title="Delete event" data-event-delete><Trash2 size={14} /></button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
