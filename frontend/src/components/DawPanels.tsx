import { Check, Download, History, MessageSquare, RotateCcw, Send, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useDaw, type StudioComment } from '../lib/daw'
import { exportMixAs, exportProjectFile, exportStems, importProjectFile, postMix, type Format } from '../lib/exporters'
import { useT } from '../lib/i18n'
import type { Channel } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'

const clock = (ms: number) => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const Panel = ({ title, icon, close, children, data }: { title: string; icon: React.ReactNode; close: () => void; children: React.ReactNode; data: string }) => (
  <div className="absolute right-2 top-24 z-40 flex max-h-[calc(100%-6.5rem)] w-80 flex-col rounded-lg border border-line bg-bg-1 shadow-2xl" data-daw-panel={data}>
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 font-bold">{icon}{title}<button type="button" onClick={close} className="ml-auto text-text-2 hover:text-text-0"><X size={16} /></button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
  </div>
)

/** Saved versions of the project: save one, restore one (the project as it is gets saved first), delete. */
export function VersionsPanel({ close }: { close: () => void }) {
  const t = useT()
  const project = useDaw((s) => s.project)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const [list, setList] = useState<{ id: string; name: string; created_at: string }[] | null>(null)
  const [name, setName] = useState('')
  const pid = project?.id
  useEffect(() => {
    if (!pid) return
    const load = () => void api.get<{ id: string; name: string; created_at: string }[]>(`/studio/projects/${pid}/versions`).then(setList).catch(() => {})
    load()
    const on = (e: Event) => { if ((e as CustomEvent).detail === pid) load() }
    window.addEventListener('parley-studio-versions', on)
    return () => window.removeEventListener('parley-studio-versions', on)
  }, [pid])
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  if (!pid) return null
  return (
    <Panel title={t('Versions')} icon={<History size={16} />} close={close} data="versions">
      <form className="mb-3 flex gap-1" onSubmit={(e) => { e.preventDefault(); api.post(`/studio/projects/${pid}/versions`, { name }).then(() => setName('')).catch(fail) }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('Name (optional)')} className="input h-8 min-w-0 flex-1 text-sm" data-daw-version-name />
        <button type="submit" className="btn-primary h-8 py-0 text-xs" data-daw-version-save>{t('Save version')}</button>
      </form>
      {list?.length === 0 && <p className="text-xs text-text-2">{t('No versions yet. Save one before a big change to come back to it.')}</p>}
      {list?.map((v) => (
        <div key={v.id} className="group mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg-3" data-daw-version={v.id}>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{v.name}</span><span className="text-[10px] text-text-2">{new Date(v.created_at).toLocaleString()}</span></span>
          <button type="button" title={t('Restore')} onClick={() => openModal({ kind: 'confirm', title: t('Restore {name}?', { name: v.name }), body: t('The project goes back to how it was in this version, for everyone. How it is now is saved as a version first.'), confirmLabel: t('Restore'), action: async () => { try { await api.post(`/studio/versions/${v.id}/restore`) ; pushToast(t('Restored {name}', { name: v.name })) } catch (e) { fail(e) } } })} className="text-text-2 hover:text-text-0" data-daw-version-restore><RotateCcw size={14} /></button>
          <button type="button" title={t('Delete')} onClick={() => api.delete(`/studio/versions/${v.id}`).catch(fail)} className="hidden text-text-2 hover:text-danger group-hover:block"><Trash2 size={14} /></button>
        </div>
      ))}
    </Panel>
  )
}

