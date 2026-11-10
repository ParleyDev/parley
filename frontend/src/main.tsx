import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { initAppearance } from './lib/appearance'
import { initPrefs } from './lib/prefs'
import { initLog } from './lib/log'
import { initLanguage } from './lib/i18n'
import { initNative } from './lib/native'
import { initPwa } from './lib/webpush'
import { initViewport } from './lib/viewport'
import { installSettingsSync } from './lib/settingsSync'
import { installArrowNav } from './lib/arrowNav'
import { installScrollingClass } from './lib/scrolling'
import { followOtherTabs } from './lib/accounts'
import { useStore } from './store'
import { initStreamerAuto } from './lib/streamerAuto'
import { initClips } from './lib/clips'
import { initAppIcon } from './lib/appIcon'
import { initOverlayHost } from './lib/overlay'
import { installKeepInView } from './lib/keepInView'
import { installTouchHold } from './lib/touchHold'

initAppearance()
initPrefs()
initLog()
const languageReady = initLanguage()
void initNative()
initPwa()
initViewport()
installSettingsSync()
installArrowNav()
installScrollingClass()
initStreamerAuto()
initClips()
initAppIcon()
initOverlayHost()
installKeepInView()
installTouchHold()
followOtherTabs(() => ({ token: useStore.getState().token, userId: useStore.getState().user?.id ?? null }), (token) => useStore.setState({ token }))

// A page left open across a deploy asks for code chunks the server no longer has: load the new build instead of
// failing (at most once a minute, so a server that is really missing them can't loop).
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('parley.chunkReload') ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('parley.chunkReload', String(Date.now()))
  } catch { /* storage blocked: reload anyway */ }
  e.preventDefault()
  location.reload()
})

// First paint waits (briefly) for the chosen language's catalogue, so a non-English UI doesn't flash English.
// The outer boundary: a crash anywhere outside the app shell's own shows Reload, not an empty screen.
const render = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
void Promise.race([languageReady, new Promise((r) => setTimeout(r, 1500))]).finally(render)
