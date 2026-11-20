#!/usr/bin/env node
// The user guide: docs/guide/*.md (one page each, front matter below) built into static pages under website/guide,
// served at runparley.com/guide. Pages are for people using Parley, not for developers: see docs/guide/README.md.
//
//   ---
//   title: Messages              page title (and sidebar entry)
//   section: Talking             sidebar group; groups appear in the order of their first page
//   order: 30                    position, lowest first
//   summary: One line for the guide's front page and search.
//   covers:                      source files this page describes (globs). A feat/fix/perf commit touching them must
//     - frontend/src/components/Composer*.tsx   update the guide too (scripts/guide-check.mjs).
//   ---
//
// Markdown: ## and ### headings (anchored), paragraphs, - and 1. lists (nested by two spaces), **bold**, *italic*,
// `code`, [links](other-page#anchor) to guide pages or full URLs, <kbd>Ctrl</kbd>, tables, > Tip:/Note:/Admins: callouts,
// and screenshots as ![alt](shot:name) taken by frontend/e2e/guide-shots.mjs into website/guide/shots/name.png.
//
// The same build writes the whole website, in every language the app speaks (scripts/site-i18n.mjs): the landing
// page from docs/site/index.html (to website/index.html and website/<lang>/index.html, with docs/i18n/<lang>.json),
// and the guide in each language from docs/guide/<lang>/<page>.md. A translated page has the English page's front
// matter fields title, section and summary translated, plus `source:`, the English page's version it was translated
// from (`node scripts/guide-build.mjs --sources` lists them). It keeps the English page's headings in the same order
// and levels (they keep the English anchors, so links and the app's Help buttons work in every language), the same
// links (written as in English: [text](page#heading)), the same screenshots, and `> Tip:`-style callouts with the
// English keyword. Every page in every language must be current: the check fails when an English page changes until
// all its translations are updated.
//
//   node scripts/guide-build.mjs                 write website/ (landing pages, guides, sitemap)
//   node scripts/guide-build.mjs --check         exit 1 if website/ is out of date, a translation is missing or out of
//                                                date, a link or shot is missing, or the app links to a guide page or
//                                                heading that doesn't exist
//   node scripts/guide-build.mjs --check --lang de   the same, reporting only problems with one language's files
//   node scripts/guide-build.mjs --sources       each English page's version, for `source:` in its translations
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUIDE_UI, LANGS, LANG_CSS, OTHER_LANGS, SITE_ORIGIN, alternates, badTranslation, langMenu, langScript, loadStrings, offerTexts, pathIn, segments, translateHtml } from './site-i18n.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/guide')
const WEB = join(ROOT, 'website')
const OUT = join(WEB, 'guide')
const check = process.argv.includes('--check')
const onlyLang = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : null
const problems = []
/** A problem with one language's files (shown with --lang for that language only). */
const problem = (lang, text) => { if (!onlyLang || onlyLang === lang) problems.push(lang === 'en' ? text : `[${lang}] ${text}`) }

// ---- front matter and pages ----
export function parseFront(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!m) throw new Error(`${file}: no front matter`)
  const meta = {}
  let list = null
  for (const line of m[1].split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && list) { list.push(item[1].trim()); continue }
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (!kv) continue
    if (kv[2] === '') { list = meta[kv[1]] = []; continue }
    list = null
    meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: text.slice(m[0].length) }
}

export function loadPages(dir = SRC) {
  return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => {
    const { meta, body } = parseFront(readFileSync(join(dir, f), 'utf8'), f)
    for (const k of ['title', 'section', 'order', 'summary']) if (!meta[k]) throw new Error(`${f}: front matter needs ${k}`)
    return { slug: f.slice(0, -3), file: `docs/guide/${f}`, ...meta, order: Number(meta.order), covers: meta.covers ?? [], body }
  }).sort((a, b) => a.order - b.order)
}

// ---- Markdown ----
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&\w+;/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

