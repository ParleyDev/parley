import { Play, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../../lib/api'
import { postMultipart } from '../../../lib/upload'
import type { Sound } from '../../../lib/types'
import { useStore } from '../../../store'

const MAX = 48
const MAX_BYTES = 512 * 1024

/** Server Settings › Soundboard: upload short clips (name, emoji, volume), preview and delete. */
export default function SoundboardTab({ guildId }: { guildId: string }) {
  const sounds = useStore((s) => s.sounds[guildId])
  const loadSounds = useStore((s) => s.loadSounds)
  const pushToast = useStore((s) => s.pushToast)
  const openModal = useStore((s) => s.openModal)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [volume, setVolume] = useState(100)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!sounds) loadSounds(guildId) }, [guildId, sounds, loadSounds])
  const pick = (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_BYTES) { pushToast('Sounds must be under 512 KB (about 5 seconds of MP3)', 'error'); return }
    setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 32))
  }
  const reset = () => { setFile(null); setName(''); setEmoji(''); setVolume(100) }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file) return
    setBusy(true)
    try { await postMultipart<Sound>(`/guilds/${guildId}/sounds`, file, { name, emoji, volume: String(volume / 100) }); pushToast('Sound added'); reset() } catch (err) { pushToast((err as Error).message, 'error') } finally { setBusy(false) }
  }
  const preview = (snd: Sound) => { const el = new Audio(snd.url); el.volume = snd.volume; el.play().catch(() => {}) }
  const del = (snd: Sound) => openModal({ kind: 'confirm', title: `Delete ${snd.name}`, body: 'Removes the sound from this server\'s soundboard.', danger: true, confirmLabel: 'Delete',
    action: async () => { try { await api.delete(`/guilds/${guildId}/sounds/${snd.id}`) } catch (err) { pushToast((err as Error).message, 'error') } } })
  const list = sounds ?? []
  return (
    <div className="space-y-5" data-soundboard-tab>
      <div>
        <h1 className="text-xl font-bold">Soundboard</h1>
        <p className="text-sm text-text-2 mt-1">Short clips members can play into voice channels from the Soundboard button. MP3, OGG, WAV, WebM or M4A under 512 KB; keep them to a few seconds. Up to {MAX} per server.</p>
      </div>
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} data-sound-file />
      {file ? (
        <form onSubmit={submit} className="rounded-xl border border-line bg-bg-0/40 p-4 space-y-3" data-sound-form>
          <div className="text-sm text-text-2">{file.name} · {Math.round(file.size / 1024)} KB</div>
          <div className="grid grid-cols-[1fr_80px_140px] gap-3 max-md:grid-cols-1">
            <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} minLength={2} required data-sound-name /></div>
            <div><label className="label">Emoji</label><input className="input text-center" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="🔊" data-sound-emoji /></div>
            <div><label className="label">Volume {volume}%</label><input type="range" min={5} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-accent" data-sound-volume /></div>
          </div>
          <div className="flex gap-2 justify-end"><button type="button" className="btn-ghost" onClick={reset}>Cancel</button><button className="btn-primary" disabled={busy || name.trim().length < 2} data-sound-submit>{busy ? 'Uploading…' : 'Add Sound'}</button></div>
        </form>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn-primary" disabled={list.length >= MAX} onClick={() => fileRef.current?.click()} data-upload-sound><Upload size={16} /> Upload Sound</button>
          <span className="text-sm text-text-2">{list.length} / {MAX} slots used</span>
        </div>
      )}
      {list.length === 0 && !file && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-text-2">No sounds yet.</div>}
      {list.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {list.map((snd) => (
            <div key={snd.id} className="group relative rounded-xl border border-line bg-bg-0/40 p-3 flex flex-col items-center gap-1.5" data-sound-row={snd.name}>
              <span className="text-3xl leading-none">{snd.emoji || '🔊'}</span>
              <div className="text-sm font-semibold truncate max-w-full">{snd.name}</div>
              <div className="text-xs text-text-2">{Math.round(snd.size / 1024)} KB · {Math.round(snd.volume * 100)}%</div>
              <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 bg-bg-1 border border-line rounded-md">
                <button type="button" onClick={() => preview(snd)} className="h-7 w-7 flex items-center justify-center text-text-2 hover:text-text-0" title="Preview" data-sound-preview><Play size={14} /></button>
                <button type="button" onClick={() => del(snd)} className="h-7 w-7 flex items-center justify-center text-text-2 hover:text-danger" title="Delete" data-delete-sound><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
