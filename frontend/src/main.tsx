import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './fonts.css'
import './index.css'

// Keep long-lived character-sheet tabs on the same certified engine release as
// the server. In auto-update mode Workbox reloads only after a newer worker has
// activated, so an in-progress action is not interrupted by an ordinary poll.
let serviceWorkerRegistrationStarted = false

const registerServiceWorker = () => {
  if (!navigator.onLine || navigator.serviceWorker.controller || serviceWorkerRegistrationStarted) {
    return
  }
  serviceWorkerRegistrationStarted = true
  registerSW({
  immediate: true,
  onRegisteredSW(_workerUrl, registration) {
    if (!registration) return

    window.setInterval(() => {
      void registration.update()
    }, 60_000)
  },
  onRegisterError(error) {
    serviceWorkerRegistrationStarted = false
    if (navigator.onLine) console.warn('Service worker registration failed', error)
  },
  })
}

// Registration no longer competes with the first route and its API bootstrap.
// Runtime caching still makes every opened route available for a warm/offline return.
window.addEventListener('load', () => {
  const requestIdle = window.requestIdleCallback
  if (typeof requestIdle === 'function') {
    requestIdle(() => registerServiceWorker(), { timeout: 2_000 })
  } else {
    globalThis.setTimeout(registerServiceWorker, 1_000)
  }
}, { once: true })
window.addEventListener('online', registerServiceWorker)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