function inline(s, ctx) {
  const codes = []
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000` })
  s = esc(s).replace(/&lt;(\/?)kbd&gt;/g, '<$1kbd>')
  s = s.replace(/!\[([^\]]*)\]\(shot:([\w-]+)\)/g, (_, alt, name) => { ctx.shots.add(name); return `<img class="shot" src="/guide/shots/${name}.png" alt="${alt}" loading="lazy">` })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    if (/^https?:/.test(href)) return `<a href="${href}" rel="noopener">${text}</a>`
    const [page, hash] = href.split('#')
    ctx.links.push({ page: page || ctx.slug, hash })
    return `<a href="${ctx.prefix ?? ''}/guide/${page || ctx.slug}/${hash ? `#${hash}` : ''}">${text}</a>`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i])
}

export function render(md, ctx) {
  const lines = md.replace(/\r/g, '').split('\n')
  const html = []
  let para = []
  const flush = () => { if (para.length) html.push(`<p>${inline(para.join(' '), ctx)}</p>`); para = [] }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = /^(#{2,3})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length
      const text = inline(h[2], ctx)
      // A translation's headings take the English page's anchors, in order.
      const en = ctx.enHeadings?.[ctx.headings.length]
      if (ctx.enHeadings && (!en || en.level !== level)) problem(ctx.lang, `${ctx.file}: heading "${h[2]}" doesn't match the English page's ${en ? `h${en.level}` : 'headings'} (keep the same headings, in the same order and levels)`)
      const id = en?.id ?? slugify(h[2])
      ctx.headings.push({ level, id, raw: h[2] })
      if (ctx.ids.has(id)) problem(ctx.lang ?? 'en', `${ctx.slug}: two headings make #${id}`)
      ctx.ids.add(id)
      if (level === 2) ctx.toc.push({ id, text })
      ctx.text.push(h[2])
      html.push(`<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>`)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      flush()
      const items = []
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (m) items.push({ depth: Math.floor(m[1].length / 2), ordered: /\d/.test(m[2]), text: m[3] })
        else items[items.length - 1].text += ` ${lines[i].trim()}`
        i++
      }
      i--
      const out = []
      const stack = []
      for (const it of items) {
        while (stack.length > it.depth + 1) out.push(`</li></${stack.pop()}>`)
        if (stack.length < it.depth + 1) { const tag = it.ordered ? 'ol' : 'ul'; stack.push(tag); out.push(`<${tag}><li>`) } else out.push('</li><li>')
        out.push(inline(it.text, ctx))
        ctx.text.push(it.text)
      }
      while (stack.length) out.push(`</li></${stack.pop()}>`)
      html.push(out.join(''))
      continue
    }
    if (/^\|/.test(line)) {
      flush()
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++].replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      i--
      const [head, , ...body] = rows
      for (const r of rows) ctx.text.push(r.join(' '))
      html.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      flush()
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      i--
      const kind = /^(Tip|Note|Admins|Heads up):/.exec(quote[0])
      const text = quote.join(' ')
      ctx.text.push(text)
      html.push(`<aside class="callout ${kind ? slugify(kind[1]) : 'note'}">${kind ? `<b>${esc(ctx.u ? ctx.u(kind[1]) : kind[1])}</b> ` : ''}${inline(kind ? text.slice(kind[0].length).trim() : text, ctx)}</aside>`)
      continue
    }
    const shot = /^!\[([^\]]*)\]\(shot:([\w-]+)\)$/.exec(line.trim())
    if (shot) {
      flush()
      ctx.shots.add(shot[2])
      html.push(`<figure><img class="shot" src="/guide/shots/${shot[2]}.png" alt="${esc(shot[1])}" loading="lazy"><figcaption>${esc(shot[1])}</figcaption></figure>`)
      continue
    }
    if (line.trim() === '') { flush(); continue }
    if (/^#\s/.test(line)) { problem(ctx.lang ?? 'en', `${ctx.slug}: use the title in front matter, not a # heading`); continue }
    para.push(line.trim())
    ctx.text.push(line.trim())
  }
  flush()
  return html.join('\n')
}

