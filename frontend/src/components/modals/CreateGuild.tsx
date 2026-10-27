import { ChevronRight, Hammer } from 'lucide-react'
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
  const [step, setStep] = useState<'start' | 'customize'>('start')
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

  if (step === 'start') {
    return (
      <Modal title={t('Create Your Server')} subtitle={t('Your server is where you and your friends hang out. Make yours and start talking.')} onClose={onClose}
        footer={<div className="w-full text-center" data-create-start-footer>
          <div className="font-bold mb-2">{t('Have an invite already?')}</div>
          <button type="button" className="btn-ghost w-full justify-center bg-bg-3" onClick={() => openModal({ kind: 'joinGuild' })} data-join-link>{t('Join a Server')}</button>
        </div>}>
        <div className="space-y-2 max-h-[52vh] overflow-y-auto -mx-1 px-1" data-create-start>
          <Row emoji={<Hammer size={20} className="text-success" />} label={t('Create My Own')} onClick={() => pick(null)} testid="own" />
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
