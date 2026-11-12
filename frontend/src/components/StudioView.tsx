import { Archive, AudioLines, Mic, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { createProject, projectRights, TAGS, tagOf } from '../lib/projects'
import type { Channel, ProjectCard, ProjectTag } from '../lib/types'
import { relativeTime } from '../lib/ua'
import { useStore } from '../store'
import Avatar from './Avatar'
import { importAny } from './DawPanels'

/**
 * A studio channel: its projects, like a forum's posts. Each card is a song with its stage, band, takes and whether
 * a session is on now; opening one goes to its channel (DAW, chat, voice room). New Project needs Create Projects.
 */
export default function StudioView({ channel }: { channel: Channel }) {
  const t = useT()
  const navigate = useNavigate()
  const users = useStore((s) => s.users)
  const pushToast = useStore((s) => s.pushToast)
  useStore((s) => s.channels[channel.id])
  const rights = projectRights(channel)
  const [list, setList] = useState<ProjectCard[] | null>(null)
  const [archived, setArchived] = useState(false)
  const [tag, setTag] = useState<ProjectTag | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState(120)
  const [importing, setImporting] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const importFile = async (f: File) => { setImporting(true); try { const p = await importAny(channel.id, f); navigate(`/channels/${channel.guild_id}/${p.channel_id}`) } catch (e) { pushToast((e as Error).message, 'error') } finally { setImporting(false) } }
  useEffect(() => {
    let live = true
    const load = () => void api.get<ProjectCard[]>(`/channels/${channel.id}/studio/projects?archived=${archived}`).then((l) => { if (live) setList(l) }).catch(() => { if (live) setList([]) })
    load()
    const on = (e: Event) => { if ((e as CustomEvent).detail === channel.id) load() }
    window.addEventListener('parley-studio-projects', on)
    return () => { live = false; window.removeEventListener('parley-studio-projects', on) }
  }, [channel.id, archived])
  const open = (p: ProjectCard) => navigate(`/channels/${channel.guild_id}/${p.channel_id}`)
  const create = async () => {
    try { const p = await createProject(channel.id, { name: name.trim(), bpm }); setCreating(false); setName(''); navigate(`/channels/${channel.guild_id}/${p.channel_id}`) } catch (e) { pushToast((e as Error).message, 'error') }
  }
  const shown = (list ?? []).filter((p) => (!tag || p.tag === tag) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 phone:px-3" data-studio={channel.id}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {rights.create && <button type="button" className="btn-primary py-1.5" onClick={() => setCreating(true)} data-studio-new><Plus size={16} /> {t('New Project')}</button>}
        {rights.create && <button type="button" className="btn-ghost py-1.5" disabled={importing} onClick={() => file.current?.click()} title={t('A .dawproject from Bitwig Studio, Studio One, Cubase and others, or a .parley-project')} data-studio-import><Upload size={16} /> {importing ? t('Importing…') : t('Import')}</button>}
        <input ref={file} type="file" accept=".dawproject,.parley-project,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} data-studio-import-file />
        <span className="relative"><input className="input w-44 py-1.5 pl-7 text-sm" placeholder={t('Search projects')} value={q} onChange={(e) => setQ(e.target.value)} data-studio-search /><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-2" /></span>
        <span className="flex flex-wrap gap-1" data-studio-tags>
          {TAGS.map((x) => <button key={x.id} type="button" onClick={() => setTag(tag === x.id ? null : x.id)} aria-pressed={tag === x.id} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tag === x.id ? x.cls : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-studio-tag={x.id}>{t(x.label)}</button>)}
        </span>
        <button type="button" onClick={() => setArchived((a) => !a)} aria-pressed={archived} className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${archived ? 'bg-accent text-white' : 'bg-bg-3 text-text-1 hover:text-text-0'}`} data-studio-archived><Archive size={13} /> {t('Archived')}</button>
      </div>
      {creating && (
        <form className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-bg-1 p-3" onSubmit={(e) => { e.preventDefault(); void create() }} data-studio-create>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-semibold text-text-2">{t('Project name')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('Untitled song')} className="input h-9 text-sm" data-studio-create-name /></label>
          <label className="flex w-24 flex-col gap-1 text-xs font-semibold text-text-2">{t('Tempo')}<input type="number" min={40} max={300} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || 120)} className="input h-9 text-sm" data-studio-create-bpm /></label>
          <button type="submit" className="btn-primary h-9" data-studio-create-go>{t('Create')}</button>
          <button type="button" className="btn-ghost h-9" onClick={() => setCreating(false)}>{t('Cancel')}</button>
        </form>
      )}
      {list !== null && shown.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-studio-empty>
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bg-3"><AudioLines size={30} className="text-text-1" /></div>
          <h2 className="text-xl font-bold">{archived ? t('No archived projects') : t('No projects yet')}</h2>
          <p className="mt-1 max-w-sm text-sm text-text-2">{archived ? t('Projects you archive show up here.') : rights.create ? t('Start a project for each song: its tracks, takes, chat and sessions stay together.') : t('Projects started here will show up for you to listen to and join.')}</p>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3" data-studio-projects>
        {shown.map((p) => {
          const tg = tagOf(p.tag)
          return (
            <button key={p.id} type="button" onClick={() => open(p)} className="group flex flex-col gap-2 rounded-xl border border-line bg-bg-1 p-3 text-left hover:border-accent/60 hover:bg-bg-2" data-studio-project={p.id}>
              <div className="flex items-start gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><AudioLines size={20} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" data-studio-project-name>{p.name}</div>
                  <div className="text-xs text-text-2">{p.bpm} BPM · {p.beats}/4 · {t('{n} takes', { n: p.takes })}</div>
                </div>
                {tg && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${tg.cls}`}>{t(tg.label)}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-2">
                <span className="flex -space-x-1.5">{p.band.slice(0, 5).map((uid) => users[uid] && <span key={uid} className="rounded-full ring-2 ring-bg-1"><Avatar user={users[uid]} size={20} /></span>)}</span>
                {p.session ? <span className="flex min-w-0 items-center gap-1 rounded-full bg-success/20 px-1.5 py-0.5 font-bold text-success" title={p.session} data-studio-live><Mic size={11} className="shrink-0" /> <span className="truncate">{t('Live · {title}', { title: p.session })}</span></span>
                  : p.live > 0 && <span className="flex items-center gap-1 rounded-full bg-bg-3 px-1.5 py-0.5 font-bold text-text-1" data-studio-in-voice><Mic size={11} /> {t('{n} in voice', { n: p.live })}</span>}
                <span className="ml-auto whitespace-nowrap">{relativeTime(p.updated_at)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