// ---- layout ----
const SITE = readFileSync(join(ROOT, 'docs/site/index.html'), 'utf8')
const ICON = SITE.match(/<link rel="icon"[^>]*>/)[0]
const MARK = SITE.match(/<span class="mark" aria-hidden="true">(<svg[\s\S]*?<\/svg>)<\/span>/)[1]
const CSS = `
:root { --ink:#07070c; --panel:#10101a; --panel-2:#171726; --rule:#24233a; --text:#ecebff; --muted:#9a98b8; --faint:#5f5d7d; --violet:#7b6cff; --signal:#3ccf7d; --hot:#f0506e; --warn:#f5b94a;
  --display:"Unbounded","Arial Black",system-ui,sans-serif; --body:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; --mono:"Geist Mono",ui-monospace,Menlo,Consolas,monospace; color-scheme:dark; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:80px; }
body { margin:0; background:var(--ink); color:var(--text); font:400 1rem/1.65 var(--body); -webkit-font-smoothing:antialiased; }
a { color:var(--violet); }
:focus-visible { outline:2px solid var(--violet); outline-offset:3px; border-radius:4px; }
.wrap { max-width:1240px; margin-inline:auto; padding-inline:max(16px, env(safe-area-inset-left, 0px)); }
@media (min-width:720px) { .wrap { padding-inline:32px; } }
.nav { position:sticky; top:0; z-index:20; backdrop-filter:blur(14px); background:color-mix(in srgb, var(--ink) 80%, transparent); border-bottom:1px solid var(--rule); }
.nav .wrap { display:flex; align-items:center; gap:1rem; height:60px; }
.brand { display:flex; align-items:center; gap:.55rem; font:900 1rem/1 var(--display); color:var(--text); text-decoration:none; }
.brand .mark { width:26px; height:26px; color:var(--violet); display:grid; } .brand .mark svg { width:100%; height:100%; }
.brand small { font:500 .8rem/1 var(--mono); color:var(--muted); letter-spacing:.1em; text-transform:uppercase; }
.nav .grow { flex:1; }
.btn { display:inline-flex; align-items:center; height:2.4rem; padding-inline:1rem; border-radius:999px; font:600 .9rem/1 var(--body); text-decoration:none; background:var(--violet); color:#fff; white-space:nowrap; }
.menu { display:none; background:none; border:1px solid var(--rule); color:var(--text); border-radius:8px; height:2.4rem; padding-inline:.8rem; font:inherit; }
.search { position:relative; width:min(320px, 100%); }
.search input { width:100%; height:2.4rem; border-radius:10px; border:1px solid var(--rule); background:var(--panel); color:var(--text); padding:0 .8rem; font:inherit; }
.results { position:absolute; top:calc(100% + 6px); left:0; right:0; min-width:300px; max-height:70vh; overflow:auto; background:var(--panel); border:1px solid var(--rule); border-radius:12px; padding:6px; display:none; box-shadow:0 20px 50px #0008; }
.results.open { display:block; }
.results a { display:block; padding:.5rem .65rem; border-radius:8px; color:var(--text); text-decoration:none; }
.results a:hover, .results a.sel { background:var(--panel-2); }
.results small { display:block; color:var(--muted); font-size:.8rem; }
.layout { display:grid; grid-template-columns:240px minmax(0,1fr) 200px; gap:40px; padding-block:32px 80px; }
.side { position:sticky; top:84px; align-self:start; max-height:calc(100vh - 100px); overflow:auto; font-size:.92rem; }
.side h4 { margin:1.2rem 0 .3rem; font:500 .72rem/1 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--faint); }
.side h4:first-child { margin-top:0; }
.side a { display:block; padding:.3rem .6rem; border-radius:8px; color:var(--muted); text-decoration:none; }
.side a:hover { color:var(--text); background:var(--panel); }
.side a[aria-current] { color:var(--text); background:var(--panel-2); }
.toc { position:sticky; top:84px; align-self:start; font-size:.85rem; }
.toc b { display:block; font:500 .72rem/1 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin-bottom:.6rem; }
.toc a { display:block; color:var(--muted); text-decoration:none; padding:.2rem 0; } .toc a:hover { color:var(--text); }
article { min-width:0; max-width:760px; }
article h1 { font:700 clamp(1.9rem, 4vw, 2.6rem)/1.1 var(--display); letter-spacing:-.02em; margin:0 0 .6rem; }
article .lede { color:var(--muted); font-size:1.15rem; margin:0 0 2rem; }
article h2 { font:700 1.35rem/1.25 var(--display); margin:2.6rem 0 .8rem; padding-top:.4rem; }
article h3 { font:600 1.08rem/1.3 var(--body); margin:1.8rem 0 .5rem; }
.anchor { float:left; margin-left:-1.1em; width:1.1em; color:var(--faint); text-decoration:none; opacity:0; }
h2:hover .anchor, h3:hover .anchor { opacity:1; }
article p, article ul, article ol { margin:0 0 1rem; } article li { margin:.25rem 0; } article li > ul, article li > ol { margin:.25rem 0 0; }
code { font:.88em var(--mono); background:var(--panel-2); border:1px solid var(--rule); border-radius:6px; padding:.08em .35em; }
kbd { font:600 .8em var(--mono); background:var(--panel-2); border:1px solid var(--rule); border-bottom-width:2px; border-radius:6px; padding:.1em .45em; white-space:nowrap; }
strong { color:#fff; }
.callout { margin:0 0 1.2rem; padding:.85rem 1rem; border-radius:12px; border:1px solid var(--rule); border-left:3px solid var(--violet); background:var(--panel); }
.callout.tip { border-left-color:var(--signal); } .callout.heads-up { border-left-color:var(--warn); } .callout.admins { border-left-color:var(--hot); }
.callout b { font:600 .72rem/1 var(--mono); letter-spacing:.12em; text-transform:uppercase; margin-right:.4rem; }
.table { overflow-x:auto; margin:0 0 1.2rem; border:1px solid var(--rule); border-radius:12px; }
table { border-collapse:collapse; width:100%; font-size:.93rem; } th, td { text-align:left; padding:.55rem .8rem; border-bottom:1px solid var(--rule); vertical-align:top; }
th { background:var(--panel); font-weight:600; } tr:last-child td { border-bottom:0; }
figure { margin:0 0 1.4rem; } figcaption { color:var(--faint); font-size:.85rem; margin-top:.4rem; text-align:center; }
img.shot { display:block; max-width:100%; height:auto; border-radius:12px; border:1px solid var(--rule); box-shadow:0 20px 60px -20px #000c; }
p img.shot { display:inline-block; vertical-align:middle; }
.pager { display:flex; gap:12px; margin-top:3rem; } .pager a { flex:1; border:1px solid var(--rule); border-radius:12px; padding:.8rem 1rem; text-decoration:none; color:var(--text); background:var(--panel); }
.pager a:hover { border-color:var(--faint); } .pager small { display:block; color:var(--muted); font-size:.78rem; } .pager .next { text-align:right; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px; margin:0 0 2rem; }
.cards a { display:block; padding:1rem 1.1rem; border:1px solid var(--rule); border-radius:14px; background:var(--panel); color:var(--text); text-decoration:none; }
.cards a:hover { border-color:var(--violet); } .cards span { display:block; color:var(--muted); font-size:.9rem; margin-top:.2rem; }
.group { font:500 .75rem/1 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:var(--violet); margin:2rem 0 .8rem; }
footer { border-top:1px solid var(--rule); color:var(--faint); font-size:.85rem; padding-block:24px; }
footer .wrap { display:flex; flex-wrap:wrap; gap:1rem; } footer a { color:var(--muted); }
@media (max-width:1100px) { .layout { grid-template-columns:220px minmax(0,1fr); } .toc { display:none; } }
@media (max-width:760px) {
  .layout { grid-template-columns:minmax(0,1fr); padding-top:20px; }
  .menu { display:inline-flex; align-items:center; }
  .side { display:none; position:fixed; inset:60px 0 0; max-height:none; top:60px; z-index:15; background:var(--ink); padding:16px; }
  .side.open { display:block; }
  .nav .btn, .brand small { display:none; }
  .search { width:auto; flex:1; min-width:0; }
  .nav .grow { display:none; }
  .anchor { display:none; }
}
[dir="rtl"] .anchor { float:right; margin-left:0; margin-right:-1.1em; }
[dir="rtl"] th, [dir="rtl"] td { text-align:right; }
.nav .langs summary { height:2.4rem; }
@media (max-width:760px) { .nav .langs summary { padding-inline:.6rem; font-size:0; gap:0; } .nav .langs summary svg { width:18px; height:18px; } }
${LANG_CSS}`

