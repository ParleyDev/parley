import { Download, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { setPrefs, usePrefs } from '../../../lib/prefs'
import { deleteClip, useClips, type Clip } from '../../../lib/clips'
import { prettyCombo, useKeybindMap } from '../../../lib/keybinds'
import { locale, tn, useT } from '../../../lib/i18n'
import { Toggle } from '../SettingsShell'

/** Settings → Clips: keep the last few seconds of calls ready to save, and the clips saved on this device. */
export default function ClipsTab() {
  const t = useT()
  const p = usePrefs()
  const kb = useKeybindMap()
  const clips = useClips()
  return (
    <div className="space-y-6" data-clips-tab>
      <h2 className="text-xl font-bold">{t('Clips')}</h2>
      <p className="text-sm text-text-2">{tn('Save the last moments of a call or a stream you are watching with {combo} or the scissors in the call bar. Clips stay on this device.', { combo: <b>{prettyCombo(kb.saveClip)}</b> })}</p>
      <section className="space-y-3">
        <span data-clips-enable><Toggle label={t('Enable Clips')} checked={p.clips} onChange={(v) => setPrefs({ clips: v })} /></span>
        <div>
          <label className="label" htmlFor="clip-length">{t('Clip length')}</label>
          <select id="clip-length" className="input w-48" value={p.clipSeconds} onChange={(e) => setPrefs({ clipSeconds: Number(e.target.value) as 15 | 30 | 60 })} data-clip-length>
            <option value={15}>{t('15 seconds')}</option><option value={30}>{t('30 seconds')}</option><option value={60}>{t('1 minute')}</option>
          </select>
        </div>
        <Toggle label={t("Include the call's voices")} checked={p.clipVoices} onChange={(v) => setPrefs({ clipVoices: v })} />
        <Toggle label={t('Include my voice')} checked={p.clipMyVoice} onChange={(v) => setPrefs({ clipMyVoice: v })} />
        <p className="text-xs text-text-2">{t('While Clips are on, your device keeps recording the call in the background so a clip is always ready. Nothing is uploaded.')}</p>
      </section>
      <div className="h-px bg-line" />
      <section className="space-y-2">
        <h3 className="label">{t('Your clips')}</h3>
        {clips === null ? <p className="text-sm text-text-2">{t('Loading…')}</p> : clips.length === 0 ? <p className="text-sm text-text-2">{t('No clips yet.')}</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">{clips.map((c) => <ClipRow key={c.id} clip={c} />)}</ul>
        )}
      </section>
    </div>
  )
}

function ClipRow({ clip }: { clip: Clip }) {
  const t = useT()
  const url = useMemo(() => URL.createObjectURL(clip.blob), [clip.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const video = clip.mime.startsWith('video')
  const ext = clip.mime.includes('mp4') ? 'mp4' : 'webm'
  const when = new Date(clip.at)
  return (
    <li className="rounded-lg border border-line bg-bg-1 overflow-hidden" data-clip={clip.id} data-clip-kind={video ? 'video' : 'audio'}>
      {video ? <video src={url} controls className="w-full aspect-video bg-black" /> : <audio src={url} controls className="w-full" />}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{clip.title || t('Clip')}</div>
          <div className="text-xs text-text-2">{when.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })} · {t('{n}s', { n: clip.seconds })}</div>
        </div>
        <a href={url} download={`parley-clip-${when.toISOString().replace(/[:.]/g, '-')}.${ext}`} title={t('Download')} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-text-0" data-clip-download><Download size={16} /></a>
        <button type="button" onClick={() => void deleteClip(clip.id)} title={t('Delete')} className="h-8 w-8 rounded-md flex items-center justify-center text-text-2 hover:bg-bg-3 hover:text-danger" data-clip-delete><Trash2 size={16} /></button>
      </div>
    </li>
  )
}
