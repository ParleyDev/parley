import { Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { DmChannel, User } from '../../lib/types'
import { useT } from '../../lib/i18n'

export default function NewDmModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<User[]>([])
  const upsertChannel = useStore((s) => s.upsertChannel)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const navigate = useNavigate()
  const t = useT()
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const timer = setTimeout(() => api.get<User[]>(`/users/search?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 200)
    return () => clearTimeout(timer)
  }, [q])
  const open = async (u: User) => {
    try { const dm = await api.post<DmChannel>('/users/@me/channels', { recipient_id: u.id }); upsertChannel(dm); onClose(); navigate(`/channels/@me/${dm.id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  return (
    <Modal title={t('Select a friend')} subtitle={t('Search by username or display name.')} onClose={onClose}>
      <div className="relative">
        <input className="input pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Type the username of a friend')} />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
      </div>
      <button type="button" onClick={() => openModal({ kind: 'groupMembers' })} className="mt-3 w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-bg-3 text-left" data-new-group>
        <span className="h-8 w-8 rounded-full bg-bg-3 flex items-center justify-center text-text-1"><Users size={16} /></span>
        <span><span className="block font-semibold">{t('Create a group DM')}</span><span className="block text-xs text-text-2">{t('Pick several friends to chat with together.')}</span></span>
      </button>
      <div className="mt-3 max-h-72 overflow-y-auto -mx-2">
        {results.map((u) => (
          <button key={u.id} onClick={() => open(u)} className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-bg-3 text-left">
            <Avatar user={u} size={32} presence /><span className="font-semibold">{u.display_name}</span><span className="text-sm text-text-2">@{u.username}</span>
          </button>
        ))}
        {q.trim() && results.length === 0 && <p className="px-2 py-4 text-sm text-text-2">{t('No users found.')}</p>}
      </div>
    </Modal>
  )
}
