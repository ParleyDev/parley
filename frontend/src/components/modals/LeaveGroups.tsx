import { useMemo, useState } from 'react'
import Modal from '../Modal'
import GroupIcon from '../GroupIcon'
import { api } from '../../lib/api'
import { dmName, isGroup } from '../../lib/dm'
import type { DmChannel } from '../../lib/types'
import { useStore } from '../../store'

const DAY = 86_400_000
/** When a uuid v7 (message or channel id) was made. */
const idTime = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16)

/** Leave many group DMs at once; the ones quiet for 30 days or more are ticked to start with. */
export default function LeaveGroupsModal({ onClose }: { onClose: () => void }) {
  const dms = useStore((s) => s.dms)
  const users = useStore((s) => s.users)
  const notes = useStore((s) => s.notes)
  const lastMessageId = useStore((s) => s.lastMessageId)
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const groups = useMemo(() => (Object.values(dms) as DmChannel[]).filter(isGroup)
    .map((d) => ({ d, at: idTime(lastMessageId[d.id] ?? d.id) }))
    .sort((a, b) => a.at - b.at), [dms, lastMessageId])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups.filter((g) => Date.now() - g.at >= 30 * DAY).map((g) => g.d.id)))
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ago = (t: number) => { const d = Math.floor((Date.now() - t) / DAY); return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago` }
  const leave = async () => {
    setBusy(true)
    let left = 0
    for (const id of picked) { try { await api.delete(`/channels/${id}/recipients/${me?.id}`); left++ } catch (e) { pushToast((e as Error).message, 'error') } }
    setBusy(false); pushToast(`Left ${left} group${left === 1 ? '' : 's'}`); onClose()
  }
  return (
    <Modal title="Leave Group DMs" subtitle="Tidy up conversations you no longer use. Groups quiet for 30 days or more are selected." onClose={onClose} width="max-w-md"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={leave} disabled={busy || picked.size === 0} data-leave-groups-confirm>Leave {picked.size || ''} Group{picked.size === 1 ? '' : 's'}</button></>}>
      <div className="max-h-[50vh] overflow-y-auto -mx-1 space-y-0.5" data-leave-groups>
        {groups.length === 0 && <p className="py-6 text-center text-sm text-text-2">You aren't in any group DMs.</p>}
        {groups.map(({ d, at }) => (
          <label key={d.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3 cursor-pointer" data-leave-group={d.id}>
            <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4 accent-accent" />
            <GroupIcon dm={d} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{dmName(d, users, notes)}</span>
              <span className="block text-xs text-text-2">Last active {ago(at)}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
