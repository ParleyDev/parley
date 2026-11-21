import { describe, expect, it } from 'vitest'
import { IDLE, RECONNECT, invariants, reduce, retryDelay, type CallEvent, type CallReason, type CallState } from './callState'

const run = (events: CallEvent[], from: CallState = IDLE) => events.reduce(reduce, from)
const lost = (now: number, reason: CallReason = 'transport'): CallEvent => ({ type: 'lost', reason, now })

describe('a call that goes well', () => {
  it('connects, and leaving returns to idle', () => {
    const s = run([{ type: 'join', channelId: 'c' }])
    expect(s.phase).toBe('connecting')
    expect(run([{ type: 'up' }], s).phase).toBe('connected')
    expect(run([{ type: 'up' }, { type: 'leave' }], s)).toEqual(IDLE)
  })
  it('ignores transport news when there is no call', () => {
    expect(run([{ type: 'up' }])).toEqual(IDLE)
    expect(run([lost(0)])).toEqual(IDLE)
    expect(run([{ type: 'fail', reason: 'refused' }])).toEqual(IDLE)
    expect(run([{ type: 'wobble' }])).toEqual(IDLE)
  })
})

describe('a call that drops', () => {
  const up = run([{ type: 'join', channelId: 'c' }, { type: 'up' }])
  it('reconnects with a growing delay and comes back', () => {
    const a = run([lost(1000)], up)
    expect(a.phase).toBe('reconnecting'); expect(a.attempts).toBe(1); expect(retryDelay(a)).toBe(RECONNECT.baseDelayMs)
    const b = run([lost(2000)], a)
    expect(b.attempts).toBe(2); expect(retryDelay(b)).toBe(RECONNECT.baseDelayMs * 2)
    const back = run([{ type: 'up' }], b)
    expect(back.phase).toBe('connected'); expect(back.reason).toBe(null); expect(retryDelay(back)).toBe(null)
  })
  it('gives up after the last attempt in the window, keeping the channel for Try again', () => {
    let s = up
    for (let i = 0; i < RECONNECT.maxAttempts; i++) { s = reduce(s, lost(1000 + i)); expect(s.phase).toBe('reconnecting') }
    s = reduce(s, lost(2000))
    expect(s.phase).toBe('failed'); expect(s.channelId).toBe('c'); expect(s.reason).toBe('transport'); expect(retryDelay(s)).toBe(null)
    // Nothing moves a failed call but the member: more bad news changes nothing.
    expect(reduce(s, lost(3000))).toBe(s)
    expect(reduce(s, { type: 'up' })).toBe(s)
    expect(reduce(s, { type: 'join', channelId: 'c' }).phase).toBe('connecting')
    expect(reduce(s, { type: 'leave' })).toEqual(IDLE)
  })
  it('starts counting again once the window has passed', () => {
    let s = up
    for (let i = 0; i < RECONNECT.maxAttempts; i++) s = reduce(s, lost(1000 + i))
    s = reduce(s, { type: 'up' })
    s = reduce(s, lost(1000 + RECONNECT.windowMs + 1))
    expect(s.phase).toBe('reconnecting'); expect(s.attempts).toBe(1)
  })
  it('caps the delay', () => {
    let s = up
    for (let i = 0; i < RECONNECT.maxAttempts; i++) s = reduce(s, lost(1000 + i))
    expect(retryDelay(s)).toBeLessThanOrEqual(RECONNECT.maxDelayMs)
  })
  it('shows a lost socket as reconnecting without spending attempts or scheduling its own retry', () => {
    const s = run([lost(1000, 'socket'), lost(1500, 'socket'), lost(2000, 'socket')], up)
    expect(s.phase).toBe('reconnecting'); expect(s.reason).toBe('socket'); expect(s.attempts).toBe(0); expect(retryDelay(s)).toBe(null)
    expect(reduce(s, { type: 'up' }).phase).toBe('connected')
  })
  it('shows the transport repairing itself, and its recovery', () => {
    const s = reduce(up, { type: 'wobble' })
    expect(s.phase).toBe('reconnecting'); expect(s.attempts).toBe(0); expect(retryDelay(s)).toBe(null)
    expect(reduce(s, { type: 'up' }).phase).toBe('connected')
  })
  it('fails at once when the server refuses', () => {
    const s = run([{ type: 'join', channelId: 'c' }, { type: 'fail', reason: 'refused', detail: 'full' }])
    expect(s.phase).toBe('failed'); expect(s.reason).toBe('refused'); expect(s.detail).toBe('full')
  })
})

describe('whatever happens', () => {
  // A small seeded generator: failures print the seed, and the same seed replays the same sequence.
  const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const reasons: CallReason[] = ['socket', 'transport', 'refused', 'microphone', 'unsupported']
  it('holds its invariants over random sequences of events', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed); let s = IDLE; let now = 0
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      for (let i = 0; i < 80; i++) {
        now += Math.floor(r() * 12_000)
        const e: CallEvent = pick<CallEvent>([
          { type: 'join', channelId: pick(['a', 'b']) }, { type: 'up' }, { type: 'wobble' }, { type: 'retry' }, { type: 'leave' },
          { type: 'lost', reason: pick(reasons), now }, { type: 'lost', reason: 'transport', now }, { type: 'fail', reason: pick(reasons) },
        ])
        const next = reduce(s, e)
        expect(invariants(next), `seed ${seed}, step ${i}: ${JSON.stringify(e)} on ${JSON.stringify(s)}`).toEqual([])
        // Only the member (join, leave) moves a call out of failed or idle.
        if ((s.phase === 'failed' || s.phase === 'idle') && e.type !== 'join' && e.type !== 'leave') expect(next).toBe(s)
        // Leaving always ends at idle, and joining always starts clean.
        if (e.type === 'leave') expect(next).toEqual(IDLE)
        if (e.type === 'join') expect(next).toEqual({ ...IDLE, phase: 'connecting', channelId: e.channelId })
        // A retry is owed exactly while reconnecting over a lost transport.
        expect(retryDelay(next) !== null).toBe(next.phase === 'reconnecting' && next.reason !== 'socket' && next.attempts > 0)
        s = next
      }
    }
  })
})
