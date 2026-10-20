import { Check, Inbox, X, Ban } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../lib/api'
import { messageRequests, useStore } from '../store'
import type { DmChannel } from '../lib/types'
import Avatar from './Avatar'
import { MobileBack } from './HeaderBits'

/** Inbox for DMs from people you are not friends with: accept, ignore, or block. */
export default function RequestsView() {
  const list = useStore(useShallow(messageRequests))
  const users = useStore((s) => s.users)
  const navigate = useNavigate()
  return (
    <main className="flex-1 min-w-0 flex flex-col bg-bg-0" data-requests-view>
      <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line"><MobileBack /><Inbox size={20} className="text-text-2" /><span className="font-bold">Message Requests</span><span className="text-xs text-text-2">{list.length}</span></header>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {list.length === 0 && <p className="text-sm text-text-2">No requests. Messages from people you are not friends with show up here first.</p>}
        {list.map((d) => { const u = d.recipients[0] ? { ...d.recipients[0], ...users[d.recipients[0].id] } : undefined; return (
          <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-bg-1 px-3 py-2.5" data-request={d.id}>
            {u && <Avatar user={u} size={40} />}
            <button type="button" onClick={() => navigate(`/channels/@me/${d.id}`)} className="min-w-0 flex-1 text-left">
              <div className="font-semibold truncate">{u?.display_name ?? 'Unknown'}</div>
              <div className="text-xs text-text-2 truncate">@{u?.username} wants to send you a message · click to read it</div>
            </button>
            <RequestActions dm={d} compact />
          </div>
        ) })}
      </div>
    </main>
  )
}

function RequestActions({ dm, compact }: { dm: DmChannel; compact?: boolean }) {
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const navigate = useNavigate()
  const other = dm.recipients[0]
  const act = async (fn: () => Promise<unknown>, after?: () => void) => { try { await fn(); after?.() } catch (e) { pushToast((e as Error).message, 'error') } }
  const block = () => other && openModal({ kind: 'confirm', title: `Block ${other.display_name}`, body: 'They will not be able to message you or send you friend requests.', danger: true, confirmLabel: 'Block',
    action: () => act(() => api.put(`/users/@me/relationships/${other.id}/block`).then(() => api.post(`/channels/${dm.id}/request`, { action: 'ignore' })), () => navigate('/channels/@me')) })
  const cls = compact ? 'h-8 w-8 rounded-full flex items-center justify-center' : 'btn-ghost py-1.5'
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button type="button" onClick={() => act(() => api.post(`/channels/${dm.id}/request`, { action: 'accept' }), () => navigate(`/channels/@me/${dm.id}`))} title="Accept" className={`${cls} bg-success/20 text-success hover:bg-success/30`} data-request-accept><Check size={16} />{!compact && ' Accept'}</button>
      <button type="button" onClick={() => act(() => api.post(`/channels/${dm.id}/request`, { action: 'ignore' }), () => navigate('/channels/@me'))} title="Ignore" className={`${cls} bg-bg-3 text-text-1 hover:bg-bg-4`} data-request-ignore><X size={16} />{!compact && ' Ignore'}</button>
      <button type="button" onClick={block} title="Block" className={`${cls} bg-danger/15 text-danger hover:bg-danger/25`} data-request-block><Ban size={16} />{!compact && ' Block'}</button>
    </div>
  )
}

/** Shown in place of the composer while a DM is still a message request. */
export function RequestBanner({ dm }: { dm: DmChannel }) {
  const other = dm.recipients[0]
  return (
    <div className="shrink-0 m-4 mt-0 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 flex items-center gap-3 flex-wrap" data-request-banner>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Message request</div>
        <div className="text-sm text-text-2">{other?.display_name ?? 'This person'} is not on your friends list. Accept to reply and move this chat to your DMs, or ignore it.</div>
      </div>
      <RequestActions dm={dm} />
    </div>
  )
}
