import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { STORAGE_PREFIX } from './brand'
import KEYS from '../locales/keys.json'

/**
 * Message catalogue: keys are the English source strings, so an untranslated key renders as English.
 * `{name}` placeholders are filled from `vars`. The language comes from Settings → Language ('system' follows
 * navigator.language) and applies live; `useT()` re-renders on change. `locale()` is the BCP-47 tag for Intl.
 *
 * Catalogues live in src/locales/<id>.json and load on demand (English needs none). Shared components (menus,
 * toggles, call controls, modal titles, settings sections) pass their labels through `t()`, so the catalogues are
 * keyed by those labels; src/locales/keys.json lists every key (see scripts/i18n-keys.mjs).
 */
export type Language = 'system' | 'en' | 'es' | 'de' | 'fr' | 'it' | 'nl' | 'pl' | 'pt-BR' | 'ru' | 'tr' | 'ar' | 'ja' | 'ko' | 'zh-CN'
export type Resolved = Exclude<Language, 'system'>

export const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: 'system', label: 'Match system', native: 'Match system' },
  { id: 'en', label: 'English', native: 'English' },
  { id: 'es', label: 'Spanish', native: 'Español' },
  { id: 'de', label: 'German', native: 'Deutsch' },
  { id: 'fr', label: 'French', native: 'Français' },
  { id: 'it', label: 'Italian', native: 'Italiano' },
  { id: 'nl', label: 'Dutch', native: 'Nederlands' },
  { id: 'pl', label: 'Polish', native: 'Polski' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { id: 'ru', label: 'Russian', native: 'Русский' },
  { id: 'tr', label: 'Turkish', native: 'Türkçe' },
  { id: 'ar', label: 'Arabic', native: 'العربية' },
  { id: 'ja', label: 'Japanese', native: '日本語' },
  { id: 'ko', label: 'Korean', native: '한국어' },
  { id: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文' },
]
const IDS = LANGUAGES.map((l) => l.id).filter((l): l is Resolved => l !== 'system')
/** Written right to left: the whole layout mirrors (`dir="rtl"` on <html>). */
const RTL = new Set<Resolved>(['ar'])

const loaders = import.meta.glob<{ default: Record<string, string> }>(['../locales/*.json', '!../locales/keys.json'])
const catalogues: Partial<Record<Resolved, Record<string, string>>> = {}
const loading = new Map<Resolved, Promise<void>>()

const KEY = `${STORAGE_PREFIX}language`
let setting: Language = (() => { try { const v = localStorage.getItem(KEY); return v && (IDS as string[]).includes(v) ? (v as Language) : 'system' } catch { return 'system' } })()
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((f) => f()) }

/** The language in effect after resolving 'system'. */
export function resolvedLanguage(l: Language = setting): Resolved {
  if (l !== 'system') return l
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('pt')) return 'pt-BR'
  if (nav.startsWith('zh')) return 'zh-CN'
  const two = nav.slice(0, 2)
  return (IDS.find((id) => id === two) ?? 'en') as Resolved
}
/** BCP-47 tag for Intl formatting: the chosen language, or the browser's own locale when following the system. */
export function locale(): string {
  if (setting === 'system') return typeof navigator !== 'undefined' ? navigator.language : 'en'
  return setting
}
export const getLanguage = () => setting
export const isRtl = (l: Resolved = resolvedLanguage()) => RTL.has(l)

/** Fetch a language's catalogue (once); re-renders everything using `useT()` when it arrives. */
function load(l: Resolved): Promise<void> {
  if (l === 'en' || catalogues[l]) return Promise.resolve()
  let p = loading.get(l)
  if (!p) {
    const loader = loaders[`../locales/${l}.json`]
    p = loader ? loader().then((m) => { catalogues[l] = m.default; emit() }).catch(() => { loading.delete(l) }) : Promise.resolve()
    loading.set(l, p)
  }
  return p
}

function applyDocument() {
  const l = resolvedLanguage()
  document.documentElement.lang = l
  document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr'
}

export function setLanguage(l: Language) {
  setting = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  applyDocument()
  emit()
  void load(resolvedLanguage(l))
}
/** Once at boot: document language and direction, and start loading the catalogue. */
export function initLanguage() { applyDocument(); return load(resolvedLanguage()) }

/** Translate a source string with optional `{placeholders}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = resolvedLanguage()
  let out = (lang === 'en' ? undefined : catalogues[lang]?.[key]) ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

/** t() for sentences with elements inside: `tn('Ban {name}?', { name: <b>{n}</b> })`. The whole sentence is one key, so
 *  each language can put the element where its word order wants it. */
export function tn(key: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = t(key).split(/(\{[a-zA-Z_][a-zA-Z0-9_]*\})/)
  return createElement(Fragment, null, ...parts.map((p) => { const m = /^\{(.+)\}$/.exec(p); return m && m[1] in vars ? vars[m[1]] : p }))
}

const reverse = new Map<Resolved, Map<string, string>>()
/** The English source of a string that may already have gone through t(): for stable ids (data-menu-item) when
 *  callers pass translated labels. Unknown text comes back unchanged. */
export function sourceText(text: string): string {
  const lang = resolvedLanguage()
  const c = lang === 'en' ? undefined : catalogues[lang]
  if (!c) return text
  let r = reverse.get(lang)
  if (!r || r.size === 0) {
    // Two keys can share a translation; the first one (the older, shared-component key) wins.
    r = new Map(); for (const [k, v] of Object.entries(c)) if (!r.has(v)) r.set(v, k)
    reverse.set(lang, r)
  }
  return r.get(text) ?? text
}

/** Hook form: re-renders the component when the language changes or its catalogue arrives. */
export function useT(): typeof t {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  return t
}
export function useLanguage(): Language {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getLanguage)
}
/** Share of the UI strings this language has translated (for the Language tab); loads its catalogue to count. */
export function coverage(l: Resolved): number {
  if (l === 'en') return 1
  const c = catalogues[l]
  if (!c) { void load(l); return 1 }
  return (KEYS as string[]).filter((k) => c[k] !== undefined).length / (KEYS as string[]).length
}
