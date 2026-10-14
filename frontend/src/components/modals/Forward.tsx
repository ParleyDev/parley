import { Check, Forward, Hash, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { renderMarkdown } from '../../lib/format'
import { has, P } from '../../lib/perms'
import type { Message } from '../../lib/types'
import { myChannelPerms, useStore } from '../../store'
import Avatar from '../Avatar'
import Modal from '../Modal'

interface Target { id: string; label: string; sub: string; kind: 'channel' | 'dm'; avatar?: { id: string; display_name: string; avatar_url: string | null } }

/** Discord's Forward dialog: pick one or more channels/DMs, see a preview, Send. */
export default function ForwardModal({ onClose, message: m }: { onClose: () => void; message: Message }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pushToast = useStore((s) => s.pushToast)
  // Select stable slices, then derive the list in useMemo (a selector returning fresh objects would re-render forever).
  const guildOrder = useStore((s) => s.guildOrder)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const dms = useStore((s) => s.dms)
  const users = useStore((s) => s.users)
  const targets = useMemo((): Target[] => {
    const s = useStore.getState()
    const out: Target[] = []
    for (const gid of guildOrder) {
      const g = guilds[gid]; if (!g) continue
      Object.values(channels).filter((c) => c.guild_id === gid && c.kind === 'text' && has(myChannelPerms(s, c.id), P.SEND_MESSAGES)).sort((a, b) => a.position - b.position)
        .forEach((c) => out.push({ id: c.id, label: c.name, sub: g.name, kind: 'channel' }))
    }
    for (const d of Object.values(dms)) {
      const r = d.recipients[0]; if (!r) continue
      const u = users[r.id] ?? r
      out.push({ id: d.id, label: u.display_name, sub: `@${u.username}`, kind: 'dm', avatar: { id: u.id, display_name: u.display_name, avatar_url: u.avatar_url } })
    }
    return out
  }, [guildOrder, guilds, channels, dms, users])
  const needle = q.trim().toLowerCase()
  const list = useMemo(() => targets.filter((t) => t.id !== m.channel_id && (!needle || t.label.toLowerCase().includes(needle) || t.sub.toLowerCase().includes(needle))), [targets, needle, m.channel_id])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const send = async () => {
    setBusy(true)
    let sent = 0
    for (const id of picked) {
      try { await api.post(`/channels/${m.channel_id}/messages/${m.id}/forward`, { channel_id: id }); sent++ } catch (e) { pushToast(`${targets.find((t) => t.id === id)?.label ?? 'Channel'}: ${(e as Error).message}`, 'error') }
    }
    setBusy(false)
    if (sent) { pushToast(sent === 1 ? 'Message forwarded' : `Forwarded to ${sent} places`); onClose() }
  }
  return (
    <Modal onClose={onClose} title="Forward" width="max-w-lg">
      <div data-forward-modal>
        <div className="flex items-center gap-2 rounded-md bg-bg-0 border border-line px-2.5 h-9 mb-3">
          <Search size={16} className="text-text-2" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a channel or friend" data-forward-search className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-2 min-w-0" />
        </div>
        <div className="max-h-[260px] overflow-y-auto -mx-1 px-1 space-y-0.5" data-forward-list>
          {list.length === 0 && <p className="p-4 text-center text-sm text-text-2">Nothing matches.</p>}
          {list.map((t) => {
            const on = picked.includes(t.id)
            return (
              <button key={t.id} type="button" onClick={() => toggle(t.id)} data-forward-target={t.label} aria-pressed={on} className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-bg-3">
                {t.kind === 'dm' && t.avatar ? <Avatar user={t.avatar} size={28} /> : <span className="h-7 w-7 rounded-md bg-bg-3 flex items-center justify-center text-text-2"><Hash size={16} /></span>}
                <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[15px] font-medium">{t.label}</span><span className="block truncate text-xs text-text-2">{t.sub}</span></span>
                <span className={`h-5 w-5 rounded border flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'border-text-2'}`}>{on && <Check size={14} />}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 rounded-lg border border-line bg-bg-0/60 p-3" data-forward-preview>
          <div className="flex items-center gap-1.5 text-xs text-text-2 mb-1"><Forward size={14} /> Forwarded</div>
          <div className="flex items-center gap-2 mb-1"><Avatar user={m.author} size={20} /><span className="text-sm font-semibold">{m.author.display_name}</span></div>
          {m.content && <div className="msg-content text-sm whitespace-pre-wrap break-words line-clamp-4">{renderMarkdown(m.content)}</div>}
          {m.sticker && <img src={m.sticker.url} alt={m.sticker.name} className="h-20 w-20 object-contain mt-1" />}
          {m.attachments?.length > 0 && <div className="mt-1 text-xs text-text-2">📎 {m.attachments.map((a) => a.filename.replace(/^SPOILER_/, '')).join(', ')}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || picked.length === 0} onClick={send} data-forward-send>{busy ? 'Sending…' : picked.length > 1 ? `Send to ${picked.length}` : 'Send'}</button>
        </div>
      </div>
    </Modal>
  )
}
