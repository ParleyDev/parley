import { t } from '../lib/i18n'
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, Eye, MoreHorizontal, PhoneOff, Settings } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { voice } from '../lib/voice'
import { DeviceOptions, deviceLabel, titles, useCurrentDevice, useDevices, type DeviceKind } from './DeviceMenu'
import VideoTile from './VideoTile'

/**
 * Call control bar pieces shared by voice channels and DM calls (Discord-style): buttons sit in rounded pill
 * groups, device controls carry a chevron that opens a menu above the bar, and hang-up is a separate red button.
 * `compact` is the smaller size used inside a DM.
 */
const Compact = createContext(false)

export function ControlBar({ compact = false, children }: { compact?: boolean; children: ReactNode }) {
  return (
    <Compact.Provider value={compact}>
      <div className="flex flex-wrap items-center justify-center gap-2 phone:gap-1.5">{children}</div>
    </Compact.Provider>
  )
}

/** Inside the phone call's More sheet controls show as labelled tiles, so they can be told apart without hovering. */
const Labeled = createContext(false)

/**
 * Phones: the call's secondary controls (reactions, captions, invite, Activities, soundboard, view options…) behind
 * one More button that opens them as a sheet of labelled tiles, so the bar keeps just mic, camera, More and hang up.
 */
