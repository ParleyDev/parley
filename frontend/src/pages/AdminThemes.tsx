import { useEffect, useState } from 'react'
import { Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import type { ColorTheme, Look } from '../lib/colorThemes'
import ThemeEditor, { MiniApp, ThemeSwatch } from '../components/ThemeEditor'

type Draft = { id?: string; name: string; look: Look; enabled: boolean }
const lookOf = (t: ColorTheme): Look => ({ base: t.base, angle: t.angle, midpoint: t.midpoint, stops: t.stops })

/**
 * Admin console → Themes: every colour theme users can pick, free for all. Edit, rename, duplicate, create, drag to
 * reorder, turn on and off, delete (the built-in ones can only be turned off). Each change is in the audit log, and
 * reaches everyone's app at once; people on a theme that goes away fall back to its plain base.
 */
export default function ThemesPane() {
  const t = useT()
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<ColorTheme[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const load = () => api.get<ColorTheme[]>('/admin/themes').then(setList).catch((e) => pushToast((e as Error).message, 'error'))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); await load(); if (done) pushToast(done) } catch (e) { pushToast((e as Error).message, 'error') } }

  const save = () => act(async () => {
    if (!draft) return
    const body = { name: draft.name, ...draft.look, enabled: draft.enabled }
    if (draft.id) await api.patch(`/admin/themes/${draft.id}`, body); else await api.post('/admin/themes', body)
    setDraft(null)
  }, t('Theme saved'))
  const toggle = (th: ColorTheme) => act(() => api.patch(`/admin/themes/${th.id}`, { enabled: !th.enabled }))
  const remove = (th: ColorTheme) => { if (confirm(t('Delete the theme {name}? People using it go back to its base.', { name: th.name }))) void act(() => api.delete(`/admin/themes/${th.id}`), t('Theme deleted')) }
  const drop = (target: string) => {
    if (!list || !dragging || dragging === target) return
    const ids = list.map((x) => x.id).filter((id) => id !== dragging)
    ids.splice(ids.indexOf(target), 0, dragging)
    setList(ids.map((id) => list.find((x) => x.id === id)!))
    void act(() => api.put('/admin/themes/order', { ids }))
    setDragging(null)
  }

  return (
    <div className="max-w-4xl space-y-6" data-admin-themes>
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">{t('Themes')}</h1><p className="text-sm text-text-2 mt-1">{t('The colour themes everyone can pick in Appearance, free for all. Drag to reorder.')}</p></div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setDraft({ name: t('New theme'), look: { base: 'dark', angle: 150, midpoint: 40, stops: [{ color: '#5865f2', pos: 10 }, { color: '#eb459e', pos: 90 }] }, enabled: true })} data-theme-new><Plus size={16} /> {t('New theme')}</button>
      </div>
      {draft && (
        <div className="rounded-xl border border-accent/50 bg-bg-1 p-4 space-y-4" data-theme-draft={draft.id ?? 'new'}>
          <ThemeEditor value={draft.look} onChange={(look) => setDraft({ ...draft, look })} name={draft.name} onName={(name) => setDraft({ ...draft, name })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-accent" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />{t('Enabled')}</label>
          <div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => void save()} data-theme-save>{t('Save')}</button><button type="button" className="btn-ghost" onClick={() => setDraft(null)}>{t('Cancel')}</button></div>
        </div>
      )}
      {!list ? <p className="text-text-2">{t('Loading…')}</p> : (
        <ul className="space-y-2" data-theme-list>
          {list.map((th) => (
            <li key={th.id} draggable onDragStart={() => setDragging(th.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(th.id)} onDragEnd={() => setDragging(null)}
              className={`flex items-center gap-3 rounded-xl border bg-bg-1 p-3 ${dragging === th.id ? 'opacity-50' : ''} ${th.enabled ? 'border-line' : 'border-line opacity-60'}`} data-theme-row={th.slug}>
              <GripVertical size={16} className="shrink-0 cursor-grab text-text-2" />
              <ThemeSwatch look={lookOf(th)} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate font-semibold" data-theme-row-name>{th.name}</span>{th.builtin && <span className="rounded bg-bg-3 px-1.5 text-[10px] font-bold uppercase text-text-2">{t('Built-in')}</span>}</div>
                <div className="text-xs text-text-2">{th.base === 'light' ? t('Light') : t('Dark')} · {Math.round(th.angle)}° · {th.stops.length} {t('colours')}</div>
              </div>
              <MiniApp look={lookOf(th)} height={64} className="hidden w-48 lg:block" />
              <label className="flex items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="h-4 w-4 accent-accent" checked={th.enabled} onChange={() => void toggle(th)} data-theme-enabled={th.slug} />{t('On')}</label>
              <button type="button" onClick={() => setDraft({ id: th.id, name: th.name, look: lookOf(th), enabled: th.enabled })} title={t('Edit')} aria-label={t('Edit {name}', { name: th.name })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-theme-edit={th.slug}><Pencil size={15} /></button>
              <button type="button" onClick={() => setDraft({ name: t('{name} copy', { name: th.name }), look: lookOf(th), enabled: true })} title={t('Duplicate')} aria-label={t('Duplicate {name}', { name: th.name })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-theme-duplicate={th.slug}><Copy size={15} /></button>
              <button type="button" onClick={() => remove(th)} disabled={th.builtin} title={th.builtin ? t('Built-in themes can be turned off, not deleted') : t('Delete')} aria-label={t('Delete {name}', { name: th.name })} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent" data-theme-delete={th.slug}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
