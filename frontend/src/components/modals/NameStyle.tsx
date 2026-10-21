import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import Modal from '../Modal'
import { EFFECTS, FONTS, NAME_COLORS, nameLook, surpriseLook, type NameEffect, type NameFont, type NameStyle } from '../../lib/nameStyle'
import { useStore } from '../../store'
import Avatar from '../Avatar'

interface Props { onClose: () => void; name: string; primary: string | null; accent: string | null; style: NameStyle; onApply: (v: { font: NameFont; effect: NameEffect; primary: string | null; accent: string | null }) => void }

/** "Change Display Name Style": font, effect and colour with a live chat + profile preview. Free for everyone. */
export default function NameStyleModal({ onClose, name, primary: p0, accent: a0, style, onApply }: Props) {
  const me = useStore((s) => s.user)
  const [font, setFont] = useState<NameFont>(style.font ?? 'default')
  const [effect, setEffect] = useState<NameEffect>(style.effect ?? 'solid')
  const [primary, setPrimary] = useState<string | null>(p0)
  const [accent, setAccent] = useState<string | null>(a0 ?? '#6d5dfc')
  const def = EFFECTS.find((e) => e.id === effect)!
  const look = nameLook({ name_primary: primary ?? '#f2f3f7', name_accent: def.twoColours ? accent : null, name_style: { font, effect } })
  const sample = (id: NameEffect) => nameLook({ name_primary: primary ?? '#f2f3f7', name_accent: accent, name_style: { font: 'default', effect: id } })
  const surprise = () => { const s = surpriseLook(); setFont(s.font); setEffect(s.effect); setPrimary(s.primary); setAccent(s.accent) }
  const Swatches = ({ value, onPick, attr }: { value: string | null; onPick: (c: string) => void; attr: string }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="relative h-9 w-9 rounded-lg border border-line overflow-hidden cursor-pointer flex items-center justify-center text-text-2" title="Custom colour"><span aria-hidden>✎</span><input type="color" value={value ?? '#6d5dfc'} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" /></label>
      {NAME_COLORS.map((c) => <button key={c} type="button" onClick={() => onPick(c)} className={`h-9 w-9 rounded-lg border-2 ${value === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} title={c} {...{ [attr]: c }} />)}
    </div>
  )
  return (
    <Modal title="Change Display Name Style" onClose={onClose} width="max-w-4xl" footer={<><button type="button" className="btn-ghost mr-auto" onClick={surprise} data-name-surprise><Sparkles size={14} /> Surprise Me</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={() => onApply({ font, effect, primary, accent: def.twoColours ? accent : null })} data-name-apply>Apply</button></>}>
      <div className="grid grid-cols-[1fr_320px] max-md:grid-cols-1 gap-6" data-name-style-modal>
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
              {EFFECTS.map((e) => { const l = sample(e.id); return <button key={e.id} type="button" onClick={() => setEffect(e.id)} className={`h-14 rounded-lg border text-[15px] font-semibold ${effect === e.id ? 'border-accent bg-accent/15' : 'border-line bg-bg-1 hover:border-text-2'}`} data-effect={e.id} aria-pressed={effect === e.id}><span className={l.className} style={l.style}>{e.label}</span></button> })}
            </div>
          </section>
          <section className="space-y-3">
            <h3 className="label">Choose colour</h3>
            <Swatches value={primary} onPick={setPrimary} attr="data-name-color" />
            {def.twoColours && <><h3 className="label">Second colour</h3><Swatches value={accent} onPick={setAccent} attr="data-name-color2" /></>}
            {primary && <button type="button" className="text-xs text-text-2 hover:text-text-0" onClick={() => setPrimary(null)} data-name-color-clear>No colour (plain name)</button>}
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
          <p className="text-xs text-text-2">Display name colours and effects do not show inside servers where a coloured role applies. Animated effects pause with "Reduced motion".</p>
        </div>
      </div>
    </Modal>
  )
}
