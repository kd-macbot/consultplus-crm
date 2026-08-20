import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initMonitoring, captureError } from './lib/monitoring'
import '@fontsource-variable/inter/wght.css'
import './styles/globals.css'

// Преди рендера — за да хване и грешка при самото стартиране.
initMonitoring()

console.log('[CRM] Starting app...', import.meta.env.VITE_BUILD_ID ?? 'dev')

try {
  const root = document.getElementById('root')
  console.log('[CRM] Root element:', root)
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
    console.log('[CRM] React rendered')
  }
} catch (err) {
  console.error('[CRM] Fatal error:', err)
  captureError(err, { where: 'bootstrap' })
  document.body.innerHTML = '<pre style="color:red;padding:2rem">' + String(err) + '</pre>'
}
