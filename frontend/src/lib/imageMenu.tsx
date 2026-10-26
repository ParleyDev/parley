import { Copy, Download, ExternalLink, Image as ImageIcon, Link2 } from 'lucide-react'
import type { MenuEntry } from '../components/ContextMenu'
import { publicOrigin } from '../components/InviteCard'
import { openExternal } from './native'
import { useStore } from '../store'

/** The image's address as others can open it: attachments are served relative to the app. */
export const absoluteUrl = (url: string) => { try { return new URL(url, publicOrigin() + '/').href } catch { return url } }

/** The clipboard only takes PNG images everywhere, so other formats are redrawn as PNG first. */
async function pngBlob(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob()
  if (blob.type === 'image/png') return blob
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not copy that image'))), 'image/png'))
}

async function save(url: string, name: string) {
  const blob = await (await fetch(url)).blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = href; a.download = name || 'image'
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

/** Right-click on any picture (attachments, the lightbox, link previews): copy, save, copy link, open. */
export function imageMenu(url: string, name: string): MenuEntry[] {
  const toast = useStore.getState().pushToast
  const run = (fn: () => Promise<void>, done?: string) => () => { fn().then(() => { if (done) toast(done) }).catch((e: Error) => toast(e.message || 'That didn’t work', 'error')) }
  const canCopyImage = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
  return [
    ...(canCopyImage ? [{ label: 'Copy Image', icon: <ImageIcon size={16} />, onClick: run(async () => { await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(url) })]) }, 'Image copied') }] : []),
    { label: 'Save Image', icon: <Download size={16} />, onClick: run(() => save(url, name)) },
    'sep',
    { label: 'Copy Link', icon: <Link2 size={16} />, onClick: run(() => navigator.clipboard.writeText(absoluteUrl(url)), 'Link copied') },
    { label: 'Open Link', icon: <ExternalLink size={16} />, onClick: () => openExternal(absoluteUrl(url)) },
    ...(name ? [{ label: 'Copy File Name', icon: <Copy size={16} />, onClick: run(() => navigator.clipboard.writeText(name), 'File name copied') }] : []),
  ]
}