export function PhoneMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const back = (e: Event) => { e.preventDefault(); setOpen(false) }
    window.addEventListener('parley:back', back)
    return () => window.removeEventListener('parley:back', back)
  }, [open])
  return (
    <>
      <ControlGroup><ControlButton label={t('More')} on={open} onClick={() => setOpen((o) => !o)} data-phone-call-more=""><MoreHorizontal size={20} /></ControlButton></ControlGroup>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[110] bg-black/50" onClick={() => setOpen(false)} data-phone-call-more-backdrop />
          <div className="pop sheet-up fixed inset-x-0 bottom-0 z-[115] rounded-t-2xl border-t border-line bg-bg-1 px-3 pt-3 pb-[max(16px,var(--sab))] shadow-2xl" data-phone-call-more-sheet>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-text-2/40" />
            <Labeled.Provider value={true}>
              <div className="grid grid-cols-4 gap-1 justify-items-center">{children}</div>
            </Labeled.Provider>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export function ControlGroup({ children }: { children: ReactNode }) {
  const compact = useContext(Compact)
  return <div role="group" className={`flex items-center gap-0.5 rounded-xl border border-line bg-bg-1 shadow-sm ${compact ? 'p-1' : 'p-1.5'}`}>{children}</div>
}

/**
 * One control. `tone` colours it while `on`: 'danger' for states that cut you off (muted), 'active' for features
 * that are running (camera, screen share, an open picker).
 */
export function ControlButton({ label, on = false, tone = 'active', onClick, disabled, children, ...data }: { label: string; on?: boolean; tone?: 'active' | 'danger'; onClick: () => void; disabled?: boolean; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  const compact = useContext(Compact)
  const labeled = useContext(Labeled)
  const state = !on ? 'text-text-0 hover:bg-bg-3' : tone === 'danger' ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-text-0 text-bg-0 hover:bg-text-1'
  if (labeled) return (
    <button type="button" aria-label={t(label)} aria-pressed={on} onClick={onClick} disabled={disabled} className="w-full min-w-0 flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-text-1 disabled:opacity-50" {...data}>
      <span className={`h-12 w-12 rounded-full flex items-center justify-center ${on ? (tone === 'danger' ? 'bg-danger/20 text-danger' : 'bg-text-0 text-bg-0') : 'bg-bg-3 text-text-0'}`}>{children}</span>
      <span className="w-full truncate text-center text-[11px] leading-tight">{t(label)}</span>
    </button>
  )
  return (
    <button type="button" title={t(label)} aria-label={t(label)} aria-pressed={on} onClick={onClick} disabled={disabled} className={`${compact ? 'h-9 w-9' : 'h-10 w-10'} shrink-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${state}`} {...data}>
      {children}
    </button>
  )
}

/** A control with a chevron beside it that opens `menu` above the bar. */
export function SplitControl({ chevronLabel, menuKind, menu, align = 'start', children }: { chevronLabel: string; menuKind: DeviceKind; menu: (close: () => void) => ReactNode; align?: 'start' | 'end'; children: ReactNode }) {
  const compact = useContext(Compact)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span ref={ref} className="flex items-center">
      {children}
      <button type="button" title={t(chevronLabel)} aria-label={t(chevronLabel)} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${compact ? 'h-9' : 'h-10'} w-6 shrink-0 rounded-lg flex items-center justify-center text-text-1 hover:bg-bg-3 hover:text-text-0 phone:hidden ${open ? 'bg-bg-3 text-text-0' : ''}`} data-device-chevron={menuKind}>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <CallMenu anchor={ref} align={align} onClose={() => setOpen(false)}>{menu(() => setOpen(false))}</CallMenu>}
    </span>
  )
}

/** The "…" control: a plain button that opens a menu above the bar. */
export function MenuControl({ label, icon, align = 'end', menu }: { label: string; icon: ReactNode; align?: 'start' | 'end'; menu: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span ref={ref} className="flex">
      <ControlButton label={label} on={open} onClick={() => setOpen((o) => !o)} data-call-more="">{icon}</ControlButton>
      {open && <CallMenu anchor={ref} align={align} onClose={() => setOpen(false)}>{menu(() => setOpen(false))}</CallMenu>}
    </span>
  )
}

export function HangUpButton({ label, onClick, ...data }: { label: string; onClick: () => void } & Record<`data-${string}`, string | undefined>) {
  const compact = useContext(Compact)
  return (
    <button type="button" title={t(label)} aria-label={t(label)} onClick={onClick} className={`${compact ? 'h-11 w-14' : 'h-[54px] w-16'} shrink-0 rounded-xl bg-danger text-white flex items-center justify-center shadow-sm hover:bg-danger/80`} {...data}>
      <PhoneOff size={compact ? 18 : 22} />
    </button>
  )
}

/**
 * A menu that opens above its anchor, portalled so the call stage's overflow cannot clip it and clamped to the
 * viewport so it fits on phones. Closes on outside click and Escape.
 */
function CallMenu({ anchor, align, onClose, children }: { anchor: RefObject<HTMLElement | null>; align: 'start' | 'end'; onClose: () => void; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(300, window.innerWidth - 16)
      const left = Math.min(Math.max(8, align === 'start' ? r.left : r.right - width), window.innerWidth - width - 8)
      setPos({ left, bottom: window.innerHeight - r.top + 8, width })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, align])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!pos) return null
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div role="menu" style={{ left: pos.left, bottom: pos.bottom, width: pos.width, maxHeight: `calc(100vh - ${pos.bottom + 16}px)` }} className="pop fixed z-50 overflow-y-auto rounded-xl border border-line bg-bg-1 p-2 shadow-2xl" data-call-menu>
        {children}
      </div>
    </>,
    document.body,
  )
}

// ---- menu rows ----

export function MenuDivider() { return <div className="my-1.5 h-px bg-line" /> }

/** A row that drills into a sub-panel: title, current value underneath, chevron. */
function NavRow({ title, sub, onClick, ...data }: { title: string; sub: string; onClick: () => void } & Record<`data-${string}`, string | undefined>) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-bg-3" {...data}>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-0">{title}</span><span className="block truncate text-xs text-text-2">{sub}</span></span>
      <ChevronRight size={16} className="shrink-0 text-text-2" />
    </button>
  )
}

export function CheckRow({ label, checked, onChange, ...data }: { label: string; checked: boolean; onChange: (v: boolean) => void } & Record<`data-${string}`, string | undefined>) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-text-0 hover:bg-bg-3" {...data}>
      <span className="flex-1">{label}</span>
      <span className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center ${checked ? 'border-accent bg-accent text-white' : 'border-text-2'}`}>{checked && <Check size={14} strokeWidth={3} />}</span>
    </button>
  )
}

