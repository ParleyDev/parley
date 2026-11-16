import { expect, test } from 'vitest'
import type { Channel } from './types'
import { changedPositions, defaultChannel, firstTextChannel } from './channelOrder'

const at = (position: number, parent_id: string | null = null) => ({ position, parent_id })

test('moving within a group sends only that group, and only what shifted', () => {
  const stored = { a: at(0, 'c1'), b: at(1, 'c1'), c: at(2, 'c1'), x: at(0, 'c2'), y: at(1, 'c2') }
  expect(changedPositions(stored, [{ parent_id: 'c1', ids: ['a', 'c', 'b'] }])).toEqual([{ id: 'c', position: 1, parent_id: 'c1' }, { id: 'b', position: 2, parent_id: 'c1' }])
})
test('moving to another group renumbers the source and the target, nothing else', () => {
  const stored = { a: at(0, 'c1'), b: at(1, 'c1'), x: at(0, 'c2'), y: at(1, 'c2'), z: at(0, 'c3') }
  const r = changedPositions(stored, [{ parent_id: 'c1', ids: ['b'] }, { parent_id: 'c2', ids: ['x', 'a', 'y'] }])
  expect(r).toEqual([{ id: 'b', position: 0, parent_id: 'c1' }, { id: 'a', position: 1, parent_id: 'c2' }, { id: 'y', position: 2, parent_id: 'c2' }])
  expect(r.some((i) => i.id === 'z')).toBe(false)
})
test('a channel whose parent changed is sent even at the same index', () => {
  expect(changedPositions({ a: at(0, 'c1') }, [{ parent_id: null, ids: ['a'] }])).toEqual([{ id: 'a', position: 0, parent_id: null }])
})
test('an unchanged order sends nothing', () => {
  expect(changedPositions({ a: at(0), b: at(1) }, [{ parent_id: null, ids: ['a', 'b'] }])).toEqual([])
})
test('categories go without a parent', () => {
  expect(changedPositions({ a: at(0), b: at(1) }, [{ parent_id: null, ids: ['b', 'a'] }], false)).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }])
})

const ch = (id: string, kind: Channel['kind'], position: number, parent_id: string | null = null, created_at = '2024-01-01T00:00:00Z') => ({ id, kind, position, parent_id, created_at }) as Channel

test('firstTextChannel follows sidebar order when every group restarts at 0', () => {
  const list = [ch('low-chat', 'text', 0, 'catB'), ch('top-chat', 'text', 0, 'catA'), ch('top-2', 'text', 1, 'catA'), ch('catB', 'category', 1), ch('catA', 'category', 0)]
  expect(firstTextChannel(list)?.id).toBe('top-chat')
})
test('firstTextChannel prefers an uncategorised channel, then breaks ties by created_at', () => {
  expect(firstTextChannel([ch('c1', 'text', 5, 'cat'), ch('cat', 'category', 0), ch('loose', 'text', 9)])?.id).toBe('loose')
  expect(firstTextChannel([ch('n', 'text', 0, null, '2024-02-01T00:00:00Z'), ch('o', 'text', 0, null, '2024-01-01T00:00:00Z')])?.id).toBe('o')
})
test('firstTextChannel skips voice channels and excluded categories', () => {
  const list = [ch('cat1', 'category', 0), ch('v', 'voice', 0, 'cat1'), ch('t1', 'text', 1, 'cat1'), ch('cat2', 'category', 1), ch('t2', 'text', 0, 'cat2')]
  expect(firstTextChannel(list, { excludeCategoryIds: new Set(['cat1']) })?.id).toBe('t2')
  expect(firstTextChannel(list)?.id).toBe('t1')
})
test('defaultChannel falls back to the unrestricted first text channel when everything is excluded', () => {
  const list = [ch('cat1', 'category', 0), ch('t1', 'text', 0, 'cat1')]
  expect(firstTextChannel(list, { excludeCategoryIds: new Set(['cat1']) })).toBeUndefined()
  expect(defaultChannel(list, new Set(['cat1']))?.id).toBe('t1')
  expect(defaultChannel([])).toBeUndefined()
})
