import { CalendarClock, Check, Disc3, Download, History, ListPlus, MessageSquare, Pause, Play, RotateCcw, Send, Trash2, Upload, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { addTake, useDaw, type StudioComment } from '../lib/daw'
import { projectRights, setBandRole, useGatherings } from '../lib/projects'
import { exportMixAs, exportProjectFile, exportStems, importProjectFile, postMix, type Format } from '../lib/exporters'
import { exportDawProject, importDawProject } from '../lib/dawproject'
import { useT } from '../lib/i18n'
import type { Channel, StudioTrack } from '../lib/types'
import { useStore } from '../store'
import Avatar from './Avatar'
import Dropdown from './Dropdown'
import { shownName } from '../lib/names'
import FloatWindow from './FloatWindow'

const clock = (ms: number) => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const Panel = ({ title, icon, close, children, data }: { title: string; icon: React.ReactNode; close: () => void; children: React.ReactNode; data: string }) => (
  <FloatWindow id={`panel-${data}`} title={title} icon={icon} width={320} onClose={close} className="max-h-[70vh]" data-daw-panel={data}>{children}</FloatWindow>
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
      <button type="button" disabled={!!busy} onClick={() => void run('dawproject', () => exportDawProject())} className={row} title={t('Opens in Bitwig Studio, Studio One, Cubase and other DAWs')} data-daw-export-dawproject><Download size={15} /> {busy === 'dawproject' ? t('Preparing…') : t('Export for other DAWs (.dawproject)')}</button>
      <button type="button" disabled={!!busy} onClick={() => void run('file', exportProjectFile)} className={row} title={t('Everything, for Parley: effects, instruments and all')} data-daw-export-project><Download size={15} /> {t('Save project file (.parley-project)')}</button>
      {channel.parent_id && projectRights(useStore.getState().channels[channel.parent_id]).create && <button type="button" disabled={!!busy} onClick={() => file.current?.click()} className={row} data-daw-import-project><Upload size={15} /> {busy === 'import' ? t('Importing…') : t('Import a project file as a new project')}</button>}
      <input ref={file} type="file" accept=".parley-project,.dawproject,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run('import', async () => { const p = await importAny(channel.parent_id ?? '', f); pushToast(t('Imported {name}', { name: p.name })); close() }) }} data-daw-import-project-file />
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

/** Everything recorded or imported into the project: listen, put a take back on the timeline, download. */
export function TakesPanel({ channel, head, close }: { channel: Channel; head: number; close: () => void }) {
  const t = useT()
  const users = useStore((s) => s.users)
  const clips = useDaw((s) => s.clips)
  const [list, setList] = useState<StudioTrack[] | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const el = useRef<HTMLAudioElement | null>(null)
  const edit = projectRights(channel).edit
  useEffect(() => {
    const load = () => void api.get<StudioTrack[]>(`/channels/${channel.id}/studio/audio`).then(setList).catch(() => setList([]))
    load()
    const on = (e: Event) => { if ((e as CustomEvent).detail === channel.id) load() }
    window.addEventListener('parley-studio-takes', on)
    return () => { window.removeEventListener('parley-studio-takes', on); el.current?.pause() }
  }, [channel.id])
  const play = (a: StudioTrack) => {
    el.current?.pause()
    if (playing === a.id) { setPlaying(null); return }
    const au = new Audio(a.url); el.current = au; au.onended = () => setPlaying(null); void au.play(); setPlaying(a.id)
  }
  const used = new Set(Object.values(clips).map((c) => c.audio_id))
  return (
    <Panel title={t('Takes')} icon={<Disc3 size={16} />} close={close} data="takes">
      {list?.length === 0 && <p className="text-xs text-text-2">{t('Nothing recorded or imported yet.')}</p>}
      {list?.map((a) => {
        const u = a.user_id ? users[a.user_id] : undefined
        return (
          <div key={a.id} className="group mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg-3" data-daw-take-row={a.id}>
            <button type="button" onClick={() => play(a)} title={playing === a.id ? t('Pause') : t('Play')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-3 hover:bg-accent hover:text-white" data-daw-take-play>{playing === a.id ? <Pause size={13} /> : <Play size={13} />}</button>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{a.name ?? (u?.display_name ?? u?.username ?? a.display_name)}</span>
              <span className="text-[10px] text-text-2">{a.kind === 'import' ? t('Imported') : t('Take')} · {clock(a.duration_ms ?? 0)} · {new Date(a.created_at).toLocaleString()}{used.has(a.id) ? ` · ${t('in the arrangement')}` : ''}</span>
            </span>
            {edit && !used.has(a.id) && <button type="button" onClick={() => addTake(a, head * 1000)} title={t('Put it on the timeline at the playhead')} className="text-text-2 hover:text-text-0" data-daw-take-add><ListPlus size={15} /></button>}
            <a href={a.url} download className="text-text-2 hover:text-text-0" title={t('Download')}><Download size={14} /></a>
          </div>
        )
      })}
    </Panel>
  )
}

/** The project's band: engineers run it, artists edit and record. Whoever manages the project adds and removes people. */
export function BandPanel({ channel, close }: { channel: Channel; close: () => void }) {
  const t = useT()
  const users = useStore((s) => s.users)
  const members = useStore((s) => (channel.guild_id ? s.members[channel.guild_id] : undefined))
  const me = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const rights = projectRights(channel)
  const [pick, setPick] = useState('')
  const engineers = channel.engineer_ids ?? [], artists = channel.artist_ids ?? []
  const set = (uid: string, role: 'engineer' | 'artist' | 'audience') => setBandRole(channel.id, uid, role).catch((e) => pushToast((e as Error).message, 'error'))
  const candidates = Object.values(members ?? {}).filter((m) => !engineers.includes(m.user_id) && !artists.includes(m.user_id) && !users[m.user_id]?.bot)
  const row = (uid: string, role: 'engineer' | 'artist') => {
    const u = users[uid]
    return (
      <div key={uid} className="group mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg-3" data-daw-band={uid} data-role={role}>
        {u && <Avatar user={u} size={22} />}
        <span className="min-w-0 flex-1 truncate font-semibold">{u?.display_name ?? u?.username ?? t('Someone')}</span>
        {rights.manage ? (
          <Dropdown value={role} onChange={(e) => void set(uid, e.target.value as 'engineer' | 'artist')} className="input h-7 w-28 px-1 text-xs" aria-label={t('Role')} data-daw-band-role={uid}>
            <option value="engineer">{t('Engineer')}</option><option value="artist">{t('Artist')}</option>
          </Dropdown>
        ) : <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${role === 'engineer' ? 'bg-warn text-black' : 'bg-accent text-white'}`}>{role === 'engineer' ? t('Engineer') : t('Artist')}</span>}
        {(rights.manage || uid === me?.id) && <button type="button" onClick={() => void set(uid, 'audience')} title={uid === me?.id ? t('Leave the band') : t('Remove from the band')} className="text-text-2 hover:text-danger" data-daw-band-remove={uid}><X size={14} /></button>}
      </div>
    )
  }
  return (
    <Panel title={t('Band')} icon={<Users size={16} />} close={close} data="band">
      <p className="mb-2 text-xs text-text-2">{t('The band edits the project any time and is heard in its sessions. Engineers also record the band and manage the project.')}</p>
      {engineers.map((u) => row(u, 'engineer'))}
      {artists.map((u) => row(u, 'artist'))}
      {rights.manage && (
        <form className="mt-3 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (pick) void set(pick, 'artist').then(() => setPick('')) }}>
          <Dropdown value={pick} onChange={(e) => setPick(e.target.value)} className="input h-8 min-w-0 flex-1 px-2 text-sm" aria-label={t('Add someone')} data-daw-band-pick>
            <option value="">{t('Add someone…')}</option>
            {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{users[m.user_id] ? shownName(users[m.user_id], m) : m.user_id}</option>)}
          </Dropdown>
          <button type="submit" disabled={!pick} className="btn-primary h-8 py-0 text-xs disabled:opacity-50" data-daw-band-add><UserPlus size={14} /> {t('Add')}</button>
        </form>
      )}
    </Panel>
  )
}

/** The project's sessions: when they ran, who was there, how many takes they got. */
export function SessionsPanel({ channel, close }: { channel: Channel; close: () => void }) {
  const t = useT()
  const users = useStore((s) => s.users)
  const list = useGatherings(channel.id)
  const span = (a: string, b: string | null) => { const m = Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }
  return (
    <Panel title={t('Sessions')} icon={<CalendarClock size={16} />} close={close} data="sessions">
      {list?.length === 0 && <p className="text-xs text-text-2">{t('No sessions yet. An engineer starts one from the top of the project when the band gets together.')}</p>}
      {list?.map((g) => (
        <div key={g.id} className="mb-2 rounded-lg border border-line p-2 text-sm" data-daw-session={g.id}>
          <div className="flex items-center gap-1.5">
            {!g.ended_at && <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />}
            <span className="min-w-0 flex-1 truncate font-semibold">{g.title}</span>
            <span className="shrink-0 text-[10px] text-text-2">{g.ended_at ? span(g.started_at, g.ended_at) : t('Live')}</span>
          </div>
          <div className="mt-1 text-[10px] text-text-2">{new Date(g.started_at).toLocaleString()} · {t('{n} takes', { n: g.takes })}</div>
          <div className="mt-1.5 flex -space-x-1.5">{g.people.slice(0, 8).map((uid) => users[uid] && <span key={uid} className="rounded-full ring-2 ring-bg-1" title={users[uid].display_name ?? users[uid].username}><Avatar user={users[uid]} size={18} /></span>)}</div>
        </div>
      ))}
    </Panel>
  )
}

/** Import a .dawproject or .parley-project file into a studio as a new project. */
export async function importAny(studioId: string, f: File) {
  if (/\.dawproject$/i.test(f.name)) { const r = await importDawProject(studioId, f); if (r.skipped.length) useStore.getState().pushToast(`Left out: ${[...new Set(r.skipped)].slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}`); return r.project }
  return importProjectFile(studioId, f)
}
