import { useEffect, useState } from 'react'
import { locale } from '../lib/i18n'
import { timeOpts } from '../lib/format'

/** `<t:1700000000>` or `<t:1700000000:R>`: a moment shown in each reader's own time zone (Discord's styles). */
export const TIMESTAMP_SRC = '<t:-?\\d{1,13}(?::[tTdDfFR])?>'

export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

export function parseTimestamp(token: string): { date: Date; style: TimestampStyle } | null {
  const m = /^<t:(-?\d{1,13})(?::([tTdDfFR]))?>$/.exec(token)
  if (!m) return null
  const date = new Date(Number(m[1]) * 1000)
  if (Number.isNaN(date.getTime())) return null
  return { date, style: (m[2] as TimestampStyle) ?? 'f' }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]

/** "in 3 hours", "2 days ago": the largest unit that fits, like Discord's R style. */
export function relative(date: Date, now = Date.now()): string {
  const secs = Math.round((date.getTime() - now) / 1000)
  const [unit, size] = UNITS.find(([, s]) => Math.abs(secs) >= s) ?? ['second', 1]
  return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(Math.round(secs / size), unit)
}

export function formatTimestamp(date: Date, style: TimestampStyle, now = Date.now()): string {
  const l = locale()
  const time = timeOpts()
  switch (style) {
    case 't': return date.toLocaleTimeString(l, time)
    case 'T': return date.toLocaleTimeString(l, { ...time, second: '2-digit' })
    case 'd': return date.toLocaleDateString(l, { year: 'numeric', month: '2-digit', day: '2-digit' })
    case 'D': return date.toLocaleDateString(l, { year: 'numeric', month: 'long', day: 'numeric' })
    case 'F': return date.toLocaleString(l, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...time })
    case 'R': return relative(date, now)
    default: return date.toLocaleString(l, { year: 'numeric', month: 'long', day: 'numeric', ...time })
  }
}

// One shared clock for every relative timestamp on screen.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const tick = () => setNow(Date.now())
    listeners.add(tick)
    timer ??= setInterval(() => listeners.forEach((f) => f()), 15_000)
    return () => { listeners.delete(tick); if (!listeners.size && timer) { clearInterval(timer); timer = null } }
  }, [live])
  return now
}

export default function Timestamp({ token }: { token: string }) {
  const parsed = parseTimestamp(token)
  const now = useNow(parsed?.style === 'R')
  if (!parsed) return <>{token}</>
  const { date, style } = parsed
  return (
    <time dateTime={date.toISOString()} title={formatTimestamp(date, 'F', now)} className="rounded bg-bg-4/70 px-1 py-px" data-timestamp={style}>
      {formatTimestamp(date, style, now)}
    </time>
  )
}
