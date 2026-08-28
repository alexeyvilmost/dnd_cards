import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/pangolin/index.css'
import './index.css'

// Keep long-lived character-sheet tabs on the same certified engine release as
// the server. In auto-update mode Workbox reloads only after a newer worker has
// activated, so an in-progress action is not interrupted by an ordinary poll.
registerSW({
  immediate: true,
  onRegisteredSW(_workerUrl, registration) {
    if (!registration) return

    window.setInterval(() => {
      void registration.update()
    }, 60_000)
  },
  onRegisterError(error) {
    console.error('Service worker registration failed', error)
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
