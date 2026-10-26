import { renderMarkdown } from '../lib/markdown'
import { locale } from '../lib/i18n'

export interface Embed {
  title?: string; description?: string; url?: string; color?: number; timestamp?: string
  author?: { name: string; url?: string | null; icon_url?: string | null }
  footer?: { text: string; icon_url?: string | null }
  image?: { url: string }; thumbnail?: { url: string }
  fields?: { name: string; value: string; inline: boolean }[]
}

const hex = (c?: number) => (c === undefined ? undefined : `#${c.toString(16).padStart(6, '0')}`)

/** A bot or webhook embed: coloured edge, author, title, description, fields (inline ones share a row), image, footer. */
export default function RichEmbed({ e }: { e: Embed }) {
  const link = (href: string | null | undefined, children: React.ReactNode, cls = '') => href ? <a href={href} target="_blank" rel="noopener noreferrer" className={`hover:underline ${cls}`}>{children}</a> : <span className={cls}>{children}</span>
  return (
    <div className="mt-1 grid max-w-[520px] grid-cols-[1fr_auto] gap-x-3 rounded border-l-4 bg-bg-2 px-3 py-2.5 text-sm" style={{ borderLeftColor: hex(e.color) ?? 'var(--color-line, #3f4147)' }} data-rich-embed>
      <div className="min-w-0 space-y-1">
        {e.author && <div className="flex items-center gap-2 text-xs font-semibold text-text-0">{e.author.icon_url && <img src={e.author.icon_url} alt="" className="h-6 w-6 rounded-full" />}{link(e.author.url, e.author.name)}</div>}
        {e.title && <div className="font-semibold text-text-0" data-embed-title>{link(e.url, e.title, e.url ? 'text-sky-400' : '')}</div>}
        {e.description && <div className="msg-content whitespace-pre-wrap break-words text-text-1">{renderMarkdown(e.description)}</div>}
        {e.fields && e.fields.length > 0 && (
          <div className="grid grid-cols-3 gap-x-4 gap-y-2 pt-1 max-sm:grid-cols-1" data-embed-fields>
            {e.fields.map((f, i) => (
              <div key={i} className={f.inline ? 'col-span-1' : 'col-span-3 max-sm:col-span-1'} data-embed-field={f.name}>
                <div className="text-xs font-semibold text-text-0">{f.name}</div>
                <div className="msg-content whitespace-pre-wrap break-words text-text-1">{renderMarkdown(f.value)}</div>
              </div>
            ))}
          </div>
        )}
        {e.image && <img src={e.image.url} alt="" loading="lazy" className="mt-2 max-h-80 max-w-full rounded" />}
        {(e.footer || e.timestamp) && (
          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-text-2">
            {e.footer?.icon_url && <img src={e.footer.icon_url} alt="" className="h-4 w-4 rounded-full" />}
            {e.footer?.text}{e.footer && e.timestamp && ' • '}{e.timestamp && new Date(e.timestamp).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        )}
      </div>
      {e.thumbnail && <img src={e.thumbnail.url} alt="" loading="lazy" className="h-20 w-20 rounded object-cover" />}
    </div>
  )
}
