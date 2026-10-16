import { Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import type { ForumTag } from '../../../lib/types'

/** Channel Settings → Tags (forum channels): up to 20 tags posts can carry. */
export default function ForumTagsTab({ channelId }: { channelId: string }) {
  const pushToast = useStore((s) => s.pushToast)
  const [tags, setTags] = useState<ForumTag[]>([])
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const load = () => api.get<ForumTag[]>(`/channels/${channelId}/tags`).then(setTags).catch(() => setTags([]))
  useEffect(() => { load() }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e: FormEvent) => {
    e.preventDefault()
    try { await api.post(`/channels/${channelId}/tags`, { name, emoji }); setName(''); setEmoji(''); load() } catch (err) { pushToast((err as Error).message, 'error') }
  }
  const del = async (t: ForumTag) => { try { await api.delete(`/channels/${channelId}/tags/${t.id}`); load() } catch (err) { pushToast((err as Error).message, 'error') } }
  return (
    <div data-forum-tags>
      <h1 className="text-xl font-bold">Tags</h1>
      <p className="text-sm text-text-2 mt-1">Posts can carry tags so readers can filter the forum. Up to 20.</p>
      <form onSubmit={add} className="mt-4 flex gap-2">
        <input className="input w-16 text-center" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="🏷️" data-forum-tag-emoji />
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Tag name" required data-forum-tag-name />
        <button className="btn-primary" disabled={!name.trim() || tags.length >= 20} data-forum-tag-add>Add</button>
      </form>
      <div className="mt-4 divide-y divide-line rounded-lg border border-line">
        {tags.length === 0 && <p className="p-4 text-sm text-text-2">No tags yet.</p>}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-forum-tag-row={t.id}>
            <span className="w-8 text-center">{t.emoji}</span><span className="flex-1 font-medium">{t.name}</span>
            <button type="button" onClick={() => del(t)} className="text-text-2 hover:text-danger" title="Delete tag" data-forum-tag-delete><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
