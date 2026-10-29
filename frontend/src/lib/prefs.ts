import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'
import { desktop, desktopBridge } from './desktop'

/**
 * Client-side preferences beyond theme/density (Appearance extras, Accessibility, Chat). Stored per browser;
 * the ones that are pure CSS are pushed onto <html> by applyPrefs, the rest are read by components.
 */
export interface ClientPrefs {
  // Appearance
  /** Accent colour (hex) or null for the theme's own. */
  accent: string | null
  /** Space between message groups, px (0–24). */
  messageGap: number
  /** Zoom level, % (50–200). */
  zoom: number
  /** Show avatars in compact mode. */
  compactAvatars: boolean
  /** Role colours: in names, as a dot next to names, or off. */
  roleColors: 'name' | 'next' | 'off'
  // Accessibility
  /** UI saturation, % (0–100). */
  saturation: number
  /** Apply the saturation setting to colours people chose (role and name colours, profile themes) too. */
  saturateCustom: boolean
  /** Show display name styles (fonts, effects, gradient colours); off shows every name plainly. */
  nameStyles: boolean
  /** Check and cross icons inside toggles, so on and off don't rely on colour alone. */
  toggleIndicators: boolean
  underlineLinks: boolean
  animatedEmoji: boolean
  autoplayGifs: boolean
  stickerAnimation: 'always' | 'interaction' | 'never'
  /** Text-to-speech rate (0.5–2). */
  ttsRate: number
  /** Read /tts messages aloud in the channel you're looking at. */
  ttsPlayback: boolean
  /** Hear people's entrance sounds when they join your voice channel. */
  entranceSounds: boolean
  /** Ask before opening links to other sites. */
  warnLinks: boolean
  /** Underline misspelt words while typing. */
  spellcheck: boolean
  /** Phones: double-tap a message to react with `quickReaction`. */
  doubleTapReact: boolean
  quickReaction: string
  /** Always show a focus ring for keyboard navigation. */
  focusRing: boolean
  timeFormat: 'auto' | '12' | '24'
  /** Animated name styles play on hover (default), always, or never. */
  nameAnimation: 'hover' | 'always' | 'never'
  // Chat
  /** Show pictures and videos uploaded directly, inline. */
  inlineAttachments: boolean
  /** Show pictures from links. */
  linkMedia: boolean
  /** Show website previews (embeds). */
  embeds: boolean
  /** Convert :) to 🙂 and friends when sending. */
  emoticons: boolean
  showReactions: boolean
  /** Spoilers: reveal on click, always in servers you moderate, or always. */
  spoilers: 'click' | 'moderate' | 'always'
  emojiSuggestions: boolean
  mediaSize: 'small' | 'medium' | 'large'
  // Streamer Mode
  streamer: boolean
  streamerHideInfo: boolean
  streamerHideInvites: boolean
  streamerMuteSounds: boolean
  streamerMuteNotifications: boolean
  /** Desktop app: Streamer Mode follows OBS / XSplit running. */
  streamerAuto: boolean
  /** Clips: keep the last few seconds of calls ready to save (Settings → Clips). */
  clips: boolean
  clipSeconds: 15 | 30 | 60
  /** Include the call's voices, and your own, in clips. */
  clipVoices: boolean
  clipMyVoice: boolean
  /** Settings → Appearance → App icon: the tab icon, and the desktop app's window and tray icon. */
  appIcon: string
  /** Desktop app: the in-game overlay during calls, and whether clicks go through it. */
  overlay: boolean
  overlayLocked: boolean
  // Advanced
  /** Developer Mode: "Copy … ID" entries in context menus. */
  developerMode: boolean
  /** External link hosts the user chose not to be warned about again. */
  trustedHosts: string[]
}

