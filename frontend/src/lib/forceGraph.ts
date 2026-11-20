/**
 * A small force layout for the admin Network view: nodes push each other apart, links pull their ends together, and
 * everything drifts gently to the middle. Repulsion only looks at nearby nodes (a grid of `CELL`-sized buckets), so a
 * step stays cheap with a couple of thousand nodes.
 */
export interface SimNode { id: string; x: number; y: number; vx: number; vy: number; r: number; pin?: boolean; drag?: boolean }
export interface SimLink { a: string; b: string; len: number; k: number }

const CELL = 220
const REPEL = 5200

/** A stable pseudo-random number in [0, 1) for a string, so a graph lays out the same way every time. */
export function unit(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967296
}

export class Sim {
  nodes = new Map<string, SimNode>()
  links: SimLink[] = []
  alpha = 1

  /**
   * `prev` keeps nodes where they were; a new node starts next to `home(id)` when that node already has a place
   * (a person next to their server), otherwise on a ring around the middle.
   */
  constructor(ids: { id: string; r: number }[], links: SimLink[], opts: { prev?: Map<string, SimNode>; home?: (id: string) => string | undefined; pin?: string } = {}) {
    const { prev, home, pin } = opts
    for (const { id, r } of ids) {
      const old = prev?.get(id)
      const h = !old && home ? home(id) : undefined
      const base = h ? prev?.get(h) : undefined
      const a = unit(id) * Math.PI * 2, d = base ? 30 + unit(id + 'd') * 40 : 60 + unit(id + 'd') * 220
      this.nodes.set(id, old ? { ...old, r, vx: 0, vy: 0, pin: false, drag: false } : { id, r, x: (base?.x ?? 0) + Math.cos(a) * d, y: (base?.y ?? 0) + Math.sin(a) * d, vx: 0, vy: 0 })
    }
    if (pin) { const p = this.nodes.get(pin); if (p) { p.pin = true; if (!prev?.has(pin)) { p.x = 0; p.y = 0 } } }
    this.links = links.filter((l) => this.nodes.has(l.a) && this.nodes.has(l.b) && l.a !== l.b)
    if (prev && prev.size) this.alpha = 0.6
  }

  step() {
    const k = this.alpha, list = [...this.nodes.values()]
    const grid = new Map<string, SimNode[]>()
    for (const n of list) { const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`; const g = grid.get(key); if (g) g.push(n); else grid.set(key, [n]) }
    for (const n of list) {
      const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL)
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const m of grid.get(`${gx},${gy}`) ?? []) {
          if (m.id <= n.id) continue
          let dx = m.x - n.x, dy = m.y - n.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = unit(n.id + m.id) - 0.5; dy = unit(m.id + n.id) - 0.5; d2 = dx * dx + dy * dy }
          const d = Math.sqrt(d2), touch = n.r + m.r + 10
          const f = (REPEL / d2 + (d < touch ? (touch - d) * 0.5 : 0)) * k
          dx /= d; dy /= d
          n.vx -= dx * f; n.vy -= dy * f; m.vx += dx * f; m.vy += dy * f
        }
      }
    }
    for (const l of this.links) {
      const a = this.nodes.get(l.a)!, b = this.nodes.get(l.b)!
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
      const f = (d - l.len) * l.k * k
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
    }
    for (const n of list) {
      if (n.pin || n.drag) { n.vx = n.vy = 0; continue }
      n.vx -= n.x * 0.004 * k; n.vy -= n.y * 0.004 * k
      n.vx *= 0.6; n.vy *= 0.6
      // A cap keeps a crowded start from flinging nodes across the screen.
      const v = Math.hypot(n.vx, n.vy); if (v > 40) { n.vx *= 40 / v; n.vy *= 40 / v }
      n.x += n.vx; n.y += n.vy
    }
    this.alpha = Math.max(0.02, this.alpha * 0.985)
  }

  settle(steps: number) { for (let i = 0; i < steps; i++) this.step() }

  /** The box around every node, labels included. */
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of this.nodes.values()) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 16) }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 }
  }
}
