import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

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
  document.body.innerHTML = '<pre style="color:red;padding:2rem">' + String(err) + '</pre>'
}
