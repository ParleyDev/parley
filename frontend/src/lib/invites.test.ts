import { describe, expect, test } from 'vitest'
import { inviteTarget, landingPath } from './invites'

describe('inviteTarget', () => {
  test('reads a valid slug', () => {
    expect(inviteTarget('?to=metallica&utm_source=x')).toBe('metallica')
    expect(inviteTarget('?utm_source=x')).toBeNull()
    expect(inviteTarget('?to=Not%20A%20Slug')).toBeNull()
    expect(inviteTarget('')).toBeNull()
  })
  test('rejects anything that is not a slug', () => {
    expect(inviteTarget('?to=../../x')).toBeNull()
    expect(inviteTarget('?to=-a')).toBeNull()
    expect(inviteTarget('?to=' + 'a'.repeat(64))).toBeNull()
    expect(inviteTarget('?to=a' + 'b'.repeat(62))).not.toBeNull()
  })
})

describe('landingPath', () => {
  const kinds: Record<string, string> = { v: 'voice', t1: 'text', t2: 'text' }
  test('first text channel of the community', () => {
    expect(landingPath('g', ['v', 't1', 't2'], (id) => kinds[id], 'f')).toBe('/channels/g/t1')
  })
  test('first id when no kind is known', () => {
    expect(landingPath('g', ['x', 'y'], () => undefined, 'f')).toBe('/channels/g/x')
  })
  test('no channels falls back to the server path', () => {
    expect(landingPath('g', [], () => undefined, 'f')).toBe('/channels/g/f')
    expect(landingPath('g', [], () => undefined, null)).toBe('/channels/g')
  })
})
