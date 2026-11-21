/**
 * Marking the words a search matched inside its results, without touching the rendered messages: the CSS Custom
 * Highlight API paints ranges over existing text (styled by ::highlight(search-hit) in index.css). Browsers without it
 * show the results unmarked.
 */

/** The words and exact phrases of a query worth marking: what is left once filters (from:, has:, before:…) are taken out. */
export function searchTerms(query: string): string[] {
  const terms: string[] = []
  const rest = query.replace(/"([^"]+)"/g, (_, phrase: string) => { terms.push(phrase.trim()); return ' ' })
  for (const word of rest.split(/\s+/)) {
    if (!word || /^-?[a-z-]+:/i.test(word)) continue
    const w = word.replace(/^[-+]/, '')
    if (w.length >= 2) terms.push(w)
  }
  return [...new Set(terms.map((x) => x.toLowerCase()).filter(Boolean))]
}

/** Where `terms` occur in `text` (case-insensitive), as [start, end) pairs in order, longer terms first where they overlap. */
export function findTerms(text: string, terms: string[]): [number, number][] {
  const hay = text.toLowerCase()
  const hits: [number, number][] = []
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    for (let at = hay.indexOf(term); at >= 0; at = hay.indexOf(term, at + term.length)) {
      if (!hits.some(([s, e]) => at < e && at + term.length > s)) hits.push([at, at + term.length])
    }
  }
  return hits.sort((a, b) => a[0] - b[0])
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
const registry = (): HighlightRegistry | null => (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined' ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null)

/** Mark `terms` in the text under every element matching `selector` inside `root`. Returns how many places were marked. */
export function highlightTerms(root: HTMLElement | null, selector: string, terms: string[]): number {
  const reg = registry()
  if (!reg) return 0
  reg.delete('search-hit')
  if (!root || !terms.length) return 0
  const ranges: Range[] = []
  for (const box of root.querySelectorAll<HTMLElement>(selector)) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [s, e] of findTerms(node.nodeValue ?? '', terms)) { const r = new Range(); r.setStart(node, s); r.setEnd(node, e); ranges.push(r) }
    }
  }
  if (ranges.length) reg.set('search-hit', new Highlight(...ranges))
  return ranges.length
}

export function clearHighlights() { registry()?.delete('search-hit') }
