import { STORAGE_PREFIX } from './brand'

const KEY = `${STORAGE_PREFIX}welcomePending`

const load = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const save = (v: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-20))) } catch { /* ignore */ } }

/** Just joined this server: show its welcome screen the first time it is opened. */
export function markJoined(guildId: string) { const v = load(); if (!v.includes(guildId)) save([...v, guildId]) }

/** Whether the welcome screen is still owed for this server; asking clears it. */
export function takeWelcome(guildId: string): boolean { const v = load(); if (!v.includes(guildId)) return false; save(v.filter((x) => x !== guildId)); return true }
