import { KeyRound, Link2, MessageCircleWarning, ShieldCheck, UserX } from 'lucide-react'
import Modal from '../Modal'
import { APP_NAME } from '../../lib/brand'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

/** Safety Center: short, practical advice and shortcuts to the settings that keep you safe. */
export default function SafetyCenterModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const openModal = useStore((s) => s.openModal)
  const mfa = useStore((s) => !!s.user?.mfa_enabled)
  const card = (icon: React.ReactNode, title: string, body: string, action?: { label: string; go: () => void }) => (
    <div className="flex gap-3 rounded-xl border border-line bg-bg-1 p-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0 flex-1"><div className="font-semibold">{title}</div><p className="text-sm text-text-2">{body}</p>{action && <button type="button" className="mt-1 text-sm text-sky-400 hover:underline" onClick={action.go}>{action.label}</button>}</div>
    </div>
  )
  return (
    <Modal title={t('Safety Center')} subtitle={t('Tools and tips for staying safe on {app}.', { app: APP_NAME })} onClose={onClose} width="max-w-lg">
      <div className="space-y-2" data-safety-center>
        {card(<KeyRound size={20} />, mfa ? t('Your account has two-factor authentication') : t('Turn on two-factor authentication'), t('A second step at login means a stolen password alone can’t get into your account.'), mfa ? undefined : { label: t('Set it up'), go: () => openModal({ kind: 'userSettings', tab: 'account' }) })}
        {card(<ShieldCheck size={20} />, t('Choose who can reach you'), t('Decide who can DM you, send friend requests or add you to groups, and blur or hide media from people you don’t know.'), { label: t('Content & Social settings'), go: () => openModal({ kind: 'userSettings' }) })}
        {card(<Link2 size={20} />, t('Watch out for scam links'), t('Free gifts, "verify your account" pages and lookalike {app} sites are common scams. {app} will never ask for your password in a message.', { app: APP_NAME }))}
        {card(<UserX size={20} />, t('Block, ignore or report'), t('Right-click anyone to ignore them quietly, block them, or report them to the admins (and in a server, its moderators).'))}
        {card(<MessageCircleWarning size={20} />, t('If something feels wrong, stop'), t('Don’t share personal details or move to another app because someone pressures you. Tell someone you trust.'))}
      </div>
    </Modal>
  )
}
