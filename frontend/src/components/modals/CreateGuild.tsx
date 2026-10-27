import { ChevronRight, Folder, Hammer, Hash, Import, Megaphone, MessagesSquare, Mic2, Upload, Volume2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import ImagePicker from './ImagePicker'
import { api } from '../../lib/api'
import { TEMPLATES } from '../../lib/discover'
import { useStore } from '../../store'
import type { Channel, Guild } from '../../lib/types'
import { useT } from '../../lib/i18n'

/**
 * Discord's two-step "Create Your Server": pick Create My Own or a template, then name it.
 * Templates add their starter channels on top of #general / General voice.
 */
export default function CreateGuildModal({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user)
  const upsertGuild = useStore((s) => s.upsertGuild)
  const openModal = useStore((s) => s.openModal)
  const [template, setTemplate] = useState<string | null>(null)
  const [step, setStep] = useState<'start' | 'customize' | 'discord'>('start')
  const [name, setName] = useState(user ? `${user.display_name}'s server` : '')
  const [icon, setIcon] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const t = useT()
  const pick = (id: string | null) => { setTemplate(id); setStep('customize') }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>('/guilds', { name, icon_url: icon })
      const tpl = TEMPLATES.find((x) => x.id === template)
      if (tpl) {
        for (const n of tpl.text) await api.post(`/guilds/${g.id}/channels`, { name: n, kind: 'text' }).catch(() => {})
        for (const n of tpl.voice) await api.post(`/guilds/${g.id}/channels`, { name: n, kind: 'voice' }).catch(() => {})
      }
      upsertGuild(g)
      onClose()
      navigate(`/channels/${g.id}/${g.channels.find((c) => c.kind === 'text')?.id ?? ''}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (step === 'discord') return <DiscordImport onBack={() => setStep('start')} onClose={onClose} />
  if (step === 'start') {
    return (
      <Modal title={t('Create Your Server')} subtitle={t('Your server is where you and your friends hang out. Make yours and start talking.')} onClose={onClose}
        footer={<div className="w-full text-center" data-create-start-footer>
          <div className="font-bold mb-2">{t('Have an invite already?')}</div>
          <button type="button" className="btn-ghost w-full justify-center bg-bg-3" onClick={() => openModal({ kind: 'joinGuild' })} data-join-link>{t('Join a Server')}</button>
        </div>}>
        <div className="space-y-2 max-h-[52vh] overflow-y-auto -mx-1 px-1" data-create-start>
          <Row emoji={<Hammer size={20} className="text-success" />} label={t('Create My Own')} onClick={() => pick(null)} testid="own" />
          <Row emoji={<Import size={20} className="text-accent" />} label={t('Import a Discord Template')} onClick={() => setStep('discord')} testid="discord" />
          <div className="pt-2 text-[11px] font-bold uppercase tracking-wider text-text-2">{t('Start from a template')}</div>
          {TEMPLATES.map((tp) => <Row key={tp.id} emoji={<span className="text-xl leading-none">{tp.emoji}</span>} label={t(tp.label)} onClick={() => pick(tp.id)} testid={tp.id} />)}
        </div>
      </Modal>
    )
  }
  const tpl = TEMPLATES.find((x) => x.id === template)
  return (
    <Modal title={t('Customize your server')} subtitle={t('Give your new server a personality with a name and an icon. You can always change it later.')} onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={() => setStep('start')} data-create-back>{t('Back')}</button><button form="create-guild" className="btn-primary" disabled={busy || !name.trim()} data-create-submit>{busy ? t('Creating…') : t('Create')}</button></>}>
      <form id="create-guild" onSubmit={submit} className="space-y-4">
        <ImagePicker value={icon} onChange={setIcon} label={name} id={name || 'x'} kind="icon" />
        {err && <p className="text-sm text-danger">{err}</p>}
        <div><label className="label">{t('Server name')}</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required data-create-name /></div>
        {tpl && <p className="text-xs text-text-2" data-template-note>{tpl.emoji} {tpl.voice.length > 1 ? t('{label} template: adds {text} and the {voice} voice channels.', { label: t(tpl.label), text: tpl.text.map((n) => `#${n}`).join(', '), voice: tpl.voice.join(t(' and ')) }) : t('{label} template: adds {text} and the {voice} voice channel.', { label: t(tpl.label), text: tpl.text.map((n) => `#${n}`).join(', '), voice: tpl.voice.join(t(' and ')) })}</p>}
      </form>
    </Modal>
  )
}

function Row({ emoji, label, onClick, testid }: { emoji: React.ReactNode; label: string; onClick: () => void; testid: string }) {
  return (
    <button type="button" onClick={onClick} data-template={testid} className="w-full flex items-center gap-3 rounded-lg border border-line bg-bg-3/60 px-3 py-2.5 text-left hover:bg-bg-3 hover:border-text-2">
      <span className="h-9 w-9 rounded-full bg-bg-1 flex items-center justify-center shrink-0">{emoji}</span>
      <span className="flex-1 font-semibold text-[15px]">{label}</span>
      <ChevronRight size={18} className="text-text-2" />
    </button>
  )
}

interface DiscordPreview {
  name: string; description: string; notes: string[]
  snapshot: { roles: { name: string; color: string | null }[]; channels: { name: string; kind: string; parent: number | null; news?: boolean }[] }
}

/**
 * Migrating from Discord: paste a server template link (discord.new/…), its code, or the template JSON (or upload
 * the .json). Preview the roles and channels it brings, then create the server from it.
 */
function DiscordImport({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const upsertGuild = useStore((s) => s.upsertGuild)
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<DiscordPreview | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (src = source) => {
    setBusy(true); setErr(null)
    try { const p = await api.post<DiscordPreview>('/templates/discord/preview', { source: src }); setPreview(p); setName(p.name) } catch (e) { setErr((e as Error).message); setPreview(null) } finally { setBusy(false) }
  }
  const upload = async (f: File | undefined) => { if (!f) return; const txt = await f.text(); setSource(txt); void load(txt) }
  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const g = await api.post<Guild & { channels: Channel[] }>('/templates/discord/import', { source, name, icon_url: icon })
      upsertGuild(g); onClose()
      navigate(`/channels/${g.id}/${g.channels.find((c) => c.kind === 'text')?.id ?? ''}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const chans = preview?.snapshot.channels ?? []
  const icon_ = (c: { kind: string; news?: boolean }) => c.kind === 'voice' ? <Volume2 size={14} /> : c.kind === 'stage' ? <Mic2 size={14} /> : c.kind === 'forum' ? <MessagesSquare size={14} /> : c.news ? <Megaphone size={14} /> : <Hash size={14} />
  const row = (c: DiscordPreview['snapshot']['channels'][number], i: number) => <div key={i} className="flex items-center gap-1.5 pl-4 text-text-1">{icon_(c)}<span className="truncate">{c.name}</span></div>
  return (
    <Modal title={t('Import a Discord Template')} subtitle={t('Bring a server over from Discord: its roles, categories, channels and permissions. Messages and members stay behind.')} onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={onBack} data-create-back>{t('Back')}</button>
        {preview
          ? <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={create} data-discord-import>{busy ? t('Creating…') : t('Create Server')}</button>
          : <button type="button" className="btn-primary" disabled={busy || !source.trim()} onClick={() => load()} data-discord-preview>{busy ? t('Loading…') : t('Preview')}</button>}</>}>
      <div className="space-y-3" data-discord-template>
        {!preview && (
          <>
            <div>
              <label className="label">{t('Template link, code or JSON')}</label>
              <textarea className="input min-h-[96px] font-mono text-xs" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://discord.new/abc123XYZ" data-discord-source />
            </div>
            <p className="text-xs text-text-2">{t('In Discord: Server Settings → Server Template → Generate Template, then copy the link. If Discord cannot be reached from this server, open the link https://discord.com/api/v10/guilds/templates/CODE in a browser and paste or upload what it shows.')}</p>
            <label className="btn-ghost bg-bg-3 inline-flex cursor-pointer"><Upload size={16} />{t('Upload .json')}<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-discord-file /></label>
          </>
        )}
        {err && <p className="text-sm text-danger" data-discord-error>{err}</p>}
        {preview && (
          <>
            <ImagePicker value={icon} onChange={setIcon} label={name} id={name || 'x'} kind="icon" />
            <div><label className="label">{t('Server name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-create-name /></div>
            {preview.description && <p className="text-sm text-text-2">{preview.description}</p>}
            <div className="grid grid-cols-2 gap-3 text-sm max-h-[34vh] overflow-y-auto">
              <div data-discord-preview-channels={chans.length}>
                <div className="label">{t('{n} channels', { n: chans.filter((c) => c.kind !== 'category').length })}</div>
                {chans.map((c, i) => c.parent === null && c.kind !== 'category' ? row(c, i) : null)}
                {chans.map((c, i) => c.kind === 'category' ? (
                  <div key={i} className="mt-1.5"><div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-text-2"><Folder size={12} />{c.name}</div>{chans.map((k, j) => k.parent === i ? row(k, j) : null)}</div>
                ) : null)}
              </div>
              <div data-discord-preview-roles={preview.snapshot.roles.length}>
                <div className="label">{t('{n} roles', { n: preview.snapshot.roles.length })}</div>
                {[...preview.snapshot.roles].reverse().map((r, i) => <div key={i} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full shrink-0" style={{ background: r.color ?? '#99aab5' }} /><span className="truncate">{r.name}</span></div>)}
              </div>
            </div>
            {preview.notes.length > 0 && <ul className="text-xs text-text-2 list-disc pl-4" data-discord-notes>{preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </>
        )}
      </div>
    </Modal>
  )
}
