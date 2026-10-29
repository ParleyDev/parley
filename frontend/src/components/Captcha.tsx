import { useEffect, useRef } from 'react'

/** The provider's widget API, once its script has loaded (Turnstile and hCaptcha share this shape). */
interface WidgetApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | number
  reset: (id?: string | number) => void
  remove?: (id?: string | number) => void
}
const SCRIPTS: Record<string, { src: string; global: 'turnstile' | 'hcaptcha' }> = {
  turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off', global: 'hcaptcha' },
}
const loading = new Map<string, Promise<WidgetApi>>()

function load(provider: string): Promise<WidgetApi> {
  const s = SCRIPTS[provider]
  let p = loading.get(provider)
  if (!p) {
    p = new Promise<WidgetApi>((resolve, reject) => {
      const ready = () => { const api = (window as unknown as Record<string, WidgetApi | undefined>)[s.global]; if (api) resolve(api); else reject(new Error('CAPTCHA unavailable')) }
      const el = document.createElement('script')
      el.src = s.src; el.async = true; el.defer = true
      el.onload = () => { let n = 0; const wait = () => ((window as unknown as Record<string, unknown>)[s.global] || n++ > 50 ? ready() : setTimeout(wait, 100)); wait() }
      el.onerror = () => { loading.delete(provider); reject(new Error('CAPTCHA unavailable')) }
      document.head.appendChild(el)
    })
    loading.set(provider, p)
  }
  return p
}

/**
 * The sign-up CAPTCHA (Cloudflare Turnstile or hCaptcha, whichever the instance set up). Calls `onToken` with the
 * widget's token when it's solved, and with null when it expires or fails. `resetKey` changing renders a fresh one
 * (a token works once: after a refused sign-up the form needs another).
 */
export default function Captcha({ provider, siteKey, onToken, resetKey }: { provider: string; siteKey: string; onToken: (t: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  useEffect(() => {
    if (!SCRIPTS[provider] || !siteKey || !ref.current) return
    let id: string | number | undefined, api: WidgetApi | undefined, alive = true
    const el = ref.current
    load(provider).then((a) => {
      if (!alive) return
      api = a
      id = a.render(el, {
        sitekey: siteKey, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        callback: (t: string) => cb.current(t), 'expired-callback': () => cb.current(null), 'error-callback': () => cb.current(null),
      })
    }).catch(() => cb.current(null))
    return () => { alive = false; cb.current(null); try { if (api?.remove) api.remove(id); else api?.reset(id) } catch { /* gone */ } el.innerHTML = '' }
  }, [provider, siteKey, resetKey])
  return <div ref={ref} className="min-h-[65px] flex justify-center" data-captcha={provider} />
}
