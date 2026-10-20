import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { PushNotifications } from '@capacitor/push-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { api } from './api'
import { useStore } from '../store'

/**
 * Native app glue (mobile/ Capacitor shells). The web client is served by the user's server and loaded inside the
 * app's WebView, where `window.Capacitor` exists; everything here is a no-op in a normal browser.
 */
const KeepAwake = registerPlugin<{ keepAwake(): Promise<void>; allowSleep(): Promise<void> }>('KeepAwake')

export const isNative = () => Capacitor.isNativePlatform()
export const nativePlatform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web'
let navigateTo: ((path: string) => void) | null = null
export const setNativeNavigator = (fn: (path: string) => void) => { navigateTo = fn }

/** Once at boot: status bar, hardware back button, push taps. */
export async function initNative() {
  if (!isNative()) return
  document.documentElement.dataset.native = nativePlatform()
  try { await StatusBar.setStyle({ style: Style.Dark }); if (nativePlatform() === 'android') await StatusBar.setBackgroundColor({ color: '#0b0c10' }) } catch { /* plugin missing */ }
  App.addListener('backButton', ({ canGoBack }) => {
    const s = useStore.getState()
    if (s.modal) { s.closeModal(); return }
    if (s.mobilePane === 'content') { s.setMobilePane('nav'); return }
    if (canGoBack) window.history.back(); else App.exitApp()
  })
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const d = notification.data as { channel_id?: string; guild_id?: string | null } | undefined
    if (d?.channel_id) navigateTo?.(`/channels/${d.guild_id ?? '@me'}/${d.channel_id}`)
  })
}

let registered = false
/** After login: ask for permission and send the device token to the server (idempotent per launch). */
export async function registerPush() {
  if (!isNative() || registered) return
  registered = true
  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    PushNotifications.addListener('registration', ({ value }) => { void api.put('/users/@me/push-tokens', { platform: nativePlatform(), token: value }).then(() => { try { localStorage.setItem('parley.pushToken', value) } catch { /* ignore */ } }).catch(() => {}) })
    PushNotifications.addListener('registrationError', (e) => console.warn('push registration failed', e))
    await PushNotifications.register()
  } catch (e) { console.warn('push unavailable', e) }
}

/** Before logging out: forget this device's token so a signed-out phone stops buzzing. */
export async function unregisterPush() {
  if (!isNative()) return
  try { const t = localStorage.getItem('parley.pushToken'); if (t) { await api.delete('/users/@me/push-tokens', { token: t }); localStorage.removeItem('parley.pushToken') } } catch { /* ignore */ }
}

/** Keep the screen on while in a call. */
export function keepAwake(on: boolean) {
  if (!isNative()) return
  ;(on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
}

export function haptic(style: 'light' | 'medium' = 'light') {
  if (!isNative()) return
  Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {})
}

/** Back to the app's connect screen to pick another server. */
export function switchServer() {
  if (!isNative()) return
  location.href = (nativePlatform() === 'android' ? 'https://localhost' : 'capacitor://localhost') + '/#switch'
}
