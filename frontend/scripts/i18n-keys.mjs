// Regenerates src/locales/keys.json: every English UI string that reaches t(), i.e. explicit t('…') calls and the
// labels shared components translate (menu and settings item labels, <Toggle label>, <ControlButton label>,
// <Modal title>, item titles). Run after adding UI text, then fill the catalogues:  node scripts/i18n-keys.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
walk(root)
const pats = [/\btn?\('((?:[^'\\]|\\.)*)'/g, /\blabel: '((?:[^'\\]|\\.)*)'/g, /<Toggle label="([^"]+)"/g, /<ControlButton label="([^"]+)"/g, /<ControlButton label=\{[^}]*?'([^']+)'[^}]*?:\s*'([^']+)'\}/g, /<Modal [^>]*title="([^"]+)"/g, /\btitle: '((?:[^'\\]|\\.)*)'/g, /\bt\("((?:[^"\\]|\\.)*)"/g, /\bdesc: '((?:[^'\\]|\\.)*)'/g]
// The source text as JavaScript sees it: \u2019, \n, \' and friends decoded.
const unescape = (x) => x.replace(/\\(u\{?([0-9a-fA-F]+)\}?|n|t|.)/g, (_, c, hex) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : c === 'n' ? '\n' : c === 't' ? '\t' : c))
const keys = new Set()
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const p of pats) for (const m of s.matchAll(p)) for (const x of m.slice(1)) if (x && /[A-Za-z]/.test(x) && x.length < 600 && !x.includes('${')) keys.add(unescape(x))
}
// Keys only reached through t(variable): option tables and the like (scripts/i18n-extra.json).
for (const k of JSON.parse(readFileSync(new URL('./i18n-extra.json', import.meta.url), 'utf8'))) keys.add(k)
const out = join(root, 'locales/keys.json')
const before = JSON.parse(readFileSync(out, 'utf8'))
for (const k of before) keys.add(k) // keep keys catalogues already translate
const list = [...keys].sort()
writeFileSync(out, JSON.stringify(list, null, 0).replace(/","/g, '",\n"') + '\n')
console.log(`${list.length} keys (${list.length - before.length} new)`)
