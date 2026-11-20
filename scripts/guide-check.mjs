#!/usr/bin/env node
// Keeps the user guide (docs/guide, runparley.com/guide) in step with the app. In the commit-msg hook:
//  - a feat/fix/perf commit that changes files a guide page covers (its `covers:` globs) must change docs/guide too,
//    or say why not with a `Guide: not affected` line in the message;
//  - a feat/fix/perf commit adding a component or page that no guide page covers (and docs/guide/uncovered.txt
//    doesn't list) must map it, so new features can't slip past the guide;
//  - whenever the guide, the website or the app's Help links change, website/ must be built and in step, with every
//    translated guide page and landing page string current in every language (scripts/guide-build.mjs --check).
//
//   scripts/guide-check.mjs <message file>
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPages } from './guide-build.mjs'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const msg = readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n')
const subject = msg.split('\n').find((l) => l.trim()) ?? ''
const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
const added = new Set(execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean))

export function globRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1 }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const fail = (text) => { console.error(`guide-check: ${text}`); process.exit(1) }
const pages = loadPages(join(ROOT, 'docs/guide')).map((p) => ({ ...p, res: p.covers.map(globRe) }))
const guideTouched = staged.some((f) => f.startsWith('docs/guide/'))
const notTest = (f) => !/\.test\.tsx?$|^frontend\/e2e\//.test(f)

if (/^(feat|fix|perf)(\([^)]*\))?!?:/.test(subject) && !/^Guide: not affected\b/m.test(msg)) {
  const hits = new Map()
  for (const f of staged.filter(notTest)) for (const p of pages) if (p.res.some((r) => r.test(f))) (hits.get(p.file) ?? hits.set(p.file, []).get(p.file)).push(f)
  if (hits.size && !guideTouched) {
    fail(`this ${subject.split(/[(:!]/)[0]} commit changes what the user guide describes, but not the guide:\n${[...hits].map(([page, fs]) => `  ${page}  (${fs.slice(0, 3).join(', ')}${fs.length > 3 ? ', …' : ''})`).join('\n')}
Update those pages (and run node scripts/guide-build.mjs), or add a line "Guide: not affected" to the message if nothing a user sees has changed.`)
  }
  const ignore = existsSync(join(ROOT, 'docs/guide/uncovered.txt')) ? readFileSync(join(ROOT, 'docs/guide/uncovered.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map(globRe) : []
  const unmapped = [...added].filter((f) => /^frontend\/src\/(components|pages)\/.*\.tsx$/.test(f) && notTest(f) && !pages.some((p) => p.res.some((r) => r.test(f))) && !ignore.some((r) => r.test(f)))
  if (unmapped.length) {
    fail(`new screens or components that no user guide page covers:\n${unmapped.map((f) => `  ${f}`).join('\n')}
Add them to the covers: list of the guide page that describes them (or write one), or list them in docs/guide/uncovered.txt if users never see them.`)
  }
}

if (staged.some((f) => /^(docs\/(guide|site|i18n)|website)\//.test(f) || /^scripts\/(guide-build|site-i18n)\.mjs$/.test(f) || /^frontend\/src\/.*\.tsx?$/.test(f))) {
  try { execFileSync('node', [join(ROOT, 'scripts/guide-build.mjs'), '--check'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] }) } catch { fail('the guide build check failed (see above)') }
}
