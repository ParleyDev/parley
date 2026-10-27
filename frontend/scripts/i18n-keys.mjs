// Regenerates src/locales/keys.json: every English UI string that reaches t(), i.e. explicit t('…') calls and the
// labels shared components translate (menu and settings item labels, <Toggle label>, <ControlButton label>,
// <Modal title>, item titles). Run after adding UI text, then fill the catalogues:  node scripts/i18n-keys.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
walk(root)
const pats = [/\bt\('((?:[^'\\]|\\.)*)'/g, /\blabel: '((?:[^'\\]|\\.)*)'/g, /<Toggle label="([^"]+)"/g, /<ControlButton label="([^"]+)"/g, /<ControlButton label=\{[^}]*?'([^']+)'[^}]*?:\s*'([^']+)'\}/g, /<Modal [^>]*title="([^"]+)"/g, /\btitle: '((?:[^'\\]|\\.)*)'/g]
const keys = new Set()
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const p of pats) for (const m of s.matchAll(p)) for (const x of m.slice(1)) if (x && /[A-Za-z]/.test(x) && x.length < 90 && !x.includes('${')) keys.add(x.replace(/\\'/g, "'"))
}
const out = join(root, 'locales/keys.json')
const before = JSON.parse(readFileSync(out, 'utf8'))
for (const k of before) keys.add(k) // keep keys catalogues already translate
const list = [...keys].sort()
writeFileSync(out, JSON.stringify(list, null, 0).replace(/","/g, '",\n"') + '\n')
console.log(`${list.length} keys (${list.length - before.length} new)`)
