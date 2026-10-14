import { Bold, Code, Eye, Italic, Strikethrough, Underline } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { FORMATS, toggleWrap, type Format } from '../lib/editor'

const ICONS: Record<string, React.ReactNode> = {
  bold: <Bold size={15} />, italic: <Italic size={15} />, underline: <Underline size={15} />, strike: <Strikethrough size={15} />, code: <Code size={15} />, spoiler: <Eye size={15} />,
}

/** Floating B/I/U/S/code/spoiler bar that appears while text is selected in the textarea. */
export default function FormatToolbar({ textarea, onChange, className = '' }: { textarea: RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void; className?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    const update = () => setShow(document.activeElement === el && el.selectionStart !== el.selectionEnd)
    const hide = () => setTimeout(() => { if (document.activeElement !== el) setShow(false) }, 0)
    document.addEventListener('selectionchange', update)
    el.addEventListener('keyup', update); el.addEventListener('mouseup', update); el.addEventListener('blur', hide); el.addEventListener('input', update)
    return () => { document.removeEventListener('selectionchange', update); el.removeEventListener('keyup', update); el.removeEventListener('mouseup', update); el.removeEventListener('blur', hide); el.removeEventListener('input', update) }
  }, [textarea])
  if (!show) return null
  const apply = (f: Format) => { const el = textarea.current; if (el) onChange(toggleWrap(el, f)) }
  return (
    <div className={`pop flex items-center rounded-lg bg-bg-0 border border-line shadow-xl overflow-hidden ${className}`} data-format-toolbar>
      {FORMATS.map((f) => (
        <button key={f.key} type="button" title={f.keys ? `${f.label} (${f.keys})` : f.label} aria-label={f.label}
          onMouseDown={(e) => e.preventDefault()} onClick={() => apply(f)}
          className="h-8 w-8 flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0">{ICONS[f.key]}</button>
      ))}
    </div>
  )
}
