/** Human label for a session's user agent: "Chrome on Windows", "Safari on iPhone", "Parley e2e"... */
export function describeUa(ua: string): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari' :
    /Chromium\//.test(ua) ? 'Chromium' :
    /HeadlessChrome/.test(ua) ? 'Headless Chrome' : null
  const os =
    /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') :
    /Android/.test(ua) ? 'Android' :
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /CrOS/.test(ua) ? 'ChromeOS' :
    /Linux/.test(ua) ? 'Linux' : null
  if (browser && os) return `${browser} on ${os}`
  if (browser) return browser
  if (os) return os
  // Not a browser: show the first token (curl/7.88, node, a script's own name).
  return ua.split(/[\s/(]/)[0]?.slice(0, 40) || 'Unknown device'
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString()
}

export type UaKind = 'phone' | 'tablet' | 'desktop' | 'other'
/** Rough device class for an icon: phone, tablet, desktop browser, or something else (scripts, bots). */
export function uaKind(ua: string): UaKind {
  if (!ua) return 'other'
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua) && /Mozilla/.test(ua)) return 'tablet'
  if (/iPhone|Android.*Mobile|Mobile Safari|Windows Phone/.test(ua)) return 'phone'
  if (/Mozilla|Chrome|Safari|Firefox|Edg\//.test(ua)) return 'desktop'
  return 'other'
}

/** "Local network" for private/loopback addresses; the address otherwise. */
export function describeIp(ip: string): string {
  if (!ip) return 'unknown network'
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|fc|fd|fe80)/i.test(ip)) return `${ip} · local network`
  return ip
}
