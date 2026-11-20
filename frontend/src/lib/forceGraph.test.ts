import { describe, expect, it } from 'vitest'
import { Sim, unit } from './forceGraph'

const dist = (s: Sim, a: string, b: string) => { const p = s.nodes.get(a)!, q = s.nodes.get(b)!; return Math.hypot(p.x - q.x, p.y - q.y) }

describe('force layout', () => {
  it('is deterministic', () => {
    expect(unit('maya')).toBe(unit('maya'))
    const mk = () => { const s = new Sim(['a', 'b', 'c'].map((id) => ({ id, r: 12 })), [{ a: 'a', b: 'b', len: 90, k: 0.04 }]); s.settle(100); return [...s.nodes.values()].map((n) => [n.x, n.y]) }
    expect(mk()).toEqual(mk())
  })

  it('pulls linked nodes together and keeps everyone apart', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, r: 12 }))
    const s = new Sim(ids, [{ a: 'a', b: 'b', len: 80, k: 0.04 }, { a: 'c', b: 'd', len: 80, k: 0.04 }])
    s.settle(400)
    expect(dist(s, 'a', 'b')).toBeLessThan(dist(s, 'a', 'e'))
    for (const p of ids) for (const q of ids) if (p.id < q.id) expect(dist(s, p.id, q.id)).toBeGreaterThan(24)
  })

  it('keeps the pinned focus in the middle and drops links to missing nodes', () => {
    const s = new Sim([{ id: 'me', r: 20 }, { id: 'x', r: 12 }], [{ a: 'me', b: 'x', len: 90, k: 0.04 }, { a: 'me', b: 'gone', len: 90, k: 0.04 }], { pin: 'me' })
    s.settle(200)
    expect(s.nodes.get('me')).toMatchObject({ x: 0, y: 0 })
    expect(s.links).toHaveLength(1)
  })

  it('starts new nodes next to their home and keeps old ones in place', () => {
    const first = new Sim([{ id: 'srv', r: 30 }], [])
    first.nodes.get('srv')!.x = 500
    const next = new Sim([{ id: 'srv', r: 30 }, { id: 'p', r: 12 }], [], { prev: first.nodes, home: () => 'srv' })
    expect(next.nodes.get('srv')!.x).toBe(500)
    expect(Math.abs(next.nodes.get('p')!.x - 500)).toBeLessThan(80)
  })
})
