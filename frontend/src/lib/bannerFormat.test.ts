import { describe, expect, it } from 'vitest'
import { DEFAULT_BANNER, parseBanner, withBanner } from './bannerFormat'

const U = '/api/images/0190a4b6-7c1e-7d3a-9f00-000000000001'

describe('banner format', () => {
  it('reads a plain picture as filled and centred', () => {
    expect(parseBanner(U)).toEqual({ base: U, format: DEFAULT_BANNER })
    expect(parseBanner(null).base).toBe('')
  })
  it('keeps a fill as #crop=, the same as other framed pictures', () => {
    const url = withBanner(U, { fit: 'fill', z: 1.5, x: 20, y: 80 })
    expect(url).toBe(`${U}#crop=1.5,20,80`)
    expect(parseBanner(url).format).toEqual({ fit: 'fill', z: 1.5, x: 20, y: 80 })
    expect(withBanner(url, DEFAULT_BANNER)).toBe(U)
  })
  it('stores a fit as #fit=x,y and switches between the two', () => {
    const url = withBanner(`${U}#crop=2,10,10`, { fit: 'fit', z: 3, x: 0, y: 100 })
    expect(url).toBe(`${U}#fit=0,100`)
    expect(parseBanner(url)).toEqual({ base: U, format: { fit: 'fit', z: 1, x: 0, y: 100 } })
    expect(withBanner(url, { fit: 'fill', z: 1, x: 50, y: 0 })).toBe(`${U}#crop=1,50,0`)
  })
  it('clamps what it reads', () => {
    expect(parseBanner(`${U}#fit=250,50`).format.x).toBe(100)
  })
})
