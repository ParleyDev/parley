import { KeyRound, Link2, MessageCircleWarning, ShieldCheck, UserX } from 'lucide-react'
import Modal from '../Modal'
import { APP_NAME } from '../../lib/brand'
import { useStore } from '../../store'

/** Safety Center: short, practical advice and shortcuts to the settings that keep you safe. */
export default function SafetyCenterModal({ onClose }: { onClose: () => void }) {
  const openModal = useStore((s) => s.openModal)
  const mfa = useStore((s) => !!s.user?.mfa_enabled)
  const card = (icon: React.ReactNode, title: string, body: string, action?: { label: string; go: () => void }) => (
    <div className="flex gap-3 rounded-xl border border-line bg-bg-1 p-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0 flex-1"><div className="font-semibold">{title}</div><p className="text-sm text-text-2">{body}</p>{action && <button type="button" className="mt-1 text-sm text-sky-400 hover:underline" onClick={action.go}>{action.label}</button>}</div>
    </div>
  )
  return (
    <Modal title="Safety Center" subtitle={`Tools and tips for staying safe on ${APP_NAME}.`} onClose={onClose} width="max-w-lg">
      <div className="space-y-2" data-safety-center>
        {card(<KeyRound size={20} />, mfa ? 'Your account has two-factor authentication' : 'Turn on two-factor authentication', 'A second step at login means a stolen password alone can’t get into your account.', mfa ? undefined : { label: 'Set it up', go: () => openModal({ kind: 'userSettings', tab: 'account' }) })}
        {card(<ShieldCheck size={20} />, 'Choose who can reach you', 'Decide who can DM you, send friend requests or add you to groups, and blur or hide media from people you don’t know.', { label: 'Content & Social settings', go: () => openModal({ kind: 'userSettings' }) })}
        {card(<Link2 size={20} />, 'Watch out for scam links', `Free gifts, "verify your account" pages and lookalike ${APP_NAME} sites are common scams. ${APP_NAME} will never ask for your password in a message.`)}
        {card(<UserX size={20} />, 'Block, ignore or report', 'Right-click anyone to ignore them quietly, block them, or report them to the admins (and in a server, its moderators).')}
        {card(<MessageCircleWarning size={20} />, 'If something feels wrong, stop', 'Don’t share personal details or move to another app because someone pressures you. Tell someone you trust.')}
      </div>
    </Modal>
  )
}
