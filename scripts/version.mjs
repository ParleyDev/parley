#!/usr/bin/env node
// One version for every artifact. The release version lives in /VERSION (semver). A build on a commit tagged
// v<VERSION> is a release and uses it verbatim; any other build is a development build:
//   <VERSION>-dev.<commits on this branch>   (+ ".dirty" when the tree has local changes)
// and the short commit hash is appended as build metadata for display (+<sha>), never in package versions.
//
//   node scripts/version.mjs            → prints the full display version (e.g. 0.2.0-dev.412+ab12cd3)
//   node scripts/version.mjs --json     → {"base","version","display","code","sha","dirty","release"}
//   node scripts/version.mjs --apply    → writes the version into mobile (package.json, Android, iOS) and desktop
//                                         (tauri.conf.json, Cargo.toml); backend and web take PARLEY_VERSION at build
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = readFileSync(join(root, 'VERSION'), 'utf8').trim()
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const sha = git('rev-parse --short=7 HEAD') || 'nogit'
const count = Number(git('rev-list --count HEAD') || 0)
const dirty = git('status --porcelain --untracked-files=no') !== ''
const tagged = git('tag --points-at HEAD').split('\n').includes(`v${base}`)
const release = tagged && !dirty && process.env.PARLEY_RELEASE !== '0'
const version = release ? base : `${base}-dev.${count}${dirty ? '.dirty' : ''}`
const display = release ? `${base}+${sha}` : `${version}+${sha}`
// Android versionCode / iOS build number: monotonic with history, room for 99 releases a day of a given commit count.
const code = count * 10 + (release ? 1 : 0)
// PARLEY_VERSION=<display version> overrides everything (containers without .git, CI passing the computed value).
const forced = process.env.PARLEY_VERSION && process.env.PARLEY_VERSION !== 'dev' ? process.env.PARLEY_VERSION : null
const info = forced
  ? { base, version: forced.split('+')[0], display: forced, code: Number((/dev\.(\d+)/.exec(forced) ?? [])[1] ?? 0) * 10 + (forced.includes('-') ? 0 : 1), sha: forced.split('+')[1] ?? sha, dirty: forced.includes('.dirty'), release: !forced.includes('-') }
  : { base, version, display, code, sha, dirty, release }

const arg = process.argv[2]
if (arg === '--json') { console.log(JSON.stringify(info)) }
else if (arg === '--version') { console.log(info.version) }
else if (arg === '--apply') {
  const edit = (rel, fn) => { const p = join(root, rel); if (!existsSync(p)) return; const before = readFileSync(p, 'utf8'); const after = fn(before); if (after !== before) { writeFileSync(p, after); console.log(`updated ${rel}`) } }
  const { version: v, code: c, display: d } = info
  edit('mobile/package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`))
  edit('mobile/android/app/build.gradle', (s) => s.replace(/versionCode \d+/, `versionCode ${c}`).replace(/versionName "[^"]*"/, `versionName "${v}"`))
  edit('mobile/ios/App/App.xcodeproj/project.pbxproj', (s) => s.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${c};`).replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${base};`))
  edit('desktop/package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`))
  edit('desktop/src-tauri/tauri.conf.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`))
  edit('desktop/src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]*"/m, `version = "${v}"`))
  console.log(d)
}
else { console.log(info.display) }
