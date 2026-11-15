import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError } from './api'
import { useStore } from '../store'
import { inviteTarget, landingPath, resolveInviteLanding } from './invites'

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

describe('resolveInviteLanding', () => {
  const comm = { id: 'c1', guild_id: 'g', slug: 'metallica', name: 'Metallica', icon_url: null, description: '', category_id: 'cat', channel_ids: ['t1'] }
  const spies = () => {
    const upsertCommunity = vi.fn(), followCommunity = vi.fn(async () => {})
    vi.spyOn(useStore, 'getState').mockReturnValue({ upsertCommunity, followCommunity, channels: { t1: { kind: 'text' } } } as unknown as ReturnType<typeof useStore.getState>)
    return { upsertCommunity, followCommunity }
  }
  afterEach(() => vi.restoreAllMocks())

  test('no target skips the request', async () => {
    const get = vi.spyOn(api, 'get')
    expect(await resolveInviteLanding('g', null, 'f')).toBe('/channels/g/f')
    expect(get).not.toHaveBeenCalled()
  })
  test('a missing community falls back', async () => {
    const { followCommunity } = spies()
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'Community not found'))
    expect(await resolveInviteLanding('g', 'metallica', 'f')).toBe('/channels/g/f')
    expect(followCommunity).not.toHaveBeenCalled()
  })
  test('a network error falls back', async () => {
    const { followCommunity } = spies()
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await resolveInviteLanding('g', 'metallica', null)).toBe('/channels/g')
    expect(followCommunity).not.toHaveBeenCalled()
  })
  test('a community without channels falls back', async () => {
    const { upsertCommunity, followCommunity } = spies()
    vi.spyOn(api, 'get').mockResolvedValue({ ...comm, channel_ids: [] })
    expect(await resolveInviteLanding('g', 'metallica', 'f')).toBe('/channels/g/f')
    expect(upsertCommunity).not.toHaveBeenCalled()
    expect(followCommunity).not.toHaveBeenCalled()
  })
  test('success upserts, follows and lands in the community', async () => {
    const { upsertCommunity, followCommunity } = spies()
    const get = vi.spyOn(api, 'get').mockResolvedValue(comm)
    expect(await resolveInviteLanding('g', 'metallica', 'f')).toBe('/channels/g/t1')
    expect(get).toHaveBeenCalledWith('/guilds/g/communities/metallica')
    expect(upsertCommunity).toHaveBeenCalledWith({ id: 'c1', guild_id: 'g', slug: 'metallica', name: 'Metallica', icon_url: null, description: '', category_id: 'cat' })
    expect(followCommunity).toHaveBeenCalledWith('g', 'metallica', true)
  })
})
