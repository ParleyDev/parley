import { Archive, ArchiveRestore, Lock, LockOpen, MessagesSquare, Pin, PinOff, Plus, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Channel, Message, ThreadInfo } from '../lib/types'
import { myChannelPerms, useStore } from '../store'
import { has, P } from '../lib/perms'
import { formatTime, renderMarkdown } from '../lib/format'
import Avatar from './Avatar'
import ChatPane from './ChatPane'

/** Side panel showing one thread: root message, its messages and composer, archive controls. */
export function ThreadPanel({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const thread = useStore((s) => s.channels[threadId])
  const info = useStore((s) => s.threads[threadId])
  const me = useStore((s) => s.user?.id)
  const upsertThread = useStore((s) => s.upsertThread)
  const pushToast = useStore((s) => s.pushToast)
  const perms = useStore((s) => myChannelPerms(s, threadId))
  const [root, setRoot] = useState<Message | null>(null)
  const parentKind = useStore((s) => (thread?.parent_id ? s.channels[thread.parent_id]?.kind : undefined))
  const joined = useStore((s) => !!s.myThreads[threadId])
  const setMyThread = useStore((s) => s.setMyThread)
  const guildMembers = useStore((s) => (thread?.guild_id ? s.members[thread.guild_id] : undefined))
  const [people, setPeople] = useState<{ id: string; display_name: string; avatar_url: string | null }[] | null>(null)
  const [addQ, setAddQ] = useState('')
  const loadPeople = () => api.get<{ id: string; display_name: string; avatar_url: string | null }[]>(`/threads/${threadId}/members`).then(setPeople).catch(() => setPeople([]))
  useEffect(() => {
    if (!thread?.parent_id) return
    api.get<{ thread: ThreadInfo; root: Message | null }>(`/channels/${thread.parent_id}/threads/${threadId}`).then((r) => { upsertThread(r.thread); setRoot(r.root) }).catch(() => {})
  }, [threadId, thread?.parent_id, upsertThread])
  if (!thread) return null
  const archived = !!info?.archived_at
  const canManage = info?.owner_id === me || has(perms, P.MANAGE_MESSAGES) || has(perms, P.MANAGE_THREADS)
  const pinned = !!info?.pinned_at
  const togglePin = async () => { try { upsertThread(await api.patch<ThreadInfo>(`/threads/${threadId}`, { pinned: !pinned })) } catch (e) { pushToast((e as Error).message, 'error') } }
  const toggle = async () => { try { upsertThread(await api.patch<ThreadInfo>(`/threads/${threadId}`, { archived: !archived })) } catch (e) { pushToast((e as Error).message, 'error') } }
  const locked = !!info?.locked
  const isMod = has(perms, P.MANAGE_MESSAGES) || has(perms, P.MANAGE_THREADS)
  const toggleLock = async () => { try { upsertThread(await api.patch<ThreadInfo>(`/threads/${threadId}`, { locked: !locked })) } catch (e) { pushToast((e as Error).message, 'error') } }
  const join = async (on: boolean) => {
    try { if (on) await api.put(`/threads/${threadId}/members/${me}`); else await api.delete(`/threads/${threadId}/members/${me}`); setMyThread(threadId, on) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const addPerson = async (uid: string) => { try { await api.put(`/threads/${threadId}/members/${uid}`); setAddQ(''); void loadPeople() } catch (e) { pushToast((e as Error).message, 'error') } }
  return (
    <aside className="w-[460px] shrink-0 bg-bg-1 border-l border-line flex flex-col max-md:w-full max-md:border-l-0" data-thread-panel={threadId} data-thread-archived={archived ? '1' : '0'}>
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <MessagesSquare size={16} className="text-text-2 shrink-0" /><span className="font-bold truncate" data-thread-title>{thread.name}</span>
        {archived && <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold text-text-2">ARCHIVED</span>}
        {info?.private && <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-bold text-text-2" data-thread-private-badge>PRIVATE</span>}
        {locked && <Lock size={13} className="shrink-0 text-text-2" data-thread-locked />}
        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => join(!joined)} className="rounded-md px-2 py-1 text-xs font-semibold text-text-1 hover:bg-bg-3 hover:text-text-0" data-thread-join={joined ? 'leave' : 'join'}>{joined ? 'Leave' : 'Join'}</button>
          <span className="relative">
            <button onClick={() => (people ? setPeople(null) : void loadPeople())} title="Thread members" className="h-8 min-w-8 px-1 rounded-md flex items-center justify-center gap-1 text-xs text-text-2 hover:bg-bg-3 hover:text-text-0" data-thread-members-toggle><Users size={16} />{info?.member_count ?? ''}</button>
            {people && (
              <div className="pop absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-bg-0 p-2 shadow-2xl" data-thread-members>
                <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-2">Members — {people.length}</div>
                <div className="max-h-48 overflow-y-auto">{people.map((u) => <div key={u.id} className="flex items-center gap-2 px-1 py-1 text-sm" data-thread-member={u.id}><Avatar user={u} size={20} /><span className="truncate">{u.display_name}</span></div>)}</div>
                {(joined || isMod) && (
                  <div className="mt-2 border-t border-line pt-2">
                    <div className="flex items-center gap-1"><UserPlus size={14} className="text-text-2" /><input className="input py-1 text-xs" placeholder="Add someone" value={addQ} onChange={(e) => setAddQ(e.target.value)} data-thread-add-search /></div>
                    {addQ && Object.values(guildMembers ?? {}).filter((m) => !people.some((p) => p.id === m.user_id) && (m.nickname ?? m.display_name).toLowerCase().includes(addQ.toLowerCase())).slice(0, 6).map((m) => (
                      <button key={m.user_id} type="button" onClick={() => addPerson(m.user_id)} className="mt-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-bg-3" data-thread-add={m.user_id}><Avatar user={{ id: m.user_id, display_name: m.display_name, avatar_url: m.avatar_url }} size={18} /><span className="truncate">{m.nickname ?? m.display_name}</span></button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </span>
          {isMod && <button onClick={toggleLock} title={locked ? 'Unlock thread' : 'Lock thread'} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-thread-lock>{locked ? <LockOpen size={16} /> : <Lock size={16} />}</button>}
          {parentKind === 'forum' && isMod && <button onClick={togglePin} title={pinned ? 'Unpin post' : 'Pin post'} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-thread-pin>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>}
          {canManage && <button onClick={toggle} title={archived ? 'Unarchive thread' : 'Archive thread'} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-thread-archive>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>}
          <button onClick={onClose} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" title="Close thread"><X size={18} /></button>
        </span>
      </div>
      {root && (
        <div className="shrink-0 border-b border-line bg-bg-2/60 px-4 py-3" data-thread-root>
          <div className="flex items-center gap-2 mb-1"><Avatar user={root.author} size={20} /><span className="font-semibold text-sm">{root.author.display_name}</span><span className="text-[11px] text-text-2">{formatTime(root.created_at)}</span></div>
          <div className="msg-content text-sm whitespace-pre-wrap break-words line-clamp-6">{renderMarkdown(root.content)}</div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatPane channel={thread as Channel} readOnly={locked && !isMod ? 'This thread is locked. Only moderators can post.' : undefined} />
      </div>
    </aside>
  )
}

/** Popover listing a channel's threads (active, or archived) with a button to start one. */
export function ThreadsPanel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [archived, setArchived] = useState(false)
  const [list, setList] = useState<ThreadInfo[] | null>(null)
  const openModal = useStore((s) => s.openModal)
  const setOpenThread = useStore((s) => s.setOpenThread)
  const upsertThread = useStore((s) => s.upsertThread)
  const perms = useStore((s) => myChannelPerms(s, channel.id))
  useEffect(() => { setList(null); api.get<ThreadInfo[]>(`/channels/${channel.id}/threads?archived=${archived}`).then((l) => { l.forEach(upsertThread); setList(l) }).catch(() => setList([])) }, [channel.id, archived, upsertThread])
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="pop absolute right-0 top-full mt-2 z-40 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] flex flex-col rounded-xl bg-bg-1 border border-line shadow-2xl" data-threads-panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <MessagesSquare size={16} className="text-text-2" /><span className="font-bold">Threads</span>
          <button type="button" onClick={() => setArchived((a) => !a)} className="ml-2 rounded-full bg-bg-3 px-2 py-0.5 text-xs font-semibold text-text-1 hover:text-text-0" data-threads-archived-toggle>{archived ? 'Showing archived' : 'Show archived'}</button>
          {has(perms, P.SEND_MESSAGES) && <button type="button" onClick={() => { onClose(); openModal({ kind: 'createThread', channelId: channel.id }) }} className="ml-auto flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-white hover:bg-accent-hover" data-threads-create><Plus size={14} /> Create</button>}
          <button onClick={onClose} className="text-text-2 hover:text-text-0 ml-1"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-2 space-y-1">
          {list === null && <p className="text-sm text-text-2 p-3">Loading…</p>}
          {list?.length === 0 && <div className="p-6 text-center text-sm text-text-2">{archived ? 'No archived threads.' : 'No threads yet. Start one from a message\'s menu or with Create.'}</div>}
          {list?.map((t) => (
            <button key={t.id} type="button" onClick={() => { setOpenThread(t.id); onClose() }} className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2 text-left hover:border-text-2" data-thread-row={t.id}>
              <div className="font-semibold truncate">{t.name}</div>
              <div className="text-xs text-text-2">{t.message_count} message{t.message_count === 1 ? '' : 's'} · started by @{t.owner_username ?? 'unknown'}{t.last_message_at ? ` · last ${formatTime(t.last_message_at)}` : ''}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
