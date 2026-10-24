import { api } from './api'
import { useStore } from '../store'
import type { PrivateUser } from './types'

/**
 * Passkeys (WebAuthn) in the browser. The server (webauthn-rs) speaks the WebAuthn JSON shapes with binary fields as
 * base64url strings; these helpers turn its options into what navigator.credentials expects and the resulting
 * credential back into JSON.
 */

const toBytes = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
const toB64url = (buf: ArrayBuffer | null | undefined): string | undefined => {
  if (!buf) return undefined
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** Drop null / undefined members: WebAuthn's option dictionaries reject an explicit null. */
const clean = <T,>(o: T): T => JSON.parse(JSON.stringify(o, (_k, v) => (v === null ? undefined : v)))

type B64Cred = { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }
interface CreationJSON { publicKey: Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: B64Cred[] } }
interface RequestJSON { publicKey: Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & { challenge: string; allowCredentials?: B64Cred[] } }
const cred = (c: B64Cred): PublicKeyCredentialDescriptor => ({ type: c.type, id: toBytes(c.id), transports: c.transports })

/** Can this page use passkeys? Needs WebAuthn, a secure page, and to be on the server's own address (its RP ID). */
export function passkeysSupported(): boolean {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !window.isSecureContext) return false
  const appUrl = useStore.getState().instance.app_url
  if (!appUrl) return true
  try { return new URL(appUrl).hostname === location.hostname } catch { return true }
}

/** Create a passkey from the server's registration options and return the credential as JSON for /finish. */
export async function createPasskey(opts: CreationJSON) {
  const pk = clean(opts.publicKey)
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...pk,
    challenge: toBytes(pk.challenge),
    user: { ...pk.user, id: toBytes(pk.user.id) },
    excludeCredentials: pk.excludeCredentials?.map(cred),
    // Ask for a discoverable credential so usernameless sign-in (the button, autofill) works. webauthn-rs sends
    // "discouraged" to spare old security keys' limited storage; a key that cannot store one still makes a normal
    // credential, which signs in after typing the username. The server does not check this option.
    authenticatorSelection: { ...pk.authenticatorSelection, residentKey: 'preferred', requireResidentKey: false },
  }
  const c = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null
  if (!c) throw new Error('No passkey was created')
  const r = c.response as AuthenticatorAttestationResponse
  return {
    id: c.id, rawId: toB64url(c.rawId), type: c.type, extensions: c.getClientExtensionResults(),
    response: { attestationObject: toB64url(r.attestationObject), clientDataJSON: toB64url(r.clientDataJSON), transports: r.getTransports?.() },
  }
}

/** Answer a sign-in challenge; `conditional` lets the browser offer passkeys in the username field's autofill. */
export async function getPasskey(opts: RequestJSON, conditional?: { signal: AbortSignal }) {
  const pk = clean(opts.publicKey)
  const publicKey: PublicKeyCredentialRequestOptions = { ...pk, challenge: toBytes(pk.challenge), allowCredentials: pk.allowCredentials?.map(cred) }
  const c = await navigator.credentials.get(conditional ? { publicKey, mediation: 'conditional', signal: conditional.signal } : { publicKey }) as PublicKeyCredential | null
  if (!c) throw new Error('No passkey was chosen')
  const r = c.response as AuthenticatorAssertionResponse
  return {
    id: c.id, rawId: toB64url(c.rawId), type: c.type, extensions: c.getClientExtensionResults(),
    response: { authenticatorData: toB64url(r.authenticatorData), clientDataJSON: toB64url(r.clientDataJSON), signature: toB64url(r.signature), userHandle: toB64url(r.userHandle) },
  }
}

/** Full sign-in: challenge (for `login` when typed, else discoverable), the browser prompt, then the session. */
export async function signInWithPasskey(login?: string, conditional?: { signal: AbortSignal }) {
  const begin = await api.post<{ id: string; options: RequestJSON }>('/auth/passkey/begin', { login: login?.trim() || undefined })
  const credential = await getPasskey(begin.options, conditional)
  return api.post<{ token: string; user: PrivateUser; reenabled?: boolean }>('/auth/passkey/finish', { id: begin.id, credential })
}

/** Turn a WebAuthn DOMException into something a person can act on; null when they simply cancelled. */
export function passkeyError(e: unknown): string | null {
  const err = e as DOMException
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return null
  if (err?.name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  if (err?.name === 'NotSupportedError') return 'This browser can\'t use passkeys here. Sign in with your password instead.'
  if (err?.name === 'SecurityError') return 'Passkeys only work on this server\'s own address.'
  return (e as Error)?.message || 'Something went wrong with the passkey.'
}
