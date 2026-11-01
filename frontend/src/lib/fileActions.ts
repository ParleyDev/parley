import { Copy, Download, ExternalLink, Link2, Share2 } from 'lucide-react'
import { createElement } from 'react'
import type { MenuEntry } from '../components/ContextMenu'
import { absoluteUrl } from './imageMenu'
import { isNative, nativePlatform, openExternal } from './native'
import { t } from './i18n'
import { useStore } from '../store'

/** The attachment URL that asks the server for a download (Content-Disposition: attachment). */
export const downloadUrl = (url: string) => { const u = new URL(url, location.href); u.searchParams.set('download', '1'); return u.href }

/**
 * Save a file to the device. Browsers and the desktop app download it; the Android app's web view hands the
 * `?download=1` response to the system download manager; the iOS app has no downloads, so it offers the share sheet
 * (Save to Files) or opens the file in Safari.
 */
export async function saveFile(url: string, name: string) {
  if (isNative() && nativePlatform() === 'ios') {
    if (await shareFile(url, name, true)) return
    openExternal(absoluteUrl(url)); return
  }
  const a = document.createElement('a'); a.href = downloadUrl(url); a.download = name || 'file'; a.rel = 'noopener'
  document.body.append(a); a.click(); a.remove()
}

/** The system share sheet with the file itself when it can take files, else the link. False when there is none. */
export async function shareFile(url: string, name: string, fileOnly = false): Promise<boolean> {
  if (!navigator.share) return false
  try {
    const blob = await (await fetch(url)).blob()
    const file = new File([blob], name || 'file', { type: blob.type })
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true }
  } catch (e) { if ((e as Error).name === 'AbortError') return true }
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
