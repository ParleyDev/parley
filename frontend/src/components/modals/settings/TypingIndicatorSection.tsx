import { Ban, Dices, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import type { PrivateUser, TypingAnimation, TypingIndicator } from '../../../lib/types'
import { useStore } from '../../../store'
import Emoji from '../../Emoji'
import ExpressionPicker from '../../ExpressionPicker'
import { surprise, TYPING_ANIMATIONS, TypingGlyphs } from '../../TypingIndicator'

type Draft = { emojis: string[]; animation: TypingAnimation; text: string }
/** The saved typing indicator as three emoji slots, an animation and text. */
const draftOf = (ti: TypingIndicator | null | undefined): Draft => ({ emojis: [0, 1, 2].map((i) => ti?.emojis?.[i] ?? ''), animation: ti?.animation ?? 'wave', text: ti?.text ?? '' })

/** Settings → Chat: your typing indicator (up to three emoji, an animation and the text after your name). Changes
 *  save as you make them; typing in the text box waits for a pause. */
export default function TypingIndicatorSection() {
  const t = useT()
  const user = useStore((s) => s.user)!
  const [d, setD] = useState<Draft>(() => draftOf(user.typing_indicator))
  const [slot, setSlot] = useState<{ i: number; rect: DOMRect } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const save = async (next: Draft) => {
    try {
      const u = await api.patch<PrivateUser>('/users/@me', { typing_indicator: next })
      const st = useStore.getState(); if (st.token) st.setAuth(st.token, u)
    } catch (e) { useStore.getState().pushToast((e as Error).message, 'error') }
  }
  const change = (next: Draft, wait = 0) => {
    setD(next); window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(next), wait)
  }
  // Leaving settings mid-pause still saves what was typed.
  const latest = useRef(d); latest.current = d
  useEffect(() => () => { if (timer.current !== undefined) { window.clearTimeout(timer.current); void save(latest.current) } }, [])
  const patch = (p: Partial<Draft>, wait = 0) => change({ ...d, ...p }, wait)
  const text = d.text.trim() || t('is typing…')
  const chip = (on: boolean) => `flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm ${on ? 'border-accent bg-accent/15 text-text-0' : 'border-line text-text-1 hover:border-text-2'}`
  return (
    <section className="space-y-4" data-typing-editor>
      <div>
        <h3 className="label">{t('Typing Indicator')}</h3>
        <p className="text-sm text-text-2">{t('When you are typing, others see this instead of the default typing indicator.')}</p>
      </div>
      <div className="flex h-20 items-center justify-center gap-2 rounded-xl border border-line bg-bg-0/40 text-sm text-text-1" data-typing-preview>
        <TypingGlyphs style={d} size={18} /><span className="truncate"><b>{user.display_name}</b> {text}</span>
      </div>
      <div>
        <div className="label">{t('Emojis')}</div>
        <div className="grid grid-cols-3 gap-2 max-w-sm">
          {d.emojis.map((e, i) => (
            <div key={i} className="group relative">
              <button type="button" onClick={(ev) => setSlot({ i, rect: ev.currentTarget.getBoundingClientRect() })} className={`flex h-14 w-full items-center justify-center rounded-xl border-2 bg-bg-0/40 ${slot?.i === i ? 'border-accent' : 'border-line hover:border-text-2'}`} aria-label={t('Emoji {n}', { n: i + 1 })} data-typing-slot={i}>
                {e ? <Emoji value={e} size={28} glyph={28} /> : <Plus size={20} className="text-text-2" />}
              </button>
              {e && <button type="button" onClick={() => patch({ emojis: d.emojis.map((x, j) => (j === i ? '' : x)) })} className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-0 text-text-2 shadow hover:text-danger group-hover:flex" aria-label={t('Remove')} data-typing-slot-clear={i}><X size={12} /></button>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="label">{t('Animation')}</div>
        <div className="flex flex-wrap gap-2">
          {TYPING_ANIMATIONS.map((a) => <button key={a} type="button" onClick={() => patch({ animation: a })} className={chip(d.animation === a)} aria-pressed={d.animation === a} data-typing-animation={a}><TypingGlyphs style={{ emojis: [], animation: a }} />{({ wave: t('Wave'), bounce: t('Bounce'), pulse: t('Pulse'), spin: t('Spin'), jiggle: t('Jiggle'), none: t('None') })[a]}</button>)}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="typing-text">{t('Text')}</label>
        <input id="typing-text" className="input max-w-sm" maxLength={32} value={d.text} onChange={(e) => patch({ text: e.target.value }, 600)} placeholder={t('is typing…')} data-typing-text />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost bg-bg-3" onClick={() => change(surprise(t))} data-typing-surprise><Dices size={16} />{t('Surprise Me')}</button>
        <button type="button" className="btn-ghost bg-bg-3" onClick={() => change({ emojis: ['', '', ''], animation: 'wave', text: '' })} data-typing-reset><Ban size={16} />{t('Reset')}</button>
      </div>
      {slot && <ExpressionPicker tabs={['emoji']} anchor={slot.rect} onClose={() => setSlot(null)} onEmoji={(tok) => { patch({ emojis: d.emojis.map((x, j) => (j === slot.i ? tok : x)) }); setSlot(null) }} />}
    </section>
  )
}
