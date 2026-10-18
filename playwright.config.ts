import { defineConfig } from '@playwright/test'
import chromium from '@sparticuz/chromium'
import { inflate } from './node_modules/@sparticuz/chromium/build/lambdafs.js'
let executablePath: string | undefined
if (process.platform === 'linux') {
  // Headless Chromium needs a UTF-8 OS locale to keep Cyrillic download filenames.
  process.env.LANG ||= 'C.UTF-8'; process.env.LC_ALL ||= 'C.UTF-8'
  await inflate(new URL('./node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url).pathname)
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}`
  executablePath = await chromium.executablePath()
}
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  expect: { timeout: 10000 }, reporter: process.env.CI ? [['list'], ['github']] : 'list', outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1536, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {} },
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60000 },
})
