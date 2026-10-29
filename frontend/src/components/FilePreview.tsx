import { ChevronDown, ChevronUp, Download, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/upload'
import { ensureLanguage, highlightHtml } from '../lib/markdown'
import type { Attachment } from '../lib/types'
import { useT } from '../lib/i18n'

/** Extensions shown as text, mapped to a highlight.js language ('' = plain text). */
const TEXT_EXT: Record<string, string> = {
  txt: '', log: '', csv: '', tsv: '', ini: 'ini', conf: '', cfg: '', env: '', wide: 'markdown', markdown: 'markdown',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml', sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', rb: 'ruby', php: 'php', lua: 'lua', swift: 'swift', diff: 'diff', patch: 'diff',
}
const MAX_PREVIEW = 1024 * 1024
const ext = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

/** Whether an attachment gets a text/code preview (small enough, and a text type or a known text extension). */
export function isTextFile(a: Pick<Attachment, 'filename' | 'content_type' | 'size'>): boolean {
  if (a.size > MAX_PREVIEW) return false
  return a.content_type.startsWith('text/') || a.content_type === 'application/json' || ext(a.filename) in TEXT_EXT
}
export const isPdf = (a: Pick<Attachment, 'content_type' | 'filename'>) => a.content_type === 'application/pdf' || ext(a.filename) === 'pdf'

/** Text and code files: the first lines, highlighted, with expand/collapse and download. */
export function TextPreview({ a }: { a: Attachment }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [, bump] = useState(0)
  const lang = TEXT_EXT[ext(a.filename)] ?? ''
  useEffect(() => {
    let live = true
    fetch(a.url, { headers: { Range: 'bytes=0-65535' } }).then((r) => r.text()).then((body) => { if (live) setText(body) }).catch(() => { if (live) setText('') })
    const pending = lang ? ensureLanguage(lang) : null
    pending?.then(() => { if (live) bump((n) => n + 1) })
    return () => { live = false }
  }, [a.url, lang])
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n')
  const shown = open ? lines.slice(0, 1000) : lines.slice(0, 12)
  const code = shown.join('\n')
  const html = lang && text ? highlightHtml(code, lang) : null
  const more = lines.length > shown.length || (text?.length ?? 0) >= 65535
  return (
    <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-line bg-bg-1" data-text-preview={a.id}>
      <div className="flex items-center gap-2 border-b border-line bg-bg-3 px-3 py-1.5 text-xs">
        <FileText size={14} className="shrink-0 text-text-2" />
        <span className="min-w-0 flex-1 truncate font-medium text-text-0">{a.filename}</span>
        <span className="shrink-0 text-text-2">{formatBytes(a.size)}</span>
        <a href={a.url} download={a.filename} className="shrink-0 text-text-2 hover:text-text-0" title={t('Download')}><Download size={14} /></a>
      </div>
      {text === null ? <div className="px-3 py-2 text-xs text-text-2">{t('Loading…')}</div> : (
        <pre className={`overflow-x-auto px-3 py-2 text-[12.5px] leading-[1.45] ${open ? 'max-h-[480px] overflow-y-auto' : ''}`}>{html !== null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}</pre>
      )}
      {text !== null && (more || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-center gap-1 border-t border-line py-1 text-xs text-text-2 hover:bg-bg-3 hover:text-text-0" data-text-preview-toggle>
          {open ? <><ChevronUp size={13} /> {t('Collapse')}</> : <><ChevronDown size={13} /> {t('Expand ({n} lines)', { n: `${lines.length}${(text?.length ?? 0) >= 65535 ? '+' : ''}` })}</>}
        </button>
      )}
    </div>
  )
}

/** PDFs: a card that opens the document in the browser's viewer (new tab) or downloads it. */
export function PdfCard({ a }: { a: Attachment }) {
  const t = useT()
  return (
    <div className="flex w-full max-w-[400px] items-center gap-3 rounded-lg border border-line bg-bg-3 px-3 py-2.5" data-pdf-card={a.id}>
      <span className="flex h-9 w-8 shrink-0 items-center justify-center rounded bg-danger text-[9px] font-extrabold text-white">PDF</span>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.filename}</div><div className="text-xs text-text-2">{formatBytes(a.size)}</div></div>
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn-ghost bg-bg-4 py-1 text-xs" data-pdf-open>{t('Open')}</a>
      <a href={a.url} download={a.filename} className="text-text-2 hover:text-text-0" title={t('Download')}><Download size={16} /></a>
    </div>
  )
}
