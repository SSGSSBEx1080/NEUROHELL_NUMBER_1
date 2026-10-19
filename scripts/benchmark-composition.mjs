import fixture from '../tests/fixtures/editor/text-blocks.cjs'
import { launch } from '../tests/browser.mjs'
import { expect } from '@playwright/test'
import { writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  await page.addInitScript(() => {
    localStorage.setItem('fsh777-preferences', JSON.stringify({ showPerformance: true }))
    window.__repairDurations = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.repair = String(url).includes('repair.worker')
        this.time = 0
        if (this.repair)
          this.addEventListener('message', ({ data }) => {
            if (data.result)
              window.__repairDurations.push({
                ms: performance.now() - this.time,
                mode: data.result.mode,
                pixels: data.result.filled,
                patches: data.result.patches,
                comparisons: data.result.comparisons,
              })
          })
      }
      postMessage(...args) {
        if (this.repair) this.time = performance.now()
        return Reflect.apply(NativeWorker.prototype.postMessage, this, args)
      }
    }
  })
  await page.goto('http://127.0.0.1:4173')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'text-blocks.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture.textBlocksFixture())),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(4)
  await page.getByLabel('Рабочая среда').selectOption('texts')
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('canvas-viewport').focus()
    await page.keyboard.press('j')
    const b = await page.locator('.artboard').boundingBox(),
      s = b.width / 896
    await page.mouse.move(b.x + 125 * s, b.y + 165 * s)
    await page.mouse.down()
    for (const [x, y] of [
      [330, 165],
      [330, 280],
      [125, 280],
      [125, 165],
    ])
      await page.mouse.move(b.x + x * s, b.y + y * s, { steps: 5 })
    await page.mouse.up()
    await expect(
      page.getByRole('button', { name: 'Применить на новый слой', exact: true }),
    ).toBeEnabled()
    await page.getByLabel('Под верхними текстовыми слоями').check()
    await page
      .getByRole('button', { name: i === 4 ? 'Применить на новый слой' : 'Отмена', exact: true })
      .click()
  }
  await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
  await page.locator('.document-bar').click()
  await page.keyboard.press('Control+d')
  await page.keyboard.press('v')
  const frames = []
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight')
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const hud = await page.locator('.performance-hud').innerText()
    frames.push(Number(hud.match(/([\d.]+) мс/)[1]))
  }
  frames.sort((a, b) => a - b)
  const result = {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    environment: {
      platform: process.platform,
      cpu: os.cpus()[0]?.model,
      browser: await browser.version(),
      viewport: '1536x960',
      flags: ['headless', 'disable-gpu'],
      page: '896x1200; 5 layers after J; upper linked text nudged; warm caches',
    },
    repairWorkerMessageRoundTrip: await page.evaluate(() => window.__repairDurations),
    renderHUD: { n: frames.length, p50Ms: frames[15], p95Ms: frames[28], maxMs: frames.at(-1) },
    scope:
      'Worker timing is postMessage → result, including transfer/remaining worker startup but excluding source capture/copy and the 140ms UI debounce. HUD is render-submission CPU time, NOT input latency, full GPU completion, FPS or a Windows/Adobe comparison. Synthetic geometric fixture, not a representative image-quality benchmark.',
  }
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/performance-composition.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
