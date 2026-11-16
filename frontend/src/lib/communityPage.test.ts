import { describe, expect, test } from 'vitest'
import { communityPath, linkHost, parseCommunityPath, pageChanges, safeLink, validatePage } from './communityPage'

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

describe('validatePage', () => {
  const ok = { name: 'Metal', slug: 'metal', description: 'Loud', about: 'Hello', links: [{ label: 'Home', url: 'https://example.com/a' }] }
  const link = (label: string, url: string) => ({ label, url })
  test('valid input has no errors', () => { expect(validatePage(ok)).toEqual({}) })
  test('name: 1 to 100 characters', () => {
    expect(validatePage({ ...ok, name: '' })).toHaveProperty('name')
    expect(validatePage({ ...ok, name: '   ' })).toHaveProperty('name')
    expect(validatePage({ ...ok, name: 'a'.repeat(100) })).toEqual({})
    expect(validatePage({ ...ok, name: 'a'.repeat(101) })).toHaveProperty('name')
  })
  test('slug rule', () => {
    expect(validatePage({ ...ok, slug: 'a'.repeat(63) })).toEqual({})
    for (const slug of ['', 'Metal', '-x', 'a b', 'a'.repeat(64)]) expect(validatePage({ ...ok, slug })).toHaveProperty('slug')
  })
  test('description at most 300', () => {
    expect(validatePage({ ...ok, description: 'a'.repeat(300) })).toEqual({})
    expect(validatePage({ ...ok, description: 'a'.repeat(301) })).toHaveProperty('description')
  })
  test('about at most 4000, trailing whitespace does not count', () => {
    expect(validatePage({ ...ok, about: 'a'.repeat(4000) })).toEqual({})
    expect(validatePage({ ...ok, about: 'a'.repeat(4000) + '  \n' })).toEqual({})
    expect(validatePage({ ...ok, about: 'a'.repeat(4001) })).toHaveProperty('about')
  })
  test('at most 10 links', () => {
    const ten = Array.from({ length: 10 }, (_, i) => link(`l${i}`, 'https://example.com'))
    expect(validatePage({ ...ok, links: ten })).toEqual({})
    expect(validatePage({ ...ok, links: [...ten, link('x', 'https://example.com')] })).toHaveProperty('links')
  })
  test('link label 1 to 80', () => {
    expect(validatePage({ ...ok, links: [link('', 'https://example.com')] })).toHaveProperty('links.0')
    expect(validatePage({ ...ok, links: [link('a'.repeat(80), 'https://example.com')] })).toEqual({})
    expect(validatePage({ ...ok, links: [link('a'.repeat(81), 'https://example.com')] })).toHaveProperty('links.0')
  })
  test('link url: http or https with a host, no whitespace, at most 500', () => {
    for (const url of ['javascript:alert(1)', 'ftp://example.com', 'example.com', 'https://', 'https://exa mple.com', '', 'https://example.com/' + 'a'.repeat(500)]) expect(validatePage({ ...ok, links: [link('x', url)] })).toHaveProperty('links.0')
    expect(validatePage({ ...ok, links: [link('x', 'http://example.com')] })).toEqual({})
    expect(validatePage({ ...ok, links: [ok.links[0], link('x', 'javascript:1')] })).toEqual({ 'links.1': expect.any(String) })
  })
})

describe('pageChanges', () => {
  const base = { name: 'Metal', slug: 'metal', description: 'Loud', about: 'Hello', links: [{ label: 'A', url: 'https://a.example' }, { label: 'B', url: 'https://b.example' }], icon_url: '/i.png', banner_url: '/b.png' }
  const same = { name: 'Metal', slug: 'metal', description: 'Loud', about: 'Hello', links: base.links, icon: '/i.png', banner: '/b.png' }
  test('nothing changed sends nothing', () => { expect(pageChanges(same, base)).toEqual({}) })
  test('only the changed field is sent', () => { expect(pageChanges({ ...same, about: 'Changed' }, base)).toEqual({ about: 'Changed' }) })
  test('reordering links sends links', () => { expect(pageChanges({ ...same, links: [base.links[1], base.links[0]] }, base)).toEqual({ links: [base.links[1], base.links[0]] }) })
  test('clearing an image sends an empty string', () => { expect(pageChanges({ ...same, banner: null }, base)).toEqual({ banner_url: '' }) })
  test('trailing whitespace in about is not a change', () => { expect(pageChanges({ ...same, about: 'Hello \n\n' }, base)).toEqual({}) })
  test('a name with only surrounding spaces added is not a change', () => { expect(pageChanges({ ...same, name: ' Metal ' }, base)).toEqual({}) })
})
