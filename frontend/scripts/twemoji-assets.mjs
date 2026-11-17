#!/usr/bin/env node
// Twemoji's pictures (https://github.com/jdecked/twemoji, CC-BY 4.0), which Parley draws every unicode emoji with so
// they look the same, and exist, on every device. Fetched from the release pinned in src/data/twemoji.json, checked
// against its sha256, and unpacked to public/assets/twemoji/<version>/ (git-ignored; cached under /assets/ like the
// rest of the build). Runs before `npm run dev` and `npm run build`; does nothing when they're already there.
//   node scripts/twemoji-assets.mjs
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const meta = JSON.parse(readFileSync(join(root, 'src/data/twemoji.json'), 'utf8'))
const dest = join(root, 'public/assets/twemoji', meta.version)
const done = join(dest, '.complete')
if (existsSync(done)) process.exit(0)

const r = await fetch(meta.tarball)
if (!r.ok) throw new Error(`twemoji: ${meta.tarball}: ${r.status}`)
const gz = Buffer.from(await r.arrayBuffer())
const sum = createHash('sha256').update(gz).digest('hex')
if (sum !== meta.sha256) throw new Error(`twemoji: checksum mismatch (${sum}), expected ${meta.sha256}`)

// A tar is 512-byte headers each followed by the file, padded to 512. Only assets/svg/*.svg is kept.
const tar = gunzipSync(gz)
mkdirSync(dest, { recursive: true })
let n = 0
for (let off = 0; off + 512 <= tar.length;) {
  const head = tar.subarray(off, off + 512)
  if (head.every((b) => b === 0)) break
  const field = (a, b) => head.subarray(a, b).toString('utf8').replace(/\0.*$/s, '')
  const name = (field(345, 500) ? `${field(345, 500)}/` : '') + field(0, 100)
  const size = parseInt(field(124, 136).trim() || '0', 8)
  const type = String.fromCharCode(head[156])
  const m = /\/assets\/svg\/([0-9a-f-]+\.svg)$/.exec(name)
  if (m && (type === '0' || type === '\0')) { writeFileSync(join(dest, m[1]), tar.subarray(off + 512, off + 512 + size)); n++ }
  off += 512 + Math.ceil(size / 512) * 512
}
if (n < 1000) throw new Error(`twemoji: only ${n} pictures in the archive`)
writeFileSync(done, `${n}\n`)
console.log(`twemoji ${meta.version}: ${n} pictures in public/assets/twemoji/${meta.version}`)
