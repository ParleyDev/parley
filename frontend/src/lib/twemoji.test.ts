import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTone } from './emoji'
import { twemojiFile } from './twemoji'
import meta from '../data/twemoji.json'

describe('twemoji file names', () => {
  it('spells code points in hex, dropping FE0F outside ZWJ sequences', () => {
    expect(twemojiFile('😀')).toBe('1f600')
    expect(twemojiFile('❤️')).toBe('2764')
    expect(twemojiFile('#️⃣')).toBe('23-20e3')
    expect(twemojiFile('🇺🇸')).toBe('1f1fa-1f1f8')
    expect(twemojiFile('🏳️‍🌈')).toBe('1f3f3-fe0f-200d-1f308')
    expect(twemojiFile('👁️‍🗨️', true)).toBe('1f441-200d-1f5e8')
  })
})

describe('skin tones', () => {
  it('tone one person after their first code point, replacing FE0F', () => {
    expect(applyTone('👍', 2)).toBe('👍🏼')
    expect(applyTone('🕵️‍♀️', 1)).toBe('🕵🏻‍♀️')
    expect(applyTone('👍🏿', 0)).toBe('👍')
  })
  it('tone every person in a couple, not the handshake between them', () => {
    expect(applyTone('🧑‍🤝‍🧑', 1)).toBe('🧑🏻‍🤝‍🧑🏻')
    expect(applyTone('👩‍❤️‍💋‍👨', 5)).toBe('👩🏿‍❤️‍💋‍👨🏿')
    expect(applyTone('🤝', 3)).toBe('🤝🏽')
  })
})

// With the pictures fetched (scripts/twemoji-assets.mjs), every emoji Parley offers, in every tone, has one.
const dir = join(__dirname, '../../public/assets/twemoji', meta.version)
describe.skipIf(!existsSync(join(dir, '.complete')))('coverage', () => {
  it('has a picture for every emoji and tone in the picker', () => {
    const groups: { e: [string, string, number?][] }[] = JSON.parse(readFileSync(join(__dirname, '../data/emoji.json'), 'utf8'))
    const missing: string[] = []
    for (const g of groups) for (const [e, , tone] of g.e) for (const t of tone ? [0, 1, 2, 3, 4, 5] : [0]) {
      const v = applyTone(e, t)
      if (!existsSync(join(dir, `${twemojiFile(v)}.svg`)) && !existsSync(join(dir, `${twemojiFile(v, true)}.svg`))) missing.push(v)
    }
    expect(missing).toEqual([])
  })
})
