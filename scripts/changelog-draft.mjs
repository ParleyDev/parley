#!/usr/bin/env node
// Drafts the next What's New entry (frontend/src/lib/changelog.ts) from the feat/fix/perf commits since the last
// entry, to paste at the top of CHANGELOG and then rewrite for users: merge related lines, drop what nobody would
// notice, keep it to a handful of items. A new entry pops up once for everyone, so one per release is plenty.
//
//   node scripts/changelog-draft.mjs                 since the last commit that changed changelog.ts
//   node scripts/changelog-draft.mjs --since v0.24.0 since any ref
//
// Commits in internal scopes (website, mcp, oauth, docker, build, ci, …) are left out; admin-only ones are marked.
import { execFileSync } from 'node:child_process'

const FILE = 'frontend/src/lib/changelog.ts'
const INTERNAL = new Set(['website', 'mcp', 'oauth', 'docker', 'build', 'ci', 'deps', 'e2e', 'test', 'release', 'beads', 'guide'])
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const i = process.argv.indexOf('--since')
const since = i > 0 ? process.argv[i + 1] : git('log', '-1', '--format=%H', '--', FILE)
if (!since) { console.error(`changelog-draft: no --since given and ${FILE} has no history`); process.exit(2) }

const rows = git('log', `${since}..HEAD`, '--no-merges', '--format=%h%x09%s').split('\n').filter(Boolean)
const items = { feat: [], fix: [], perf: [] }
for (const row of rows) {
  const [sha, subject] = row.split('\t')
  const m = /^(feat|fix|perf)(?:\(([^)]*)\))?!?: (.+)$/.exec(subject)
  if (!m || INTERNAL.has(m[2])) continue
  const text = m[3].charAt(0).toUpperCase() + m[3].slice(1)
  items[m[1]].push({ sha, scope: m[2] ?? '', text: /[.!?]$/.test(text) ? text : `${text}.` })
}
const all = [...items.feat, ...items.perf, ...items.fix]
if (!all.length) { console.error(`changelog-draft: no user-facing feat/fix/perf commits since ${since.slice(0, 9)}`); process.exit(1) }

const today = new Date().toISOString().slice(0, 10)
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
console.log(`  {
    id: '${today}', date: '${today}', title: 'TODO: a short headline',
    items: [`)
for (const [kind, list] of Object.entries(items)) {
  if (!list.length) continue
  console.log(`      // ${kind}`)
  for (const it of list) console.log(`      ${q(it.text)}, // ${it.sha}${it.scope ? ` ${it.scope}` : ''}${it.scope === 'admin' ? ' (admins only)' : ''}`)
}
console.log(`    ],
  },`)
console.error(`changelog-draft: ${all.length} commits since ${since.slice(0, 9)}; edit before committing.`)
