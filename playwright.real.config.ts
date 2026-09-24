import { defineConfig } from '@playwright/test'

export default defineConfig({
  metadata: { apiMode: 'real' },
  testDir: './tests/e2e',
  testMatch: 'phase3*.spec.ts',
  workers: 1,
  outputDir: './test-results/real',
  use: { baseURL: 'http://127.0.0.1:15175', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 15175 --strictPort',
    url: 'http://127.0.0.1:15175',
    reuseExistingServer: false,
    env: { VITE_DEV_MODE: 'real', VITE_API_MODE: 'real' },
  },
})
