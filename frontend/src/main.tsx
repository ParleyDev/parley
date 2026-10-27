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

initAppearance()
initPrefs()
initLog()
initLanguage()
void initNative()
initPwa()
initViewport()
installSettingsSync()
installArrowNav()
followOtherTabs(() => ({ token: useStore.getState().token, userId: useStore.getState().user?.id ?? null }), (token) => useStore.setState({ token }))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
