import { Pipette, Sparkles } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { colourCount, defaultColors, EFFECTS, FONTS, GRADIENT_PRESETS, GUMMY_PRESETS, gradientFor, modeOf, NAME_COLORS, nameLook, PRISM_PRESETS, surpriseStyle, type NameEffect, type NameFont, type NameStyle } from '../../lib/nameStyle'
import { useStore } from '../../store'
import Avatar from '../Avatar'

/** Eyedropper over a colour stop. A module-level component: defining it inside the modal would remount the
 *  native <input type=color> on every change and close the OS picker. */
function Dropper({ i, value, onPick, cls = '' }: { i: number; value: string; onPick: (i: number, c: string) => void; cls?: string }) {
  return <label className={`relative h-8 w-8 rounded-full bg-white/80 text-black flex items-center justify-center cursor-pointer shadow ${cls}`} title={`Colour ${i + 1}`}><Pipette size={14} /><input type="color" value={value} onChange={(e) => onPick(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-name-stop={i} /></label>
}
function Bar({ stops, colors, onPick }: { stops: number; colors: string[]; onPick: (i: number, c: string) => void }) {
  return (
    <div className="relative h-14 flex-1 min-w-[220px] rounded-xl flex items-center justify-between px-2" style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }} data-name-bar>
      {Array.from({ length: stops }, (_, i) => <Dropper key={i} i={i} value={colors[i]} onPick={onPick} />)}
    </div>
  )
}
function Presets({ list, effect, current, onPick }: { list: string[][]; effect: NameEffect; current: string[]; onPick: (p: string[]) => void }) {
  return <div className="grid grid-cols-3 gap-2 shrink-0">{list.map((p) => { const on = p.join() === current.join(); return <button key={p.join()} type="button" onClick={() => onPick(p)} className={`h-6 w-12 rounded-md border-2 ${on ? 'border-white' : 'border-transparent'}`} style={{ background: gradientFor(effect, p) }} title={p.join(', ')} data-name-preset={p.join(',')} /> })}</div>
}

interface Props { onClose: () => void; name: string; value: NameStyle; onApply: (v: Required<NameStyle>) => void; title?: string; subject?: 'you' | 'role' }