const script = (prefix, u) => `
(() => {
  const menu = document.querySelector('.menu'), side = document.querySelector('.side')
  menu?.addEventListener('click', () => { const o = side.classList.toggle('open'); menu.setAttribute('aria-expanded', o) })
  const input = document.getElementById('q'), box = document.getElementById('results')
  let index = null, sel = -1
  const load = () => index ?? fetch('${prefix}/guide/search.json').then((r) => r.json()).then((d) => (index = d))
  const show = async () => {
    const q = input.value.trim().toLowerCase()
    if (!q) { box.classList.remove('open'); return }
    const words = q.split(/\\s+/)
    const data = await load()
    const hits = []
    for (const p of data) for (const s of p.parts) {
      const hay = (s.title + ' ' + s.text).toLowerCase()
      if (!words.every((w) => hay.includes(w))) continue
      let score = 0
      for (const w of words) score += (s.title.toLowerCase().includes(w) ? 5 : 0) + (p.title.toLowerCase().includes(w) ? 3 : 0) + 1
      hits.push({ score, href: '${prefix}/guide/' + p.slug + '/' + (s.id ? '#' + s.id : ''), title: s.title, where: s.id ? p.title : p.section })
    }
    hits.sort((a, b) => b.score - a.score)
    sel = -1
    box.innerHTML = hits.length ? hits.slice(0, 12).map((h) => '<a href="' + h.href + '">' + h.title.replace(/</g, '&lt;') + '<small>' + h.where + '</small></a>').join('') : ${JSON.stringify(`<a aria-disabled="true">${esc(u('No matches'))}<small>${esc(u('Try other words'))}</small></a>`)}
    box.classList.add('open')
  }
  input?.addEventListener('input', show)
  input?.addEventListener('focus', show)
  input?.addEventListener('keydown', (e) => {
    const links = [...box.querySelectorAll('a[href]')]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, i) => l.classList.toggle('sel', i === sel)) }
    if (e.key === 'Enter' && links.length) location.href = links[Math.max(sel, 0)].href
    if (e.key === 'Escape') { box.classList.remove('open'); input.blur() }
  })
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus() } })
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.classList.remove('open') })
})()`

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Geist:wght@400;600&family=Geist+Mono:wght@500&display=swap">'

