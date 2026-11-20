// The website in every language Parley speaks: runparley.com/ is English, runparley.com/<lang>/ the rest (the app's
// languages, from frontend/src/lib/i18n.ts). Used by scripts/guide-build.mjs, which writes the whole site.
//
// Translations live in docs/i18n/<lang>.json, one map per language from the English text to its translation:
//  - the landing page (docs/site/index.html): every run of text between block tags, with its inline markup
//    (<strong>, <a href=…>, <code>…) kept as it is, plus alt, title, aria-label, placeholder, data-l10n-* and the page's
//    description and share-card text. A translation must keep exactly the same tags and {placeholders};
//  - the guide's own words (menus, buttons, search), listed in GUIDE_UI below.
// docs/i18n/keys.json lists every English string (written by the build), so a missing translation is easy to find;
// the build check fails while any language lacks one. The guide's pages are translated as whole files instead, in
// docs/guide/<lang>/ (see guide-build.mjs).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SITE_ORIGIN = 'https://runparley.com'

/** The app's languages, English first: {id, path, native, dir}. */
export const LANGS = (() => {
  const src = readFileSync(join(ROOT, 'frontend/src/lib/i18n.ts'), 'utf8')
  const list = [...src.matchAll(/\{ id: '([\w-]+)', label: '[^']*', native: '([^']*)' \}/g)].filter((m) => m[1] !== 'system').map((m) => ({ id: m[1], native: m[2] }))
  const rtl = new Set([...(/const RTL = new Set<Resolved>\(\[([^\]]*)\]/.exec(src)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1]))
  return list.map((l) => ({ ...l, path: l.id === 'en' ? '' : l.id.toLowerCase(), dir: rtl.has(l.id) ? 'rtl' : 'ltr' }))
})()
export const OTHER_LANGS = LANGS.filter((l) => l.id !== 'en')

/** A site path ('/guide/messages/') in a language ('/de/guide/messages/'). */
export const pathIn = (lang, path) => (lang.path ? `/${lang.path}${path}` : path)

export function loadStrings(lang) {
  const f = join(ROOT, 'docs/i18n', `${lang.id}.json`)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
}

/** The guide's own words, besides its pages. */
export const GUIDE_UI = [
  'Guide', 'Topics', 'Search the guide  /', 'Search the guide', 'Open Parley', 'Parley user guide', 'All topics', 'Something wrong or missing? Tell us',
  'On this page', 'More topics', 'Previous', 'Next', 'No matches', 'Try other words', 'Parley Guide',
  'How to use Parley, from your first message to running a busy community. Pick a topic, or search with <kbd>/</kbd>.',
  'How to use Parley: servers, channels, messages, voice and video, your profile, settings and running a community.',
  'Tip', 'Note', 'Admins', 'Heads up', 'Language',
  // The offer shown when the reader's browser prefers another language; translated into that language.
  'Read this page in {language}', 'Dismiss',
]

// ---- landing page segments ----
const INLINE = new Set(['a', 'b', 'strong', 'em', 'i', 'code', 'kbd', 'br', 'span', 'small', 'sup', 'sub', 'abbr', 'mark', 's', 'u', 'wbr'])
const VOID = new Set(['br', 'wbr', 'img', 'input', 'meta', 'link', 'hr'])
const ATTRS = /\s(alt|title|aria-label|placeholder|data-l10n-[\w-]+)="([^"]*)"/g
const META_CONTENT = /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/
const hasWords = (s) => /\p{L}/u.test(s.replace(/<[^>]+>/g, '').replace(/&\w+;/g, ''))
export const norm = (s) => s.replace(/\s+/g, ' ').trim()

function tokens(html) {
  const out = []
  const re = /<!--[\s\S]*?-->|<(script|style|svg|textarea|pre)\b[\s\S]*?<\/\1>|<\/?[a-zA-Z][^>]*>|[^<]+/g
  let m
  while ((m = re.exec(html))) {
    const t = m[0]
    const kind = t.startsWith('<!--') || m[1] ? 'raw' : t.startsWith('<') ? 'tag' : 'text'
    const name = kind === 'tag' ? /^<\/?([a-zA-Z][\w-]*)/.exec(t)[1].toLowerCase() : ''
    out.push({ t, kind, name, close: kind === 'tag' && t.startsWith('</'), start: m.index, end: m.index + t.length })
  }
  return out
}

