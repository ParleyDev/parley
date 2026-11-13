import { Copy, Download, ExternalLink, Link2, Share2 } from 'lucide-react'
import { createElement } from 'react'
import type { MenuEntry } from '../components/ContextMenu'
import { absoluteUrl } from './imageMenu'
import { openExternal } from './native'
import { t } from './i18n'
import { desktop, desktopBridge } from './desktop'
import { useStore } from '../store'

/** The attachment URL that asks the server for a download (Content-Disposition: attachment). */
export const downloadUrl = (url: string) => { const u = new URL(url, location.href); u.searchParams.set('download', '1'); return u.href }

/** iPhone and iPad (iPadOS says it is a Mac, but with touch): Safari, the home-screen app and the iOS app. */
export const appleTouch = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

/*
 * Safari only opens the share sheet straight from a tap: a file fetched after the tap arrives too late ("not allowed").
 * So files are fetched ahead (when a menu or the viewer opens) and kept here, and a tap shares the one in hand.
 * Big files (videos) aren't held in memory: those share their link, or open to save from there.
 */
const MAX_HELD = 150 * 1024 * 1024
const held = new Map<string, { file: File | null; job: Promise<File | null> }>()
export function prepareFile(url: string, name: string): Promise<File | null> {
  const k = absoluteUrl(url)
  const had = held.get(k)
  if (had) return had.job
  const e: { file: File | null; job: Promise<File | null> } = { file: null, job: Promise.resolve(null) }
  e.job = (async () => {
    try {
      const r = await fetch(url)
      if (!r.ok || Number(r.headers.get('content-length') ?? 0) > MAX_HELD) return null
      const blob = await r.blob()
      return (e.file = new File([blob], name || 'file', { type: blob.type }))
    } catch { held.delete(k); return null }
  })()
  held.set(k, e)
  while (held.size > 12) held.delete(held.keys().next().value!)
  return e.job
}
const inHand = (url: string) => held.get(absoluteUrl(url))?.file ?? null
const shareable = (f: File) => !!navigator.share && !!navigator.canShare?.({ files: [f] })

/**
 * Save a file to the device. Browsers download it; the desktop app asks where with the system Save dialog first; the
 * Android app's web view hands the `?download=1` response to the system download manager. iPhones and iPads (the iOS
 * app, Safari and the home-screen app, which ignores downloads) get the share sheet with the file: Save Image, Save to
 * Files. A file still on its way offers a "Save" button when it arrives (a fresh tap); one too big to hold opens.
 */
export async function saveFile(url: string, name: string) {
  if (appleTouch()) {
    const f = inHand(url)
    if (f && shareable(f)) { await shareNow(f); return }
    if (!navigator.share) { openExternal(absoluteUrl(url)); return }
    const toast = useStore.getState().pushToast
    const got = await prepareFile(url, name)
    if (got && shareable(got)) toast(t('{name} is ready', { name: name || t('File') }), 'info', { label: t('Save'), run: () => void shareNow(got) })
    else openExternal(absoluteUrl(url))
    return
  }
  await download(downloadUrl(url), name || 'file')
}

async function shareNow(f: File) {
  try { await navigator.share({ files: [f], title: f.name }) } catch (e) { if ((e as Error).name !== 'AbortError') throw e }
}

/** Start a download of `href` (a URL or blob: URL) as `name`; the desktop app first asks where (cancel stops it). */
export async function download(href: string, name: string) {
  if (desktopBridge() && await desktop.chooseDownload(href, name) === null) return
  const a = document.createElement('a'); a.href = href; a.download = name; a.rel = 'noopener'
  document.body.append(a); a.click(); a.remove()
}

/**
 * The system share sheet with the file itself when it is in hand (see prepareFile), else the link, straight from the
 * tap (Safari refuses a share sheet after waiting on the network). False when there is none.
 */
export async function shareFile(url: string, name: string, fileOnly = false): Promise<boolean> {
  if (!navigator.share) return false
  const f = inHand(url)
  if (f && shareable(f)) { await shareNow(f); return true }
  if (!appleTouch()) {
    // Elsewhere there's no such limit: fetch it now.
    const got = await prepareFile(url, name)
    if (got && shareable(got)) { await shareNow(got); return true }
  } else void prepareFile(url, name)
  if (fileOnly) return false
  try { await navigator.share({ url: absoluteUrl(url), title: name }); return true } catch (e) { return (e as Error).name === 'AbortError' }
}

export const canShare = () => typeof navigator !== 'undefined' && !!navigator.share

/** What a file attachment offers (phones show it as a bottom sheet): save, share, copy the link, open. */
export function fileMenu(url: string, name: string): MenuEntry[] {
  const toast = useStore.getState().pushToast
  const run = (fn: () => Promise<unknown>, done?: string) => () => { fn().then(() => { if (done) toast(done) }).catch((e: Error) => toast(e.message || t('That didn’t work'), 'error')) }
  const icon = (c: typeof Download) => createElement(c, { size: 16 })
  return [
    { label: t('Save to Device'), icon: icon(Download), onClick: run(() => saveFile(url, name)) },
    ...(canShare() ? [{ label: t('Share…'), icon: icon(Share2), onClick: run(() => shareFile(url, name)) }] : []),
    'sep',
    { label: t('Copy Link'), icon: icon(Link2), onClick: run(() => navigator.clipboard.writeText(absoluteUrl(url)), t('Link copied')) },
    { label: t('Open in Browser'), icon: icon(ExternalLink), onClick: () => openExternal(absoluteUrl(url)) },
    ...(name ? [{ label: t('Copy File Name'), icon: icon(Copy), onClick: run(() => navigator.clipboard.writeText(name), t('File name copied')) }] : []),
  ]
}

/**
 * The desktop app tells the page when a download has finished (or failed): say so, with Show in folder, instead of
 * the file landing somewhere without a word.
 */
export function watchDownloads() {
  window.addEventListener('parley-download', (e) => {
    const d = (e as CustomEvent<{ url: string; path: string | null; ok: boolean }>).detail
    const toast = useStore.getState().pushToast
    const file = d.path?.split(/[\\/]/).pop() || (() => { try { return decodeURIComponent(new URL(d.url).pathname.split('/').pop() ?? '') } catch { return '' } })() || t('File')
    if (!d.ok) { toast(t('Couldn’t download {name}', { name: file }), 'error'); return }
    const path = d.path
    toast(t('Downloaded {name}', { name: file }), 'info', path ? { label: t('Show in folder'), run: () => desktop.revealDownload(path) } : undefined)
  })
}
