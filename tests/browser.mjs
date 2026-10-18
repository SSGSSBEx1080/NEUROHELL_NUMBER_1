import chromium from '@sparticuz/chromium'
import { chromium as playwright } from '@playwright/test'
import { inflate } from '../node_modules/@sparticuz/chromium/build/lambdafs.js'
await inflate(new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url).pathname)
process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}`
export async function launch() {
  return playwright.launch({ executablePath: await chromium.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], headless: true })
}
