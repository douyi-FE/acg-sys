import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['inline-validation.spec.ts', 'quality-settings.spec.ts', 'workflow-versions.spec.ts', 'engine-interactions.spec.ts'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:15389' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 15389 --strictPort',
    url: 'http://127.0.0.1:15389',
    reuseExistingServer: false,
    env: { VITE_API_MODE: 'mock' },
  },
})
