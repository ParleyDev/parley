import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import type { Guild } from '../../../lib/types'
import { useStore } from '../../../store'
import WelcomeModal from '../Welcome'

type Row = { channel_id: string; description: string; emoji: string }

/** Server Settings › Welcome Screen: a short pitch and up to five channels new members are pointed to. */
export default function WelcomeTab({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const upsertGuild = useStore((s) => s.upsertGuild)
  const pushToast = useStore((s) => s.pushToast)
  const channels = useStore((s) => s.channels)
  const options = useMemo(() => Object.values(channels).filter((c) => c.guild_id === guildId && c.kind !== 'category' && c.kind !== 'thread').sort((a, b) => a.position - b.position), [channels, guildId])
  const w = guild?.welcome_screen ?? {}
  const [enabled, setEnabled] = useState(!!w.enabled)
  const [description, setDescription] = useState(w.description ?? '')
  const [rows, setRows] = useState<Row[]>((w.channels ?? []).map((c) => ({ channel_id: c.channel_id, description: c.description, emoji: c.emoji ?? '' })))
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  if (!guild) return null
  const save = async () => {
    setBusy(true)
    try {
      const g = await api.patch<Guild>(`/guilds/${guildId}`, { welcome_screen: { enabled, description, channels: rows.filter((r) => r.channel_id).map((r) => ({ channel_id: r.channel_id, description: r.description, emoji: r.emoji || null })) } })
      upsertGuild(g); pushToast('Welcome screen saved')
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-6" data-welcome-tab>
      <div>
        <h1 className="text-xl font-bold">Welcome Screen</h1>
        <p className="mt-1 text-sm text-text-2">New members see this when they first open {guild.name}: what it's about and where to start.</p>
      </div>
      <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg-1 p-3 cursor-pointer">
        <span className="text-sm font-semibold">Show the welcome screen to new members</span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-accent" data-welcome-enabled />
      </label>
      <div>
        <label className="label" htmlFor="welcome-desc">Description</label>
        <textarea id="welcome-desc" className="input resize-none" rows={2} maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={guild.description || 'What is this server about?'} data-welcome-desc />
      </div>
      <div>
        <label className="label">Suggested channels <span className="normal-case font-normal text-text-2">(up to 5)</span></label>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 max-md:flex-wrap" data-welcome-row={i}>
              <input className="input w-12 shrink-0 px-0 text-center text-lg" value={r.emoji} onChange={(e) => set(i, { emoji: e.target.value })} maxLength={64} placeholder="✨" aria-label="Emoji" data-welcome-emoji={i} />
              <select className="input w-44 shrink-0" value={r.channel_id} onChange={(e) => set(i, { channel_id: e.target.value })} data-welcome-pick={i}>
                <option value="">Pick a channel</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.kind === 'voice' ? '🔊 ' : '#'}{c.name}</option>)}
              </select>
              <input className="input min-w-0 flex-1" value={r.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={50} placeholder="Say hi and introduce yourself" data-welcome-text={i} />
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="shrink-0 text-text-2 hover:text-danger" title="Remove"><X size={16} /></button>
            </div>
          ))}
        </div>
        {rows.length < 5 && <button type="button" className="mt-2 flex items-center gap-1 text-sm text-sky-400 hover:underline" onClick={() => setRows([...rows, { channel_id: '', description: '', emoji: '' }])} data-welcome-add><Plus size={14} /> Add a channel</button>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy} data-welcome-save>Save</button>
        <button type="button" className="btn-ghost" onClick={() => setPreview(true)} data-welcome-preview>Preview</button>
      </div>
      {preview && <WelcomeModal guildId={guildId} onClose={() => setPreview(false)} draft={{ enabled, description, channels: rows.filter((r) => r.channel_id).map((r) => ({ ...r, emoji: r.emoji || null })) }} />}
    </div>
  )
}