/** Exporting: the mix (WAV / FLAC / MP3), stems, posting the mix to a channel, the project file (and importing one). */
export function ExportPanel({ channel, close }: { channel: Channel; close: () => void }) {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const channels = useStore((s) => s.channels)
  const project = useDaw((s) => s.project)
  const [format, setFormat] = useState<Format>('wav')
  const [busy, setBusy] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const texts = Object.values(channels).filter((c) => c.guild_id === channel.guild_id && c.kind === 'text').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn() } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(null) } }
  const row = 'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-bg-3 disabled:opacity-50'
  return (
    <Panel title={t('Export')} icon={<Download size={16} />} close={close} data="export">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-text-2">{t('Format')}</span>
        <Dropdown value={format} onChange={(e) => setFormat(e.target.value as Format)} className="input h-8 w-36 px-2 text-sm" aria-label={t('Format')} data-daw-export-format>
          <option value="wav">{t('WAV (16-bit)')}</option><option value="flac">{t('FLAC (lossless)')}</option><option value="mp3">{t('MP3 (192 kbps)')}</option>
        </Dropdown>
      </div>
      <button type="button" disabled={!!busy} onClick={() => void run('mix', async () => { const l = await exportMixAs(format); if (l !== null) pushToast(t('Mix exported · {lufs} LUFS integrated', { lufs: l.toFixed(1) })) })} className={row} data-daw-export-mix><Download size={15} /> {busy === 'mix' ? t('Rendering…') : t('Export mix')}</button>
      <button type="button" disabled={!!busy} onClick={() => void run('stems', async () => { const n = await exportStems(); pushToast(t('{n} stems exported', { n })) })} className={row} data-daw-export-stems><Download size={15} /> {busy === 'stems' ? t('Rendering…') : t('Export stems (WAV, zipped)')}</button>
      <div className="my-2 h-px bg-line" />
      <p className="mb-1 text-xs font-semibold text-text-2">{t('Post the mix to a channel')}</p>
      <Dropdown value={target} onChange={(e) => setTarget(e.target.value)} className="input mb-1 h-8 w-full px-2 text-sm" aria-label={t('Channel')} data-daw-post-channel>
        <option value="">{t('Pick a channel…')}</option>
        {texts.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
      </Dropdown>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t('Say something about it (optional)')} className="input mb-1 h-8 w-full text-sm" data-daw-post-text />
      <button type="button" disabled={!!busy || !target} onClick={() => void run('post', async () => { await postMix(target, format === 'wav' ? 'mp3' : format, text || `🎵 ${project?.name ?? ''}`); pushToast(t('Posted to #{name}', { name: channels[target]?.name ?? '' })); setText('') })} className="btn-primary h-8 w-full justify-center py-0 text-xs disabled:opacity-50" data-daw-post><Send size={14} /> {busy === 'post' ? t('Posting…') : t('Post')}</button>
      <p className="mt-1 text-[10px] text-text-2">{t('WAV posts as MP3 to keep it small.')}</p>
      <div className="my-2 h-px bg-line" />
      <button type="button" disabled={!!busy} onClick={() => void run('file', exportProjectFile)} className={row} data-daw-export-project><Download size={15} /> {t('Save project file (.parley-project)')}</button>
      <button type="button" disabled={!!busy} onClick={() => file.current?.click()} className={row} data-daw-import-project><Upload size={15} /> {busy === 'import' ? t('Importing…') : t('Import a project file')}</button>
      <input ref={file} type="file" accept=".parley-project,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run('import', async () => { const p = await importProjectFile(channel.id, f); pushToast(t('Imported {name}', { name: p.name })); close() }) }} data-daw-import-project-file />
    </Panel>
  )
}

/** Comments pinned to moments of the song: add one at the playhead, jump to one, resolve, delete. */
export function CommentsPanel({ head, seek, close }: { head: number; seek: (sec: number) => void; close: () => void }) {
  const t = useT()
  const project = useDaw((s) => s.project)
  const comments = useDaw((s) => s.comments)
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [body, setBody] = useState('')
  const fail = (e: unknown) => pushToast((e as Error).message, 'error')
  if (!project) return null
  return (
    <Panel title={t('Comments')} icon={<MessageSquare size={16} />} close={close} data="comments">
      <form className="mb-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) api.post(`/studio/projects/${project.id}/comments`, { ms: Math.round(head * 1000), body }).then(() => setBody('')).catch(fail) }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} placeholder={t('Comment at {time}…', { time: clock(head * 1000) })} className="input w-full resize-none text-sm" data-daw-comment-input />
        <button type="submit" disabled={!body.trim()} className="btn-primary mt-1 h-8 w-full justify-center py-0 text-xs disabled:opacity-50" data-daw-comment-send>{t('Comment')}</button>
      </form>
      {comments.length === 0 && <p className="text-xs text-text-2">{t('No comments yet.')}</p>}
      {comments.map((c: StudioComment) => {
        const u = c.user_id ? users[c.user_id] : undefined
        return (
          <div key={c.id} className={`mb-2 rounded-lg border border-line p-2 text-sm ${c.resolved ? 'opacity-50' : ''}`} data-daw-comment={c.id}>
            <div className="mb-1 flex items-center gap-1.5 text-xs">
              {u && <Avatar user={u} size={16} />}<span className="font-semibold">{u?.display_name ?? u?.username ?? t('Someone')}</span>
              <button type="button" onClick={() => seek(c.ms / 1000)} className="rounded bg-bg-3 px-1 font-mono text-[10px] hover:bg-accent hover:text-white" title={t('Go there')} data-daw-comment-seek>{clock(c.ms)}</button>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => api.patch(`/studio/comments/${c.id}`, { resolved: !c.resolved }).catch(fail)} title={c.resolved ? t('Reopen') : t('Resolve')} className="text-text-2 hover:text-success" data-daw-comment-resolve><Check size={13} /></button>
                {c.user_id === me?.id && <button type="button" onClick={() => api.delete(`/studio/comments/${c.id}`).catch(fail)} title={t('Delete')} className="text-text-2 hover:text-danger"><Trash2 size={13} /></button>}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
          </div>
        )
      })}
    </Panel>
  )
}
