/** VOICE_REACTION fan-out: tiles subscribe and float the emoji over that person. */
export type CallReactionListener = (userId: string, emoji: string) => void
export const callReactionListeners = new Set<CallReactionListener>()
export function emitCallReaction(userId: string, emoji: string) { callReactionListeners.forEach((l) => l(userId, emoji)) }
