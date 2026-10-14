import type { KeyboardEvent } from 'react'

/** Markdown wrappers the composer can toggle around a selection. */
export interface Format { key: string; label: string; before: string; after: string; keys?: string }

export const FORMATS: Format[] = [
  { key: 'bold', label: 'Bold', before: '**', after: '**', keys: 'Ctrl+B' },
  { key: 'italic', label: 'Italic', before: '*', after: '*', keys: 'Ctrl+I' },
  { key: 'underline', label: 'Underline', before: '__', after: '__', keys: 'Ctrl+U' },
  { key: 'strike', label: 'Strikethrough', before: '~~', after: '~~', keys: 'Ctrl+Shift+S' },
  { key: 'code', label: 'Code', before: '`', after: '`', keys: 'Ctrl+E' },
  { key: 'spoiler', label: 'Spoiler', before: '||', after: '||' },
]

/** Wrap (or, if already wrapped, unwrap) the textarea's selection and return the new value. The caller sets state; the selection is restored on the next frame. */
export function toggleWrap(el: HTMLTextAreaElement, f: Format): string {
  const { selectionStart: s, selectionEnd: e, value } = el
  const sel = value.slice(s, e)
  const outer = value.slice(s - f.before.length, s) === f.before && value.slice(e, e + f.after.length) === f.after
  const inner = sel.startsWith(f.before) && sel.endsWith(f.after) && sel.length >= f.before.length + f.after.length
  let next: string, ns: number, ne: number
  if (outer) {
    next = value.slice(0, s - f.before.length) + sel + value.slice(e + f.after.length)
    ns = s - f.before.length; ne = ns + sel.length
  } else if (inner) {
    const bare = sel.slice(f.before.length, sel.length - f.after.length)
    next = value.slice(0, s) + bare + value.slice(e)
    ns = s; ne = s + bare.length
  } else {
    next = value.slice(0, s) + f.before + sel + f.after + value.slice(e)
    ns = s + f.before.length; ne = ns + sel.length
  }
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ns, ne) })
  return next
}

/** Map a keydown to a format, Discord-style: Ctrl/Cmd + B / I / U / E, Ctrl/Cmd+Shift+S. */
export function shortcutFormat(e: KeyboardEvent<HTMLTextAreaElement>): Format | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'b' && !e.shiftKey) return FORMATS[0]
  if (k === 'i' && !e.shiftKey) return FORMATS[1]
  if (k === 'u' && !e.shiftKey) return FORMATS[2]
  if (k === 's' && e.shiftKey) return FORMATS[3]
  if (k === 'e' && !e.shiftKey) return FORMATS[4]
  return null
}