/** Every translatable piece of a page: {start, end, key, kind: 'text'|'attr'}. */
export function segments(html) {
  const toks = tokens(html)
  const segs = []
  // Attributes (and the description and share-card text in <meta content>).
  for (const tk of toks) {
    if (tk.kind !== 'tag' || tk.close) continue
    for (const a of tk.t.matchAll(ATTRS)) if (hasWords(a[2])) segs.push({ kind: 'attr', start: tk.start + a.index + a[0].indexOf('"') + 1, end: tk.start + a.index + a[0].length - 1, key: a[2] })
    if (tk.name === 'meta') {
      const which = /\s(?:name|property)="([^"]+)"/.exec(tk.t)?.[1] ?? ''
      const c = /\scontent="([^"]*)"/.exec(tk.t)
      if (META_CONTENT.test(which) && c && hasWords(c[1])) segs.push({ kind: 'attr', start: tk.start + c.index + c[0].indexOf('"') + 1, end: tk.start + c.index + c[0].length - 1, key: c[1] })
    }
  }
  // Text: runs of text and inline tags, broken by block tags and by line breaks between inline elements.
  let buf = [], depth = 0
  const flush = () => {
    let a = 0, b = buf.length - 1
    const blank = (tk) => tk.kind === 'text' && !tk.t.trim()
    // Tags at either end whose partner is outside the run (`</span>Parley</a>` after an icon) aren't part of it.
    const partnered = (i) => {
      const tk = buf[i]; let d = 0
      if (tk.close) { for (let j = i; j >= a; j--) { const x = buf[j]; if (x.kind === 'tag' && x.name === tk.name) { d += x.close ? 1 : -1; if (d === 0) return true } } }
      else { for (let j = i; j <= b; j++) { const x = buf[j]; if (x.kind === 'tag' && x.name === tk.name) { d += x.close ? -1 : 1; if (d === 0) return true } } }
      return false
    }
    const loose = (i) => buf[i].kind === 'tag' && !VOID.has(buf[i].name) && !partnered(i)
    for (;;) {
      while (a <= b && (blank(buf[a]) || loose(a))) a++
      while (b >= a && (blank(buf[b]) || loose(b))) b--
      if (a >= b) break
      // Peel a wrapper: <a …>inner</a> as the whole run translates as its inner text.
      const first = buf[a], last = buf[b]
      if (first.kind !== 'tag' || first.close || VOID.has(first.name) || !last.close || last.name !== first.name) break
      let d = 0, wraps = true
      for (let i = a; i <= b; i++) { const tk = buf[i]; if (tk.kind === 'tag' && tk.name === first.name && !VOID.has(tk.name)) { d += tk.close ? -1 : 1; if (d === 0 && i < b) { wraps = false; break } } }
      if (!wraps) break
      a++; b--
    }
    const run = buf.slice(a, b + 1)
    buf = []; depth = 0
    if (!run.length || !run.some((tk) => tk.kind === 'text' && hasWords(tk.t))) return
    let start = run[0].start, end = run[run.length - 1].end
    if (run[0].kind === 'text') start += run[0].t.length - run[0].t.trimStart().length
    if (run[run.length - 1].kind === 'text') end -= run[run.length - 1].t.length - run[run.length - 1].t.trimEnd().length
    segs.push({ kind: 'text', start, end, key: norm(html.slice(start, end)) })
  }
  let inHead = true, inTitle = false
  for (const tk of toks) {
    if (tk.kind === 'tag' && tk.name === 'body') { inHead = false; flush(); continue }
    if (tk.kind === 'tag' && tk.name === 'title') { flush(); inTitle = !tk.close; continue }
    if (inHead && !inTitle) continue
    if (tk.kind === 'raw' || (tk.kind === 'tag' && !INLINE.has(tk.name))) { flush(); continue }
    if (tk.kind === 'text' && !tk.t.trim() && tk.t.includes('\n') && depth === 0) { flush(); continue }
    // A close tag at depth 0 belongs to an element that began before this run; it ends the run.
    if (tk.kind === 'tag' && tk.close && depth === 0 && !VOID.has(tk.name)) { flush(); continue }
    // Elements side by side with no text between (table cells, a row of buttons) are separate pieces.
    if (tk.kind === 'tag' && !tk.close && !VOID.has(tk.name) && depth === 0) {
      const prev = [...buf].reverse().find((x) => !(x.kind === 'text' && !x.t.trim()))
      if (prev?.kind === 'tag' && prev.close) flush()
    }
    if (tk.kind === 'tag' && !VOID.has(tk.name)) depth += tk.close ? -1 : 1
    buf.push(tk)
  }
  flush()
  return segs.sort((x, y) => x.start - y.start)
}

const tagsOf = (s) => (s.match(/<[^>]+>/g) ?? []).sort().join('\n')
const varsOf = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
/** Why a translation can't stand in for its English, or ''. */
export function badTranslation(key, value) {
  if (typeof value !== 'string' || !value.trim()) return 'is empty'
  if (tagsOf(key) !== tagsOf(value)) return `must keep the same markup (${(key.match(/<[^>]+>/g) ?? []).join(' ') || 'none'})`
  if (varsOf(key) !== varsOf(value)) return `must keep the same placeholders (${varsOf(key) || 'none'})`
  return ''
}