/** "Change Display Name Style": font, effect and colours (per-effect pickers) with a live chat + profile preview. */
export default function NameStyleModal({ onClose, name, value, onApply, title = 'Change Display Name Style', subject = 'you' }: Props) {
  const me = useStore((s) => s.user)
  const [font, setFont] = useState<NameFont>(value.font ?? 'default')
  const [effect, setEffect] = useState<NameEffect>(value.effect ?? 'solid')
  const [colors, setColors] = useState<string[]>(value.colors?.length ? value.colors : defaultColors(value.effect ?? 'solid', []))
  const [none, setNone] = useState(!(value.colors?.length))
  const mode = modeOf(effect)
  const n = colourCount(mode)
  const cur = colors.slice(0, n)
  while (cur.length < n) cur.push(defaultColors(effect, cur)[cur.length])
  const look = nameLook({ name_style: { font, effect, colors: none ? [] : cur } })
  const sample = (id: NameEffect) => nameLook({ name_style: { font: 'default', effect: id, colors: defaultColors(id, none ? [] : colors) } })
  const pickEffect = (id: NameEffect) => { setEffect(id); setColors(defaultColors(id, colors)); setNone(false) }
  const setAt = (i: number, c: string) => { const next = [...cur]; next[i] = c; setColors(next); setNone(false) }
  const surprise = () => { const s = surpriseStyle(); setFont(s.font); setEffect(s.effect); setColors(s.colors); setNone(false) }
  return (
    <Modal title={title} onClose={onClose} width="max-w-4xl" footer={<><button type="button" className="btn-ghost mr-auto" onClick={surprise} data-name-surprise><Sparkles size={14} /> Surprise Me</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={() => onApply({ font, effect, colors: none ? [] : cur })} data-name-apply>Apply</button></>}>
      <div className="grid grid-cols-[1fr_320px] max-md:grid-cols-1 gap-6" data-name-style-modal data-name-mode={mode}>
        <div className="space-y-5">
          <section>
            <h3 className="label">Choose font</h3>
            <div className="grid grid-cols-4 max-md:grid-cols-3 gap-2" data-font-options>
              {FONTS.map((f) => <button key={f.id} type="button" onClick={() => setFont(f.id)} title={f.label} className={`h-14 rounded-lg border text-xl font-semibold ${font === f.id ? 'border-accent bg-accent/15' : 'border-line bg-bg-1 hover:border-text-2'} ${f.id !== 'default' ? `nf-${f.id}` : ''}`} data-font={f.id} aria-pressed={font === f.id}>Gg</button>)}
            </div>
          </section>
          <section>
            <h3 className="label">Choose effect</h3>
            <div className="grid grid-cols-4 max-md:grid-cols-3 gap-2" data-effect-options>
              {EFFECTS.map((e) => { const l = sample(e.id); return <button key={e.id} type="button" onClick={() => pickEffect(e.id)} className={`h-14 rounded-lg border text-[15px] font-semibold ${effect === e.id ? 'border-accent bg-accent/15' : 'border-line bg-bg-1 hover:border-text-2'}`} data-effect={e.id} aria-pressed={effect === e.id}><span className={l.className} style={l.style}>{e.label}</span></button> })}
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="label">Choose colour</h3>
            {mode === 'one' && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="relative h-9 w-9 rounded-lg border border-line overflow-hidden cursor-pointer flex items-center justify-center text-text-2" title="Custom colour"><Pipette size={14} /><input type="color" value={cur[0]} onChange={(e) => setAt(0, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-name-stop="0" /></label>
                {NAME_COLORS.map((c) => <button key={c} type="button" onClick={() => setAt(0, c)} className={`h-9 w-9 rounded-lg border-2 ${!none && cur[0] === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} title={c} data-name-color={c} />)}
              </div>
            )}
            {mode === 'two' && <div className="flex items-center gap-3 flex-wrap"><Bar stops={2} colors={cur} onPick={setAt} /><Presets list={GRADIENT_PRESETS} effect={effect} current={cur} onPick={(p) => { setColors(p); setNone(false) }} /></div>}
            {mode === 'stripes' && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex gap-1 rounded-lg border border-line p-1" title="Custom stripes">{[0, 1, 2].map((i) => <label key={i} className="relative h-8 w-8 rounded-md cursor-pointer flex items-center justify-center text-black/70" style={{ background: cur[i] }}><Pipette size={12} /><input type="color" value={cur[i]} onChange={(e) => setAt(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" data-name-stop={i} /></label>)}</div>
                {GUMMY_PRESETS.map((p) => { const on = p.join() === cur.join(); return <button key={p.join()} type="button" onClick={() => { setColors(p); setNone(false) }} className={`h-10 w-12 rounded-lg border-2 ${on ? 'border-white' : 'border-transparent'}`} style={{ background: gradientFor('gummy', p) }} title={p.join(', ')} data-name-preset={p.join(',')} /> })}
              </div>
            )}
            {mode === 'five' && <div className="flex items-center gap-3 flex-wrap"><Bar stops={5} colors={cur} onPick={setAt} /><Presets list={PRISM_PRESETS} effect={effect} current={cur} onPick={(p) => { setColors(p); setNone(false) }} /></div>}
            {!none && subject === 'you' && <button type="button" className="text-xs text-text-2 hover:text-text-0" onClick={() => setNone(true)} data-name-color-clear>No colour (plain name)</button>}
            {!none && subject === 'role' && <button type="button" className="text-xs text-text-2 hover:text-text-0" onClick={() => setNone(true)} data-name-color-clear>No colour (role does not colour names)</button>}
          </section>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-bg-0 p-3" data-name-preview-chat>
            <div className="flex gap-3">
              {me && <Avatar user={me} size={40} />}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2"><span className={`font-semibold ${look.className}`} style={look.style} data-name-preview-text>{name}</span><span className="text-[11px] text-text-2">Today at 9:41</span></div>
                <div className="text-[15px]">does anyone read this?</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-bg-0 p-3 flex items-center gap-3">
            {me && <Avatar user={me} size={32} />}<span className={`text-lg font-bold ${look.className}`} style={look.style}>{name}</span>
          </div>
          <p className="text-xs text-text-2">{subject === 'role' ? 'Members with this role get this name style in the server; it beats their own style.' : 'Inside a server a coloured role takes over. Animated effects pause with "Reduced motion".'}</p>
        </div>
      </div>
    </Modal>
  )
}
