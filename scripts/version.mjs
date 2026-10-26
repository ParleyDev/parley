#!/usr/bin/env node
// One version for every artifact. The release version lives in /VERSION (semver). Builds come in three channels:
//   release      a commit tagged v<VERSION>: <VERSION>
//   production   any other clean commit on main, which is what production runs: <VERSION> as well
//   dev          everything else (other branches, local changes): <VERSION>-dev.<commits on this branch>
//                (+ ".dirty" when the tree has local changes)
// and the short commit hash is appended as build metadata for display (+<sha>), never in package versions, so a
// production build reads 0.2.0+ab12cd3. Only releases count as releases for installers and Docker version tags.
// Local changes that never reach a build (.beads, docs, website, Markdown) don't make a tree dirty.
//
//   node scripts/version.mjs            → prints the full display version (e.g. 0.2.0+ab12cd3, 0.2.0-dev.412+ab12cd3)
//   node scripts/version.mjs --json     → {"base","version","bundle","display","code","sha","dirty","release","channel"}
//   node scripts/version.mjs --bundle   → installer version (0.2.0 for releases, 0.2.0+412 for dev builds)
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
const dirty = git("status --porcelain --untracked-files=no -- . ':!.beads' ':!docs' ':!website' ':!*.md'") !== ''
const tagged = git('tag --points-at HEAD').split('\n').includes(`v${base}`)
const release = tagged && !dirty && process.env.PARLEY_RELEASE !== '0'
// CI checks out the pushed ref (GITHUB_REF); a local build goes by the checked-out branch.
const ref = process.env.GITHUB_REF ?? ''
const branch = ref ? (ref.startsWith('refs/heads/') ? ref.slice(11) : '') : git('branch --show-current')
const channel = release ? 'release' : branch === 'main' && !dirty ? 'production' : 'dev'
const version = channel === 'dev' ? `${base}-dev.${count}${dirty ? '.dirty' : ''}` : base
const display = `${version}+${sha}`
// Android versionCode / iOS build number: monotonic with history, room for 99 releases a day of a given commit count.
const code = count * 10 + (release ? 1 : 0)
// PARLEY_VERSION overrides everything: containers without .git get the computed display version, and release
// workflows pass the release tag (v1.4.0 → 1.4.0, v2.0.0-rc.1 → 2.0.0-rc.1), which wins over /VERSION.
// A version without a pre-release part (1.4.0) is a release; anything with one (1.4.0-dev.12, 2.0.0-rc.1) is not.
const forced = process.env.PARLEY_VERSION && process.env.PARLEY_VERSION !== 'dev' ? process.env.PARLEY_VERSION.replace(/^v/, '') : null
const fVersion = forced?.split('+')[0] ?? ''
const fRelease = !!forced && !fVersion.includes('-')
// Build codes stay monotonic with history whenever git is available; containers fall back to the dev counter.
const fCount = count || Number((/dev\.(\d+)/.exec(fVersion) ?? [])[1] ?? 0)
const info = forced
  ? { base: fVersion.split('-')[0], version: fVersion, display: forced.includes('+') ? forced : `${fVersion}+${sha}`, code: fCount * 10 + (fRelease ? 1 : 0), sha: forced.split('+')[1] ?? sha, dirty: forced.includes('.dirty'), release: fRelease, channel: fRelease ? 'release' : 'dev' }
  : { base, version, display, code, sha, dirty, release, channel }
// Installer version (Tauri bundle): MSI needs a numeric-only suffix (<= 65535) and RPM forbids '-', so dev builds
// use numeric build metadata: 0.2.0+412 (MSI 0.2.0.412). The app binary keeps the full semver `version`.
// Pre-releases (rc, beta, dev) get <core>+<commit count>; MSI turns that into core.count.
const devCount = Number((/dev\.(\d+)/.exec(info.version) ?? [])[1] ?? count)
info.bundle = info.release ? info.version : `${info.base}+${Math.min(devCount, 65535)}`

const arg = process.argv[2]
if (arg === '--json') { console.log(JSON.stringify(info)) }
else if (arg === '--version') { console.log(info.version) }
else if (arg === '--bundle') { console.log(info.bundle) }
else if (arg === '--apply') {
  const edit = (rel, fn) => { const p = join(root, rel); if (!existsSync(p)) return; const before = readFileSync(p, 'utf8'); const after = fn(before); if (after !== before) { writeFileSync(p, after); console.log(`updated ${rel}`) } }
  const { version: v, code: c, display: d, bundle: bv } = info
  edit('mobile/package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`))
  edit('mobile/android/app/build.gradle', (s) => s.replace(/versionCode \d+/, `versionCode ${c}`).replace(/versionName "[^"]*"/, `versionName "${v}"`))
  edit('mobile/ios/App/App.xcodeproj/project.pbxproj', (s) => s.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${c};`).replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${info.base};`))
  edit('desktop/package.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${v}"`))
  edit('desktop/src-tauri/tauri.conf.json', (s) => s.replace(/"version": "[^"]*"/, `"version": "${bv}"`))
  edit('desktop/src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]*"/m, `version = "${v}"`))
  console.log(d)
}
else { console.log(info.display) }
