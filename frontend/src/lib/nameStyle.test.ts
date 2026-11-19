import { describe, expect, it } from 'vitest'
import { EFFECTS, FONTS, HOLO_COLORS, LEGACY_EFFECTS, LEGACY_FONTS, defaultColors, effectOf, fontOf, nameLook, surpriseStyle } from './nameStyle'

describe('name styles', () => {
  it('maps fonts and effects from before the rework to their replacements', () => {
    expect(fontOf('serif')).toBe('slab')
    expect(fontOf('display')).toBe('poster')
    expect(fontOf('italic')).toBe('default')
    expect(fontOf('nope')).toBe('default')
    expect(effectOf('prism')).toBe('rainbow')
    expect(effectOf('sparkle')).toBeUndefined()
    for (const f of Object.values(LEGACY_FONTS)) expect(FONTS.some((x) => x.id === f)).toBe(true)
    for (const e of Object.values(LEGACY_EFFECTS)) expect(EFFECTS.some((x) => x.id === e)).toBe(true)
  })

  it('renders a stored legacy style with the new classes', () => {
    expect(nameLook({ name_style: { font: 'script', effect: 'prism', colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] } }).className).toBe('nf-retro ne-rainbow')
    const holo = nameLook({ name_style: { font: 'default', effect: 'holographic', colors: ['#a9c9ff', '#ffbbec', '#c6f7e2'] } })
    expect(holo.className).toBe('ne-rainbow')
    expect(String((holo.style as Record<string, string>)['--ngrad'])).toContain(HOLO_COLORS[1])
  })

  it('splits letters only for the letter effects, and gives Gummy its colours', () => {
    expect(nameLook({ name_style: { effect: 'neon', colors: ['#57f287'] } }).letters).toBeUndefined()
    expect(nameLook({ name_style: { effect: 'wave', colors: ['#57f287'] } }).letters).toEqual(['#57f287'])
    expect(nameLook({ name_style: { effect: 'gummy', colors: ['#111111', '#222222', '#333333'] } }).letters).toEqual(['#111111', '#222222', '#333333'])
    expect(nameLook({ name_style: { font: 'pixel', effect: 'wave' } })).toEqual({ className: 'nf-pixel', style: {} })
  })

  it('gives every effect enough default colours, and Pop a second one for its shadow', () => {
    for (const e of EFFECTS) expect(defaultColors(e.id, []).length).toBe({ one: 1, two: 2, stripes: 3, five: 5 }[e.mode])
    expect(defaultColors('pop', ['#abcdef'])).toHaveLength(2)
    const s = surpriseStyle()
    expect(FONTS.some((f) => f.id === s.font) && EFFECTS.some((e) => e.id === s.effect)).toBe(true)
  })
})
