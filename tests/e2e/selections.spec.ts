import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { newDocument, makeLayer } from '../../src/engine/document'
import type { EditorDocument } from '../../src/types'
initializeCanvas(
  () => {
    throw new Error('No DOM in verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function open(page: Page, doc: EditorDocument) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: doc.name + '.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function start(page: Page, doc = newDocument(200, 120, 'Selections', '#204060')) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await open(page, doc)
}
async function area(page: Page, from: [number, number], to: [number, number], modifier?: string) {
  const b = (await page.getByTestId('editor-canvas').boundingBox())!
  if (modifier) await page.keyboard.down(modifier)
  await page.mouse.move(b.x + from[0], b.y + from[1])
  await page.mouse.down()
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 5 })
  await page.mouse.up()
  if (modifier) await page.keyboard.up(modifier)
}
async function invert(page: Page) {
  await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Инверсия', exact: true }).click()
}
async function samples(page: Page, points: [number, number][]) {
  return page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement, points) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const x = c.getContext('2d')!
    return points.map(([a, b]) => [...x.getImageData(a, b, 1, 1).data])
  }, points)
}
const base = [32, 64, 96, 255],
  negative = [223, 191, 159, 255]
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}
async function fixture(page: Page, name: string) {
  const psd = await save(page)
  await writeFile(`test-results/${name}.psd`, psd)
  const src = await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return c.toDataURL().split(',')[1]
  })
  await writeFile(`test-results/${name}.png`, Buffer.from(src, 'base64'))
  return readPsd(psd, { useImageData: true })
}
test('selection union, subtraction and intersection create a precise native adjustment mask with atomic undo', async ({
  page,
}) => {
  await start(page)
  await page.keyboard.press('m')
  await area(page, [20, 20], [100, 100])
  await area(page, [80, 40], [160, 80], 'Shift')
  await area(page, [50, 50], [70, 70], 'Alt')
  await page.keyboard.down('Shift')
  await area(page, [10, 10], [140, 110], 'Alt')
  await page.keyboard.up('Shift')
  await invert(page)
  expect(
    await samples(page, [
      [30, 30],
      [130, 60],
      [60, 60],
      [150, 60],
      [180, 10],
    ]),
  ).toEqual([negative, negative, base, base, base])
  const psd = await fixture(page, 'selection-combined')
  expect(psd.children![1].mask).toBeTruthy()
  expect(psd.children![1].adjustment?.type).toBe('invert')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(0)
  expect(await samples(page, [[30, 30]])).toEqual([base])
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(
    await samples(page, [
      [130, 60],
      [60, 60],
    ]),
  ).toEqual([negative, base])
})
test('quick-mask painting changes only coverage, supports soft brushes and one-step undo', async ({
  page,
}) => {
  await start(page, newDocument(160, 100, 'Quick mask', '#204060'))
  await page.keyboard.press('q')
  await expect(page.getByTestId('quick-mask-overlay')).toBeVisible()
  await page.getByLabel('Размер', { exact: true }).fill('20')
  await page.getByLabel('Жёсткость', { exact: true }).fill('50')
  await page.getByLabel('Жёсткость', { exact: true }).press('Tab')
  const b = (await page.getByTestId('editor-canvas').boundingBox())!
  await page.mouse.click(b.x + 80, b.y + 50)
  expect(
    await samples(page, [
      [80, 50],
      [110, 50],
    ]),
  ).toEqual([base, base])
  await expect(page.locator('.layer-row')).toHaveCount(0)
  await page.keyboard.press('q')
  await invert(page)
  expect(
    await samples(page, [
      [80, 50],
      [110, 50],
    ]),
  ).toEqual([base, negative])
  const psd = await fixture(page, 'selection-quick-mask'),
    mask = psd.children![1].mask!.imageData!
  expect(mask.data[(50 * 160 + 80) * 4]).toBe(0)
  expect([...mask.data].some((v, i) => i % 4 === 0 && v > 0 && v < 255)).toBe(true)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await invert(page)
  expect(await samples(page, [[80, 50]])).toEqual([negative])
})
async function stripeDocument(page: Page) {
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 180
    c.height = 100
    const x = c.getContext('2d')!
    x.fillStyle = '#ff0000'
    x.fillRect(0, 0, 180, 100)
    x.fillStyle = '#00ff00'
    x.fillRect(60, 0, 60, 100)
    return c.toDataURL()
  })
  const doc = newDocument(180, 100, 'Color source', 'transparent')
  doc.layers = [makeLayer({ kind: 'image', name: 'Stripes', src, width: 180, height: 100 })]
  return doc
}
test('W selects without erasing: contiguous and global matching differ', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await open(page, await stripeDocument(page))
  await page.keyboard.press('w')
  await page.getByLabel('Допуск палочки', { exact: true }).fill('0')
  await page.getByLabel('Допуск палочки', { exact: true }).press('Tab')
  let b = (await page.getByTestId('editor-canvas').boundingBox())!
  await page.mouse.click(b.x + 20, b.y + 50)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  expect(
    await samples(page, [
      [20, 50],
      [140, 50],
    ]),
  ).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ])
  await invert(page)
  expect(
    await samples(page, [
      [20, 50],
      [80, 50],
      [140, 50],
    ]),
  ).toEqual([
    [0, 255, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
  ])
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await page.keyboard.press('w')
  await page.getByLabel('Смежные пиксели').uncheck()
  b = (await page.getByTestId('editor-canvas').boundingBox())!
  await page.mouse.click(b.x + 20, b.y + 50)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await invert(page)
  expect(
    await samples(page, [
      [20, 50],
      [140, 50],
    ]),
  ).toEqual([
    [0, 255, 255, 255],
    [0, 255, 255, 255],
  ])
})
test('color-range preview is cancellable and its applied sampled mask is editable native coverage', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await open(page, await stripeDocument(page))
  await page.getByRole('button', { name: 'Выделение', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Цветовой диапазон…', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Применить диапазон', exact: true })).toBeEnabled()
  await page.getByTestId('color-range-source').click({ position: { x: 20, y: 50 } })
  await page.getByLabel('Разброс цвета', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Применить диапазон', exact: true }).click()
  expect(await samples(page, [[20, 50]])).toEqual([[255, 0, 0, 255]])
  await invert(page)
  expect(
    await samples(page, [
      [20, 50],
      [80, 50],
      [140, 50],
    ]),
  ).toEqual([
    [0, 255, 255, 255],
    [0, 255, 0, 255],
    [0, 255, 255, 255],
  ])
  await page.getByRole('button', { name: 'Выделение', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Цветовой диапазон…', exact: true }).click()
  await page.getByLabel('Разброс цвета', { exact: true }).fill('200')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await samples(page, [[80, 50]])).toEqual([[0, 255, 0, 255]])
})
test('expand uses circular distance, selection modification is undoable and empty intersections never expose the whole image', async ({
  page,
}) => {
  await start(page, newDocument(120, 80, 'Modify', '#204060'))
  await page.keyboard.press('m')
  await area(page, [20, 20], [40, 40])
  await page.getByRole('button', { name: 'Выделение', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Расширить выделение…', exact: true }).click()
  await page.getByLabel('Радиус выделения', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Применить выделение', exact: true }).click()
  await invert(page)
  expect(
    await samples(page, [
      [16, 30],
      [15, 15],
      [30, 30],
    ]),
  ).toEqual([negative, base, negative])
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await page.keyboard.press('Control+z')
  await page.keyboard.press('m')
  await page.getByLabel('Режим выделения').selectOption('intersect')
  await area(page, [80, 10], [110, 40])
  await invert(page)
  expect(
    await samples(page, [
      [16, 30],
      [30, 30],
      [90, 30],
    ]),
  ).toEqual([base, base, base])
})
test('pixel-selection histories are local to tabs, reselect and opacity selection work', async ({
  page,
}) => {
  const a = newDocument(200, 120, 'Selection A', '#204060')
  a.layers = [makeLayer({ name: 'Patch', x: 30, y: 40, width: 40, height: 30, color: '#808080' })]
  await start(page, a)
  await page.keyboard.press('m')
  await area(page, [10, 10], [50, 40])
  await open(page, newDocument(200, 120, 'Selection B', '#204060'))
  await page.keyboard.press('m')
  await area(page, [100, 50], [150, 100])
  await page
    .locator('.document-tab.inactive')
    .getByRole('button', { name: 'Selection A.psd', exact: true })
    .click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await invert(page)
  expect(
    await samples(page, [
      [20, 20],
      [110, 70],
    ]),
  ).toEqual([negative, base])
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await page.keyboard.press('Control+d')
  await page.keyboard.press('Control+Shift+d')
  await invert(page)
  expect(await samples(page, [[20, 20]])).toEqual([negative])
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await page
    .getByRole('button', { name: 'Пиксели слоя: Patch', exact: true })
    .click({ modifiers: ['Control'] })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await invert(page)
  expect(
    await samples(page, [
      [20, 20],
      [45, 50],
    ]),
  ).toEqual([base, [127, 127, 127, 255]])
})
