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

initAppearance()
initPrefs()
initLog()
initLanguage()
void initNative()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
