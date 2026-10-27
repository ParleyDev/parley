import { Mic, Video, VideoOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store'
import { STREAM_QUALITY, voice } from '../../../lib/voice'
import { keyLabel, supportsSinkId, type VoiceSettings } from '../../../lib/settings'
import VideoTile from '../../VideoTile'
import EntranceSound from '../../EntranceSound'
import { desktopBridge } from '../../../lib/desktop'
import { useT } from '../../../lib/i18n'

interface Devices { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; cameras: MediaDeviceInfo[]; labelsHidden: boolean }

export default function VoiceVideoTab() {
  const t = useT()
  const st = useStore((s) => s.voiceSettings)
  const update = useStore((s) => s.updateVoiceSettings)
  const level = useStore((s) => s.inputLevel)
  const transmitting = useStore((s) => s.transmitting)
  const pttHeld = useStore((s) => s.pttHeld)
  const [devices, setDevices] = useState<Devices>({ inputs: [], outputs: [], cameras: [], labelsHidden: false })
  const [testing, setTesting] = useState(false)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const previewRef = useRef<MediaStream | null>(null)

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices()
    setDevices({
      inputs: list.filter((d) => d.kind === 'audioinput'),
      outputs: list.filter((d) => d.kind === 'audiooutput'),
      cameras: list.filter((d) => d.kind === 'videoinput'),
      labelsHidden: list.some((d) => !d.label),
    })
  }, [])

  // Open the mic for the level meter while this tab is visible; enumerate devices (labels appear once permission is granted).
  useEffect(() => {
    let alive = true
    voice.startMeter().then(() => { if (alive) enumerate() })
    enumerate()
    navigator.mediaDevices?.addEventListener?.('devicechange', enumerate)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', enumerate)
      voice.stopMicTest(); voice.stopMeter()
      previewRef.current?.getTracks().forEach((tr) => tr.stop())
    }
  }, [enumerate])

  // Keybind recording for push-to-talk.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.code === 'Escape') { setRecording(false); return }
      update({ pttKey: e.code }); setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, update])

  const toggleTest = async () => {
    if (testing) { voice.stopMicTest(); setTesting(false); return }
    if (await voice.startMicTest()) setTesting(true)
  }

  const togglePreview = async () => {
    if (preview) { preview.getTracks().forEach((tr) => tr.stop()); previewRef.current = null; setPreview(null); return }
    const s = await voice.openCamera()
    if (s) { previewRef.current = s; setPreview(s); enumerate() }
  }
  // Re-open the preview when the chosen camera changes.
  useEffect(() => {
    if (!previewRef.current) return
    previewRef.current.getTracks().forEach((tr) => tr.stop())
    voice.openCamera().then((s) => { previewRef.current = s; setPreview(s) })
  }, [st.cameraDeviceId])

  const pct = Math.max(0, Math.min(100, ((level + 100) / 100) * 100))
  const threshold = st.autoSensitivity ? -45 : st.sensitivity
  const set = (k: keyof VoiceSettings) => (v: VoiceSettings[typeof k]) => update({ [k]: v } as Partial<VoiceSettings>)

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-bold">{t('Voice & Video')}</h2>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Select label={t('Input Device')} value={st.inputDeviceId} onChange={set('inputDeviceId')} options={devices.inputs} />
        <Select label={t('Output Device')} value={st.outputDeviceId} onChange={set('outputDeviceId')} options={devices.outputs}
          disabled={!supportsSinkId} note={!supportsSinkId ? t('Output selection is not supported by this browser') : undefined} />
        {devices.labelsHidden && <p className="sm:col-span-2 text-xs text-text-2">{t('Device names appear once microphone access has been granted.')}</p>}
        <Slider label={t('Input Volume')} value={st.inputVolume} min={0} max={200} onChange={set('inputVolume')} format={(v) => `${v}%`} />
        <Slider label={t('Output Volume')} value={st.outputVolume} min={0} max={100} onChange={set('outputVolume')} format={(v) => `${v}%`} />
      </section>

      <section>
        <label className="label">{t('Mic Test')}</label>
        <p className="text-sm text-text-2 mb-3">{t("Having mic issues? Start a test and say something fun — we'll play your voice back to you.")}</p>
        <div className="flex items-center gap-4">
          <button onClick={toggleTest} className={`btn ${testing ? 'bg-danger text-white hover:bg-danger/80' : 'bg-accent text-white hover:bg-accent-hover'} px-5`}>{testing ? t('Stop Testing') : t("Let's Check")}</button>
          <Meter pct={pct} active={transmitting} />
        </div>
      </section>

      <Divider />

      <section>
        <label className="label">{t('Input Mode')}</label>
        <div className="space-y-2">
          <Radio checked={st.inputMode === 'vad'} onClick={() => update({ inputMode: 'vad' })} title={t('Voice Activity')} />
          <Radio checked={st.inputMode === 'ptt'} onClick={() => update({ inputMode: 'ptt' })} title={t('Push to Talk')} />
          <Radio checked={st.inputMode === 'open'} onClick={() => update({ inputMode: 'open' })} title={t('Always Transmit')} />
        </div>
        {st.inputMode === 'open' && <p className="mt-1.5 text-xs text-text-2" data-input-open-note>{t('Your mic is always live (unless muted). Best for music: voice activity detection can cut off quiet notes and tails.')}</p>}
      </section>

      {st.inputMode === 'vad' ? (
        <section>
          <Toggle label={t('Automatically determine input sensitivity')} checked={st.autoSensitivity} onChange={set('autoSensitivity')} />
          <div className="mt-4">
            <label className="label">{t('Input Sensitivity')}</label>
            <div className="relative h-7 rounded-md bg-bg-0/60 border border-line overflow-hidden">
              <div className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${level >= threshold ? 'bg-success' : 'bg-warn'}`} style={{ width: `${pct}%` }} />
              <input type="range" min={-100} max={0} value={threshold} disabled={st.autoSensitivity} onChange={(e) => update({ sensitivity: Number(e.target.value) })}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer disabled:cursor-default [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow" />
            </div>
            <p className="mt-1.5 text-xs text-text-2">{st.autoSensitivity ? t('Transmits when the meter turns green.') : t("Threshold {threshold} dB — the bar turns green when you'd be heard.", { threshold })}</p>
          </div>
        </section>
      ) : st.inputMode === 'ptt' ? (
        <section className="space-y-4">
          <div>
            <label className="label">{t('Shortcut')}</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setRecording((r) => !r)} className={`input w-56 text-left font-mono ${recording ? 'border-danger ring-2 ring-danger/30' : ''}`}>{recording ? t('Press a key…') : keyLabel(st.pttKey)}</button>
              <button onClick={() => setRecording(true)} className="btn-ghost whitespace-nowrap">{t('Record Keybind')}</button>
              <span className={`ml-auto rounded-md px-2 py-1 text-xs font-bold ${pttHeld ? 'bg-success text-black' : 'bg-bg-3 text-text-2'}`}>{pttHeld ? t('TRANSMITTING') : t('IDLE')}</span>
            </div>
            <p className="mt-1.5 text-xs text-text-2">{desktopBridge() ? t('Works while Parley is in the background too, during a call. Modifier keys work even while typing.') : t('Push to talk only works while this tab is focused (browser limitation); the desktop app also hears it in the background. Modifier keys work even while typing.')}</p>
          </div>
          <Slider label={t('Push to Talk Release Delay')} value={st.pttRelease} min={0} max={2000} step={20} onChange={set('pttRelease')} format={(v) => `${(v / 1000).toFixed(2)}s`} />
        </section>
      ) : null}

      <Divider />

      <section className="space-y-3">
        <label className="label">{t('Voice Processing')}</label>
        <Toggle label={t('Echo Cancellation')} checked={st.echoCancellation} onChange={set('echoCancellation')} />
        <Toggle label={t('Noise Suppression')} checked={st.noiseSuppression} onChange={set('noiseSuppression')} />
        {st.noiseSuppression && (
          <div className="ml-1 flex flex-wrap gap-2" data-ns-mode>
            {([['standard', t('Standard'), t("Your browser's suppressor")], ['enhanced', t('Enhanced'), t('Removes keyboard, fans and background chatter (RNNoise, runs on this device)')]] as const).map(([v, label, hint]) => (
              <button key={v} type="button" title={hint} onClick={() => update({ noiseSuppressionMode: v })} className={`rounded-md border px-3 py-1.5 text-sm text-left ${st.noiseSuppressionMode === v ? 'border-accent bg-accent/15 text-text-0' : 'border-line bg-bg-1 text-text-1 hover:border-text-2'}`} data-ns-mode-option={v} data-on={st.noiseSuppressionMode === v ? '1' : '0'}>
                <span className="block font-semibold">{label}</span><span className="block text-xs text-text-2">{hint}</span>
              </button>
            ))}
          </div>
        )}
        <Toggle label={t('Automatic Gain Control')} checked={st.autoGainControl} onChange={set('autoGainControl')} />
        <p className="text-xs text-text-2" data-hifi-processing-note>{t('High-fidelity channels (set by the server) turn all three off and capture 48 kHz stereo, so instruments and music come through untouched.')}</p>
      </section>

      <Divider />

      <EntranceSound />

      <Divider />

      <section className="space-y-4">
        <h3 className="text-base font-bold">{t('Video Settings')}</h3>
        <div className="aspect-video w-full max-w-md rounded-xl bg-bg-0 border border-line overflow-hidden flex items-center justify-center">
          {preview ? <VideoTile stream={preview} mirror /> : <div className="text-center text-text-2"><VideoOff size={40} className="mx-auto mb-2" /><button onClick={togglePreview} className="btn-primary">{t('Test Video')}</button></div>}
        </div>
        {preview && <button onClick={togglePreview} className="btn-ghost"><Video size={16} /> {t('Stop Test')}</button>}
        <Select label={t('Camera')} value={st.cameraDeviceId} onChange={set('cameraDeviceId')} options={devices.cameras} />
        <div data-stream-quality>
          <label className="label" htmlFor="stream-quality">{t('Screen share quality')}</label>
          <select id="stream-quality" className="input" value={st.streamQuality} onChange={(e) => update({ streamQuality: e.target.value })}>
            {Object.entries(STREAM_QUALITY).map(([k, q]) => <option key={k} value={k}>{t(q.label)}</option>)}
          </select>
          <p className="mt-1 text-xs text-text-2">{t('Applies the next time you share your screen. Higher settings need a faster upload; viewers on slow connections may see it stutter.')}</p>
        </div>
      </section>
    </div>
  )
}

function Select({ label, value, onChange, options, disabled, note }: { label: string; value: string; onChange: (v: string) => void; options: MediaDeviceInfo[]; disabled?: boolean; note?: string }) {
  const t = useT()
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('Default')}</option>
        {options.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
      {note && <p className="mt-1 text-xs text-text-2">{note}</p>}
    </div>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div>
      <div className="flex justify-between"><label className="label">{label}</label><span className="text-xs text-text-2">{format(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-accent" />
    </div>
  )
}

function Meter({ pct, active }: { pct: number; active: boolean }) {
  const segs = 20
  const lit = Math.round((pct / 100) * segs)
  return (
    <div className="flex-1 flex items-center gap-1 h-5">
      {Array.from({ length: segs }, (_, i) => (
        <span key={i} className={`flex-1 h-full rounded-sm ${i < lit ? (active ? 'bg-success' : 'bg-warn') : 'bg-bg-3'}`} />
      ))}
      <Mic size={16} className={active ? 'text-success' : 'text-text-2'} />
    </div>
  )
}

function Radio({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${checked ? 'border-accent bg-accent/10' : 'border-line bg-bg-3 hover:bg-bg-4'}`}>
      <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${checked ? 'border-accent' : 'border-text-2'}`}>{checked && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}</span>
      <span className="font-semibold">{title}</span>
    </button>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="w-full flex items-center justify-between py-1 text-left">
      <span className="text-[15px]">{label}</span>
      <span className={`relative h-6 w-10 rounded-full transition-colors ${checked ? 'bg-success' : 'bg-bg-4'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </span>
    </button>
  )
}

function Divider() { return <div className="h-px bg-line" /> }