export const DEFAULT_PREFS: ClientPrefs = {
  accent: null, messageGap: 17, zoom: 100, compactAvatars: false, roleColors: 'name',
  saturation: 100, saturateCustom: true, nameStyles: true, toggleIndicators: false, underlineLinks: false, animatedEmoji: true, autoplayGifs: true, stickerAnimation: 'always', ttsRate: 1, ttsPlayback: true, entranceSounds: true, warnLinks: true, spellcheck: true, doubleTapReact: true, quickReaction: '❤️', focusRing: false, timeFormat: 'auto', nameAnimation: 'hover',
  inlineAttachments: true, linkMedia: true, embeds: true, emoticons: true, showReactions: true, spoilers: 'click', emojiSuggestions: true, mediaSize: 'medium',
  streamer: false, streamerHideInfo: true, streamerHideInvites: true, streamerMuteSounds: true, streamerMuteNotifications: true, streamerAuto: false, clips: false, clipSeconds: 30, clipVoices: true, clipMyVoice: true, appIcon: 'default', overlay: false, overlayLocked: true,
  developerMode: true,
  trustedHosts: [],
}
export const ACCENTS = ['#6d5dfc', '#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e', '#1abc9c', '#e67e22', '#9b59b6', '#00bcd4']
export const MEDIA_SIZES: Record<ClientPrefs['mediaSize'], { w: number; h: number }> = { small: { w: 280, h: 210 }, medium: { w: 400, h: 300 }, large: { w: 560, h: 420 } }

const KEY = `${STORAGE_PREFIX}prefs`
const clamp = (n: unknown, lo: number, hi: number, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d }
const oneOf = <T extends string | number>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

function load(): ClientPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ClientPrefs>
    return {
      accent: typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : null,
      messageGap: clamp(p.messageGap, 0, 24, 17), zoom: clamp(p.zoom, 50, 200, 100), compactAvatars: bool(p.compactAvatars, false), roleColors: oneOf(p.roleColors, ['name', 'next', 'off'] as const, 'name'),
      saturation: clamp(p.saturation, 0, 100, 100), saturateCustom: bool(p.saturateCustom, true), nameStyles: bool(p.nameStyles, true), toggleIndicators: bool(p.toggleIndicators, false), underlineLinks: bool(p.underlineLinks, false), animatedEmoji: bool(p.animatedEmoji, true), autoplayGifs: bool(p.autoplayGifs, true),
      stickerAnimation: oneOf(p.stickerAnimation, ['always', 'interaction', 'never'] as const, 'always'), ttsRate: clamp(p.ttsRate, 0.5, 2, 1), ttsPlayback: bool(p.ttsPlayback, true), entranceSounds: bool(p.entranceSounds, true), warnLinks: bool(p.warnLinks, true), spellcheck: bool(p.spellcheck, true), doubleTapReact: bool(p.doubleTapReact, true), quickReaction: typeof p.quickReaction === 'string' && p.quickReaction.trim() && [...p.quickReaction].length <= 8 ? p.quickReaction : '❤️', focusRing: bool(p.focusRing, false), timeFormat: oneOf(p.timeFormat, ['auto', '12', '24'] as const, 'auto'), nameAnimation: oneOf(p.nameAnimation, ['hover', 'always', 'never'] as const, 'hover'),
      inlineAttachments: bool(p.inlineAttachments, true), linkMedia: bool(p.linkMedia, true), embeds: bool(p.embeds, true), emoticons: bool(p.emoticons, true), showReactions: bool(p.showReactions, true),
      spoilers: oneOf(p.spoilers, ['click', 'moderate', 'always'] as const, 'click'), emojiSuggestions: bool(p.emojiSuggestions, true), mediaSize: oneOf(p.mediaSize, ['small', 'medium', 'large'] as const, 'medium'),
      streamer: bool(p.streamer, false), streamerHideInfo: bool(p.streamerHideInfo, true), streamerHideInvites: bool(p.streamerHideInvites, true), streamerMuteSounds: bool(p.streamerMuteSounds, true), streamerMuteNotifications: bool(p.streamerMuteNotifications, true), streamerAuto: bool(p.streamerAuto, false),
      clips: bool(p.clips, false), clipSeconds: oneOf(p.clipSeconds, [15, 30, 60] as const, 30), clipVoices: bool(p.clipVoices, true), clipMyVoice: bool(p.clipMyVoice, true), appIcon: typeof p.appIcon === 'string' && /^[a-z]{1,20}$/.test(p.appIcon) ? p.appIcon : 'default',
      overlay: bool(p.overlay, false), overlayLocked: bool(p.overlayLocked, true),
      developerMode: bool(p.developerMode, true),
      trustedHosts: Array.isArray(p.trustedHosts) ? p.trustedHosts.filter((h): h is string => typeof h === 'string').slice(0, 500) : [],
    }
  } catch { return { ...DEFAULT_PREFS } }
}

let current: ClientPrefs = load()
const listeners = new Set<() => void>()

