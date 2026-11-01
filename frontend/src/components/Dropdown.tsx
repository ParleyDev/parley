import { Check, ChevronDown } from 'lucide-react'
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { usePhone } from '../lib/swipe'

interface Opt { value: string; label: ReactNode; text: string; disabled: boolean; group?: string }
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean }

const textOf = (n: ReactNode): string => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : isValidElement<{ children?: ReactNode }>(n) ? textOf(n.props.children) : ''

/** The `<option>`s (and `<optgroup>`s) among the children, through fragments and conditionals, in order. */
function parse(children: ReactNode, group?: string): Opt[] {
  return Children.toArray(children).flatMap((c): Opt[] => {
    if (!isValidElement(c)) return []
    const el = c as ReactElement<OptionProps & { label?: string }>
    if (el.type === 'optgroup') return parse(el.props.children, el.props.label)
    if (el.type === 'option') {
      const text = textOf(el.props.children)
      return [{ value: String(el.props.value ?? text), label: el.props.children, text, disabled: !!el.props.disabled, group }]
    }
    return parse(el.props.children, group)
  })
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'multiple' | 'size'> & {
  value?: string | number
  onChange?: (e: { target: { value: string } }) => void
}

/**
 * A themed stand-in for `<select>` with the same props and `<option>`/`<optgroup>` children: a button showing the
 * choice, opening a floating list (a sheet on phones) with keyboard support. A hidden native select carries the value,
 * `data-*` attributes and form semantics, so `selectOption` in tests and forms keep working.
 */
export default function Dropdown({ value, onChange, children, className = 'input', disabled, id, title, style, 'aria-label': ariaLabel, ...rest }: Props) {
  const opts = parse(children)
  const current = String(value ?? '')
  const chosen = opts.find((o) => o.value === current)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useId()
  const phone = usePhone()
  const typed = useRef({ s: '', at: 0 })
  const small = /\btext-(xs|\[1[0-2]px\])/.test(className)

  const pick = (v: string) => { setOpen(false); btn.current?.focus(); if (v !== current) onChange?.({ target: { value: v } }) }
  const show = () => { if (disabled) return; setActive(Math.max(0, opts.findIndex((o) => o.value === current))); setOpen(true) }
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i
    return from
  }
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return
    const k = e.key
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); show() }
      return
    }
    if (k === 'Escape' || k === 'Tab') { if (k === 'Escape') { e.preventDefault(); e.stopPropagation() } setOpen(false); return }
    if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)) }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)) }
    else if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)) }
    else if (k === 'End') { e.preventDefault(); setActive(step(opts.length, -1)) }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); const o = opts[active]; if (o && !o.disabled) pick(o.value) }
    else if (k.length === 1) {
      // Type to jump, like a native select.
      const t = typed.current, now = Date.now()
      t.s = (now - t.at > 700 ? '' : t.s) + k.toLowerCase(); t.at = now
      // Leading symbols don't count, so "an" finds "#announcements".
      const i = opts.findIndex((o) => !o.disabled && [o.text, o.text.replace(/^[^\p{L}\p{N}]+/u, '')].some((x) => x.toLowerCase().startsWith(t.s)))
      if (i >= 0) setActive(i)
    }
  }

  return (
    <>
      <button ref={btn} type="button" id={id} title={title} style={style} disabled={disabled} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? list : undefined} aria-label={ariaLabel} aria-activedescendant={open && active >= 0 ? `${list}-${active}` : undefined}
        className={`${className} !flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'border-accent/70 ring-2 ring-accent/20' : ''}`} data-dropdown>
        {/* Every label stacked in one cell, the chosen one visible: the button is as wide as the longest, like a native select.
            The others are drawn with CSS content so they never count as the button's text (search, screen readers, tests). */}
        <span className="grid min-w-0 flex-1">
          {opts.map((o) => o === chosen
            ? <span key={o.value} className="col-start-1 row-start-1 truncate">{o.label}</span>
            : <span key={o.value} className="invisible col-start-1 row-start-1 truncate before:content-[attr(data-sizer)]" data-sizer={o.text} aria-hidden />)}
          {!chosen && <span className="col-start-1 row-start-1">&nbsp;</span>}
        </span>
        <ChevronDown size={small ? 12 : 16} className={`shrink-0 text-text-2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* After the button, so sibling spacing (space-y, gap) and labels treat the button as the control. */}
      <select {...rest} value={current} disabled={disabled} onChange={(e) => onChange?.(e)} aria-hidden tabIndex={-1} className="sr-only">{children}</select>
      {open && <Popup anchor={btn} phone={phone} onClose={() => setOpen(false)} label={ariaLabel ?? title}>
        <div id={list} role="listbox" aria-label={ariaLabel ?? title} data-dropdown-list>
          {opts.map((o, i) => (
            <div key={o.value + i}>
              {o.group && o.group !== opts[i - 1]?.group && <div className="px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-2" role="presentation">{o.group}</div>}
              <div id={`${list}-${i}`} role="option" aria-selected={o === chosen} aria-disabled={o.disabled || undefined} data-dropdown-option={o.value}
                ref={(el) => { if (el && i === active) el.scrollIntoView({ block: 'nearest' }) }}
                onMouseEnter={() => !o.disabled && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => !o.disabled && pick(o.value)}
                className={`flex items-center gap-2 rounded-md px-2.5 text-sm phone:text-[15px] ${phone ? 'py-3' : 'py-1.5'} ${o.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${i === active && !o.disabled ? 'bg-bg-4 text-text-0' : o === chosen ? 'text-text-0' : 'text-text-1'}`}>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.label}</span>
                {o === chosen && <Check size={16} className="shrink-0 text-accent" />}
              </div>
            </div>
          ))}
        </div>
      </Popup>}
    </>
  )
}

/** Below the button (above when there's more room there), at least as wide; on phones a sheet from the bottom. */
function Popup({ anchor, phone, onClose, label, children }: { anchor: RefObject<HTMLElement | null>; phone: boolean; onClose: () => void; label?: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    if (phone) return
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const vh = window.innerHeight, vw = window.innerWidth
      const below = vh - r.bottom - 12, above = r.top - 12
      const up = below < 220 && above > below
      const minWidth = Math.min(r.width, vw - 16)
      const left = Math.min(Math.max(8, r.left), vw - minWidth - 8)
      setPos(up ? { left, bottom: vh - r.top + 4, minWidth, maxHeight: Math.min(320, above) } : { left, top: r.bottom + 4, minWidth, maxHeight: Math.min(320, below) })
    }
    place()
    // Follow the button when a pane scrolls or the window resizes.
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, phone])
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!anchor.current?.contains(e.target as Node) && !(e.target as Element).closest?.('[data-dropdown-popup]')) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [anchor, onClose])
  if (phone) return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/50 safe-area" onClick={onClose} data-dropdown-popup>
      <div className="sheet-rise max-h-[70dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-bg-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {label && <div className="px-2.5 pt-1 pb-2 text-[13px] font-semibold text-text-2">{label}</div>}
        {children}
      </div>
    </div>, document.body)
  if (!pos) return null
  return createPortal(
    <div style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxHeight: pos.maxHeight }} className="pop fixed z-[200] max-w-[min(420px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-lg border border-line bg-bg-1 p-1 shadow-2xl" data-dropdown-popup>
      {children}
    </div>, document.body)
}
