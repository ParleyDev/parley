#!/usr/bin/env node
// One version for every artifact. The release version lives in /VERSION (semver). Builds come in three channels:
//   release      a commit tagged v<VERSION>: <VERSION>
//   prerelease   any other clean commit on main, which is what production runs: the next release as a pre-release,
//                <next>-pre.<commits since the last release tag>. The next release is a minor bump when a feature
//                (or epic) was closed in the issue tracker (.beads/issues.jsonl) since that tag, otherwise a patch;
//                a "Bump: major|minor|patch" line in a commit message since the tag asks for at least that much, and
//                a /VERSION already raised past the tag (a release being prepared) is the next release itself.
//   dev          everything else (other branches, local changes): <VERSION>-dev.<commits on this branch>
//                (+ ".dirty" when the tree has local changes)
// and the short commit hash is appended as build metadata for display (+<sha>), never in package versions, so a
// prerelease build reads 0.21.0-pre.11+ab12cd3. Only releases count as releases for installers and Docker's latest.
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
const channel = release ? 'release' : branch === 'main' && !dirty ? 'prerelease' : 'dev'

/** The release after the last one: see the channels above. */
function nextRelease() {
  const tag = git("describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*'")
  const since = Number((tag && git(`rev-list --count ${tag}..HEAD`)) || count)
  const core = (v) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => Number(x) || 0)
  const last = core(tag || base), mine = core(base)
  if ((mine[0] - last[0] || mine[1] - last[1] || mine[2] - last[2]) > 0) return { next: mine.join('.'), since }
  const rank = { patch: 0, minor: 1, major: 2 }
  let bump = 0
  if (tag) {
    for (const m of git(`log --format=%B ${tag}..HEAD`).matchAll(/^Bump:\s*(major|minor|patch)\s*$/gim)) bump = Math.max(bump, rank[m[1].toLowerCase()])
    const after = git(`log -1 --format=%cI ${tag}`)
    try {
      for (const line of readFileSync(join(root, '.beads/issues.jsonl'), 'utf8').split('\n')) {
        if (!line.includes('"closed_at"')) continue
        const i = JSON.parse(line)
        if (i.closed_at > after && (i.issue_type === 'feature' || i.issue_type === 'epic')) bump = Math.max(bump, 1)
      }
    } catch { /* no issue export: a patch unless a commit says otherwise */ }
  }
  const [M, m, p] = last
  return { next: bump === 2 ? `${M + 1}.0.0` : bump === 1 ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`, since }
}
const pre = channel === 'prerelease' ? nextRelease() : null
const version = channel === 'dev' ? `${base}-dev.${count}${dirty ? '.dirty' : ''}` : pre ? `${pre.next}-pre.${pre.since}` : base
const display = `${version}+${sha}`
// Android versionCode / iOS build number: monotonic with history, room for 99 releases a day of a given commit count.
const code = count * 10 + (release ? 1 : 0)
// PARLEY_VERSION overrides everything: containers without .git get the computed display version, and release
// workflows pass the release tag (v1.4.0 → 1.4.0, v2.0.0-rc.1 → 2.0.0-rc.1), which wins over /VERSION.
// A version without a pre-release part (1.4.0) is a release; anything with one (1.4.0-dev.12, 2.0.0-rc.1) is not.
// Forced pre-releases (0.21.0-pre.11) keep their channel.
const forced = process.env.PARLEY_VERSION && process.env.PARLEY_VERSION !== 'dev' ? process.env.PARLEY_VERSION.replace(/^v/, '') : null
const fVersion = forced?.split('+')[0] ?? ''
const fRelease = !!forced && !fVersion.includes('-')
// Build codes stay monotonic with history whenever git is available; containers fall back to the dev counter.
const fCount = count || Number((/dev\.(\d+)/.exec(fVersion) ?? [])[1] ?? 0)
const info = forced
  ? { base: fVersion.split('-')[0], version: fVersion, display: forced.includes('+') ? forced : `${fVersion}+${sha}`, code: fCount * 10 + (fRelease ? 1 : 0), sha: forced.split('+')[1] ?? sha, dirty: forced.includes('.dirty'), release: fRelease, channel: fRelease ? 'release' : /-pre\./.test(fVersion) ? 'prerelease' : 'dev' }
  : { base: pre ? pre.next : base, version, display, code, sha, dirty, release, channel }
// Installer version (Tauri bundle): MSI needs a numeric-only suffix (<= 65535) and RPM forbids '-', so dev builds
// use numeric build metadata: 0.2.0+412 (MSI 0.2.0.412). The app binary keeps the full semver `version`.
// Pre-releases (rc, beta, dev) get <core>+<commit count>; MSI turns that into core.count.
const devCount = Number((/(?:dev|pre)\.(\d+)/.exec(info.version) ?? [])[1] ?? count)
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
