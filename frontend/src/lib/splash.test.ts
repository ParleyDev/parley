import { describe, expect, it } from 'vitest'
import { splashBackground } from './splash'

describe('splashBackground', () => {
  it('quotes the url and encodes characters that could end it', () => {
    const css = splashBackground('https://x.test/a")b(c).png')!
    expect(css).toContain('url("https://x.test/a%22%29b%28c%29.png")')
    expect(css.match(/"/g)).toHaveLength(2)
  })
  it('returns nothing without a splash', () => {
    expect(splashBackground(null)).toBeUndefined()
    expect(splashBackground('')).toBeUndefined()
  })
})
