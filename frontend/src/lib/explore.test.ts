import { describe, expect, it } from 'vitest'
import { NO_FILTERS, groupVariants, labelOf, matches, plainTags, sortItems, wearPatch, type ExploreItem } from './explore'

const item = (p: Partial<ExploreItem> & { value: string }): ExploreItem => ({ kind: 'decoration', name: p.value, added: 0, ...p })
const moonBlue = item({ value: 'asset:moon_blue', name: 'Moon', base_name: 'Moon', variant_label: 'Blue', colors: ['blue'], themes: ['sci_fi'], collection_id: 'c1', bundles: ['b1'], tags: ['night'], rank: 2, added: 5 })
const moonRed = item({ value: 'asset:moon_red', name: 'Moon', base_name: 'Moon', variant_label: 'Red', colors: ['red'], added: 9 })
const star = item({ value: 'asset:star', name: 'Star', themes: ['fantasy'], rank: 1, added: 1 })
const plate = item({ kind: 'nameplate', value: 'asset:sky', name: 'Sky', description: 'A starry night' })

describe('explore', () => {
  it('filters by kind, colour, theme, collection, sets and search', () => {
    const all = [moonBlue, moonRed, star, plate]
    const pick = (f: Partial<typeof NO_FILTERS>) => all.filter((x) => matches(x, { ...NO_FILTERS, ...f })).map((x) => x.value)
    expect(pick({})).toHaveLength(4)
    expect(pick({ kinds: ['nameplate'] })).toEqual(['asset:sky'])
    expect(pick({ colors: ['blue', 'red'] })).toEqual(['asset:moon_blue', 'asset:moon_red'])
    expect(pick({ colors: ['blue'], themes: ['fantasy'] })).toEqual([])
    expect(pick({ inCollection: true })).toEqual(['asset:moon_blue'])
    expect(pick({ inBundle: true })).toEqual(['asset:moon_blue'])
    expect(pick({ collection: 'c1' })).toEqual(['asset:moon_blue'])
    expect(pick({ q: 'starry' })).toEqual(['asset:sky'])
    expect(pick({ q: 'red' })).toEqual(['asset:moon_red'])
    expect(pick({ q: '#nig' })).toEqual(['asset:moon_blue'])
    expect(pick({ q: '#sky' })).toEqual([])
  })

  it('groups variants of one design', () => {
    const groups = groupVariants([moonBlue, star, moonRed, plate])
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([['Moon', 2], ['Star', 1], ['Sky', 1]])
  })

  it('sorts by popularity, newness and name', () => {
    expect(sortItems([moonRed, moonBlue, star], 'popular').map((x) => x.value)).toEqual(['asset:star', 'asset:moon_blue', 'asset:moon_red'])
    expect(sortItems([star, moonBlue, moonRed], 'newest').map((x) => x.value)).toEqual(['asset:moon_red', 'asset:moon_blue', 'asset:star'])
    expect(sortItems([star, moonBlue], 'az')[0].value).toBe('asset:moon_blue')
  })

  it('wears one of each kind', () => {
    expect(wearPatch([{ kind: 'decoration', value: 'a' }, { kind: 'decoration', value: 'b' }, { kind: 'frame', value: 'f' }])).toEqual({ avatar_decoration: 'a', profile_frame: 'f' })
  })

  it('labels codes', () => {
    expect(labelOf({ cute_cozy: 'Cozy!' }, 'cute_cozy')).toBe('Cozy!')
    expect(labelOf({}, 'sci_fi')).toBe('Sci-Fi')
    expect(labelOf({}, 'space_opera')).toBe('Space Opera')
  })
})

describe('plainTags', () => {
  it('leaves out color: and theme: tags, which count as colours and themes', () => {
    expect(plainTags(['halo', 'color:light_blue', 'theme:holiday', 'foo:bar'])).toEqual(['halo', 'foo:bar'])
    expect(plainTags(undefined)).toEqual([])
  })
})
