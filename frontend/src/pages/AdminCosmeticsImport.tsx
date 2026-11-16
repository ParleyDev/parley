import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderInput, X } from 'lucide-react'
import { api, ApiError, getToken } from '../lib/api'
import { useT } from '../lib/i18n'
import type { CosmeticKind } from '../lib/cosmetics'
import { KIND_DIRS, MAX_IMPORT_FILE, planImport, type ImportItem, type KindPlan } from '../lib/cosmeticsImport'

type Standing = 'missing' | 'present' | 'clash'
interface Reviewed { kind: CosmeticKind; error?: string; items: (ImportItem & { standing?: Standing })[] }
type Phase = { at: 'pick' } | { at: 'reading' } | { at: 'review'; plans: Reviewed[] } | { at: 'sending'; plans: Reviewed[]; done: number; total: number; failed: { item: ImportItem; why: string }[]; skipped: number; stopped?: boolean; finished?: boolean }

/** One item to the server: its entry as it is, and its files under their own names. */
async function sendItem(item: ImportItem) {
  const form = new FormData()
  form.append('entry', JSON.stringify(item.entry))
  for (const f of item.files) form.append('file', f.file, f.name)
  const token = getToken()
  const res = await fetch(`/api/admin/cosmetics/${item.kind}/import`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error ?? msg } catch { /* keep */ } throw new ApiError(res.status, msg) }
}

/**
 * Admin console → Cosmetics → Import from folder: pick a folder laid out like the assets folder (avatar-decorations/,
 * nameplates/, profile-effects/, profile-frames/, each with its metadata.json), see what it has that this server
 * doesn't, and add only those. Items already here (by file or folder name) are left alone; entries are kept as they
 * are in the picked folder.
 */
