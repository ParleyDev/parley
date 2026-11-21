/**
 * The call's connection as one state machine: a pure reducer over the events the voice engine sees, so "what does the
 * member see now" has one answer and can be tested without a browser.
 *
 *   idle ── join ──▶ connecting ── up ──▶ connected
 *                        │  ▲                 │
 *                        │  └── retry ──┐     │ lost (an error, not the member or a moderator)
 *                        ▼              │     ▼
 *                     failed ◀── gave up ── reconnecting
 *
 * `failed` keeps the channel so Try again knows where to go, but the engine has left the call by then: a member is
 * never left looking connected with nothing carrying their sound.
 */

export type CallPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

/** Why a call is reconnecting or failed, in the engine's terms; the UI words them (callFailureText). */
export type CallReason =
  /** The app's own connection to the server went away. */
  | 'socket'
  /** The media server (or the route to it) dropped the call. */
  | 'transport'
  /** The server said no: full, no permission, timed out. Not worth retrying on our own. */
  | 'refused'
  /** No microphone could be opened. */
  | 'microphone'
  /** This browser cannot join (encrypted call without the means to encrypt). */
  | 'unsupported'

export interface CallState {
  phase: CallPhase
  channelId: string | null
  reason: CallReason | null
  /** The engine's own words for the logs (Copy Logs), never shown as the message. */
  detail: string | null
  /** Reconnect attempts made in the current window. */
  attempts: number
  /** When the current window of attempts began (ms). */
  windowStart: number
}

export type CallEvent =
  | { type: 'join'; channelId: string }
  /** The transport carries the call: the server acknowledged a mesh join, or the media server room is connected. */
  | { type: 'up' }
  /** The transport dropped through no choice of ours. `now` in ms. */
  | { type: 'lost'; reason: CallReason; detail?: string; now: number }
  /** The transport says it is repairing itself (the media server client's own reconnect): show it, count nothing. */
  | { type: 'wobble' }
  /** A reconnect attempt began. */
  | { type: 'retry' }
  /** Nothing more to try, or nothing worth trying. */
  | { type: 'fail'; reason: CallReason; detail?: string }
  /** The member left, was moved out, or dismissed a failed call. */
  | { type: 'leave' }

/** Reconnect only so often: a few quick attempts, then say it failed and let the member decide. */
export const RECONNECT = { windowMs: 30_000, maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 8000 }

export const IDLE: CallState = { phase: 'idle', channelId: null, reason: null, detail: null, attempts: 0, windowStart: 0 }

export function reduce(s: CallState, e: CallEvent): CallState {
  switch (e.type) {
    case 'join':
      return { ...IDLE, phase: 'connecting', channelId: e.channelId }
    case 'leave':
      return IDLE
    case 'fail':
      // Failing needs a call to have failed: there is nowhere to "try again" from idle.
      if (!s.channelId || s.phase === 'failed') return s
      return { ...s, phase: 'failed', reason: e.reason, detail: e.detail ?? null }
    case 'up':
      if (s.phase === 'connecting' || s.phase === 'reconnecting') return { ...s, phase: 'connected', reason: null, detail: null }
      return s
    case 'wobble':
      if (s.phase === 'connected') return { ...s, phase: 'reconnecting', reason: 'transport', detail: null }
      return s
    case 'lost': {
      if (s.phase === 'idle' || s.phase === 'failed') return s
      // The socket has its own retry loop (lib/ws.ts): losing it shows as reconnecting and uses up no attempts.
      if (e.reason === 'socket') return { ...s, phase: 'reconnecting', reason: 'socket', detail: e.detail ?? null }
      const fresh = e.now - s.windowStart > RECONNECT.windowMs
      const attempts = fresh ? 1 : s.attempts + 1
      const windowStart = fresh ? e.now : s.windowStart
      if (attempts > RECONNECT.maxAttempts) return { ...s, phase: 'failed', reason: e.reason, detail: e.detail ?? null, attempts, windowStart }
      return { ...s, phase: 'reconnecting', reason: e.reason, detail: e.detail ?? null, attempts, windowStart }
    }
    case 'retry':
      return s
  }
}

/** How long to wait before the reconnect attempt the state now calls for; null when there is none to make. */
export function retryDelay(s: CallState): number | null {
  if (s.phase !== 'reconnecting' || s.reason === 'socket' || s.attempts < 1) return null
  return Math.min(RECONNECT.maxDelayMs, RECONNECT.baseDelayMs * 2 ** (s.attempts - 1))
}

/** What must hold whatever happened; the tests throw random event sequences at the reducer and check these. */
export function invariants(s: CallState): string[] {
  const bad: string[] = []
  if ((s.phase === 'idle') !== (s.channelId === null)) bad.push('idle exactly when there is no channel')
  if (s.phase === 'connected' && s.reason) bad.push('a connected call has no failure reason')
  if ((s.phase === 'reconnecting' || s.phase === 'failed') && !s.reason) bad.push('reconnecting and failed say why')
  if (s.phase !== 'failed' && s.attempts > RECONNECT.maxAttempts) bad.push('past the last attempt the call is failed')
  if (s.attempts < 0) bad.push('attempts never go negative')
  return bad
}
