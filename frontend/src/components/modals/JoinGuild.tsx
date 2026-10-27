import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../Modal'
import { useStore } from '../../store'
import { publicOrigin } from '../InviteCard'
import { useT, tn } from '../../lib/i18n'

export default function JoinGuildModal({ onClose, code: initial }: { onClose: () => void; code?: string }) {
  const t = useT()
  const [code, setCode] = useState(initial ?? '')
  const navigate = useNavigate()
  const openModal = useStore((s) => s.openModal)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const c = code.trim().split('/').filter(Boolean).pop() ?? ''
    if (!c) return
    onClose()
    navigate(/\/template\//.test(code) ? `/template/${c}` : `/invite/${c}`)
  }
  return (
    <Modal title={t('Join a Server')} subtitle={t('Enter an invite below to join an existing server.')} onClose={onClose}
      footer={<><button type="button" className="btn-ghost" onClick={() => openModal({ kind: 'createGuild' })} data-join-back>{t('Back')}</button><button form="join-guild" className="btn-primary" disabled={!code.trim()}>{t('Join Server')}</button></>}>
      <form id="join-guild" onSubmit={submit}>
        <label className="label">{t('Invite or template link')}</label>
        <input className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={`${publicOrigin()}/invite/abcd1234`} />
        <p className="mt-3 text-xs text-text-2">{tn('Invites look like {link} or just {code}.', { link: <b className="text-text-1">{publicOrigin()}/invite/hTKzmak8</b>, code: <b className="text-text-1">hTKzmak8</b> })}</p>
      </form>
    </Modal>
  )
}
