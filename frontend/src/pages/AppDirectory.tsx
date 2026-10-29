import { ArrowLeft, BadgeCheck, Search, Server, SquareSlash } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

interface DirApp { id: string; name: string; description: string; icon_url: string | null; verified: boolean; client_id: string; install_permissions: string; tags: string[]; servers: number; commands: number }

/** /app-directory: listed public apps. Add one to a server (its bot), or to your account (its commands, anywhere). */
export default function AppDirectoryPage() {
  const t = useT()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [list, setList] = useState<DirApp[] | null>(null)
  useEffect(() => { const h = setTimeout(() => api.get<DirApp[]>(`/app-directory?q=${encodeURIComponent(q)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`).then(setList).catch(() => setList([])), q ? 250 : 0); return () => clearTimeout(h) }, [q, tag])
  const tags = [...new Set((list ?? []).flatMap((a) => a.tags))].sort()
  const add = (a: DirApp, server: boolean) => navigate(`/oauth2/authorize?client_id=${a.client_id}&scope=${encodeURIComponent(server ? 'bot applications.commands' : 'applications.commands')}${server ? `&permissions=${a.install_permissions}` : ''}`)
  return (
    <div className="h-full overflow-y-auto bg-bg-0 p-6 phone:p-3" data-app-directory>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <button type="button" className="rounded-full p-1.5 text-text-2 hover:bg-bg-3" onClick={() => navigate(-1)} title={t('Back')}><ArrowLeft size={20} /></button>
          <div><h1 className="text-2xl font-bold">{t('App Directory')}</h1><p className="text-sm text-text-2">{t('Bots and apps for your servers and your account.')}</p></div>
        </div>
        <div className="relative"><input className="input pl-9" placeholder={t('Search apps')} value={q} onChange={(e) => setQ(e.target.value)} data-app-search /><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2" /></div>
        {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{['', ...tags].map((tg) => <button key={tg || 'all'} type="button" onClick={() => setTag(tg)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tag === tg ? 'bg-accent text-white' : 'bg-bg-3 text-text-1'}`} data-app-tag={tg || 'all'}>{tg || t('All')}</button>)}</div>}
        {list === null ? <p className="text-sm text-text-2">{t('Loading…')}</p> : list.length === 0 ? <p className="text-sm text-text-2">{t('No apps found.')}</p> : (
          <div className="grid grid-cols-2 gap-3 phone:grid-cols-1">
            {list.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 rounded-xl border border-line bg-bg-1 p-4" data-directory-app={a.id}>
                <div className="flex items-center gap-3">
                  {a.icon_url ? <img src={a.icon_url} alt="" className="h-12 w-12 rounded-xl" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-3 text-xl font-bold">{a.name[0]}</div>}
                  <div className="min-w-0"><div className="flex items-center gap-1 font-bold">{a.name}{a.verified && <BadgeCheck size={16} className="text-accent" aria-label={t('Verified')} />}</div>
                    <div className="flex gap-3 text-xs text-text-2"><span className="flex items-center gap-1"><Server size={12} />{a.servers === 1 ? t('1 server') : t('{n} servers', { n: a.servers })}</span><span className="flex items-center gap-1"><SquareSlash size={12} />{a.commands === 1 ? t('1 command') : t('{n} commands', { n: a.commands })}</span></div></div>
                </div>
                {a.description && <p className="line-clamp-3 text-sm text-text-1">{a.description}</p>}
                {a.tags.length > 0 && <div className="flex flex-wrap gap-1">{a.tags.map((tg) => <span key={tg} className="rounded-full bg-bg-3 px-2 py-0.5 text-[11px]">{tg}</span>)}</div>}
                <div className="mt-auto flex gap-2 pt-1">
                  <button type="button" className="btn-primary flex-1" onClick={() => add(a, true)} data-directory-add-server={a.id}>{t('Add to Server')}</button>
                  {a.commands > 0 && <button type="button" className="btn-ghost flex-1" onClick={() => add(a, false)} data-directory-add-me={a.id}>{t('Add to My Apps')}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
