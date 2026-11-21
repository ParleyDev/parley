import { describe, expect, it } from 'vitest'
import { byPriority, fitGrid, largestTile } from './callGrid'

const fits = (w: number, h: number, gap: number, f: ReturnType<typeof fitGrid>) => {
  const cells = f.cells
  const rows = Math.ceil(cells / f.cols)
  return f.cols * f.tileW + (f.cols - 1) * gap <= w && rows * f.tileH + (rows - 1) * gap <= h
}

describe('the call grid', () => {
  it('gives one person the space, up to the largest size', () => {
    const f = fitGrid(1200, 700, 1)
    expect(f).toMatchObject({ cols: 1, shown: 1, more: 0, tileW: 960 })
  })
  it('puts two side by side in a wide space and stacked in a tall one', () => {
    expect(fitGrid(1200, 500, 2).cols).toBe(2)
    expect(fitGrid(500, 900, 2).cols).toBe(1)
  })
  it('uses a square-ish arrangement for many', () => {
    const f = fitGrid(1280, 720, 9)
    expect(f.cols).toBe(3); expect(f.shown).toBe(9); expect(f.more).toBe(0)
  })
  it('never needs scrolling, whatever the space and the number of people', () => {
    for (const [w, h] of [[1600, 900], [1280, 720], [900, 600], [700, 900], [500, 400], [320, 240]]) {
      for (let n = 1; n <= 40; n++) {
        const f = fitGrid(w, h, n, 12, 220)
        expect(f.shown + f.more).toBe(n)
        expect(f.shown).toBeGreaterThanOrEqual(1)
        // Everything shown fits, unless the space is too small for one tile at the least size (then one is shown, as large as fits).
        if (f.tileW >= 220) expect(fits(w, h, 12, f), `${w}x${h} n=${n} ${JSON.stringify(f)}`).toBe(true)
        if (f.more === 0 && n > 1) expect(f.tileW).toBeGreaterThanOrEqual(220)
      }
    }
  })
  it('shows those that fit and counts the rest when there are too many', () => {
    const f = fitGrid(900, 500, 30)
    expect(f.more).toBeGreaterThan(0)
    expect(f.tileW).toBeGreaterThanOrEqual(220)
    expect(f.shown + f.more).toBe(30)
  })
  it('keeps 16:9', () => {
    const f = fitGrid(1000, 800, 5)
    expect(Math.abs(f.tileW / f.tileH - 16 / 9)).toBeLessThan(0.02)
  })
  it('finds the largest tile by trying every column count', () => {
    expect(largestTile(1200, 300, 4, 0).cols).toBe(4)
    expect(largestTile(300, 1200, 4, 0).cols).toBe(1)
  })
})

describe('who is shown first when not everyone fits', () => {
  it('is screen shares, cameras, people talking, then the rest, keeping order within each', () => {
    const tile = (id: string, kind: 'camera' | 'screen', hasVideo: boolean, talking: boolean) => ({ id, kind, hasVideo, talking })
    const out = byPriority([tile('quiet1', 'camera', false, false), tile('talk', 'camera', false, true), tile('cam', 'camera', true, false), tile('quiet2', 'camera', false, false), tile('screen', 'screen', true, false)])
    expect(out.map((x) => x.id)).toEqual(['screen', 'cam', 'talk', 'quiet1', 'quiet2'])
  })
})
