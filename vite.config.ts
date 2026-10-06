import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.DEV_BACKEND_PORT || '8061'
  const webPort = Number(env.DEV_WEB_PORT || '8060')
  const productionPort = Number(env.PROD_PORT || '8060')
  return ({
  // A build is never a development demo, even if NODE_ENV was misconfigured.
  define: command === 'build' ? { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' } : {},
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: env.API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`,
        changeOrigin: false,
      },
    },
  },
  preview: { port: productionPort, strictPort: true },
  })
})
