import { writeFile } from 'node:fs/promises'
import { launch } from '../tests/browser.mjs'
const browser = await launch(),
  page = await browser.newPage()
const png = await page.evaluate(async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#b6a3ff"/><path d="M9 10h23v5L18 32H8l15-16H9z" fill="#251e35"/></svg>'
  const image = new Image()
  image.src = 'data:image/svg+xml;base64,' + btoa(svg)
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.getContext('2d').drawImage(image, 0, 0, 256, 256)
  return canvas.toDataURL('image/png').split(',')[1]
})
await browser.close()
const image = Buffer.from(png, 'base64'),
  header = Buffer.alloc(22)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(image.length, 14)
header.writeUInt32LE(22, 18)
await writeFile('desktop/icon.png', image)
await writeFile('desktop/icon.ico', Buffer.concat([header, image]))