function shell({ lang, u, title, description, path, side, main, toc = '' }) {
  const prefix = pathIn(lang, '')
  return `<!doctype html>
<html lang="${lang.id}" dir="${lang.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#07070c">
<link rel="canonical" href="${SITE_ORIGIN}${pathIn(lang, path)}">
${alternates(path)}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta property="og:locale" content="${lang.id.replace('-', '_')}">
${ICON}
${FONTS}
<style>${CSS}</style>
</head>
<body>
<header class="nav"><div class="wrap">
<a class="brand" href="${pathIn(lang, '/')}"><span class="mark" aria-hidden="true">${MARK}</span>Parley <small>${esc(u('Guide'))}</small></a>
<button class="menu" aria-controls="side" aria-expanded="false">${esc(u('Topics'))}</button>
<div class="grow"></div>
<div class="search" role="search"><input id="q" type="search" placeholder="${esc(u('Search the guide  /'))}" aria-label="${esc(u('Search the guide'))}" autocomplete="off"><div class="results" id="results"></div></div>
${langMenu(lang, path, esc(u('Language')))}
<a class="btn" href="https://app.runparley.com">${esc(u('Open Parley'))}</a>
</div></header>
<div class="wrap layout">
<nav class="side" id="side" aria-label="${esc(u('Guide'))}">${side}</nav>
${main}
${toc}
</div>
<footer><div class="wrap"><span>${esc(u('Parley user guide'))}</span><a href="${pathIn(lang, '/')}">runparley.com</a><a href="${prefix}/guide/">${esc(u('All topics'))}</a><a href="https://github.com/ParleyDev/parley/issues">${esc(u('Something wrong or missing? Tell us'))}</a></div></footer>
<script>${script(prefix, u)}</script>
<script>${langScript(lang, path, OFFERS)}</script>
</body>
</html>
`
}

function sidebar(pages, current, prefix) {
  const out = []
  let group = null
  for (const p of pages) {
    if (p.section !== group) { group = p.section; out.push(`<h4>${esc(group)}</h4>`) }
    out.push(`<a href="${prefix}/guide/${p.slug}/"${p.slug === current ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`)
  }
  return out.join('')
}

// ---- build ----
/** An English page's version: what its translations record in `source:` (front matter covers and order don't count). */
export const sourceOf = (p) => createHash('sha256').update([p.title, p.section, p.summary, p.body].join('\n')).digest('hex').slice(0, 12)

