import { Fragment, useEffect, useState, type ReactNode, useRef } from 'react'
import { getPrefs } from './prefs'
import FrozenGif from '../components/FrozenGif'
import { Check, Copy } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import { CUSTOM_TOKEN_SRC, PICTO_SRC, customUrl, parseCustom } from './emoji'
import { ChannelMention, EveryoneMention, RoleMention, UserMention } from '../components/Mentions'
import Timestamp, { TIMESTAMP_SRC } from '../components/Timestamp'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import { useT } from './i18n'

/**
 * Discord-flavoured markdown → React. Supported:
 *   inline: **bold** *italic* _italic_ ***both*** __underline__ ~~strike~~ `code` ``code`` ||spoiler||
 *           [text](https://url) <https://url> bare URLs, and backslash escapes (\*)
 *   blocks: # ## ### headers, -# subtext, > quote, >>> multi-line quote (headers and lists work inside quotes),
 *           - * + bullets, 1. numbered lists (one level of nesting), | pipe | tables | with a |---| separator row,
 *           ```lang fenced code``` with highlighting (18 languages bundled, ~30 more loaded on first use)
 * Everything is produced as React elements; no HTML strings from user input ever reach the DOM
 * except highlight.js output, which escapes its input.
 */
hljs.registerLanguage('javascript', javascript); hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' })
hljs.registerLanguage('typescript', typescript); hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash); hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerLanguage('python', python); hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerLanguage('rust', rust); hljs.registerAliases(['rs'], { languageName: 'rust' })
hljs.registerLanguage('go', go); hljs.registerAliases(['golang'], { languageName: 'go' })
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp); hljs.registerAliases(['cs', 'c#'], { languageName: 'csharp' })
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp); hljs.registerAliases(['c++', 'cc', 'hpp'], { languageName: 'cpp' })
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml); hljs.registerAliases(['html', 'svg'], { languageName: 'xml' })
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml); hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerLanguage('markdown', markdown); hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerLanguage('diff', diff)

/** Languages bundled as separate chunks and registered the first time a code block asks for them. */
const LAZY_LANGS: Record<string, { label: string; aliases?: string[]; load: () => Promise<{ default: import('highlight.js').LanguageFn }> }> = {
  php: { label: 'PHP', load: () => import('highlight.js/lib/languages/php') },
  ruby: { label: 'Ruby', aliases: ['rb'], load: () => import('highlight.js/lib/languages/ruby') },
  kotlin: { label: 'Kotlin', aliases: ['kt'], load: () => import('highlight.js/lib/languages/kotlin') },
  swift: { label: 'Swift', load: () => import('highlight.js/lib/languages/swift') },
  scala: { label: 'Scala', load: () => import('highlight.js/lib/languages/scala') },
  lua: { label: 'Lua', load: () => import('highlight.js/lib/languages/lua') },
  perl: { label: 'Perl', aliases: ['pl'], load: () => import('highlight.js/lib/languages/perl') },
  r: { label: 'R', load: () => import('highlight.js/lib/languages/r') },
  dart: { label: 'Dart', load: () => import('highlight.js/lib/languages/dart') },
  dockerfile: { label: 'Dockerfile', aliases: ['docker'], load: () => import('highlight.js/lib/languages/dockerfile') },
  nginx: { label: 'nginx', load: () => import('highlight.js/lib/languages/nginx') },
  ini: { label: 'INI / TOML', aliases: ['toml'], load: () => import('highlight.js/lib/languages/ini') },
  powershell: { label: 'PowerShell', aliases: ['ps', 'ps1'], load: () => import('highlight.js/lib/languages/powershell') },
  makefile: { label: 'Makefile', aliases: ['make', 'mk'], load: () => import('highlight.js/lib/languages/makefile') },
  graphql: { label: 'GraphQL', aliases: ['gql'], load: () => import('highlight.js/lib/languages/graphql') },
  haskell: { label: 'Haskell', aliases: ['hs'], load: () => import('highlight.js/lib/languages/haskell') },
  elixir: { label: 'Elixir', aliases: ['ex', 'exs'], load: () => import('highlight.js/lib/languages/elixir') },
  erlang: { label: 'Erlang', aliases: ['erl'], load: () => import('highlight.js/lib/languages/erlang') },
  clojure: { label: 'Clojure', aliases: ['clj'], load: () => import('highlight.js/lib/languages/clojure') },
  objectivec: { label: 'Objective-C', aliases: ['objc', 'objective-c'], load: () => import('highlight.js/lib/languages/objectivec') },
  scss: { label: 'SCSS', aliases: ['sass'], load: () => import('highlight.js/lib/languages/scss') },
  less: { label: 'Less', load: () => import('highlight.js/lib/languages/less') },
  vbnet: { label: 'VB.NET', aliases: ['vb'], load: () => import('highlight.js/lib/languages/vbnet') },
  matlab: { label: 'MATLAB', load: () => import('highlight.js/lib/languages/matlab') },
  julia: { label: 'Julia', aliases: ['jl'], load: () => import('highlight.js/lib/languages/julia') },
  protobuf: { label: 'Protobuf', aliases: ['proto'], load: () => import('highlight.js/lib/languages/protobuf') },
  http: { label: 'HTTP', load: () => import('highlight.js/lib/languages/http') },
  latex: { label: 'LaTeX', aliases: ['tex'], load: () => import('highlight.js/lib/languages/latex') },
  wasm: { label: 'WebAssembly', aliases: ['wat'], load: () => import('highlight.js/lib/languages/wasm') },
}
const lazyLoads = new Map<string, Promise<void>>()
/** Resolve an alias to a lazy language key, or null. */
function lazyKey(lang: string): string | null {
  if (LAZY_LANGS[lang]) return lang
  for (const [k, v] of Object.entries(LAZY_LANGS)) if (v.aliases?.includes(lang)) return k
  return null
}
/** Load and register a lazy language once; resolves when hljs knows it. */
export function ensureLanguage(lang: string): Promise<void> | null {
  const key = lazyKey(lang)
  if (!key || hljs.getLanguage(key)) return null
  let p = lazyLoads.get(key)
  if (!p) {
    p = LAZY_LANGS[key].load().then((m) => { hljs.registerLanguage(key, m.default); if (LAZY_LANGS[key].aliases) hljs.registerAliases(LAZY_LANGS[key].aliases!, { languageName: key }) }).catch(() => { lazyLoads.delete(key) })
    lazyLoads.set(key, p)
  }
  return p
}

