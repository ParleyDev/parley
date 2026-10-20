import { setAppearance, useAppearance } from '../../../lib/appearance'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { Toggle } from '../SettingsShell'

/** Settings → Accessibility: motion, contrast, saturation, links, animation, text-to-speech, focus ring, time format. */
export default function AccessibilityTab() {
  const a = useAppearance()
  const p = usePrefs()
  return (
    <div className="space-y-6" data-accessibility-tab>
      <h2 className="text-xl font-bold">Accessibility</h2>

      <section className="space-y-3">
        <span data-reduced-motion-row><Toggle label="Reduced motion" checked={a.reducedMotion} onChange={(v) => setAppearance({ reducedMotion: v })} /></span>
        <p className="text-xs text-text-2">Turns off pop-ins, fades and pulses. Your system's reduce-motion setting is honoured either way.</p>
        <span data-high-contrast-row><Toggle label="High contrast" checked={a.highContrast} onChange={(v) => setAppearance({ highContrast: v })} /></span>
        <p className="text-xs text-text-2">Brighter secondary text and borders.</p>
        <div>
          <div className="flex justify-between"><label className="label">Saturation</label><span className="text-xs text-text-2">{p.saturation}%</span></div>
          <input type="range" min={0} max={100} step={5} value={p.saturation} onChange={(e) => setPrefs({ saturation: Number(e.target.value) })} className="w-full accent-accent" data-saturation />
          <p className="text-xs text-text-2">Lower it to tone down colours across the app (helps with some kinds of colour sensitivity).</p>
        </div>
        <Toggle label="Always underline links" checked={p.underlineLinks} onChange={(v) => setPrefs({ underlineLinks: v })} />
        <Toggle label="Show a focus ring when navigating with the keyboard" checked={p.focusRing} onChange={(v) => setPrefs({ focusRing: v })} />
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3">
        <h3 className="label">Animation</h3>
        <Toggle label="Play animated emoji" checked={p.animatedEmoji} onChange={(v) => setPrefs({ animatedEmoji: v })} />
        <Toggle label="Automatically play GIFs" checked={p.autoplayGifs} onChange={(v) => setPrefs({ autoplayGifs: v })} />
        <p className="text-xs text-text-2">Off: animated emoji and GIFs show their first frame and play while you hover.</p>
        <div>
          <label className="label">Animated stickers</label>
          <div className="flex gap-2">
            {([['always', 'Always animate'], ['interaction', 'On hover'], ['never', 'Never animate']] as const).map(([v, label]) => <button key={v} type="button" onClick={() => setPrefs({ stickerAnimation: v })} className={`rounded-md border px-3 py-1.5 text-sm ${p.stickerAnimation === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-sticker-animation={v}>{label}</button>)}
          </div>
        </div>
      </section>

      <div className="h-px bg-line" />

      <section className="space-y-3">
        <div>
          <div className="flex justify-between"><label className="label">Text-to-speech rate</label><span className="text-xs text-text-2">{p.ttsRate.toFixed(1)}×</span></div>
          <input type="range" min={0.5} max={2} step={0.1} value={p.ttsRate} onChange={(e) => setPrefs({ ttsRate: Number(e.target.value) })} className="w-full accent-accent" data-tts-rate />
          <button type="button" onClick={() => { try { const u = new SpeechSynthesisUtterance('This is what text to speech sounds like at the current speed.'); u.rate = p.ttsRate; speechSynthesis.speak(u) } catch { /* ignore */ } }} className="btn-ghost text-xs mt-1">▶ Preview</button>
        </div>
        <div>
          <label className="label">Time format</label>
          <div className="flex gap-2" data-time-format-options>
            {([['auto', 'Match my locale'], ['12', '12-hour'], ['24', '24-hour']] as const).map(([v, label]) => <button key={v} type="button" onClick={() => setPrefs({ timeFormat: v })} className={`rounded-md border px-3 py-1.5 text-sm ${p.timeFormat === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-time-format={v}>{label}</button>)}
          </div>
        </div>
      </section>
    </div>
  )
}
