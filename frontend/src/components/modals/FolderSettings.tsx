import { useState, type FormEvent } from 'react'
import { ROLE_COLORS } from '../../lib/perms'
import { dissolveFolder, updateFolder } from '../../lib/layout'
import { useStore } from '../../store'
import Modal from '../Modal'

/** Name and colour for a server folder, plus "Remove Folder" (servers go back to the bar). */
export default function FolderSettingsModal({ onClose, folderId }: { onClose: () => void; folderId: string }) {
  const folder = useStore((s) => s.guildLayout.find((it) => it.kind === 'folder' && it.id === folderId))
  const layout = useStore((s) => s.guildLayout)
  const setLayout = useStore((s) => s.setGuildLayout)
  const [name, setName] = useState(folder?.kind === 'folder' ? folder.name : '')
  const [color, setColor] = useState<string | null>(folder?.kind === 'folder' ? folder.color : null)
  if (!folder || folder.kind !== 'folder') return null
  const save = (e: FormEvent) => { e.preventDefault(); setLayout(updateFolder(layout, folderId, { name: name.trim(), color }), true); onClose() }
  const remove = () => { setLayout(dissolveFolder(layout, folderId), true); onClose() }
  return (
    <Modal title="Folder Settings" onClose={onClose} footer={<><button type="button" className="btn-ghost text-danger mr-auto" onClick={remove} data-folder-remove>Remove Folder</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button form="folder-settings" className="btn-primary" data-folder-save>Save</button></>}>
      <form id="folder-settings" onSubmit={save} className="space-y-4" data-folder-settings>
        <div><label className="label">Folder name</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Leave blank to show the servers' names" data-folder-name /></div>
        <div>
          <label className="label">Folder colour</label>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setColor(null)} className={`h-7 px-2 rounded-md border-2 text-xs ${color === null ? 'border-white' : 'border-transparent'} bg-bg-3`}>Default</button>
            {ROLE_COLORS.slice(0, 12).map((c) => <button key={c} type="button" onClick={() => setColor(c)} data-folder-color={c} className={`h-7 w-7 rounded-md border-2 ${color === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />)}
          </div>
        </div>
        <p className="text-xs text-text-2">{folder.guilds.length} server{folder.guilds.length === 1 ? '' : 's'} in this folder.</p>
      </form>
    </Modal>
  )
}
