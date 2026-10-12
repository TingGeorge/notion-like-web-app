import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './app/App'
import { htmlLang, t } from './strings'

document.documentElement.lang = htmlLang

// SEC-3: <meta> CSP cannot carry frame-ancestors, so refuse to run inside a frame.
if (window.top !== window.self) {
  document.body.textContent = t.app.frameRefused
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
