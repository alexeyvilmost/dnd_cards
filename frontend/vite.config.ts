import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Engine code and its certified release identity are one atomic client
      // artifact. A waiting worker can strand an open tab on old pinned hashes
      // after the DB release changes, so updates activate automatically.
      registerType: 'autoUpdate',
      includeAssets: [
        'site_logo.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
      ],
      manifest: {
        id: '/m/',
        name: 'Bag of Holding',
        short_name: 'Bag of Holding',
        description: 'Мобильный лист и мастер создания персонажей D&D.',
        lang: 'ru',
        start_url: '/m',
        scope: '/',
        display: 'standalone',
        background_color: '#12100d',
        theme_color: '#12100d',
        categories: ['games', 'utilities'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/proxy\//],
        globPatterns: ['**/*.{js,css,html,woff,woff2}'],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    allowedHosts: [
      'localhost',
      'bagofholding.ru',
    ],
    proxy: {
      '/api': {
        target: 'https://bagofholding.ru',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  publicDir: 'public',
})
