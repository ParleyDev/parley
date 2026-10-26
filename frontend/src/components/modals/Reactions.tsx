import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import Emoji from '../Emoji'
import { api } from '../../lib/api'
import { has, P } from '../../lib/perms'
import { myChannelPerms, useStore } from '../../store'

interface Reactor { id: string; display_name: string; avatar_url: string | null }

/** View Reactions: a tab per emoji with everyone who reacted; moderators can remove someone's reaction. */
export default function ReactionsModal({ onClose, channelId, messageId }: { onClose: () => void; channelId: string; messageId: string }) {
  const msg = useStore((s) => s.messages[channelId]?.find((m) => m.id === messageId))
  const me = useStore((s) => s.user)
  const perms = useStore((s) => myChannelPerms(s, channelId))
  const guildChannel = useStore((s) => !!s.channels[channelId]?.guild_id)
  const pushToast = useStore((s) => s.pushToast)
  const reactions = msg?.reactions ?? []
  const keyOf = (x: { emoji: string; burst?: boolean }) => `${x.burst ? 'b' : 'n'}${x.emoji}`
  const [tab, setTab] = useState(reactions[0] ? keyOf(reactions[0]) : '')
  const emoji = tab.slice(1), burst = tab.startsWith('b')
  const q = burst ? '?burst=true' : ''
  const [people, setPeople] = useState<Reactor[] | null>(null)
  const count = reactions.map((r) => `${keyOf(r)}:${r.count}`).join(',')
  useEffect(() => {
    if (!emoji) return
    setPeople(null)
    api.get<Reactor[]>(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}${q}`).then(setPeople).catch(() => setPeople([]))
  }, [channelId, messageId, emoji, count, q])
  const canRemove = guildChannel && has(perms, P.MANAGE_MESSAGES)
  const remove = async (id: string) => {
    try { await api.delete(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${id}${q}`); setPeople((p) => (p ?? []).filter((x) => x.id !== id)) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <Modal title="Reactions" onClose={onClose} width="max-w-lg">
      {reactions.length === 0 ? <p className="text-sm text-text-2">No reactions left on this message.</p> : (
        <div className="flex min-h-[16rem] gap-3 max-sm:flex-col" data-reactions-modal>
          <div className="flex shrink-0 flex-col gap-1 max-sm:flex-row max-sm:overflow-x-auto" role="tablist" aria-label="Emoji">
            {reactions.map((r) => (
              <button key={keyOf(r)} type="button" role="tab" aria-selected={keyOf(r) === tab} onClick={() => setTab(keyOf(r))}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${keyOf(r) === tab ? 'bg-bg-4 text-text-0' : 'text-text-1 hover:bg-bg-3'} ${r.burst ? 'super-reaction' : ''}`} data-reactions-tab={r.emoji} data-reactions-burst={r.burst ? '1' : undefined}>
                <Emoji value={r.emoji} size={20} /><span className="tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-1" role="tabpanel">
            {people === null ? <p className="text-sm text-text-2">Loading…</p> : people.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-3" data-reactor={u.id}>
                <Avatar user={u} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm">{u.display_name}</span>
                {(canRemove || u.id === me?.id) && <button type="button" onClick={() => remove(u.id)} className="rounded p-1 text-text-2 hover:bg-bg-4 hover:text-danger" title="Remove reaction" aria-label={`Remove ${u.display_name}'s reaction`} data-reactor-remove={u.id}><X size={14} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
