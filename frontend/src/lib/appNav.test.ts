import { describe, expect, it } from 'vitest'
import { inAppPath } from './appNav'

describe('inAppPath', () => {
  const o = 'https://chat.example'
  it('keeps admin console links on this site in the app', () => {
    expect(inAppPath('https://chat.example/admin/users/1?x=1#y', o)).toBe('/admin/users/1?x=1#y')
    expect(inAppPath('https://chat.example/admin', o)).toBe('/admin')
  })
  it('leaves everything else to the browser', () => {
    expect(inAppPath('https://evil.example/admin/users/1', o)).toBeNull()
    expect(inAppPath('https://chat.example/channels/@me', o)).toBeNull()
    expect(inAppPath('https://chat.example/administrator', o)).toBeNull()
    expect(inAppPath('not a url', o)).toBeNull()
  })
})
