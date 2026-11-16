#!/usr/bin/env node
// Release notes go through this before `gh release create/edit`. GitHub turns every bare @word in a release body into
// a link to the account of that name, notifies it, and lists it under the release's Contributors: Parley's own
// @everyone and @here (and role names) would credit unrelated GitHub accounts. Every @word outside code is put in
// backticks, so it reads the same and links nowhere.
//
//   node scripts/release-notes-safe.mjs < notes.md > safe.md
//   node scripts/release-notes-safe.mjs --check < notes.md    exit 1 (listing them) if any bare @word is left
import { readFileSync } from 'node:fs'

const check = process.argv.includes('--check')
const text = readFileSync(0, 'utf8')
const found = []
let fenced = false
const out = text.split('\n').map((line) => {
  if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line }
  if (fenced) return line
  // Split on inline code spans and leave those alone; an e-mail address (word before the @) is not a mention.
  return line.split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part : part.replace(/(^|[^\w`/.-])@([A-Za-z0-9][\w-]*)/g, (_, pre, name) => {
    found.push(`@${name}`)
    return `${pre}\`@${name}\``
  })).join('')
}).join('\n')

if (check) {
  if (found.length) { console.error(`bare @mentions in release notes: ${[...new Set(found)].join(', ')}`); process.exit(1) }
} else process.stdout.write(out)
