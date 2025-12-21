import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Это позволяет принимать соединения с любого хоста
    allowedHosts: [
      'localhost',
      '.railway.app', // Разрешает все поддомены Railway
      'frontend-production-550b.up.railway.app' // Конкретно ваш домен
    ],
    proxy: {
      '/api': {
        // Railway production URL по умолчанию
        // Для локальной разработки замените на: target: 'http://localhost:8080'
        target: 'https://backend-production-41c3.up.railway.app',
        changeOrigin: true,
        secure: true, // Для HTTPS
      },
    },
  },
  publicDir: 'public',
})