export interface MarkdownOptions {
  /** Headers, lists and multi-line quotes; off for compact places like profile bios. */
  blocks?: boolean
}

export function renderMarkdown(src: string, opts: MarkdownOptions = {}): ReactNode {
  const blocks = opts.blocks ?? true
  const out: ReactNode[] = []
  let k = 0
  const key = () => `b${k++}`
  // Fenced code first so nothing inside it is interpreted.
  const parts = src.split(/(```[\s\S]*?```)/g)
  parts.forEach((part) => {
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      let inner = part.slice(3, -3)
      let lang = ''
      const m = /^([a-zA-Z0-9_+#-]*)\n/.exec(inner)
      if (m) { lang = m[1].toLowerCase(); inner = inner.slice(m[0].length) }
      if (inner.endsWith('\n')) inner = inner.slice(0, -1)
      out.push(<CodeBlock key={key()} code={inner} lang={lang} />)
    } else if (part) {
      out.push(...renderLines(part.split('\n'), blocks, key))
    }
  })
  return <>{out}</>
}

type ListItem = { text: string; children: ListItem[]; ordered: boolean }

function renderLines(lines: string[], blocks: boolean, key: () => string): ReactNode[] {
  const out: ReactNode[] = []
  // A <br> separates consecutive plain lines; block elements break on their own.
  let prevPlain = false
  const plain = (node: ReactNode) => { if (prevPlain) out.push(<br key={key()} />); out.push(node); prevPlain = true }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m: RegExpExecArray | null
    if (blocks && (m = /^(#{1,3})\s+(.+)$/.exec(line))) {
      const Tag = (`h${m[1].length}`) as 'h1' | 'h2' | 'h3'
      out.push(<Tag key={key()}>{renderInline(m[2])}</Tag>); prevPlain = false; i++; continue
    }
    // GitHub-style pipe table: a header row, a |---|:--:| separator, then rows. Cells take inline markdown.
    if (blocks && /^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
      const head = cells(line)
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : 'left'))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++ }
      out.push(
        <table key={key()}>
          <thead><tr>{head.map((h, ci) => <th key={ci} style={{ textAlign: align[ci] ?? 'left' }}>{renderInline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, ci) => <td key={ci} style={{ textAlign: align[ci] ?? 'left' }}>{renderInline(r[ci] ?? '')}</td>)}</tr>)}</tbody>
        </table>,
      )
      prevPlain = false; continue
    }
    if (blocks && (m = /^-#\s+(.+)$/.exec(line))) {
      out.push(<span key={key()} className="subtext">{renderInline(m[1])}</span>); prevPlain = false; i++; continue
    }
    if (blocks && /^>>>\s?/.test(line)) {
      const rest = [line.replace(/^>>>\s?/, ''), ...lines.slice(i + 1)]
      out.push(<blockquote key={key()}>{renderLines(rest, true, key)}</blockquote>)
      prevPlain = false; break
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]) && !/^>>>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(<blockquote key={key()}>{renderLines(q, blocks, key)}</blockquote>); prevPlain = false; continue
    }
    if (blocks && /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+\S/.test(line)) {
      const items: ListItem[] = []
      while (i < lines.length && (m = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]))) {
        const item: ListItem = { text: m[3], children: [], ordered: /\d/.test(m[2]) }
        const nested = m[1].length >= 2 && items.length > 0
        if (nested) items[items.length - 1].children.push(item); else items.push(item)
        i++
      }
      out.push(renderList(items, key)); prevPlain = false; continue
    }
    plain(<Fragment key={key()}>{renderInline(line)}</Fragment>)
    i++
  }
  return out
}

