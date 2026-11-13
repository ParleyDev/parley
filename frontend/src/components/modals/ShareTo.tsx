import { FileText, Hash, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { appNavigate } from '../../lib/native'
import { handOff, type Incoming } from '../../lib/shareIn'
import { formatBytes, isImage } from '../../lib/upload'
import { useT } from '../../lib/i18n'
import Avatar from '../Avatar'
import Modal from '../Modal'
import { useSendTargets } from './Forward'

/**
 * Something shared into Parley from another app (a link, text, photos, files): pick where it goes, and that chat
 * opens with it in the message box, to add a word to and send.
 */
export default function ShareToModal({ onClose, share }: { onClose: () => void; share: Incoming }) {
  const t = useT()
  const [q, setQ] = useState('')
  const targets = useSendTargets()
  const needle = q.trim().toLowerCase()
  const list = useMemo(() => targets.filter((tg) => !needle || tg.label.toLowerCase().includes(needle) || tg.sub.toLowerCase().includes(needle)), [targets, needle])
  const thumbs = useMemo(() => share.files.map((f) => (isImage(f.type) ? URL.createObjectURL(f) : null)), [share.files])
  useEffect(() => () => thumbs.forEach((u) => u && URL.revokeObjectURL(u)), [thumbs])
  const pick = (id: string, guildId?: string) => {
    handOff(id, share)
    appNavigate(`/channels/${guildId ?? '@me'}/${id}`)
    onClose()
  }
  return (
    <Modal onClose={onClose} title={t('Share to…')} width="max-w-lg">
      <div data-share-to>
        <div className="mb-3 rounded-lg border border-line bg-bg-0/60 p-2.5" data-share-preview>
          {share.text && <p className="whitespace-pre-wrap break-words text-sm line-clamp-4" data-share-text>{share.text}</p>}
          {share.files.length > 0 && (
            <div className={`flex gap-2 overflow-x-auto ${share.text ? 'mt-2' : ''}`}>
              {share.files.map((f, i) => (
                <div key={i} className="shrink-0" data-share-file={f.name} title={f.name}>
                  {thumbs[i]
                    ? <img src={thumbs[i]!} alt={f.name} className="h-16 w-16 rounded-md object-cover" />
                    : <div className="flex h-16 w-28 flex-col justify-center rounded-md bg-bg-3 px-2 text-xs"><FileText size={16} className="mb-1 text-text-2" /><span className="truncate">{f.name}</span><span className="text-text-2">{formatBytes(f.size)}</span></div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-md bg-bg-0 border border-line px-2.5 h-9 mb-3">
          <Search size={16} className="text-text-2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search for a channel or friend')} data-share-search className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-2 min-w-0" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-0.5" data-share-list>
          {list.length === 0 && <p className="p-4 text-center text-sm text-text-2">{t('Nothing matches.')}</p>}
          {list.map((tg) => (
            <button key={tg.id} type="button" onClick={() => pick(tg.id, tg.guildId)} data-share-target={tg.label} className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-bg-3">
              {tg.kind === 'dm' && tg.avatar ? <Avatar user={tg.avatar} size={28} /> : <span className="h-7 w-7 rounded-md bg-bg-3 flex items-center justify-center text-text-2"><Hash size={16} /></span>}
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[15px] font-medium">{tg.label}</span><span className="block truncate text-xs text-text-2">{tg.sub}</span></span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
