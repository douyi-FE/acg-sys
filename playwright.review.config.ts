import { defineConfig } from '@playwright/test'

// Isolated development server: no dotenv loading, no existing workspace server reuse.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'review-preview.spec.ts',
  workers: 1,
  timeout: 45000,
  outputDir: './test-results/review',
  use: { baseURL: 'http://127.0.0.1:15284', trace: 'retain-on-failure' },
  webServer: {
    command: `node --input-type=module -e "import {createServer} from 'vite'; const s = await createServer({envFile:false,server:{host:'127.0.0.1',port:15284,strictPort:true}}); await s.listen()"`,
    url: 'http://127.0.0.1:15284',
    reuseExistingServer: false,
  },
})
