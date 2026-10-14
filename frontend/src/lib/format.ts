
/** Minimal, XSS-safe markdown subset: code blocks, inline code, bold, italic, strike, links, quotes. */
export { renderMarkdown } from './markdown'

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

