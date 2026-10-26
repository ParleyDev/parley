import { Check } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import Modal from '../Modal'

/** Onboarding: the server's questions; answers grant roles and show channels. */
export default function OnboardingModal({ onClose, guildId }: { onClose: () => void; guildId: string }) {
  const guild = useStore((s) => s.guilds[guildId])
  const loadCustomize = useStore((s) => s.loadCustomize)
  const openModal = useStore((s) => s.openModal)
  const pushToast = useStore((s) => s.pushToast)
  const qs = guild?.onboarding?.questions ?? []
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [busy, setBusy] = useState(false)
  if (!guild || qs.length === 0) return null
  const q = qs[step]
  const mine = picked[step] ?? []
  const toggle = (id: string) => setPicked({ ...picked, [step]: q.multi ? (mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]) : (mine.includes(id) ? [] : [id]) })
  const last = step === qs.length - 1
  const finish = async (skip: boolean) => {
    setBusy(true)
    try {
      await api.post(`/guilds/${guildId}/onboarding/answers`, { option_ids: skip ? [] : Object.values(picked).flat() })
      await loadCustomize(guildId)
      onClose()
      if (guild.welcome_screen?.enabled) openModal({ kind: 'welcome', guildId })
    } catch (e) { pushToast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const canSkip = !qs.some((x) => x.required)
  const footer = (
    <>
      {step > 0 && <button type="button" className="btn-ghost mr-auto" onClick={() => setStep(step - 1)}>Back</button>}
      {canSkip && <button type="button" className="btn-ghost" disabled={busy} onClick={() => finish(true)} data-onboarding-skip>Skip</button>}
      <button type="button" className="btn-primary" disabled={busy || (q.required && mine.length === 0)} onClick={() => (last ? finish(false) : setStep(step + 1))} data-onboarding-next>{last ? 'Finish' : 'Next'}</button>
    </>
  )
  return (
    <Modal title={`Welcome to ${guild.name}`} subtitle={`Question ${step + 1} of ${qs.length}`} onClose={onClose} width="max-w-lg" footer={footer}>
      <div data-onboarding-modal data-step={step}>
        <h3 className="text-lg font-bold">{q.title}{q.required && <span className="text-danger"> *</span>}</h3>
        <p className="mb-3 text-xs text-text-2">{q.multi ? 'Pick as many as you like.' : 'Pick one.'}</p>
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          {q.options.map((o) => {
            const on = !!o.id && mine.includes(o.id)
            return (
              <button key={o.id} type="button" onClick={() => o.id && toggle(o.id)} aria-pressed={on} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${on ? 'border-accent bg-accent/15' : 'border-line bg-bg-1 hover:bg-bg-3'}`} data-onboarding-option={o.label}>
                {o.emoji && <span className="text-lg">{o.emoji}</span>}<span className="flex-1">{o.label}</span>{on && <Check size={16} className="text-accent" />}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
