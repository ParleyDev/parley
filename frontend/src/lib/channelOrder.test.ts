import { expect, test } from 'vitest'
import { changedPositions } from './channelOrder'

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
