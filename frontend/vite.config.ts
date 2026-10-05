import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createShellPrecacheTransform } from './scripts/pwa-shell.mjs'
import { prepareMediaVariantsFromEnvironment } from './scripts/media-variants.mjs'

const mediaVariants = prepareMediaVariantsFromEnvironment()
let shellDirectory = fileURLToPath(new URL('./dist', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {name:'pwa-shell-output-directory',configResolved(config){shellDirectory=path.resolve(config.root,config.build.outDir)}},
    react(),
    ...(mediaVariants.plugin ? [mediaVariants.plugin] : []),
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
        // Keep install small: app entry + Russian/Latin UI fonts. Route chunks
        // are cached only after the user opens them, so authoring, Mermaid,
        // export and 3D assets do not compete with login or the library.
        globPatterns: [
          'index.html',
          'assets/*.{js,css,png,svg,jpg,jpeg,webp,avif}',
          'assets/inter-{cyrillic,latin}-*.woff2',
          'assets/pangolin-{cyrillic,latin}-*.woff2',
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        manifestTransforms: [createShellPrecacheTransform(()=>shellDirectory)],
        runtimeCaching: [
          {
            urlPattern: ({url,sameOrigin}) => sameOrigin && /^\/media\/variants\/[a-f0-9]{64}\.webp$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bagofholding-media-variants',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({url,sameOrigin}) => sameOrigin && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2|png|svg|jpg|jpeg|webp|avif)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bagofholding-route-assets',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 160, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({url,sameOrigin}) => sameOrigin && /^\/(?:assets|images|icons)\//.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bagofholding-content-images',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 160, maxAgeSeconds: 14 * 24 * 60 * 60 },
            },
          },
        ],
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
        target: process.env.DEV_API_PROXY_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  publicDir: 'public',
  define: {__MEDIA_VARIANTS__: JSON.stringify(mediaVariants.runtimeManifest)},
  build: {manifest: true},
})