export default function CosmeticsImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>({ at: 'pick' })
  const input = useRef<HTMLInputElement>(null)
  const stop = useRef(false)
  const sending = phase.at === 'sending' && !phase.finished
  useEffect(() => { input.current?.setAttribute('webkitdirectory', '') }, [])
  const close = () => { if (sending) { stop.current = true; return } onClose() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const KIND_LABEL: Record<CosmeticKind, string> = { decoration: t('Avatar decorations'), nameplate: t('Nameplates'), effect: t('Profile effects'), frame: t('Profile frames') }
  const PROBLEM: Record<NonNullable<ImportItem['problem']>, string> = {
    'no-files': t('its files aren\'t in the folder'),
    'bad-name': t('a file or folder name has characters other than letters, digits, \'.\', \'_\' and \'-\''),
    'too-big': t('a file is over {n} MB', { n: MAX_IMPORT_FILE / 1024 / 1024 }),
  }

  const picked = async (list: FileList | null) => {
    if (!list?.length) return
    setPhase({ at: 'reading' })
    try {
      const plans = await planImport([...list].map((file) => ({ path: file.webkitRelativePath || file.name, file })))
      const reviewed: Reviewed[] = []
      for (const p of plans as KindPlan[]) {
        if (p.error) { reviewed.push({ kind: p.kind, error: p.error, items: [] }); continue }
        const keys: Record<string, Standing> = {}
        for (let i = 0; i < p.items.length; i += 5000) {
          const r = await api.post<{ keys: Record<string, Standing> }>(`/admin/cosmetics/${p.kind}/import/check`, { keys: p.items.slice(i, i + 5000).map((it) => it.key) })
          Object.assign(keys, r.keys)
        }
        reviewed.push({ kind: p.kind, items: p.items.map((it) => ({ ...it, standing: keys[it.key] })) })
      }
      setPhase({ at: 'review', plans: reviewed })
    } catch (e) {
      setPhase({ at: 'pick' }); alert((e as Error).message)
    } finally { if (input.current) input.current.value = '' }
  }

  const toSend = (plans: Reviewed[]) => plans.flatMap((p) => p.items.filter((it) => it.standing === 'missing' && !it.problem))
  const run = async (plans: Reviewed[]) => {
    const queue = toSend(plans)
    stop.current = false
    let done = 0, skipped = 0
    const failed: { item: ImportItem; why: string }[] = []
    const show = (finished = false) => setPhase({ at: 'sending', plans, done, total: queue.length, failed: [...failed], skipped, stopped: stop.current, finished })
    show()
    // Two at a time: the server writes one at a time anyway (its folder lock), and big files go faster in pairs.
    let next = 0
    const worker = async () => {
      while (next < queue.length && !stop.current) {
        const item = queue[next++]
        try { await sendItem(item) } catch (e) {
          // Added meanwhile (another admin, an earlier run): nothing to do.
          if (e instanceof ApiError && e.status === 409 && /already in the assets folder/.test(e.message)) skipped++
          else failed.push({ item, why: (e as Error).message })
        }
        done++; show()
      }
    }
    await Promise.all([worker(), worker()])
    show(true)
    onImported()
  }

  const body = () => {
    if (phase.at === 'pick' || phase.at === 'reading') return (
      <div className="space-y-3 text-sm" data-cosmetics-import-pick>
        <p>{t('Pick a folder laid out like the assets folder: avatar-decorations, nameplates, profile-effects and profile-frames, each with its metadata.json. You can pick the folder that holds them, or one of them.')}</p>
        <p className="text-text-2">{t('Only items this server doesn\'t have yet are added (matched by file or folder name). Their metadata entries are copied as they are.')}</p>
        <button type="button" className="btn-primary" disabled={phase.at === 'reading'} onClick={() => input.current?.click()} data-cosmetics-import-choose><FolderInput size={16} /> {phase.at === 'reading' ? t('Reading…') : t('Choose folder…')}</button>
      </div>
    )
    const { plans } = phase
    const count = toSend(plans).length
    return (
      <div className="space-y-4 text-sm">
        {!plans.length && <p className="text-text-2" data-cosmetics-import-empty>{t('No avatar-decorations, nameplates, profile-effects or profile-frames folder was found there.')}</p>}
        {plans.map((p) => {
          const by = (s: Standing) => p.items.filter((it) => it.standing === s)
          const fresh = by('missing'), ready = fresh.filter((it) => !it.problem), blocked = fresh.filter((it) => it.problem)
          return (
            <section key={p.kind} className="rounded-lg border border-line p-3 space-y-2" data-cosmetics-import-kind={p.kind}>
              <div className="flex flex-wrap items-baseline gap-x-3"><h3 className="font-bold">{KIND_LABEL[p.kind]}</h3><span className="text-xs text-text-2">{KIND_DIRS[p.kind]}/</span></div>
              {p.error ? <p className="text-red-400" data-cosmetics-import-error>{p.error === 'no-metadata' ? t('No metadata.json in this folder.') : t('Its metadata.json isn\'t valid, or has no items list.')}</p> : (
                <>
                  <p data-cosmetics-import-counts={`${p.items.length}/${by('present').length}/${ready.length}`}>{t('{n} in the folder · {here} already here · {fresh} new', { n: p.items.length, here: by('present').length, fresh: ready.length })}</p>
                  {ready.length > 0 && <details><summary className="cursor-pointer text-text-2">{t('New items')}</summary><ul className="mt-1 max-h-48 overflow-y-auto columns-2 text-xs" data-cosmetics-import-new>{ready.map((it) => <li key={it.key} className="truncate">{it.name}</li>)}</ul></details>}
                  {by('clash').length > 0 && <div className="text-amber-400" data-cosmetics-import-clash>{t('Skipped, another item here has the same id: {list}', { list: by('clash').map((it) => it.key).join(', ') })}</div>}
                  {blocked.length > 0 && <ul className="text-amber-400 text-xs" data-cosmetics-import-blocked>{blocked.map((it) => <li key={it.key}>{t('Skipped {name}: {why}', { name: it.key, why: PROBLEM[it.problem!] })}</li>)}</ul>}
                </>
              )}
            </section>
          )
        })}
        {phase.at === 'sending' && (
          <div className="space-y-2" data-cosmetics-import-progress={`${phase.done}/${phase.total}`}>
            <div className="h-2 overflow-hidden rounded bg-bg-3"><div className="h-full bg-accent transition-[width]" style={{ width: `${phase.total ? (phase.done / phase.total) * 100 : 100}%` }} /></div>
            <p>{phase.finished
              ? (phase.stopped ? t('Stopped after {n} of {total}.', { n: phase.done, total: phase.total }) : t('Done: {n} added.', { n: phase.done - phase.failed.length - phase.skipped }))
              : t('Adding {n} of {total}…', { n: phase.done, total: phase.total })}
            {phase.skipped > 0 && ` ${t('{n} were added meanwhile and left alone.', { n: phase.skipped })}`}</p>
            {phase.failed.length > 0 && <ul className="max-h-40 overflow-y-auto text-xs text-red-400" data-cosmetics-import-failed>{phase.failed.map((f) => <li key={`${f.item.kind}:${f.item.key}`}>{f.item.key}: {f.why}</li>)}</ul>}
          </div>
        )}
        {phase.at === 'review' && plans.length > 0 && count === 0 && <p className="font-semibold" data-cosmetics-import-nothing>{t('Nothing new to add.')}</p>}
      </div>
    )
  }

  const footer = phase.at === 'review'
    ? <><button type="button" className="btn-ghost" onClick={() => setPhase({ at: 'pick' })}>{t('Pick another folder')}</button><button type="button" className="btn-primary" disabled={!toSend(phase.plans).length} onClick={() => void run(phase.plans)} data-cosmetics-import-go>{t('Add {n} items', { n: toSend(phase.plans).length })}</button></>
    : sending ? <button type="button" className="btn-ghost" onClick={() => { stop.current = true }} data-cosmetics-import-stop>{t('Stop')}</button>
    : <button type="button" className="btn-ghost" onClick={onClose} data-cosmetics-import-close>{t('Close')}</button>

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div role="dialog" aria-modal aria-label={t('Import from folder')} className="pop flex h-full w-full max-w-2xl flex-col overflow-hidden bg-bg-1 shadow-2xl sm:h-auto sm:max-h-full sm:rounded-2xl sm:border sm:border-line" style={{ paddingTop: 'var(--sat)' }} data-cosmetics-import>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{t('Import from folder')}</h2>
          <button type="button" onClick={close} disabled={sending} className="rounded-md p-1 text-text-2 hover:bg-bg-3 hover:text-text-0 disabled:opacity-30" aria-label={t('Close')}><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{body()}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-1 px-4 pt-3" style={{ paddingBottom: 'max(0.75rem, var(--sab))' }}>{footer}</div>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => void picked(e.target.files)} data-cosmetics-import-input />
      </div>
    </div>,
    document.body,
  )
}
