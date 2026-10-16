import { useEffect, type ReactNode } from 'react'
import GuildBar from './GuildBar'
import Modals from './modals'
import UserPanel from './UserPanel'
import { useStore } from '../store'

/**
 * The app's two-column frame (server bar + sidebar on the left, content on the right) for pages
 * outside the chat shell. On phones only one pane shows at a time, driven by the shared
 * `mobilePane` state: sidebars call `useShowContent()` when an item is picked and content headers
 * render `<MobileBack />` to return. `defaultPane` picks which pane a phone lands on.
 */
export default function SplitLayout({ sidebar, children, defaultPane = 'nav', testid }: { sidebar: ReactNode; children: ReactNode; defaultPane?: 'nav' | 'content'; testid?: Record<string, string> }) {
  const pane = useStore((s) => s.mobilePane)
  const setMobilePane = useStore((s) => s.setMobilePane)
  useEffect(() => { if (window.matchMedia('(max-width: 767px)').matches) setMobilePane(defaultPane) }, [defaultPane, setMobilePane])
  return (
    <div className="h-full flex overflow-hidden relative" {...testid}>
      <div className={`flex flex-col h-full shrink-0 w-[344px] max-md:w-auto max-md:absolute max-md:inset-0 max-md:z-20 ${pane === 'content' ? 'max-md:hidden' : ''}`}>
        <div className="flex flex-1 min-h-0">
          <GuildBar />
          {sidebar}
        </div>
        <UserPanel />
      </div>
      <main className={`flex-1 min-w-0 flex flex-col bg-bg-2 ${pane === 'nav' ? 'max-md:hidden' : ''}`}>{children}</main>
      <Modals />
    </div>
  )
}

/** For sidebar items: on phones, reveal the content pane after a pick. */
export function useShowContent() {
  const setMobilePane = useStore((s) => s.setMobilePane)
  return () => setMobilePane('content')
}
