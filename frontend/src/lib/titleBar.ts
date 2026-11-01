import { useEffect, useState } from 'react'
import { desktop, desktopBridge } from './desktop'
import { usePrefs } from './prefs'
import { usePhone } from './swipe'

type Frame = 'custom' | 'mac' | null
let frame: Frame | undefined
const frameReady: Promise<Frame> = desktopBridge()
  ? desktop.settings().then((s) => (frame = s.frame ?? null)).catch(() => (frame = null))
  : Promise.resolve((frame = null))

/** The desktop app's window has no system frame ("custom": we draw its buttons; "mac": traffic lights over us). */
export function useDesktopFrame(): Frame {
  const [f, setF] = useState<Frame>(frame ?? null)
  useEffect(() => { if (frame === undefined) void frameReady.then(setF) }, [])
  return f
}

/** Whether the title bar is showing: on wide screens when chosen in Appearance, and always in a frameless desktop window. */
export function useTitleBarShown(): boolean {
  const pref = usePrefs().titleBar
  const phone = usePhone()
  const f = useDesktopFrame()
  return !phone && (pref || !!f)
}