function renderList(items: ListItem[], key: () => string): ReactNode {
  const Tag = items[0].ordered ? 'ol' : 'ul'
  return (
    <Tag key={key()}>
      {items.map((it) => (
        <li key={key()}>{renderInline(it.text)}{it.children.length > 0 && renderList(it.children, key)}</li>
      ))}
    </Tag>
  )
}

// Order matters: longer/more specific tokens first.
const INLINE_SRC = [
  '\\\\[\\\\`*_~|#>\\-\\[\\]()<]',             // escape
  '``[^\\n]+?``|`[^`\\n]+`',                    // code (double backtick may contain single ones)
  '\\|\\|[\\s\\S]+?\\|\\|',                     // spoiler
  CUSTOM_TOKEN_SRC,                             // custom emoji <:name:id>
  '<@&?[0-9a-f-]{36}>|<#[0-9a-f-]{36}>',        // user / role / channel mentions
  TIMESTAMP_SRC,                                // <t:unix:style> in the reader's time zone
  '@everyone|@here',
  '\\*\\*\\*(?=\\S)[\\s\\S]+?(?<=\\S)\\*\\*\\*', // bold italic
  '\\*\\*(?=\\S)[\\s\\S]+?(?<=\\S)\\*\\*',      // bold
  '__(?=\\S)[\\s\\S]+?(?<=\\S)__',              // underline
  '~~(?=\\S)[\\s\\S]+?(?<=\\S)~~',              // strike
  '\\*(?=\\S)[^*\\n]+?(?<=\\S)\\*',             // italic
  '(?<![\\w])_(?=\\S)[^_\\n]+?(?<=\\S)_(?![\\w])', // italic (underscore, word-bounded)
  '\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\)', // masked link
  '<https?:\\/\\/[^\\s>]+>',                    // bracketed link
  'https?:\\/\\/[^\\s<]+',                      // bare url
  PICTO_SRC,                                    // unicode emoji (wrapped for the hover tooltip)
].join('|')

