#!/usr/bin/env node
// A release must say what's new: a `chore(release): X.Y.Z` commit is refused unless frontend/src/lib/changelog.ts
// (What's New) changed since the previous release tag, in an earlier commit or in this one. Other commits pass.
// Draft the entry with `node scripts/changelog-draft.mjs`.
//
//   node scripts/changelog-check.mjs <message file>     (the commit-msg hook)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FILE = 'frontend/src/lib/changelog.ts'
const subject = readFileSync(process.argv[2], 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? ''
if (!/^chore\(release\): \d+\.\d+\.\d+/.test(subject)) process.exit(0)

const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' } }
const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*')
const staged = git('diff', '--cached', '--name-only', '--', FILE)
const since = tag ? git('diff', '--name-only', tag, 'HEAD', '--', FILE) : 'no tag yet'
if (staged || since) process.exit(0)

console.error(`changelog-check: ${subject} has no What's New entry: ${FILE} is unchanged since ${tag}.
  Draft one with: node scripts/changelog-draft.mjs
  then rewrite it for users, add it at the top of CHANGELOG and commit it with the release.`)
process.exit(1)
