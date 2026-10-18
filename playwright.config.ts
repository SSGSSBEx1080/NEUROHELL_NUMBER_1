import { defineConfig } from '@playwright/test'
import chromium from '@sparticuz/chromium'
import { inflate } from './node_modules/@sparticuz/chromium/build/lambdafs.js'
let executablePath: string | undefined
if (process.platform === 'linux') {
  await inflate(new URL('./node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url).pathname)
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}`
  executablePath = await chromium.executablePath()
}
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  expect: { timeout: 10000 }, reporter: 'list', outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1536, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {} },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 60000 },
})
