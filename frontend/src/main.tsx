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
import { initViewport } from './lib/viewport'
import { followOtherTabs } from './lib/accounts'
import { useStore } from './store'

initAppearance()
initPrefs()
initLog()
initLanguage()
void initNative()
initViewport()
followOtherTabs(() => ({ token: useStore.getState().token, userId: useStore.getState().user?.id ?? null }), (token) => useStore.setState({ token }))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
