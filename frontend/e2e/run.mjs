// Runs the e2e suites one after another against a running stack and exits non-zero if any fails.
//   node e2e/run.mjs            # all suites
//   node e2e/run.mjs groups admin   # a subset
// Screenshots land in e2e/out/.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'out'); mkdirSync(out, { recursive: true })
const all = readdirSync(join(here, 'suites')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort()
const wanted = process.argv.slice(2)
const suites = wanted.length ? all.filter((s) => wanted.includes(s)) : all
const results = []
for (const s of suites) {
  console.log(`\n===== ${s} =====`)
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [join(here, 'suites', `${s}.mjs`)], { cwd: out, stdio: 'inherit', env: process.env, timeout: 10 * 60 * 1000 })
  results.push({ s, code: r.status ?? 1, secs: Math.round((Date.now() - t0) / 1000) })
}
console.log('\n===== summary =====')
for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.s} (${r.secs}s)`)
const failed = results.filter((r) => r.code !== 0)
console.log(`\n${results.length - failed.length}/${results.length} suites passed`)
process.exit(failed.length ? 1 : 0)
