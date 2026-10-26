import Modal from '../Modal'
import { KEYBIND_LABELS, prettyCombo, useKeybindMap, type KeybindAction } from '../../lib/keybinds'
import { isDesktop } from '../../lib/native'
import { FORMATS } from '../../lib/editor'
import { useStore } from '../../store'

/** Keys that always do the same thing (only the ones in Settings › Keybinds can be changed). */
const FIXED: { group: string; rows: [string, string][] }[] = [
  { group: 'Messages', rows: [
    ['Enter', 'Send message'], ['Shift + Enter', 'New line'], ['Arrow Up', 'Edit your last message (empty box)'],
    ['Escape', 'Cancel reply or edit'], ['/', 'Built-in commands (start of the box)'], ['Any letter', 'Start typing in the message box'],
  ] },
  { group: 'Formatting', rows: FORMATS.filter((f) => f.keys).map((f) => [prettyCombo(f.keys!), f.label]) },
  { group: 'Navigation', rows: [
    ['Alt + Left / Right', 'Back and forward (desktop app)'],
    ['Escape', 'Close a menu or dialog'],
  ] },
]

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const binds = useKeybindMap()
  const openModal = useStore((s) => s.openModal)
  const actions = Object.keys(KEYBIND_LABELS) as KeybindAction[]
  const Row = ({ keys, what }: { keys: string; what: string }) => (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm" data-shortcut>
      <span className="text-text-1">{what}</span>
      <kbd className="shrink-0 rounded-md border border-line bg-bg-0 px-2 py-0.5 font-mono text-xs text-text-0">{keys}</kbd>
    </div>
  )
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} footer={<button type="button" className="btn-ghost" onClick={() => openModal({ kind: 'userSettings', tab: 'keybinds' })} data-shortcuts-edit>Change keybinds</button>}>
      <div className="grid gap-6 sm:grid-cols-2" data-shortcuts>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-2">Your keybinds</h3>
          {actions.filter((a) => binds[a]).map((a) => <Row key={a} keys={prettyCombo(binds[a])} what={KEYBIND_LABELS[a]} />)}
        </section>
        <div className="space-y-6">
          {FIXED.map((g) => (
            <section key={g.group}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-2">{g.group}</h3>
              {g.rows.filter(([k]) => isDesktop() || !k.startsWith('Alt + Left')).map(([k, w]) => <Row key={k + w} keys={k} what={w} />)}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
