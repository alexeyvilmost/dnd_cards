import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-аналог продакшн nginx-прокси. Контракт — путь, а не ?url=:
 * `/proxy/ttg-club-import/bestiary/<slug>` проксируется на `<upstreamOrigin>/bestiary/<slug>`.
 * Тот же контракт в проде обслуживает nginx (см. nginx.conf.template), поэтому импорт
 * работает и локально, и после выкатки. Старый `?url=` тоже поддержан для совместимости.
 */
function externalImportProxy(
  name: string,
  path: string,
  upstreamOrigin: string,
  allowedHosts: Set<string>,
  pathPattern: RegExp,
  errorLabel: string,
): Plugin {
  return {
    name,
    configureServer(server) {
      // Register as a "pre" middleware (do NOT return a function): it must run
      // before Vite's internal spa-fallback / 404 middlewares, otherwise the
      // request to `path` is answered with index.html or a 404 before we see it.
      server.middlewares.use((req, res, next) => {
        const parsed = new URL(req.url ?? '/', 'http://vite.local')
        const { pathname, search } = parsed

        let target: string | null = null
        if (pathname.startsWith(`${path}/`)) {
          const ttgPath = pathname.slice(path.length) // "/bestiary/<slug>"
          if (pathPattern.test(ttgPath)) target = `${upstreamOrigin}${ttgPath}${search}`
        } else if (pathname === path) {
          const url = parsed.searchParams.get('url')
          if (url) {
            try {
              target = normalizeImportUrl(url, allowedHosts, pathPattern)
            } catch {
              target = null
            }
          }
        } else {
          return next()
        }

        if (!target) {
          res.statusCode = 400
          res.end('Invalid import url')
          return
        }

        fetch(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BagOfHolding/1.0)',
            Accept: 'text/html',
          },
        })
          .then(async (response) => {
            const body = await response.text()
            res.statusCode = response.status
            res.setHeader('Content-Type', response.headers.get('content-type') ?? 'text/html; charset=utf-8')
            res.end(body)
          })
          .catch(() => {
            res.statusCode = 502
            res.end(errorLabel)
          })
      })
    },
  }
}

function normalizeImportUrl(url: string, allowedHosts: Set<string>, pathPattern: RegExp): string {
  const trimmed = url.trim()
  const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
  const parsed = new URL(normalized)
  if (!allowedHosts.has(parsed.hostname) || !pathPattern.test(parsed.pathname)) {
    throw new Error('Invalid import url')
  }
  return normalized
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    externalImportProxy(
      'ttg-club-import-proxy',
      '/proxy/ttg-club-import',
      'https://new.ttg.club',
      new Set(['new.ttg.club', 'ttg.club']),
      /\/bestiary\/[^/]+/,
      'ttg.club import proxy error',
    ),
  ],
  server: {
    port: 3000,
    host: true,
    allowedHosts: [
      'localhost',
      '.railway.app',
      'frontend-production-550b.up.railway.app',
    ],
    proxy: {
      '/api': {
        target: 'https://backend-production-41c3.up.railway.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  publicDir: 'public',
})