/** A language's pages: English, or each English page's translation (order and covers stay the English page's). */
function pagesIn(lang, en) {
  if (lang.id === 'en') return en
  const dir = join(SRC, lang.id)
  return en.map((e) => {
    const file = `docs/guide/${lang.id}/${e.slug}.md`
    if (!existsSync(join(dir, `${e.slug}.md`))) { problem(lang.id, `${file} is missing: translate docs/guide/${e.slug}.md`); return { ...e, missing: true } }
    const { meta, body } = parseFront(readFileSync(join(dir, `${e.slug}.md`), 'utf8'), file)
    for (const k of ['title', 'section', 'summary', 'source']) if (!meta[k]) problem(lang.id, `${file}: front matter needs ${k}`)
    if (meta.source !== sourceOf(e)) problem(lang.id, `${file} is out of date: docs/guide/${e.slug}.md changed since it was translated (source: ${meta.source}, now ${sourceOf(e)}). Update the translation and its source:`)
    return { ...e, file, title: meta.title ?? e.title, section: meta.section ?? e.section, summary: meta.summary ?? e.summary, body }
  })
}

function buildGuide(lang, en, strings, enHeadings) {
  const pages = pagesIn(lang, en)
  const prefix = pathIn(lang, '')
  const u = (k) => (lang.id === 'en' ? k : strings[k] ?? k)
  const files = new Map()
  const search = []
  const ids = new Map()
  const allLinks = []
  const shots = new Set()
  for (const p of pages) {
    const ctx = { lang: lang.id, file: p.file, slug: p.slug, prefix, u, ids: new Set(), toc: [], text: [], links: [], shots: new Set(), headings: [], enHeadings: lang.id === 'en' ? null : enHeadings.get(p.slug) }
    p.html = render(p.body, ctx)
    p.toc = ctx.toc
    if (lang.id === 'en') enHeadings.set(p.slug, ctx.headings)
    else if (!p.missing && ctx.headings.length !== ctx.enHeadings.length) problem(lang.id, `${p.file}: has ${ctx.headings.length} headings, the English page ${ctx.enHeadings.length}`)
    else if (!p.missing && ctx.headings.length >= 3 && ctx.headings.every((h, i) => h.raw === ctx.enHeadings[i]?.raw)) problem(lang.id, `${p.file}: every heading is still in English (translate them; the build keeps the English anchors)`)
    ids.set(p.slug, ctx.ids)
    allLinks.push(...ctx.links.map((l) => ({ ...l, from: p.slug })))
    for (const s of ctx.shots) shots.add(s)
    if (lang.id !== 'en' && !p.missing) {
      const enCtx = { slug: p.slug, ids: new Set(), toc: [], text: [], links: [], shots: new Set(), headings: [] }
      render(en.find((e) => e.slug === p.slug).body, enCtx)
      const key = (ls) => ls.map((l) => `${l.page}#${l.hash ?? ''}`).sort().join(' ')
      if (key(ctx.links) !== key(enCtx.links)) problem(lang.id, `${p.file}: links differ from the English page's (keep every [text](page#heading) link, with the same targets)`)
      if ([...ctx.shots].sort().join() !== [...enCtx.shots].sort().join()) problem(lang.id, `${p.file}: screenshots differ from the English page's`)
    }
    // Search: the page, then each ## section with its text.
    const parts = [{ id: '', title: p.title, text: p.summary }]
    let cur = parts[0], n = 0
    for (const line of p.body.split('\n')) {
      const h = /^#{2,3}\s+(.*)$/.exec(line)
      if (h) { cur = { id: ctx.headings[n++]?.id ?? slugify(h[1]), title: h[1].replace(/[*`]/g, ''), text: '' }; parts.push(cur); continue }
      if (/^!\[/.test(line)) continue
      cur.text += ' ' + line.replace(/[*`#>|]/g, '').replace(/\]\([^)]*\)/g, ']').replace(/<\/?kbd>/g, '').replace(/[[\]]/g, '').trim()
    }
    search.push({ slug: p.slug, title: p.title, section: p.section, parts: parts.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim().slice(0, 1200) })) })
  }
  if (lang.id === 'en') {
    for (const l of allLinks) {
      if (!ids.has(l.page)) problems.push(`${l.from}: links to missing page ${l.page}`)
      else if (l.hash && !ids.get(l.page).has(l.hash)) problems.push(`${l.from}: links to missing heading ${l.page}#${l.hash}`)
    }
    for (const s of shots) if (!existsSync(join(OUT, 'shots', `${s}.png`))) problems.push(`screenshot shots/${s}.png is missing: run node frontend/e2e/guide-shots.mjs`)
  }

  const base = lang.path ? `${lang.path}/guide` : 'guide'
  pages.forEach((p, i) => {
    const prev = pages[i - 1], next = pages[i + 1]
    const pager = `<nav class="pager" aria-label="${esc(u('More topics'))}">${prev ? `<a href="${prefix}/guide/${prev.slug}/"><small>${esc(u('Previous'))}</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${prefix}/guide/${next.slug}/"><small>${esc(u('Next'))}</small>${esc(next.title)}</a>` : '<span></span>'}</nav>`
    const main = `<article><h1>${esc(p.title)}</h1><p class="lede">${inline(p.summary, { slug: p.slug, prefix, links: [], shots: new Set() })}</p>\n${p.html}\n${pager}</article>`
    const toc = p.toc.length > 1 ? `<nav class="toc" aria-label="${esc(u('On this page'))}"><b>${esc(u('On this page'))}</b>${p.toc.map((t) => `<a href="#${t.id}">${t.text.replace(/<[^>]+>/g, '')}</a>`).join('')}</nav>` : '<span></span>'
    files.set(`${base}/${p.slug}/index.html`, shell({ lang, u, title: `${p.title} · ${u('Parley Guide')}`, description: p.summary, path: `/guide/${p.slug}/`, side: sidebar(pages, p.slug, prefix), main, toc }))
  })

  const groups = []
  for (const p of pages) { let g = groups.find((x) => x.name === p.section); if (!g) groups.push(g = { name: p.section, pages: [] }); g.pages.push(p) }
  const home = `<article><h1>${esc(u('Parley Guide'))}</h1><p class="lede">${u('How to use Parley, from your first message to running a busy community. Pick a topic, or search with <kbd>/</kbd>.')}</p>
${groups.map((g) => `<div class="group">${esc(g.name)}</div><div class="cards">${g.pages.map((p) => `<a href="${prefix}/guide/${p.slug}/">${esc(p.title)}<span>${esc(p.summary.replace(/[*`]/g, ''))}</span></a>`).join('')}</div>`).join('\n')}</article>`
  files.set(`${base}/index.html`, shell({ lang, u, title: u('Parley Guide'), description: u('How to use Parley: servers, channels, messages, voice and video, your profile, settings and running a community.'), path: '/guide/', side: sidebar(pages, '', prefix), main: home, toc: '<span></span>' }))
  files.set(`${base}/search.json`, JSON.stringify(search) + '\n')
  return { pages, files, ids }
}

/** The landing page in a language: docs/site/index.html with its text translated, links kept in that language, its
 *  alternates and the language menu. */
function buildLanding(lang, strings) {
  let html = SITE
  if (lang.id !== 'en') {
    const r = translateHtml(SITE, strings)
    html = r.html
    for (const k of new Set(r.missing)) problem(lang.id, `docs/i18n/${lang.id}.json: the landing page's ${JSON.stringify(k.length > 90 ? k.slice(0, 90) + '…' : k)} has no translation${strings[k] !== undefined ? ` that works (${badTranslation(k, strings[k])})` : ''}`)
    html = html.replace(/<html lang="en">/, `<html lang="${lang.id}" dir="${lang.dir}">`)
      .replace(/(href|content)="https:\/\/runparley\.com\/"/g, `$1="${SITE_ORIGIN}${pathIn(lang, '/')}"`)
      .replace(/href="\/(guide\/[^"]*)?"/g, (_, rest) => `href="${pathIn(lang, '/')}${rest ?? ''}"`)
      .replace(/<meta property="og:url"/, `<meta property="og:locale" content="${lang.id.replace('-', '_')}">\n<meta property="og:url"`)
  }
  const u = (k) => (lang.id === 'en' ? k : strings[k] ?? k)
  return html.replace('</head>', `${alternates('/')}\n<style>${LANG_CSS}\n.nav .langs summary { height:2.4rem; } footer .langs { margin-inline-start:auto; } @media (max-width:900px) { .nav .langs { margin-inline-start:auto; } .nav .langs ~ .open { margin-left:0; } }</style>\n</head>`)
    .replaceAll('<!--parley:langs-->', langMenu(lang, '/', esc(u('Language'))))
    .replace('</body>', `<script>${langScript(lang, '/', OFFERS)}</script>\n</body>`)
}