/** The page with its translatable pieces replaced; missing ones stay English and are listed. */
export function translateHtml(html, strings) {
  const missing = []
  let out = html
  for (const s of segments(html).reverse()) {
    const v = strings[s.key]
    if (v === undefined || badTranslation(s.key, v)) { missing.push(s.key); continue }
    out = out.slice(0, s.start) + (s.kind === 'attr' ? v.replace(/"/g, '&quot;') : v) + out.slice(s.end)
  }
  return { html: out, missing }
}

// ---- shared chrome: language menu, alternates, the "read this in …" offer ----
export function alternates(path) {
  return [...LANGS.map((l) => `<link rel="alternate" hreflang="${l.id}" href="${SITE_ORIGIN}${pathIn(l, path)}">`), `<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${path}">`].join('\n')
}

export const LANG_CSS = `
:lang(ja) { word-break: auto-phrase; line-break: strict; }
:lang(ko) { word-break: keep-all; }
.langs { position:relative; }
.langs summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:.4rem; height:2.4rem; padding-inline:.75rem; border:1px solid var(--rule); border-radius:999px; color:var(--muted); font-size:.875rem; white-space:nowrap; }
.langs summary::-webkit-details-marker { display:none; }
.langs summary:hover, .langs[open] summary { color:var(--text); border-color:var(--faint); }
.langs summary svg { width:16px; height:16px; }
@media (max-width: 1100px) { .nav .langs summary .name { display:none; } }
.langs .list { position:absolute; inset-inline-end:0; top:calc(100% + 8px); z-index:40; min-width:190px; max-height:min(70vh, 460px); overflow:auto; padding:6px; background:var(--panel); border:1px solid var(--rule); border-radius:12px; box-shadow:0 20px 50px #0009; display:grid; }
footer .langs .list { top:auto; bottom:calc(100% + 8px); }
.langs .list a { padding:.45rem .7rem; border-radius:8px; color:var(--text); text-decoration:none; font-size:.92rem; }
.langs .list a:hover { background:var(--panel-2); }
.langs .list a[aria-current] { color:var(--violet); }
.lang-offer { position:fixed; inset-inline:max(16px, env(safe-area-inset-left, 0px)) max(16px, env(safe-area-inset-right, 0px)); bottom:max(16px, env(safe-area-inset-bottom, 0px)); z-index:50; margin-inline:auto; width:fit-content; max-width:calc(100% - 32px); display:flex; align-items:center; gap:.75rem; padding:.6rem .6rem .6rem 1rem; background:var(--panel-2); border:1px solid var(--rule); border-radius:999px; box-shadow:0 20px 50px #000a; font-size:.92rem; }
.lang-offer a { color:#fff; font-weight:600; text-decoration:none; background:var(--violet); border-radius:999px; padding:.35rem .9rem; }
.lang-offer button { background:none; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:1.1rem; line-height:1; padding:.2rem .45rem; }
`

const GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
/** The language menu for a page at `path` (its English path), shown in `lang`. */
export function langMenu(lang, path, label) {
  return `<details class="langs"><summary aria-label="${label}">${GLOBE}<span class="name">${lang.native}</span></summary><div class="list">${LANGS.map((l) => `<a href="${pathIn(l, path)}" hreflang="${l.id}" lang="${l.id}" data-lang="${l.id}"${l.id === lang.id ? ' aria-current="true"' : ''}>${l.native}</a>`).join('')}</div></details>`
}

/** Remembers a language picked from the menu, and offers the reader's own language once (until they pick or dismiss).
 *  `offers` is {lang id: [text, dismiss label]} in each language. */
export function langScript(lang, path, offers) {
  const paths = Object.fromEntries(LANGS.map((l) => [l.id, pathIn(l, path)]))
  return `(() => {
  const KEY = 'parley.site-lang', here = ${JSON.stringify(lang.id)}, paths = ${JSON.stringify(paths)}, offers = ${JSON.stringify(offers)}
  const get = () => { try { return localStorage.getItem(KEY) } catch { return null } }
  const set = (v) => { try { localStorage.setItem(KEY, v) } catch {} }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.langs a[data-lang]'); if (a) set(a.dataset.lang)
    document.querySelectorAll('.langs[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false })
  })
  if (get()) return
  const ids = Object.keys(paths)
  const want = (navigator.languages || [navigator.language]).map((x) => { x = (x || '').toLowerCase(); return ids.find((id) => id.toLowerCase() === x) || ids.find((id) => x.split('-')[0] === id.toLowerCase().split('-')[0]) }).find(Boolean)
  if (!want || want === here || !offers[want]) return
  const bar = document.createElement('div'); bar.className = 'lang-offer'; bar.lang = want; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', offers[want][0])
  const go = document.createElement('a'); go.href = paths[want]; go.textContent = offers[want][0]; go.addEventListener('click', () => set(want))
  const no = document.createElement('button'); no.type = 'button'; no.textContent = '\\u00d7'; no.title = no.ariaLabel = offers[want][1]; no.addEventListener('click', () => { set(here); bar.remove() })
  bar.append(go, no); document.body.append(bar)
})()`
}

/** {lang id: [offer text, dismiss]} for every language, each in its own words. */
export function offerTexts() {
  const out = {}
  for (const l of LANGS) {
    const s = l.id === 'en' ? {} : loadStrings(l)
    const text = s['Read this page in {language}'] ?? (l.id === 'en' ? 'Read this page in {language}' : null)
    if (text) out[l.id] = [text.replace('{language}', l.native), s.Dismiss ?? 'Dismiss']
  }
  return out
}
