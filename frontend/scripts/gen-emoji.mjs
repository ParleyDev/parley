#!/usr/bin/env node
// Regenerate src/data/emoji.json (groups → [emoji, slug, tone?]) and src/data/emojiAliases.json (emoji → gemoji aliases)
// from Unicode's emoji-test.txt and GitHub's gemoji database. One command keeps the bundled set current:
//   npm run emoji:update            # the Unicode release Parley's Twemoji pictures cover (src/data/twemoji.json)
//   npm run emoji:update -- 16.0    # a specific release
// Emoji newer than the pictures would show as empty boxes on most devices, so keep the two in step.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2] ?? JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'twemoji.json'), 'utf8')).unicode
// From Unicode 17 the file lives under the full version (/Public/17.0.0/emoji/); older ones under /Public/emoji/16.0/.
const TEST_URLS = version === 'latest' ? ['https://unicode.org/Public/emoji/latest/emoji-test.txt'] : [`https://www.unicode.org/Public/${version}.0/emoji/emoji-test.txt`, `https://unicode.org/Public/emoji/${version}/emoji-test.txt`]
const GEMOJI_URL = 'https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json'
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')

const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text() }
// CLDR name → slug: strip accents (piñata → pinata) and parenthesised qualifiers ("A button (blood type)"), spell out the
// keycap symbols, then snake_case.
const SYMBOLS = { '#': 'number sign', '*': 'asterisk' }
const slugify = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*\([^)]*\)/g, '').replace(/[#*]/g, (c) => ` ${SYMBOLS[c]} `).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/u
const strip = (s) => s.replace(/\uFE0F/g, '')

let text = null
for (const url of TEST_URLS) { try { text = await fetchText(url); break } catch (e) { if (url === TEST_URLS.at(-1)) throw e } }
const groups = []
let group = null
const toneBases = new Set()
for (const raw of text.split('\n')) {
  const line = raw.trim()
  if (line.startsWith('# group:')) { group = { n: line.slice(8).trim(), e: [] }; if (group.n !== 'Component') groups.push(group); continue }
  if (!line || line.startsWith('#') || !group || group.n === 'Component') continue
  const m = /^([0-9A-F ]+?)\s*;\s*(fully-qualified|minimally-qualified|unqualified)\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/.exec(line)
  if (!m || m[2] !== 'fully-qualified') continue
  const emoji = m[3], name = m[4]
  if (TONE_RE.test(emoji)) {
    // "thumbs up: medium skin tone" → the base entry is tone-capable; variants are derived at runtime.
    const base = emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
    toneBases.add(strip(base)); continue
  }
  group.e.push([emoji, slugify(name.replace(/:\s*(light|medium-light|medium|medium-dark|dark) skin tone/g, ''))])
}
for (const g of groups) for (const e of g.e) if (toneBases.has(strip(e[0]))) e.push(1)

const gemoji = JSON.parse(await fetchText(GEMOJI_URL))
// Union with the aliases already shipped: hand-curated Discord-style names (slight_smile, hugging…) survive upstream changes.
let aliases = {}
try { aliases = JSON.parse(readFileSync(join(out, 'emojiAliases.json'), 'utf8')) } catch { /* first run */ }
const known = new Map(groups.flatMap((g) => g.e.map((e) => [strip(e[0]), e[0]])))
for (const g of gemoji) {
  if (!g.emoji) continue
  const key = known.get(strip(g.emoji))
  if (!key) continue
  const a = (g.aliases ?? []).filter((x) => x !== key)
  const merged = Array.from(new Set([...(aliases[key] ?? []), ...a]))
  if (merged.length) aliases[key] = merged
}

writeFileSync(join(out, 'emoji.json'), JSON.stringify(groups))
writeFileSync(join(out, 'emojiAliases.json'), JSON.stringify(aliases))
const total = groups.reduce((n, g) => n + g.e.length, 0)
console.log(`emoji.json: ${groups.length} groups, ${total} emoji (${toneBases.size} tone-capable); emojiAliases.json: ${Object.keys(aliases).length} entries (Unicode ${version})`)