const OFFERS = offerTexts()

export function build() {
  const en = loadPages()
  const enHeadings = new Map()
  const files = new Map()
  let enIds = null
  // Every English string a language's docs/i18n file translates, for translators (and the check).
  const keys = [...new Set([...segments(SITE).map((s) => s.key), ...GUIDE_UI])]
  files.set('../docs/i18n/keys.json', JSON.stringify(keys, null, 1) + '\n')
  for (const lang of LANGS) {
    const strings = lang.id === 'en' ? {} : loadStrings(lang)
    if (lang.id !== 'en') for (const k of GUIDE_UI) if (strings[k] === undefined || badTranslation(k, strings[k])) problem(lang.id, `docs/i18n/${lang.id}.json: the guide's ${JSON.stringify(k)} has no translation${strings[k] !== undefined ? ` that works (${badTranslation(k, strings[k])})` : ''}`)
    const g = buildGuide(lang, en, strings, enHeadings)
    if (lang.id === 'en') enIds = g.ids
    for (const [k, v] of g.files) files.set(k, v)
    files.set(lang.path ? `${lang.path}/index.html` : 'index.html', buildLanding(lang, strings))
  }
  // website/sitemap.xml: every page in every language, each listing its other languages.
  const paths = ['/', '/guide/', ...en.map((p) => `/guide/${p.slug}/`)]
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${paths.flatMap((path) => LANGS.map((l) => `  <url><loc>${SITE_ORIGIN}${pathIn(l, path)}</loc>${LANGS.map((o) => `<xhtml:link rel="alternate" hreflang="${o.id}" href="${SITE_ORIGIN}${pathIn(o, path)}"/>`).join('')}</url>`)).join('\n')}\n</urlset>\n`)
  return { pages: en, files, ids: enIds }
}

// The app's Help links (guideUrl('slug#heading') in frontend/src) must point at real pages and headings.
function checkAppLinks(ids) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [])
  for (const f of walk(join(ROOT, 'frontend/src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:guideUrl\(|openGuide\(|guideTopic\(|topic=|help:\s*)['"]([\w-]+)(?:#([\w-]+))?['"]/g)) {
      const [, page, hash] = m
      if (!ids.has(page)) problems.push(`${relative(ROOT, f)}: Help link to missing guide page ${page}`)
      else if (hash && !ids.get(page).has(hash)) problems.push(`${relative(ROOT, f)}: Help link to missing heading ${page}#${hash}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sources')) {
    for (const p of loadPages()) console.log(`${p.slug}: ${sourceOf(p)}`)
    process.exit(0)
  }
  const { files, ids } = build()
  checkAppLinks(ids)
  const stale = []
  for (const [rel, content] of files) {
    const path = join(WEB, rel)
    const old = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (old === content) continue
    stale.push(rel)
    if (!check) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
  }
  // Pages whose Markdown is gone.
  for (const lang of LANGS) {
    const dir = join(WEB, lang.path, 'guide')
    if (existsSync(dir)) for (const d of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${lang.path ? `${lang.path}/` : ''}guide/${d.name}`
      if (!d.isDirectory() || d.name === 'shots' || files.has(`${rel}/index.html`)) continue
      stale.push(`${rel}/`)
      if (!check) rmSync(join(WEB, rel), { recursive: true })
    }
  }
  if (problems.length) { console.error(`guide: ${problems.join('\n guide: ')}`); process.exit(1) }
  if (check && stale.length && !onlyLang) { console.error(`guide: website/ is out of date (${stale.slice(0, 8).join(', ')}${stale.length > 8 ? `, and ${stale.length - 8} more` : ''}): run node scripts/guide-build.mjs`); process.exit(1) }
  if (!check) console.log(stale.length ? `guide: wrote ${stale.length > 12 ? `${stale.length} files` : stale.join(', ')}` : 'guide: up to date')
}
