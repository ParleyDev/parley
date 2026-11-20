import { describe, expect, it, vi } from 'vitest'

let lang = 'en'
vi.mock('./i18n', () => ({ resolvedLanguage: () => lang }))
vi.mock('./native', () => ({ openExternal: () => {} }))
const { guideUrl } = await import('./guide')

describe('guideUrl', () => {
  it('opens the English guide without a prefix', () => {
    lang = 'en'
    expect(guideUrl()).toBe('https://runparley.com/guide/')
    expect(guideUrl('messages#polls')).toBe('https://runparley.com/guide/messages/#polls')
  })
  it('opens the guide in the app language, with lowercase paths', () => {
    lang = 'de'
    expect(guideUrl('messages#polls')).toBe('https://runparley.com/de/guide/messages/#polls')
    lang = 'pt-BR'
    expect(guideUrl('profile')).toBe('https://runparley.com/pt-br/guide/profile/')
    lang = 'zh-CN'
    expect(guideUrl()).toBe('https://runparley.com/zh-cn/guide/')
  })
})
