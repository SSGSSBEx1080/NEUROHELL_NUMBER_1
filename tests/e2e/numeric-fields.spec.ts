import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function start(page: Page, empty = false) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(500, 320, 'Expression fields', 'transparent')
  if (!empty)
    doc.layers = [
      makeLayer({
        name: 'Precise',
        x: 100.125,
        y: 70.25,
        width: 200,
        height: 100,
        color: '#e74e8d',
      }),
    ]
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'fields.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function native(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const d = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readPsd(await readFile((await d.path())!), { useImageData: true }).children![0]
}
const left = (record: Awaited<ReturnType<typeof native>>) =>
  record.vectorOrigination!.keyDescriptorList[0].keyOriginShapeBoundingBox!.left.value

test('numeric expressions and relative operations are real native geometry with one undo; mere focus never rounds the model', async ({
  page,
}) => {
  await start(page)
  const x = page.getByRole('spinbutton', { name: 'X', exact: true })
  await expect(x).toHaveValue('100.13')
  await x.focus()
  await x.press('Tab')
  expect(left(await native(page))).toBe(100.125)
  await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })).toBeDisabled()
  await x.fill('+=25')
  await x.press('Enter')
  await expect(x).toHaveValue('125.13')
  expect(left(await native(page))).toBe(125.125)
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  expect(left(await native(page))).toBe(100.125)
  const w = page.getByRole('spinbutton', { name: 'Ш', exact: true })
  await w.fill('(100+20)*2')
  await w.press('Enter')
  await expect(w).toHaveValue('240')
  await expect(page.getByRole('spinbutton', { name: 'В', exact: true })).toHaveValue('120')
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await expect(w).toHaveValue('200')
})

test('Escape and invalid arithmetic restore exact values without a phantom history step, arrow keys stay in the input', async ({
  page,
}) => {
  await start(page)
  const x = page.getByRole('spinbutton', { name: 'X', exact: true }),
    undo = page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })
  await x.fill('+=75')
  await x.press('Escape')
  await expect(x).toHaveValue('100.13')
  await expect(undo).toBeDisabled()
  await x.fill('1/0')
  await x.press('Enter')
  await expect(x).toHaveAttribute('aria-invalid', 'true')
  await expect(undo).toBeDisabled()
  expect(left(await native(page))).toBe(100.125)
  await x.focus()
  await x.press('ArrowUp')
  await x.press('Shift+ArrowUp')
  await x.press('Enter')
  expect(left(await native(page))).toBe(111.125)
  await undo.click()
  expect(left(await native(page))).toBe(100.125)
})

test('complete expressions preview tool settings before the first brush stroke even without Enter', async ({
  page,
}) => {
  await start(page, true)
  await page.getByRole('button', { name: 'Кисть', exact: true }).click()
  await page.getByLabel('Размер', { exact: true }).fill('20*2')
  const b = (await page.getByTestId('editor-canvas').boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })).toBeEnabled()
  const width = await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const p = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let left = c.width,
      right = -1
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (p[(y * c.width + x) * 4 + 3]) {
          left = Math.min(left, x)
          right = Math.max(right, x)
        }
    return right - left + 1
  })
  expect(width).toBeGreaterThanOrEqual(39)
  expect(width).toBeLessThanOrEqual(42)
})
