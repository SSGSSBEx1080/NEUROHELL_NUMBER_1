// Regenerates desktop/icon.png (256×256) and desktop/icon.ico (PNG-compressed
// 256 entry) from public/favicon.svg using the bundled test Chromium.
// Usage: node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
let executablePath
if (process.platform === 'linux') {
  const sparticuz = (await import('@sparticuz/chromium')).default
  const { inflate } = await import('../node_modules/@sparticuz/chromium/build/lambdafs.js')
  await inflate(
    new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url).pathname,
  )
  process.env.LD_LIBRARY_PATH = `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH || ''}`
  executablePath = await sparticuz.executablePath()
}
const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
  const pngBase64 = await page.evaluate(async (markup) => {
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    canvas.getContext('2d').drawImage(image, 0, 0, 256, 256)
    return canvas.toDataURL('image/png').split(',')[1]
  }, svg)
  const png = Buffer.from(pngBase64, 'base64')
  await writeFile(new URL('../desktop/icon.png', import.meta.url), png)

  // Single-entry PNG-compressed ICO (the same layout as the previous icon).
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 0 // 256 px
  header[7] = 0
  header[8] = 0
  header[9] = 0
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(header.length, 18)
  await writeFile(new URL('../desktop/icon.ico', import.meta.url), Buffer.concat([header, png]))
  console.log(`desktop/icon.png + desktop/icon.ico regenerated (${png.length} PNG bytes)`)
} finally {
  await browser.close()
}
