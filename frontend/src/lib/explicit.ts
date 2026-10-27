/**
 * Explicit image detection on this device (nsfwjs, MobileNetV2): pictures never leave the browser to be checked.
 * The model (a few MB) loads only the first time a filter needs it. Results are cached per URL for the session.
 */
type Model = { classify: (img: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, top?: number) => Promise<{ className: string; probability: number }[]> }
let model: Promise<Model> | null = null
const cache = new Map<string, Promise<boolean | null>>()
let running = 0
const queue: (() => void)[] = []

async function loadModel(): Promise<Model> {
  const [tf, core, def] = await Promise.all([import('@tensorflow/tfjs'), import('nsfwjs/core'), import('nsfwjs/models/mobilenet_v2')])
  tf.enableProdMode()
  await tf.ready()
  return (await core.load('MobileNetV2', { modelDefinitions: [def.MobileNetV2Model] })) as unknown as Model
}

/** Porn or hentai above 60%, or very confident "sexy": explicit. */
function verdict(p: { className: string; probability: number }[]): boolean {
  const by = Object.fromEntries(p.map((x) => [x.className, x.probability]))
  return (by.Porn ?? 0) + (by.Hentai ?? 0) > 0.6 || (by.Sexy ?? 0) > 0.85
}

const slot = () => new Promise<void>((r) => { if (running < 2) { running++; r() } else queue.push(() => { running++; r() }) })
const done = () => { running--; queue.shift()?.() }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = url })
}

/** A frame from a little way into a video (same-origin files only). */
function videoFrame(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = url
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2) }
    v.onseeked = () => { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0); v.src = ''; resolve(c) }
    v.onerror = () => reject(new Error('video'))
  })
}

/** true = explicit, false = fine, null = couldn't tell (cross-origin, broken file, no WebGL/WASM). */
export function isExplicit(url: string, kind: 'image' | 'video' = 'image', name = ''): Promise<boolean | null> {
  // End-to-end tests decide by URL instead of shipping explicit pictures.
  const test = (window as unknown as { __parleyExplicitTest?: (u: string) => boolean | null }).__parleyExplicitTest
  if (test) return new Promise((r) => setTimeout(() => r(test(`${url} ${name}`)), 300))
  let p = cache.get(url)
  if (!p) {
    p = (async () => {
      await slot()
      try {
        const m = await (model ??= loadModel().catch((e) => { model = null; throw e }))
        const el = kind === 'video' ? await videoFrame(url) : await loadImage(url)
        return verdict(await m.classify(el, 5))
      } catch (e) {
        console.warn('explicit check failed', e)
        return null
      } finally { done() }
    })()
    cache.set(url, p)
  }
  return p
}
