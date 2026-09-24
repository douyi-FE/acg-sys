import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig(({ command }) => ({
  // A build is never a development demo, even if NODE_ENV was misconfigured.
  define: command === 'build' ? { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' } : {},
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false } },
  },
}))
