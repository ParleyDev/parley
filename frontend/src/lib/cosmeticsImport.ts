import type { CosmeticKind } from './cosmetics'

/*
 * Importing cosmetics from a folder laid out like the instance's assets folder: a subfolder per kind, each with its
 * metadata.json ({items: [{file | folder, name, ...}]}). Picked in the browser as a whole folder (the folder itself or
 * any folder above it), every item its kind's metadata.json lists is matched with its files; the server says which
 * it already has, and only the rest are sent.
 */

export const KIND_DIRS: Record<CosmeticKind, string> = { decoration: 'avatar-decorations', nameplate: 'nameplates', effect: 'profile-effects', frame: 'profile-frames' }
export const IMPORT_KINDS = Object.keys(KIND_DIRS) as CosmeticKind[]
export const layeredKind = (k: CosmeticKind) => k === 'effect' || k === 'frame'
/** What the server takes per file (asset_admin.rs MAX_FILE). */
export const MAX_IMPORT_FILE = 8 * 1024 * 1024

const FILE_EXTS: Record<CosmeticKind, string[]> = {
  decoration: ['png', 'apng', 'gif', 'webp'],
  nameplate: ['png', 'apng', 'gif', 'webp', 'webm', 'mp4'],
  effect: ['png', 'apng', 'gif', 'webp'],
  frame: ['png', 'apng', 'gif', 'webp'],
}
/** A file name the server writes as it is (asset_admin.rs clean_file_name). */
export function okFileName(kind: CosmeticKind, name: string) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return name.length > 0 && name.length <= 100 && !name.startsWith('.') && /^[A-Za-z0-9._-]+$/.test(name) && FILE_EXTS[kind].includes(ext)
}
/** A layered item's folder name the server takes (asset_admin.rs clean_folder_name). */
export const okFolderName = (name: string) => name.length > 0 && name.length <= 100 && /^[A-Za-z0-9_-]+$/.test(name)

/** A picked file, by its path inside the picked folder (`webkitRelativePath`). */
export interface PickedFile { path: string; file: File }

export interface ImportItem {
  kind: CosmeticKind
  /** Its file (decorations, nameplates) or folder (effects, frames): how the server knows it. */
  key: string
  name: string
  entry: Record<string, unknown>
  files: { name: string; file: File }[]
  /** Why it can't be sent, when it can't. */
  problem?: 'no-files' | 'bad-name' | 'too-big'
}

export interface KindPlan { kind: CosmeticKind; items: ImportItem[]; error?: string }

/** Where a path sits under a kind's folder: the kind and the rest of the path, or null. */
function underKind(path: string): { kind: CosmeticKind; rest: string[] } | null {
  const parts = path.split('/').filter(Boolean)
  for (let i = parts.length - 2; i >= 0; i--) {
    const kind = IMPORT_KINDS.find((k) => KIND_DIRS[k] === parts[i])
    if (kind) return { kind, rest: parts.slice(i + 1) }
  }
  return null
}

/** Every kind folder found among the picked files, its metadata.json read, each listed item matched with its files. */
export async function planImport(picked: PickedFile[]): Promise<KindPlan[]> {
  type Slot = { meta?: File; files: Map<string, File> }
  const byKind = new Map<CosmeticKind, Slot>()
  for (const p of picked) {
    const at = underKind(p.path)
    if (!at || at.rest.some((s) => s.startsWith('.'))) continue
    const slot: Slot = byKind.get(at.kind) ?? { files: new Map() }
    byKind.set(at.kind, slot)
    const rel = at.rest.join('/')
    if (rel === 'metadata.json') slot.meta = p.file
    else slot.files.set(rel, p.file)
  }
  const plans: KindPlan[] = []
  for (const kind of IMPORT_KINDS) {
    const slot = byKind.get(kind)
    if (!slot) continue
    if (!slot.meta) { plans.push({ kind, items: [], error: 'no-metadata' }); continue }
    let list: unknown
    try { list = (JSON.parse(await slot.meta.text()) as { items?: unknown }).items } catch { plans.push({ kind, items: [], error: 'bad-metadata' }); continue }
    if (!Array.isArray(list)) { plans.push({ kind, items: [], error: 'bad-metadata' }); continue }
    plans.push({ kind, items: itemsOf(kind, list, slot.files) })
  }
  return plans
}

export function itemsOf(kind: CosmeticKind, list: unknown[], files: Map<string, File>): ImportItem[] {
  const field = layeredKind(kind) ? 'folder' : 'file'
  const seen = new Set<string>()
  const out: ImportItem[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const key = typeof entry[field] === 'string' ? (entry[field] as string).trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = typeof entry.name === 'string' && entry.name ? entry.name : key
    let mine: { name: string; file: File }[]
    if (layeredKind(kind)) {
      mine = [...files].filter(([rel]) => rel.startsWith(`${key}/`) && !rel.slice(key.length + 1).includes('/')).map(([rel, file]) => ({ name: rel.slice(key.length + 1), file }))
    } else {
      const f = files.get(key)
      mine = f ? [{ name: key, file: f }] : []
    }
    const item: ImportItem = { kind, key, name, entry, files: mine }
    if (!mine.length) item.problem = 'no-files'
    else if (layeredKind(kind) ? !okFolderName(key) || mine.some((f) => !okFileName(kind, f.name)) : !okFileName(kind, key)) item.problem = 'bad-name'
    else if (mine.some((f) => f.file.size > MAX_IMPORT_FILE)) item.problem = 'too-big'
    out.push(item)
  }
  return out
}
