import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { PushNotifications } from '@capacitor/push-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { api } from './api'
import { resumeSocket, suspendSocket } from './ws'
import { voice } from './voice'
import { t } from './i18n'
import { useStore } from '../store'

/**
 * Native app glue (mobile/ Capacitor shells). The web client is served by the user's server and loaded inside the
 * app's WebView, where `window.Capacitor` exists; everything here is a no-op in a normal browser.
 */
const KeepAwake = registerPlugin<{ keepAwake(): Promise<void>; allowSleep(): Promise<void> }>('KeepAwake')
/** Android: the "In a call" foreground service that keeps the mic and audio going in the background (app 0.16+). */
const CallKeepAlive = registerPlugin<{ start(o: { title: string }): Promise<void>; stop(): Promise<void> }>('CallKeepAlive')

export const isNative = () => Capacitor.isNativePlatform()
export const nativePlatform = () => Capacitor.getPlatform() as 'ios' | 'android' | 'web'
let navigateTo: ((path: string) => void) | null = null
export const setNativeNavigator = (fn: (path: string) => void) => { navigateTo = fn }
/** Navigate from outside React (notification clicks, push taps). */
export const appNavigate = (path: string) => navigateTo?.(path)

/** A tapped notification opens its channel. */
function openFromPush({ notification }: { notification: { data?: unknown } }) {
  const d = notification.data as { channel_id?: string; guild_id?: string | null } | undefined
  if (d?.channel_id) navigateTo?.(`/channels/${d.guild_id ?? '@me'}/${d.channel_id}`)
}

/** Once at boot: status bar, hardware back button, push taps. */
export async function initNative() {
  if (!isNative()) return
  document.documentElement.dataset.native = nativePlatform()
  try { await StatusBar.setStyle({ style: Style.Dark }); if (nativePlatform() === 'android') await StatusBar.setBackgroundColor({ color: '#0b0c10' }) } catch { /* plugin missing */ }
  App.addListener('appStateChange', ({ isActive }) => { if (isActive) { resumeSocket(); void voice.resumeAfterBackground() } else suspendSocket() })
  App.addListener('backButton', ({ canGoBack }) => {
    const s = useStore.getState()
    // Something on screen (a phone call's fullscreen view, its More sheet) can claim the back button first.
    if (!window.dispatchEvent(new CustomEvent('parley:back', { cancelable: true }))) return
    if (s.modal) { s.closeModal(); return }
    if (s.mobilePane === 'content') { s.setMobilePane('nav'); return }
    if (canGoBack) window.history.back(); else App.exitApp()
  })
  void PushNotifications.addListener('pushNotificationActionPerformed', openFromPush)
}

/** How registering went: 'ok', 'denied' (notifications off for the app), 'timeout' (no token from the OS), or the
 *  error the OS or the server gave. */
export type PushRegistration = 'ok' | 'denied' | 'timeout' | 'web' | string
let registered: Promise<PushRegistration> | null = null
/** After login: ask for permission and send the device token to the server (once per launch while it works). */
export function registerPush(): Promise<PushRegistration> {
  if (!isNative()) return Promise.resolve('web')
  registered ??= (async (): Promise<PushRegistration> => {
    try {
      const perm = await PushNotifications.requestPermissions()
      if (perm.receive !== 'granted') return 'denied'
      return await new Promise<PushRegistration>((resolve) => {
        void PushNotifications.removeAllListeners().then(() => {
          // removeAllListeners also drops the tap handler from initNative: put it back.
          void PushNotifications.addListener('pushNotificationActionPerformed', openFromPush)
          void PushNotifications.addListener('registration', ({ value }) => {
            api.put('/users/@me/push-tokens', { platform: nativePlatform(), token: value })
              .then(() => { try { localStorage.setItem('parley.pushToken', value) } catch { /* ignore */ } resolve('ok') })
              .catch((e) => resolve(`server: ${(e as Error).message}`))
          })
          void PushNotifications.addListener('registrationError', (e) => { console.warn('push registration failed', e); resolve(e.error || 'registration failed') })
          void PushNotifications.register()
          setTimeout(() => resolve('timeout'), 10_000)
        })
      })
    } catch (e) { console.warn('push unavailable', e); return `unavailable: ${(e as Error).message}` }
  })().then((r) => { if (r !== 'ok') registered = null; return r })
  return registered
}

/** Before logging out: forget this device's token so a signed-out phone stops buzzing. */
export async function unregisterPush() {
  await import('./webpush').then((w) => w.disablePush()).catch(() => {})
  if (!isNative()) return
  try { const t = localStorage.getItem('parley.pushToken'); if (t) { await api.delete('/users/@me/push-tokens', { token: t }); localStorage.removeItem('parley.pushToken') } } catch { /* ignore */ }
}

/** While in a call: keep the screen on, and on Android keep the call alive in the background. */
export function keepAwake(on: boolean) {
  if (!isNative()) return
  ;(on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
  if (nativePlatform() === 'android') (on ? CallKeepAlive.start({ title: t('In a call') }) : CallKeepAlive.stop()).catch(() => {})
}

export function haptic(style: 'light' | 'medium' = 'light') {
  if (!isNative()) return
  Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {})
}

/** Back to the app's connect screen to pick another server. */
/** Running inside the Tauri desktop shell (its window carries a ParleyDesktop marker in the user agent). */
export const isDesktop = () => typeof navigator !== 'undefined' && /ParleyDesktop\//.test(navigator.userAgent)
/** The desktop shell's version from its user agent marker. */
export const desktopVersion = () => (typeof navigator !== 'undefined' && /ParleyDesktop\/([^\s]+)/.exec(navigator.userAgent)?.[1]) ?? ''

/** Open a URL outside the app: the desktop shell intercepts /?parley-open=… and hands it to the OS; browsers get a new tab. */
export function openExternal(url: string) {
  if (isDesktop()) { location.href = `${location.origin}/?parley-open=${encodeURIComponent(url)}`; return }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function switchServer() {
  if (isDesktop()) { location.href = `${location.origin}/?parley-switch=1`; return }
  if (!isNative()) return
  location.href = (nativePlatform() === 'android' ? 'https://localhost' : 'capacitor://localhost') + '/#switch'
}
