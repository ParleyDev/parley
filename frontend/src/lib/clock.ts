import { api } from './api'

/**
 * The server's clock, as seen from here: shared playback and takes are timed in server time, and this device's clock
 * may be off by seconds. Measured with a round trip (best of a few) and refreshed now and then.
 */
let offset = 0
let measured = 0
let pending: Promise<void> | null = null

async function measure() {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    try {
      const { now } = await api.get<{ now: number }>('/studio/clock')
      const t1 = Date.now(), rtt = t1 - t0
      if (rtt < best) { best = rtt; offset = Math.round(now - (t0 + rtt / 2)) }
    } catch { return }
  }
  measured = Date.now()
}

/** Make sure the offset is known (and fresh: within ten minutes). */
export function syncClock(): Promise<void> {
  if (Date.now() - measured < 600_000) return Promise.resolve()
  return (pending ??= measure().finally(() => { pending = null }))
}

/** Server time now, in ms. */
export const serverNow = () => Date.now() + offset
/** A server timestamp in this device's clock. */
export const toLocal = (serverMs: number) => serverMs - offset
