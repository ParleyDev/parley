import { Check, ChevronDown, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../store'

export type DeviceKind = 'input' | 'output' | 'camera'
const TITLES: Record<DeviceKind, string> = { input: 'Input Device', output: 'Output Device', camera: 'Camera' }
const NAMES: Record<DeviceKind, string> = { input: 'Microphone', output: 'Speakers', camera: 'Camera' }
const MEDIA_KIND: Record<DeviceKind, MediaDeviceKind> = { input: 'audioinput', output: 'audiooutput', camera: 'videoinput' }

/** Microphone / speaker / camera picker, mirroring Voice & Video settings; changes apply live to the running call. */
export default function DeviceMenu({ kind, onClose, align = 'right' }: { kind: DeviceKind; onClose: () => void; align?: 'right' | 'center' }) {
  const settings = useStore((s) => s.voiceSettings)
  const update = useStore((s) => s.updateVoiceSettings)
  const openModal = useStore((s) => s.openModal)
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) { setList([]); return }
    navigator.mediaDevices.enumerateDevices().then((ds) => setList(ds.filter((d) => d.kind === MEDIA_KIND[kind]))).catch(() => setList([]))
  }, [kind])
  const current = kind === 'input' ? settings.inputDeviceId : kind === 'output' ? settings.outputDeviceId : settings.cameraDeviceId
  const pick = (id: string) => { update(kind === 'input' ? { inputDeviceId: id } : kind === 'output' ? { outputDeviceId: id } : { cameraDeviceId: id }); onClose() }
  const pos = align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0'
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={`pop absolute bottom-full ${pos} mb-2 z-40 w-64 rounded-xl bg-bg-0 border border-line shadow-2xl p-2`} data-device-menu={kind} role="menu">
        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{TITLES[kind]}</div>
        {list === null && <div className="px-2 py-1.5 text-sm text-text-2">Looking for devices…</div>}
        {list?.length === 0 && <div className="px-2 py-1.5 text-sm text-text-2">No devices found. Allow access first, or check your system settings.</div>}
        {list && [{ deviceId: '', label: 'Default' } as Pick<MediaDeviceInfo, 'deviceId' | 'label'>, ...list.filter((d) => d.deviceId !== 'default' && d.deviceId !== '')].map((d, i) => (
          <button key={d.deviceId || 'default'} role="menuitemradio" aria-checked={current === d.deviceId} onClick={() => pick(d.deviceId)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-white ${current === d.deviceId ? 'text-text-0' : 'text-text-1'}`} data-device-option={d.deviceId || 'default'}>
            <span className="w-4 shrink-0">{current === d.deviceId && <Check size={14} />}</span><span className="truncate">{d.label || (i === 0 ? 'Default' : `${NAMES[kind]} ${i}`)}</span>
          </button>
        ))}
        <div className="h-px bg-line my-1" />
        <button onClick={() => { onClose(); openModal({ kind: 'userSettings', tab: 'voice' }) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white"><Settings size={14} /> Voice & Video Settings</button>
      </div>
    </>
  )
}

/** A round call control with an optional chevron that opens the device picker for it. */
export function DeviceCtl({ children, label, on, accent, onClick, size = 56, menu, mobileLabel }: { children: ReactNode; label: string; on: boolean; accent?: boolean; onClick: () => void; size?: number; menu?: DeviceKind; mobileLabel?: boolean }) {
  const [open, setOpen] = useState(false)
  const onCls = accent ? 'bg-accent text-white' : 'bg-white text-black'
  return (
    <span className="relative flex flex-col items-center gap-1">
      <span className="flex items-center">
        <button title={label} aria-label={label} aria-pressed={on} onClick={onClick} style={{ height: size, width: size }} className={`rounded-full flex items-center justify-center ${on ? onCls : 'bg-bg-3 text-text-0 hover:bg-bg-4'}`}>{children}</button>
        {menu && <button type="button" title={`${label.replace(/^Un/, '').replace(/^Turn O(n|ff) /, '')} device`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`-ml-2 h-7 w-5 rounded-r-full flex items-center justify-center text-text-1 hover:text-text-0 ${open ? 'bg-white/10' : 'bg-bg-3/80'}`} data-device-chevron={menu}><ChevronDown size={12} /></button>}
      </span>
      {mobileLabel && <span className="md:hidden text-[11px] text-text-2">{label}</span>}
      {open && menu && <DeviceMenu kind={menu} onClose={() => setOpen(false)} align="center" />}
    </span>
  )
}