export function renderInline(text: string, opts: { noLinks?: boolean } = {}): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  // Fresh regex per call: this recurses and a shared global regex's lastIndex would be clobbered.
  const re = new RegExp(INLINE_SRC, 'gu')
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const t = m[0]
    // Inside a masked link's text, URLs stay plain text: nested anchors would hide the real destination.
    if (opts.noLinks && (/^\[[^\]]+\]\(https?:/.test(t) || /^<https?:\/\//.test(t) || /^https?:\/\//.test(t))) { nodes.push(t); last = m.index + t.length; continue }
    k++
    if (t.startsWith('\\')) nodes.push(t.slice(1))
    else if (t.startsWith('``')) nodes.push(<code key={k}>{t.slice(2, -2)}</code>)
    else if (t.startsWith('`')) nodes.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('||')) nodes.push(<Spoiler key={k}>{renderInline(t.slice(2, -2))}</Spoiler>)
    else if (t.startsWith('<t:')) nodes.push(<Timestamp key={k} token={t} />)
    else if (t.startsWith('<@&')) nodes.push(<RoleMention key={k} id={t.slice(3, -1)} />)
    else if (t.startsWith('<@')) nodes.push(<UserMention key={k} id={t.slice(2, -1)} />)
    else if (t.startsWith('<#')) nodes.push(<ChannelMention key={k} id={t.slice(2, -1)} />)
    else if (t === '@everyone' || t === '@here') nodes.push(<EveryoneMention key={k} kind={t.slice(1) as 'everyone' | 'here'} />)
    else if (t.startsWith('<:') || t.startsWith('<a:')) {
      const c = parseCustom(t)!
      if (t.startsWith('<a:') && !getPrefs().animatedEmoji) nodes.push(<FrozenGif key={k} src={customUrl(c.id)} alt={`:${c.name}:`} title={`:${c.name}:`} className="emoji" data-custom-emoji={c.name} />)
      else nodes.push(<img key={k} src={customUrl(c.id)} alt={`:${c.name}:`} title={`:${c.name}:`} className="emoji" draggable={false} data-custom-emoji={c.name} />)
    }
    else if (t.startsWith('***')) nodes.push(<strong key={k}><em>{renderInline(t.slice(3, -3))}</em></strong>)
    else if (t.startsWith('**')) nodes.push(<strong key={k}>{renderInline(t.slice(2, -2))}</strong>)
    else if (t.startsWith('__')) nodes.push(<u key={k}>{renderInline(t.slice(2, -2))}</u>)
    else if (t.startsWith('~~')) nodes.push(<s key={k}>{renderInline(t.slice(2, -2))}</s>)
    else if (t.startsWith('*') || t.startsWith('_')) nodes.push(<em key={k}>{renderInline(t.slice(1, -1))}</em>)
    else if (t.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(t)!
      nodes.push(<a key={k} href={mm[2]} title={mm[2]} target="_blank" rel="noopener noreferrer">{renderInline(mm[1], { noLinks: true })}</a>)
    } else if (t.startsWith('<')) {
      const url = t.slice(1, -1)
      nodes.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)
    } else if (!/^https?:/.test(t)) {
      nodes.push(<span key={k} className="uemoji" data-emoji={t}>{t}</span>)
    } else {
      // Trailing punctuation is rarely part of a pasted URL.
      const trimmed = t.replace(/[.,;:!?'"]+$/, '').replace(/\)+$/, (p) => (t.includes('(') ? p : ''))
      nodes.push(<a key={k} href={trimmed} target="_blank" rel="noopener noreferrer">{trimmed}</a>)
      if (trimmed.length < t.length) nodes.push(t.slice(trimmed.length))
    }
    last = m.index + t.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function Spoiler({ children }: { children: ReactNode }) {
  const mode = getPrefs().spoilers
  const t = useT()
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(mode === 'always')
  // "On servers I moderate": the message marks itself data-can-moderate when the reader has Manage Messages there.
  useEffect(() => { if (mode === 'moderate' && ref.current?.closest('[data-can-moderate="1"]')) setOpen(true) }, [mode])
  return (
    <span ref={ref} className={`spoiler ${open ? 'open' : ''}`} role="button" tabIndex={0} aria-label={open ? undefined : t('Spoiler')} title={open ? undefined : t('Click to reveal')}
      onClick={(e) => { if (!open) { e.stopPropagation(); setOpen(true) } }}
      onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true) } }}>
      {children}
    </span>
  )
}

const LANG_LABELS: Record<string, string> = { javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', bash: 'Shell', python: 'Python', rust: 'Rust', go: 'Go', java: 'Java', csharp: 'C#', c: 'C', cpp: 'C++', css: 'CSS', xml: 'HTML', sql: 'SQL', yaml: 'YAML', markdown: 'Markdown', diff: 'Diff' }

/** Highlighted HTML for `code` in `lang` (a name or alias), or null when the language isn't loaded/known. */
export function highlightHtml(code: string, lang: string): string | null {
  const name = hljs.getLanguage(lang)?.name
  if (!name) return null
  try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value } catch { return null }
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const t = useT()
  // Lazy languages: render plain first, re-render once the chunk has registered itself.
  const [, bump] = useState(0)
  const pending = lang ? ensureLanguage(lang) : null
  useEffect(() => { let live = true; pending?.then(() => { if (live) bump((n) => n + 1) }); return () => { live = false } }, [pending])
  const name = lang ? hljs.getLanguage(lang)?.name ?? null : null
  const labels: Record<string, string> = { ...LANG_LABELS, ...Object.fromEntries(Object.entries(LAZY_LANGS).map(([k, v]) => [k, v.label])) }
  const canonical = name ? Object.keys(labels).find((l) => hljs.getLanguage(l)?.name === name) ?? null : null
  const html = canonical ? hljs.highlight(code, { language: canonical, ignoreIllegals: true }).value : null
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="codeblock" data-lang={canonical ?? lang ?? ''}>
      <div className="codeblock-head">
        <span>{canonical ? labels[canonical] : lang || t('Code')}</span>
        <button type="button" onClick={copy} title={t('Copy code')} className="codeblock-copy">{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? t('Copied') : t('Copy')}</span></button>
      </div>
      <pre>{html !== null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}</pre>
    </div>
  )
}
