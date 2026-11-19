import type { CSSProperties, ReactNode } from 'react'
import type { NameLook } from '../lib/nameStyle'

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** A name's text, split into letters (.ne-l, by grapheme so emoji and accents stay whole) when its effect animates
 *  letter by letter. Gummy letters take the style's colours in turn. Anything but a plain string is left as it is. */
export default function NameText({ look, children }: { look: NameLook; children: ReactNode }) {
  if (!look.letters || typeof children !== 'string') return <>{children}</>
  const letters = segmenter ? Array.from(segmenter.segment(children), (s) => s.segment) : Array.from(children)
  const colors = look.letters
  return <>{letters.map((g, i) => <span key={i} className="ne-l" style={{ '--i': i, '--lc': colors[i % colors.length] } as CSSProperties}>{g}</span>)}</>
}
