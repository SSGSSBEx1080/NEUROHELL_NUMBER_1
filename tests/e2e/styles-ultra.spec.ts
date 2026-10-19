import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByTestId('open-demo').click()
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
}
async function blank(page: Page) {
  await page.getByRole('button', { name: 'Создать новый проект', exact: true }).click()
  await page.getByLabel('Ширина нового холста').fill('300')
  await page.getByLabel('Высота нового холста').fill('200')
  await page.getByRole('button', { name: 'Прозрачный', exact: true }).click()
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(0)
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = (await page.locator('.artboard').boundingBox())!
  await page.mouse.move(b.x + from[0], b.y + from[1])
  await page.mouse.down()
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 12 })
  await page.mouse.up()
}
async function pixel(page: Page, x: number, y: number) {
  return page
    .locator('[data-testid=editor-canvas]')
    .evaluate(
      (c: HTMLCanvasElement, p) => [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data],
      { x, y },
    )
}
async function exportPsd(page: Page) {
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page
    .locator('.format-options button')
    .filter({ has: page.locator('strong', { hasText: /^PSD$/ }) })
    .click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PSD', exact: true }).click()
  const download = await downloadPromise
  await expect(page.getByRole('dialog')).toBeHidden()
  return readFile((await download.path())!)
}

test('three ordered strokes survive Fill 0 and export as native PSD effects', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [220, 140])
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await expect(page.getByTestId('effect-instance-list')).toBeVisible()

  // #1 (top): 4px white. Add #2: 10px red below it, then #3: 16px blue at the bottom.
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('4')
  await page.getByRole('button', { name: 'Добавить экземпляр эффекта' }).click()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('10')
  await page.getByLabel('Цвет обводки слоя').fill('#ff0000')
  await page.getByRole('button', { name: 'Добавить экземпляр эффекта' }).click()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('16')
  await page.getByLabel('Цвет обводки слоя').fill('#0000ff')
  await expect(page.locator('.effect-instance')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/style-ultra-dialog.png' })
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  await expect.poll(async () => await pixel(page, 58, 95)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => await pixel(page, 53, 95)).toEqual([255, 0, 0, 255])
  await expect.poll(async () => await pixel(page, 47, 95)).toEqual([0, 0, 255, 255])
  await expect(page.locator('.layer-fx-mark')).toHaveCount(1)

  // Fill 0 removes only the rectangle content; the strokes stay untouched.
  await page.getByRole('spinbutton', { name: 'Заливка' }).fill('0')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await pixel(page, 140, 95))[3]).toBe(0)
  await expect.poll(async () => await pixel(page, 58, 95)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => await pixel(page, 47, 95)).toEqual([0, 0, 255, 255])

  // Native multi-stroke descriptors are in the PSD itself, not in our XMP sidecar.
  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.stroke?.length)
  expect(layer?.effects?.stroke?.map((s) => s.size?.value)).toEqual([4, 10, 16])
  parsed.imageResources = {}
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  const stripped = (withoutXmp.children || []).find((l) => l.effects?.stroke?.length)
  expect(stripped?.effects?.stroke).toHaveLength(3)
})

test('gradient tool paints the selected library gradient with real alpha', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.keyboard.press('g')
  await page.keyboard.press('Shift+g')
  await page.getByRole('button', { name: 'Выбрать градиент' }).click()
  await expect(page.getByTestId('gradient-definition-editor')).toBeVisible()
  await page.getByLabel('Библиотека градиентов').selectOption('2') // Белый → прозрачный
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await drag(page, [30, 100], [270, 100])
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect.poll(async () => (await pixel(page, 35, 100))[3]).toBeGreaterThan(230)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBeGreaterThan(90)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBeLessThan(170)
  await expect.poll(async () => (await pixel(page, 265, 100))[3]).toBeLessThan(25)
})
