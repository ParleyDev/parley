import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { initAppearance } from './lib/appearance'
import { initPrefs } from './lib/prefs'
import { initLog } from './lib/log'
import { initLanguage } from './lib/i18n'
import { initNative } from './lib/native'
import { initPwa } from './lib/webpush'
import { initViewport } from './lib/viewport'
import { installSettingsSync } from './lib/settingsSync'
import { installArrowNav } from './lib/arrowNav'
import { followOtherTabs } from './lib/accounts'
import { useStore } from './store'
import { initStreamerAuto } from './lib/streamerAuto'
import { initClips } from './lib/clips'
import { initAppIcon } from './lib/appIcon'
import { initOverlayHost } from './lib/overlay'

initAppearance()
initPrefs()
initLog()
const languageReady = initLanguage()
void initNative()
initPwa()
initViewport()
installSettingsSync()
installArrowNav()
initStreamerAuto()
initClips()
initAppIcon()
initOverlayHost()
followOtherTabs(() => ({ token: useStore.getState().token, userId: useStore.getState().user?.id ?? null }), (token) => useStore.setState({ token }))

// First paint waits (briefly) for the chosen language's catalogue, so a non-English UI doesn't flash English.
const render = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
void Promise.race([languageReady, new Promise((r) => setTimeout(r, 1500))]).finally(render)
