import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { Channel } from '../../lib/types'

/** Rename or delete a category. Deleting keeps its channels (they move to the top level). */
export default function EditCategoryModal({ onClose, channelId }: { onClose: () => void; channelId: string }) {
  const cat = useStore((s) => s.channels[channelId])
  const upsertChannel = useStore((s) => s.upsertChannel)
  const removeChannel = useStore((s) => s.removeChannel)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [name, setName] = useState(cat?.name ?? '')
  const [busy, setBusy] = useState(false)
  if (!cat) return null
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { upsertChannel(await api.patch<Channel>(`/channels/${channelId}`, { name })); pushToast('Category renamed'); onClose() } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const del = () => openModal({ kind: 'confirm', title: `Delete '${cat.name}'`, body: `The channels inside ${cat.name} are kept and move to the top of the list.`, danger: true, confirmLabel: 'Delete Category',
    action: async () => { try { await api.delete(`/channels/${channelId}`); removeChannel(channelId) } catch (err) { pushToast((err as Error).message, 'error') } } })
  return (
    <Modal title="Edit Category" onClose={onClose} width="max-w-sm"
      footer={<><button type="button" className="btn-danger mr-auto" onClick={del} data-category-delete>Delete</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="edit-category" className="btn-primary" disabled={busy || !name.trim()} data-category-save>Save</button></>}>
      <form id="edit-category" onSubmit={save}>
        <label className="label">Category name</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required data-category-name />
        <button type="button" className="btn-ghost mt-3 w-full justify-center bg-bg-3" onClick={() => openModal({ kind: 'channelSettings', channelId, tab: 'permissions' })} data-category-perms>Edit Permissions</button>
      </form>
    </Modal>
  )
}
