#!/usr/bin/env node
// The app's translations against src/locales/keys.json: every key translated in every language, with the same
// {placeholders} and markup as the English.
//
//   node scripts/i18n-check.mjs            every language; exit 1 on any problem
//   node scripts/i18n-check.mjs de         one language
//   node scripts/i18n-check.mjs de --list  print that language's missing keys as JSON (an object to fill in)
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/locales')
const keys = JSON.parse(readFileSync(join(DIR, 'keys.json'), 'utf8'))
const args = process.argv.slice(2)
const only = args.find((a) => !a.startsWith('--'))
const langs = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'keys.json').map((f) => f.slice(0, -5)).filter((l) => !only || l === only)
const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
const tags = (s) => (s.match(/<\/?(?:a|b|br|code|em|i|kbd|small|span|strong)\b[^>]*>/g) ?? []).sort().join('')
let bad = 0
for (const l of langs) {
  const cat = JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8'))
  const missing = keys.filter((k) => typeof cat[k] !== 'string' || !cat[k].trim())
  if (args.includes('--list')) { console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, ''])), null, 1)); continue }
  const wrong = keys.filter((k) => typeof cat[k] === 'string' && cat[k].trim() && (vars(k) !== vars(cat[k]) || tags(k) !== tags(cat[k])))
  if (missing.length || wrong.length) {
    bad++
    console.error(`${l}: ${missing.length} missing, ${wrong.length} with different {placeholders} or markup`)
    for (const k of wrong.slice(0, 20)) console.error(`  ${JSON.stringify(k)} → ${JSON.stringify(cat[k])}`)
  }
}
if (bad) process.exit(1)
console.log(`i18n: ${langs.length} languages, ${keys.length} keys, all translated`)
