import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function dndSuImportProxy(): Plugin {
  return {
    name: 'dnd-su-import-proxy',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          const parsed = new URL(req.url ?? '/', 'http://vite.local')
          if (parsed.pathname !== '/proxy/dnd-su-import') return next()

          const target = parsed.searchParams.get('url')
          if (!target) {
            res.statusCode = 400
            res.end('Missing url parameter')
            return
          }

          let normalized: string
          try {
            normalized = normalizeDndSuImportUrl(target)
          } catch (err) {
            res.statusCode = 400
            res.end(err instanceof Error ? err.message : 'Invalid url')
            return
          }

          fetch(normalized, {
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
              res.end('dnd.su import proxy error')
            })
        })
      }
    },
  }
}

function normalizeDndSuImportUrl(url: string): string {
  const trimmed = url.trim()
  const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
  const parsed = new URL(normalized)
  const allowed = new Set(['next.dnd.su', 'dnd.su', '5e14.dnd.su'])
  if (!allowed.has(parsed.hostname) || !/\/bestiary\/\d+/.test(parsed.pathname)) {
    throw new Error('Invalid dnd.su bestiary url')
  }
  return normalized
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), dndSuImportProxy()],
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
