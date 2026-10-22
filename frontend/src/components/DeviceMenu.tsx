import { Check, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'

export type DeviceKind = 'input' | 'output' | 'camera'
export const TITLES: Record<DeviceKind, string> = { input: 'Input Device', output: 'Output Device', camera: 'Camera' }
const NAMES: Record<DeviceKind, string> = { input: 'Microphone', output: 'Speakers', camera: 'Camera' }
const MEDIA_KIND: Record<DeviceKind, MediaDeviceKind> = { input: 'audioinput', output: 'audiooutput', camera: 'videoinput' }

/** The system's devices of one kind; `null` while enumerating. */
export function useDevices(kind: DeviceKind) {
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) { setList([]); return }
    navigator.mediaDevices.enumerateDevices().then((ds) => setList(ds.filter((d) => d.kind === MEDIA_KIND[kind]))).catch(() => setList([]))
  }, [kind])
  return list
}

/** The chosen device id for a kind ('' = system default). */
export function useCurrentDevice(kind: DeviceKind) {
  return useStore((s) => (kind === 'input' ? s.voiceSettings.inputDeviceId : kind === 'output' ? s.voiceSettings.outputDeviceId : s.voiceSettings.cameraDeviceId))
}

/** Display name of the chosen device, for menu subtitles. */
export function deviceLabel(kind: DeviceKind, list: MediaDeviceInfo[] | null, id: string) {
  if (!id) return 'Default'
  return list?.find((d) => d.deviceId === id)?.label || NAMES[kind]
}

/** The radio list of devices (Default first); picking one applies it live and calls `onPicked`. */
export function DeviceOptions({ kind, onPicked }: { kind: DeviceKind; onPicked: () => void }) {
  const update = useStore((s) => s.updateVoiceSettings)
  const list = useDevices(kind)
  const current = useCurrentDevice(kind)
  const pick = (id: string) => { update(kind === 'input' ? { inputDeviceId: id } : kind === 'output' ? { outputDeviceId: id } : { cameraDeviceId: id }); onPicked() }
  return (
    <>
      {list === null && <div className="px-2 py-1.5 text-sm text-text-2">Looking for devices…</div>}
      {list?.length === 0 && <div className="px-2 py-1.5 text-sm text-text-2">No devices found. Allow access first, or check your system settings.</div>}
      {list && [{ deviceId: '', label: 'Default' } as Pick<MediaDeviceInfo, 'deviceId' | 'label'>, ...list.filter((d) => d.deviceId !== 'default' && d.deviceId !== '')].map((d, i) => (
        <button key={d.deviceId || 'default'} role="menuitemradio" aria-checked={current === d.deviceId} onClick={() => pick(d.deviceId)} className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-white ${current === d.deviceId ? 'text-text-0' : 'text-text-1'}`} data-device-option={d.deviceId || 'default'}>
          <span className="w-4 shrink-0">{current === d.deviceId && <Check size={14} />}</span><span className="truncate">{d.label || (i === 0 ? 'Default' : `${NAMES[kind]} ${i}`)}</span>
        </button>
      ))}
    </>
  )
}

/** Microphone / speaker / camera picker, mirroring Voice & Video settings; changes apply live to the running call. */
export default function DeviceMenu({ kind, onClose, align = 'right' }: { kind: DeviceKind; onClose: () => void; align?: 'right' | 'center' }) {
  const openModal = useStore((s) => s.openModal)
  const pos = align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0'
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={`pop absolute bottom-full ${pos} mb-2 z-40 w-64 rounded-xl bg-bg-0 border border-line shadow-2xl p-2`} data-device-menu={kind} role="menu">
        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-2">{TITLES[kind]}</div>
        <DeviceOptions kind={kind} onPicked={onClose} />
        <div className="h-px bg-line my-1" />
        <button onClick={() => { onClose(); openModal({ kind: 'userSettings', tab: 'voice' }) }} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-1 hover:bg-accent hover:text-white"><Settings size={14} /> Voice & Video Settings</button>
      </div>
    </>
  )
}