export function ActionRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-text-0 hover:bg-bg-3">
      <span className="text-text-1">{icon}</span>{label}
    </button>
  )
}

export function SettingsRow({ label, close }: { label: string; close: () => void }) {
  const openModal = useStore((s) => s.openModal)
  return <ActionRow icon={<Settings size={18} />} label={label} onClick={() => { close(); openModal({ kind: 'userSettings', tab: 'voice' }) }} />
}

function SliderRow({ label, value, max, onChange, ...data }: { label: string; value: number; max: number; onChange: (v: number) => void } & Record<`data-${string}`, string | undefined>) {
  return (
    <label className="block px-2.5 py-1.5">
      <span className="flex items-baseline justify-between text-sm font-semibold text-text-0">{label}<span className="text-xs font-normal text-text-2">{value}%</span></span>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-accent" {...data} />
    </label>
  )
}

/** Segmented input meter, fed by the call's voice gate (dBFS); green while transmitting. */
function LevelRow() {
  const level = useStore((s) => s.inputLevel)
  const transmitting = useStore((s) => s.transmitting)
  const SEGMENTS = 24
  const lit = Math.max(0, Math.min(SEGMENTS, Math.round(((level + 60) / 60) * SEGMENTS)))
  return (
    <div className="px-2.5 py-1.5">
      <div className="text-sm font-semibold text-text-0">{t('Input Level')}</div>
      <div className="mt-2 flex gap-[3px]" aria-hidden data-input-meter={lit}>
        {Array.from({ length: SEGMENTS }, (_, i) => <span key={i} className={`h-3 flex-1 rounded-sm ${i < lit ? (transmitting ? 'bg-success' : 'bg-warn') : 'bg-bg-4'}`} />)}
      </div>
    </div>
  )
}

/** A sub-panel inside a menu: back button with the panel's title, then its content. */
function SubPanel({ title, onBack, children, ...data }: { title: string; onBack: () => void; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <div {...data}>
      <button type="button" onClick={onBack} className="mb-1 w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-bold text-text-0 hover:bg-bg-3" data-menu-back><ArrowLeft size={16} />{title}</button>
      {children}
    </div>
  )
}

// ---- the menus ----

type Profile = 'isolation' | 'studio' | 'custom'
const profiles = (): { id: Profile; name: string; hint: string }[] => [
  { id: 'isolation', name: t('Voice Isolation'), hint: t('Echo cancellation, noise suppression and auto gain on') },
  { id: 'studio', name: t('Studio'), hint: t('All processing off, for music and good microphones') },
  { id: 'custom', name: t('Custom'), hint: t('Your own mix in Voice & Video settings') },
]

