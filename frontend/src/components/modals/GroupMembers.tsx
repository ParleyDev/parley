import { Check, Link2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../lib/api'
import { isGroup } from '../../lib/dm'
import type { DmChannel } from '../../lib/types'
import { useStore } from '../../store'
import Avatar from '../Avatar'
import Modal from '../Modal'

const MAX = 10

/**
 * Discord's "Select Friends" dialog. Without a channel it creates a DM (one friend) or a group
 * (several). In a 1:1 DM it starts a new group with that person plus the picks; in a group it adds.
 */
export default function GroupMembersModal({ onClose, channelId, userIds }: { onClose: () => void; channelId?: string; userIds?: string[] }) {
  const friends = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.kind === 'friend').map((r) => s.users[r.user.id] ?? r.user)))
  const dm = useStore((s) => (channelId ? s.dms[channelId] : undefined))
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>(userIds ?? [])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const makeLink = async () => {
    if (!dm) return
    try { const r = await api.post<{ code: string }>(`/channels/${dm.id}/group-invites`, {}); const url = `${location.origin}/invite/${r.code}`; setLink(url); void navigator.clipboard?.writeText(url).catch(() => {}) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const already = useMemo(() => new Set(dm ? dm.recipients.map((r) => r.id) : []), [dm])
  const existing = dm ? dm.recipients.length + 1 : 1
  const room = MAX - existing
  const needle = q.trim().toLowerCase()
  const list = friends.filter((u) => !already.has(u.id) && (!needle || u.display_name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle)))
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p))
  const submit = async () => {
    if (!picked.length) return
    setBusy(true)
    try {
      if (dm && isGroup(dm)) {
        for (const id of picked) await api.put(`/channels/${dm.id}/recipients/${id}`)
        pushToast(picked.length === 1 ? 'Friend added' : `${picked.length} friends added`)
      } else {
        const ids = [...(dm ? dm.recipients.map((r) => r.id) : []), ...picked]
        const c = await api.post<DmChannel>('/users/@me/channels', ids.length === 1 ? { recipient_id: ids[0] } : { recipient_ids: ids, name: name.trim() })
        upsertChannel(c); navigate(`/channels/@me/${c.id}`)
      }
      onClose()
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const creatingGroup = !(dm && isGroup(dm)) && (dm ? dm.recipients.length : 0) + picked.length >= 2
  return (
    <Modal title="Select Friends" subtitle={`You can add ${room} more friend${room === 1 ? '' : 's'}.`} onClose={onClose}>
      <div data-group-members-modal>
        <div className="relative">
          <input className="input pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the username of a friend" data-friend-search />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
        </div>
        <div className="mt-3 max-h-64 overflow-y-auto -mx-2">
          {list.length === 0 && <p className="px-2 py-4 text-sm text-text-2">{friends.length === 0 ? 'Add some friends first; only friends can be added to groups.' : 'No friends match.'}</p>}
          {list.map((u) => {
            const on = picked.includes(u.id)
            return (
              <button key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={on} data-friend-option={u.username} className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-bg-3 text-left">
                <Avatar user={u} size={32} presence /><span className="font-semibold truncate">{u.display_name}</span><span className="text-sm text-text-2 truncate">@{u.username}</span>
                <span className={`ml-auto h-5 w-5 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'border-text-2'}`}>{on && <Check size={14} />}</span>
              </button>
            )
          })}
        </div>
        {creatingGroup && (
          <div className="mt-3"><label className="label">Group name (optional)</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Leave blank to use member names" data-group-name-input /></div>
        )}
        <button type="button" className="btn-primary w-full mt-4 justify-center" disabled={busy || picked.length === 0} onClick={submit} data-group-submit>
          {busy ? 'Working…' : dm && isGroup(dm) ? 'Add to Group' : creatingGroup ? 'Create Group DM' : 'Create DM'}
        </button>
        {dm && isGroup(dm) && (
          <div className="mt-4 border-t border-line pt-3" data-group-invite>
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-2">Or, send an invite link to anyone</div>
            {link ? <div className="flex gap-2"><input readOnly className="input flex-1 text-sm" value={link} data-group-invite-link /><button type="button" className="btn-primary" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); pushToast('Link copied') }}>Copy</button></div>
              : <button type="button" className="btn-ghost flex items-center gap-1" onClick={makeLink} data-group-invite-create><Link2 size={16} />Create invite link</button>}
            {link && <p className="mt-1 text-xs text-text-2">Expires in 24 hours.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
