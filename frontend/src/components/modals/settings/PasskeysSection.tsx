import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { createPasskey, passkeyError, passkeysSupported } from '../../../lib/passkey'

interface Passkey { id: string; name: string; created_at: string; last_used_at: string | null }

/** A name for the passkey made on this device, from the platform the browser reports. */
function guessName(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iPhone or iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'Passkey'
}

/** Passkeys card in My Account: add (after the password and any 2FA code), rename, remove. */
export default function PasskeysSection() {
  const user = useStore((s) => s.user)
  const pushToast = useStore((s) => s.pushToast)
  const [list, setList] = useState<Passkey[] | null>(null)
  const [serverOk, setServerOk] = useState(true)
  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState(guessName)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const supported = passkeysSupported()
  const load = () => api.get<{ available: boolean; passkeys: Passkey[] }>('/users/@me/passkeys').then((r) => { setList(r.passkeys); setServerOk(r.available) }).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) { const m = passkeyError(e); if (m) setErr(m) } finally { setBusy(false) }
  }
  const add = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const begin = await api.post<{ id: string; options: Parameters<typeof createPasskey>[0] }>('/users/@me/passkeys/begin', { password, code: code || undefined })
    const credential = await createPasskey(begin.options)
    await api.post('/users/@me/passkeys/finish', { id: begin.id, credential, name })
    setAdding(false); setPassword(''); setCode(''); setName(guessName()); await load()
    pushToast('Passkey added. You can now sign in with it.')
  }) }
  const rename = (id: string) => run(async () => { await api.patch(`/users/@me/passkeys/${id}`, { name: editName }); setEditing(null); await load() })
  const remove = (id: string) => run(async () => { await api.delete(`/users/@me/passkeys/${id}`); setRemoving(null); await load(); pushToast('Passkey removed') })

  if (!user) return null
  const usable = supported && serverOk
  const when = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'never')
  return (
    <section className="rounded-xl bg-bg-0/50 p-4 space-y-3" data-passkeys-section>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${list?.length ? 'bg-success/20 text-success' : 'bg-bg-3 text-text-2'}`}><KeyRound size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Passkeys</h3>
          <p className="text-sm text-text-2">Sign in with your fingerprint, face, screen lock or a security key instead of your password. Your password keeps working too.</p>
        </div>
      </div>
      {err && <div className="rounded-lg bg-danger/15 border border-danger/40 px-3 py-2 text-sm" data-passkey-error>{err}</div>}

      {list && list.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line" data-passkey-list>
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-passkey={p.id}>
              {editing === p.id ? (
                <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename(p.id) }}>
                  <input className="input py-1" autoFocus maxLength={64} value={editName} onChange={(e) => setEditName(e.target.value)} data-passkey-rename-input />
                  <button className="btn-primary py-1" disabled={busy || !editName.trim()}>Save</button>
                  <button type="button" className="btn-ghost py-1" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : removing === p.id ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-0">Remove <b>{p.name}</b>? It will stop working for sign-in.</span>
                  <button type="button" className="btn-primary bg-danger hover:bg-danger/80 py-1" disabled={busy} onClick={() => remove(p.id)} data-passkey-remove-confirm>Remove</button>
                  <button type="button" className="btn-ghost py-1" onClick={() => setRemoving(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1"><div className="font-medium truncate" data-passkey-name>{p.name}</div><div className="text-xs text-text-2">Added {when(p.created_at)} · last used {when(p.last_used_at)}</div></div>
                  <button type="button" title="Rename" className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" onClick={() => { setEditing(p.id); setEditName(p.name) }} data-passkey-rename><Pencil size={15} /></button>
                  <button type="button" title="Remove" className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger" onClick={() => setRemoving(p.id)} data-passkey-remove><Trash2 size={15} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!usable ? (
        <p className="text-sm text-text-2" data-passkey-unavailable>{!serverOk ? 'Passkeys need this server to run on a domain name (APP_URL).' : 'Passkeys aren\'t available here. Use a browser on this server\'s own address, or the Windows app.'}</p>
      ) : adding ? (
        <form onSubmit={add} className="space-y-2" data-passkey-add-form>
          <div><label className="label">Name</label><input className="input" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} data-passkey-name-input /></div>
          <div><label className="label">Current password</label><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-passkey-password /></div>
          {user.mfa_enabled && <div><label className="label">Two-factor code</label><input className="input tracking-widest" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or abcde-fghij" data-passkey-code /></div>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || !password} data-passkey-create>{busy ? 'Waiting for your device…' : 'Create passkey'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setErr(null) }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setAdding(true)} data-passkey-add><KeyRound size={16} /> Add a passkey</button>
      )}
    </section>
  )
}
