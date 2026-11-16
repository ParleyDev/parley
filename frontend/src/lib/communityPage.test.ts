import { describe, expect, test } from 'vitest'
import { communityPath, linkHost, parseCommunityPath, safeLink } from './communityPage'

describe('community page helpers', () => {
  test('communityPath and parseCommunityPath round-trip', () => {
    expect(communityPath('g1', 'metal')).toBe('/channels/g1/c/metal')
    expect(parseCommunityPath('/channels/g1/c/metal')).toEqual({ guildId: 'g1', slug: 'metal' })
    expect(parseCommunityPath('/channels/g1/c/metal/')).toEqual({ guildId: 'g1', slug: 'metal' })
    for (const p of ['/channels/g1/c/', '/channels/g1/c/Metal', '/channels/g1/c/a/b', '/channels/g1/abc', '/channels/@me/c/x', '/c/x', '/channels/g1/c/-x', '/channels/g1/c/' + 'a'.repeat(64)]) expect(parseCommunityPath(p)).toBeNull()
    expect(parseCommunityPath('/channels/g1/c/' + 'a'.repeat(63))).not.toBeNull()
  })
  test('linkHost', () => {
    expect(linkHost('https://www.example.com/a?b=1')).toBe('example.com')
    expect(linkHost('http://sub.example.org')).toBe('sub.example.org')
    expect(linkHost('not a url')).toBe('')
  })
  test('safeLink', () => {
    expect(safeLink('https://example.com/x')).toBe('https://example.com/x')
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', '', 'example.com']) expect(safeLink(u)).toBeNull()
  })
})
