/**
 * The call grid: tiles keep 16:9 and are as large as fits the space, with no scrolling. When there are more people
 * than fit at a size worth looking at, the grid shows those that fit and a "+N" tile for the rest.
 */
export interface GridFit {
  /** Columns, and each tile's width and height in px. */
  cols: number
  tileW: number
  tileH: number
  /** How many of the tiles are shown; the rest are behind "+N" (which takes one more cell). */
  shown: number
  /** Tiles not shown. */
  more: number
  /** Cells drawn: the tiles shown, and one for "+N" when there is room for it (with room for a single cell, "+N" is a badge on it). */
  cells: number
}

const RATIO = 16 / 9

/** The largest 16:9 tile that lets `n` cells fit in `w` × `h` with `gap` between them, and the columns that give it. */
export function largestTile(w: number, h: number, n: number, gap: number): { cols: number; tileW: number } {
  let best = { cols: 1, tileW: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const byWidth = (w - gap * (cols - 1)) / cols
    const byHeight = ((h - gap * (rows - 1)) / rows) * RATIO
    const tileW = Math.floor(Math.min(byWidth, byHeight))
    if (tileW > best.tileW) best = { cols, tileW }
  }
  return best
}

/**
 * Fit `n` tiles into `w` × `h`. Tiles never get narrower than `minW` or wider than `maxW`: below `minW` fewer are
 * shown, with one cell kept for "+N". A space too small for even one tile at `minW` still gets one, as large as fits.
 */
export function fitGrid(w: number, h: number, n: number, gap = 12, minW = 220, maxW = 960): GridFit {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, tileW: 0, tileH: 0, shown: 0, more: 0, cells: 0 }
  const size = (cells: number) => { const b = largestTile(w, h, cells, gap); const tileW = Math.min(maxW, b.tileW); return { cols: b.cols, tileW, tileH: Math.floor(tileW / RATIO) } }
  const all = size(n)
  if (all.tileW >= minW || n === 1) return { ...all, shown: n, more: 0, cells: n }
  // The most cells that fit at the least width; one of them is "+N".
  let cells = n - 1
  while (cells > 1 && size(cells).tileW < minW) cells--
  const fit = size(cells)
  const shown = cells === 1 ? 1 : cells - 1
  return { ...fit, shown, more: n - shown, cells }
}

/** Who gets the cells when not everyone fits: screen shares, then cameras, then people talking, then the rest, each in its given order. */
export function byPriority<T extends { kind: 'camera' | 'screen'; hasVideo: boolean; talking: boolean }>(tiles: T[]): T[] {
  const rank = (t: T) => (t.kind === 'screen' ? 0 : t.hasVideo ? 1 : t.talking ? 2 : 3)
  return tiles.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t)
}
