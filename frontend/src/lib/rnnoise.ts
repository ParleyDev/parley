import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

/**
 * Enhanced noise suppression: RNNoise (a small recurrent network trained on speech vs noise) in an AudioWorklet,
 * instead of the browser's own suppressor. Needs a 48 kHz AudioContext; the wasm loads once, on first use.
 */
let wasm: Promise<ArrayBuffer> | null = null
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

export const rnnoiseSupported = (ctx: BaseAudioContext | null) => !!ctx && ctx.sampleRate === 48000 && typeof AudioWorkletNode !== 'undefined'

/** A ready RNNoise node for this context, or null when it can't run here (the caller keeps the plain path). */
export async function createRnnoise(ctx: AudioContext): Promise<AudioWorkletNode | null> {
  if (!rnnoiseSupported(ctx)) return null
  try {
    wasm ??= loadRnnoise({ url: wasmUrl, simdUrl })
    if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(workletUrl))
    const [bin] = await Promise.all([wasm, loaded.get(ctx)])
    return new RnnoiseWorkletNode(ctx, { maxChannels: 2, wasmBinary: bin })
  } catch (e) {
    console.warn('RNNoise unavailable', e)
    wasm = null
    return null
  }
}
