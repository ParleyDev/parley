/** Discord's slowmode choices, in seconds. */
export const SLOWMODE: { label: string; seconds: number }[] = [
  { label: 'Off', seconds: 0 }, { label: '5s', seconds: 5 }, { label: '10s', seconds: 10 }, { label: '15s', seconds: 15 }, { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 }, { label: '2m', seconds: 120 }, { label: '5m', seconds: 300 }, { label: '10m', seconds: 600 }, { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 }, { label: '1h', seconds: 3600 }, { label: '2h', seconds: 7200 }, { label: '6h', seconds: 21600 },
]

/** "30s", "2m", "1h 30m" for a slowmode or a countdown. */
export function shortDuration(secs: number): string {
  const s = Math.max(0, Math.ceil(secs))
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return [h && `${h}h`, m && `${m}m`, !h && r && `${r}s`].filter(Boolean).join(' ')
}