/** Darken a hex colour for the hover shade. */
function darken(hex: string, by = 0.12): string {
  const n = parseInt(hex.slice(1), 16); const f = (c: number) => Math.max(0, Math.round(c * (1 - by))).toString(16).padStart(2, '0')
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`
}

/** Push the CSS-level preferences onto <html> / <body>. */
export function applyPrefs(p: ClientPrefs = current) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (p.accent) { el.style.setProperty('--color-accent', p.accent); el.style.setProperty('--color-accent-hover', darken(p.accent)) } else { el.style.removeProperty('--color-accent'); el.style.removeProperty('--color-accent-hover') }
  el.style.setProperty('--msg-gap', `${p.messageGap}px`)
  // The desktop app zooms natively; browsers get CSS zoom (their own Ctrl +/- still works on top).
  ;(el.style as CSSStyleDeclaration & { zoom?: string }).zoom = desktop.zoom(p.zoom / 100) || p.zoom === 100 ? '' : `${p.zoom}%`
  document.body.style.filter = p.saturation === 100 ? '' : `saturate(${p.saturation}%)`
  // Custom colours kept at full strength: undo the app-wide saturation on them (as far as it can be undone).
  el.dataset.keepCustom = p.saturation < 100 && !p.saturateCustom ? '1' : '0'
  el.style.setProperty('--sat-undo', String(Math.min(10, 100 / Math.max(10, p.saturation))))
  el.dataset.nameStyles = p.nameStyles ? '1' : '0'
  el.dataset.toggleIcons = p.toggleIndicators ? '1' : '0'
  el.dataset.underlineLinks = p.underlineLinks ? '1' : '0'
  el.dataset.focusRing = p.focusRing ? '1' : '0'
  el.dataset.compactAvatars = p.compactAvatars ? '1' : '0'
  el.dataset.nameAnim = p.nameAnimation
  el.dataset.streamer = p.streamer ? '1' : '0'
  el.dataset.streamerInvites = p.streamer && p.streamerHideInvites ? '1' : '0'
}

/** Streamer Mode helpers: is personal info / are invites hidden, are sounds / notifications muted right now? */
export const streamerHides = (what: 'info' | 'invites' | 'sounds' | 'notifications'): boolean => {
  const p = current
  if (!p.streamer) return false
  return what === 'info' ? p.streamerHideInfo : what === 'invites' ? p.streamerHideInvites : what === 'sounds' ? p.streamerMuteSounds : p.streamerMuteNotifications
}

export function getPrefs(): ClientPrefs { return current }
export function subscribePrefs(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }
export function setPrefs(patch: Partial<ClientPrefs>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ }
  applyPrefs(current)
  listeners.forEach((l) => l())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('parley:settings'))
}
export function usePrefs(): ClientPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, getPrefs)
}
export function initPrefs() {
  applyPrefs(current)
  // Desktop app: Ctrl/⌘ + = / - / 0 zoom like a browser, in 10% steps, remembered with the other preferences.
  if (desktopBridge()) window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey && e.key !== '+') return
    const z = current.zoom
    const next = e.key === '=' || e.key === '+' ? z + 10 : e.key === '-' ? z - 10 : e.key === '0' ? 100 : null
    if (next === null) return
    e.preventDefault()
    setPrefs({ zoom: Math.max(50, Math.min(200, next)) })
  })
}

/** Classic emoticons → emoji (Chat → "Automatically convert emoticons"). Only whole tokens are replaced. */
const EMOTICONS: [RegExp, string][] = [
  [/(^|\s):-?\)(?=\s|$)/g, '$1🙂'], [/(^|\s):-?\((?=\s|$)/g, '$1🙁'], [/(^|\s):-?D(?=\s|$)/g, '$1😃'], [/(^|\s);-?\)(?=\s|$)/g, '$1😉'],
  [/(^|\s):-?P(?=\s|$)/gi, '$1😛'], [/(^|\s):-?O(?=\s|$)/gi, '$1😮'], [/(^|\s):'\((?=\s|$)/g, '$1😢'], [/(^|\s)<3(?=\s|$)/g, '$1❤️'], [/(^|\s)XD(?=\s|$)/g, '$1😆'], [/(^|\s):-?\|(?=\s|$)/g, '$1😐'],
]
export function convertEmoticons(text: string): string {
  // Leave code spans and blocks alone.
  return text.split(/(```[\s\S]*?```|`[^`]*`)/).map((part, i) => (i % 2 === 1 ? part : EMOTICONS.reduce((t, [re, to]) => t.replace(re, to), part))).join('')
}
