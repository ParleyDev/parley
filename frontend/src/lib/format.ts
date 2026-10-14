import { createElement, Fragment, type ReactNode } from 'react'

/** Minimal, XSS-safe markdown subset: code blocks, inline code, bold, italic, strike, links, quotes. */
export function renderMarkdown(src: string): ReactNode {
  const out: ReactNode[] = []
  const parts = src.split(/(```[\s\S]*?```)/g)
  parts.forEach((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      let inner = part.slice(3, -3)
      inner = inner.replace(/^[a-zA-Z0-9_-]*\n/, '')
      out.push(createElement('pre', { key: i }, createElement('code', null, inner)))
    } else if (part) {
      const lines = part.split('\n')
      lines.forEach((line, li) => {
        if (li > 0) out.push(createElement('br', { key: `${i}-br-${li}` }))
        if (line.startsWith('> ')) {
          out.push(createElement('blockquote', { key: `${i}-${li}` }, renderInline(line.slice(2))))
        } else {
          out.push(createElement(Fragment, { key: `${i}-${li}` }, renderInline(line)))
        }
      })
    }
  })
  return createElement(Fragment, null, ...out)
}

const INLINE_SRC = '(`[^`]+`|\\*\\*.+?\\*\\*|__[^_]+__|~~[^~]+~~|\\*[^*\\n]+\\*|_[^_\\n]+_|https?:\\/\\/[^\\s<]+)'

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  // Fresh regex per call: this function recurses, and a shared global regex's lastIndex would be clobbered.
  const INLINE = new RegExp(INLINE_SRC, 'g')
  let k = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const t = m[0]
    k++
    if (t.startsWith('`')) nodes.push(createElement('code', { key: k }, t.slice(1, -1)))
    else if (t.startsWith('**')) nodes.push(createElement('strong', { key: k }, renderInline(t.slice(2, -2))))
    else if (t.startsWith('__')) nodes.push(createElement('u', { key: k }, renderInline(t.slice(2, -2))))
    else if (t.startsWith('~~')) nodes.push(createElement('s', { key: k }, renderInline(t.slice(2, -2))))
    else if (t.startsWith('*') || t.startsWith('_')) nodes.push(createElement('em', { key: k }, renderInline(t.slice(1, -1))))
    else if (t.startsWith('http')) nodes.push(createElement('a', { key: k, href: t, target: '_blank', rel: 'noopener noreferrer' }, t))
    last = m.index + t.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today at ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`
  return `${d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' })} ${time}`
}

export function formatShortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatDateDivider(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const PALETTE = ['#6d5dfc', '#3ccf7d', '#f6b53d', '#f0506e', '#38bdf8', '#e879f9', '#fb923c']
export function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Downscale an image file in the browser and return a data URL under `maxBytes` (JPEG unless the source is PNG/GIF with alpha-ish needs). */
export function resizeImage(file: File, maxW: number, maxH: number, maxBytes = 400 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxW / img.width, maxH / img.height)
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas unavailable'))
      ctx.drawImage(img, 0, 0, w, h)
      const keepPng = file.type === 'image/png' && file.size <= maxBytes
      let q = 0.9
      let out = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', q)
      while (out.length > maxBytes * 1.37 && q > 0.4) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q) }
      if (out.length > maxBytes * 1.37) return reject(new Error('Image is too large even after resizing'))
      resolve(out)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

export function readFileAsDataUrl(file: File, maxBytes = 400 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new Error('Image must be under 400KB'))
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}