/** Microphone menu: input/output devices, input profile, volumes, live input level, Deafen, settings. */
export function MicMenu({ close }: { close: () => void }) {
  const [panel, setPanel] = useState<'main' | 'input' | 'output' | 'profile'>('main')
  const st = useStore((s) => s.voiceSettings)
  const update = useStore((s) => s.updateVoiceSettings)
  const openModal = useStore((s) => s.openModal)
  const deaf = useStore((s) => s.selfDeaf)
  const inputs = useDevices('input'), outputs = useDevices('output')
  const inputId = useCurrentDevice('input'), outputId = useCurrentDevice('output')
  const profile: Profile = st.echoCancellation && st.noiseSuppression && st.autoGainControl ? 'isolation' : !st.echoCancellation && !st.noiseSuppression && !st.autoGainControl ? 'studio' : 'custom'
  const pickProfile = (p: Profile) => {
    if (p === 'custom') { close(); openModal({ kind: 'userSettings', tab: 'voice' }); return }
    const on = p === 'isolation'
    update({ echoCancellation: on, noiseSuppression: on, autoGainControl: on })
    setPanel('main')
  }
  if (panel === 'input' || panel === 'output') {
    return <SubPanel title={titles()[panel]} onBack={() => setPanel('main')} data-device-menu={panel}><DeviceOptions kind={panel} onPicked={() => setPanel('main')} /></SubPanel>
  }
  if (panel === 'profile') {
    return (
      <SubPanel title={t('Input Profile')} onBack={() => setPanel('main')} data-input-profiles="">
        {profiles().map((p) => (
          <button key={p.id} type="button" role="menuitemradio" aria-checked={profile === p.id} onClick={() => pickProfile(p.id)} className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-3" data-input-profile={p.id}>
            <span className="mt-0.5 w-4 shrink-0 text-text-0">{profile === p.id && <Check size={14} />}</span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-text-0">{p.name}</span><span className="block text-xs text-text-2">{p.hint}</span></span>
          </button>
        ))}
      </SubPanel>
    )
  }
  return (
    <div data-mic-menu>
      <NavRow title={t('Input Device')} sub={deviceLabel('input', inputs, inputId)} onClick={() => setPanel('input')} data-device-row="input" />
      <NavRow title={t('Input Profile')} sub={profiles().find((p) => p.id === profile)!.name} onClick={() => setPanel('profile')} data-device-row="profile" />
      <NavRow title={t('Output Device')} sub={deviceLabel('output', outputs, outputId)} onClick={() => setPanel('output')} data-device-row="output" />
      <MenuDivider />
      <SliderRow label={t('Input Volume')} value={st.inputVolume} max={200} onChange={(v) => update({ inputVolume: v })} data-input-volume="" />
      <LevelRow />
      <SliderRow label={t('Output Volume')} value={Math.min(100, st.outputVolume)} max={100} onChange={(v) => update({ outputVolume: v })} data-output-volume="" />
      <MenuDivider />
      <CheckRow label={t('Deafen')} checked={deaf} onChange={(v) => voice.setDeaf(v)} data-call-deafen="" />
      <SettingsRow label={t('Voice Settings')} close={close} />
    </div>
  )
}

/** Camera menu: device, an inline preview, settings. */
export function CameraMenu({ close }: { close: () => void }) {
  const [panel, setPanel] = useState<'main' | 'camera'>('main')
  const [preview, setPreview] = useState(false)
  const cams = useDevices('camera')
  const camId = useCurrentDevice('camera')
  if (panel === 'camera') return <SubPanel title={titles().camera} onBack={() => setPanel('main')} data-device-menu="camera"><DeviceOptions kind="camera" onPicked={() => setPanel('main')} /></SubPanel>
  return (
    <div data-camera-menu>
      <NavRow title={t('Camera')} sub={deviceLabel('camera', cams, camId)} onClick={() => setPanel('camera')} data-device-row="camera" />
      <MenuDivider />
      {preview && <CameraPreview />}
      <ActionRow icon={<Eye size={18} />} label={preview ? t('Hide Preview') : t('Preview Camera')} onClick={() => setPreview((p) => !p)} />
      <SettingsRow label={t('Video Settings')} close={close} />
    </div>
  )
}

/** The camera as others will see it: the live track when it is on, otherwise a temporary preview stream. */
function CameraPreview() {
  const live = useStore((s) => s.localCamera)
  const camId = useCurrentDevice('camera')
  const [own, setOwn] = useState<MediaStream | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (live) return
    let stream: MediaStream | null = null, cancelled = false
    voice.openCamera().then((s) => { if (cancelled) { s?.getTracks().forEach((tr) => tr.stop()); return } stream = s; setOwn(s); setFailed(!s) })
    return () => { cancelled = true; stream?.getTracks().forEach((tr) => tr.stop()); setOwn(null) }
  }, [live, camId])
  const stream = live ?? own
  return (
    <div className="mx-1 mb-1.5 aspect-video overflow-hidden rounded-lg bg-bg-0" data-camera-preview>
      {stream ? <VideoTile stream={stream} mirror contain={false} /> : <div className="h-full flex items-center justify-center text-xs text-text-2">{failed ? t('Camera unavailable') : t('Starting camera…')}</div>}
    </div>
  )
}
