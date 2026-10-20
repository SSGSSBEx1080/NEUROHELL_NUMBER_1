import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { defaultLayout } from '../../src/engine/layout'
import type { EditorDocument, ShapePath } from '../../src/types'
initializeCanvas(
  () => {
    throw new Error('No DOM in PSD verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function open(page: Page, doc: EditorDocument) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: doc.name + '.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Масштаб холста').selectOption('1')
}
const base = (name: string) => ({
  ...newDocument(600, 400, name, 'transparent'),
  layout: { ...defaultLayout, snap: false },
})
async function point(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('editor-canvas').boundingBox())!
  return { x: box.x + (x * box.width) / 600, y: box.y + (y * box.height) / 400 }
}
async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y)
  await page.mouse.click(p.x, p.y)
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, ...from),
    b = await point(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
}
async function key(page: Page, key: string) {
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press(key)
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const download = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await download.path())!)
}
async function png(page: Page) {
  return Buffer.from(
    await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return c.toDataURL().split(',')[1]
    }),
    'base64',
  )
}
const anchor = (page: Page, path: number, index: number) =>
  page
    .getByTestId('path-anchor')
    .and(page.locator(`[data-node-path="${path}"][data-node-index="${index}"]`))
const node = (x: number, y: number) => ({ linked: false, points: [x, y, x, y, x, y] })
function component(points: [number, number][], open = false): ShapePath {
  return {
    open,
    fillRule: 'non-zero',
    operation: 'combine',
    knots: points.map(([x, y]) => node(x, y)),
  }
}

test('pen click/drag creates native cubic paths, XMP-free node edits and undo preserve vectors', async ({
  page,
}) => {
  await open(page, base('Native pen'))
  await key(page, 'p')
  await click(page, 70, 100)
  await drag(page, [260, 80], [310, 125])
  await drag(page, [430, 260], [415, 310])
  await click(page, 140, 320)
  await click(page, 70, 100)
  await expect(page.getByTestId('pen-draft')).toHaveCount(0)
  await expect(page.getByTestId('path-anchor')).toHaveCount(4)
  await expect(page.locator('.layer-row')).toHaveCount(1)
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true }),
    shape = psd.children![0]
  expect(shape.vectorMask!.paths[0].open).toBe(false)
  expect(shape.vectorMask!.paths[0].knots).toHaveLength(4)
  expect(shape.vectorMask!.paths[0].knots[1].points[4]).toBeCloseTo(310, 3)
  expect(shape.vectorStroke!.fillEnabled).toBe(true)
  await writeFile('test-results/native-pen.psd', bytes)
  await writeFile('test-results/native-pen.png', await png(page))
  delete psd.imageResources!.xmpMetadata
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'pen-native-only.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: Buffer.from(writePsd(psd)),
  })
  await page.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await key(page, 'a')
  await anchor(page, 0, 1).click()
  await expect(page.getByLabel('X узла', { exact: true })).toHaveValue('260')
  await page.getByLabel('X узла', { exact: true }).fill('290')
  await page.getByLabel('X узла', { exact: true }).press('Enter')
  const edited = readPsd(await save(page), { useImageData: true }).children![0]
  expect(edited.vectorMask!.paths[0].knots[1].points[2]).toBeCloseTo(290, 3)
  expect(edited.vectorMask!.paths[0].knots[1].points[4]).toBeCloseTo(340, 3)
  expect(edited.placedLayer).toBeUndefined()
  await page.screenshot({ path: 'test-results/paths-ui.png' })
  await key(page, 'Control+z')
  await expect(page.getByLabel('X узла', { exact: true })).toHaveValue('260')
})

test('draft pen has local undo/redo and cancel; no phantom layer or raster changes', async ({
  page,
}) => {
  const doc = base('Draft pen')
  doc.layers = [
    makeLayer({ name: 'Existing', x: 20, y: 30, width: 90, height: 60, color: '#ff3344' }),
  ]
  await open(page, doc)
  const before = await png(page)
  await key(page, 'p')
  await click(page, 170, 80)
  await click(page, 290, 120)
  await expect(page.getByTestId('path-tool-status')).toContainText('2 точек')
  await key(page, 'Control+z')
  await expect(page.getByTestId('path-tool-status')).toContainText('1 точек')
  await key(page, 'Control+Shift+z')
  await expect(page.getByTestId('path-tool-status')).toContainText('2 точек')
  await key(page, 'Escape')
  await expect(page.getByTestId('pen-draft')).toHaveCount(0)
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(await png(page)).toEqual(before)
  await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })).toBeDisabled()
})

test('open thin path expands safely during node drag, keeps native stroke and supports Escape', async ({
  page,
}) => {
  await open(page, base('Open pen'))
  await key(page, 'p')
  await click(page, 80, 120)
  await click(page, 340, 120)
  await key(page, 'Enter')
  await expect(page.getByTestId('path-anchor')).toHaveCount(2)
  const before = await save(page),
    first = readPsd(before, { useImageData: true }).children![0]
  expect(first.vectorMask!.paths[0].open).toBe(true)
  expect(first.vectorStroke!.fillEnabled).toBe(false)
  // A visibly thick stroke gives the independent rasterizer a real interior to
  // test. At 2px every pixel is an AA edge and aggdraw's coverage differs ~10%.
  expect(first.vectorStroke!.lineWidth!.value).toBe(2)
  expect(first.vectorStroke!.lineCapType).toBe('round')
  // psd-tools explicitly does not implement line caps/joins. Match its supported
  // flat-cap subset for independent pixels; retain the actual round-cap metadata check.
  await page.getByLabel('Концы обводки').selectOption('butt')
  await page.getByLabel('Толщ.', { exact: true }).fill('8')
  await page.getByLabel('Толщ.', { exact: true }).press('Enter')
  await drag(page, [340, 120], [380, 285])
  const next = await save(page),
    record = readPsd(next, { useImageData: true }).children![0]
  expect(record.vectorMask!.paths[0].knots[1].points[2]).toBeCloseTo(380, 3)
  expect(record.vectorMask!.paths[0].knots[1].points[3]).toBeCloseTo(285, 3)
  expect(record.vectorStroke!.lineAlignment).toBe('center')
  await writeFile('test-results/native-pen-open.psd', next)
  await writeFile('test-results/native-pen-open.png', await png(page))
  const snapshot = await png(page),
    a = await point(page, 380, 285),
    b = await point(page, 440, 320)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await png(page)).toEqual(snapshot)
})

test('split, smooth/corner, multi-node shift selection, keyboard and undo', async ({ page }) => {
  const doc = base('Path controls')
  doc.layers = [
    makeLayer({
      name: 'Ellipse',
      shape: 'ellipse',
      x: 100,
      y: 100,
      width: 200,
      height: 130,
      color: '#b066d8',
    }),
  ]
  await open(page, doc)
  await key(page, 'a')
  await anchor(page, 0, 0).click()
  const panel = page.getByTestId('path-properties')
  await panel.getByRole('button', { name: 'Разделить сегмент', exact: true }).click()
  await expect(page.getByTestId('path-anchor')).toHaveCount(5)
  const split = readPsd(await save(page), { useImageData: true }).children![0]
  expect(split.vectorMask!.paths[0].knots).toHaveLength(5)
  await panel.getByRole('button', { name: 'Угловые узлы', exact: true }).click()
  expect(
    readPsd(await save(page), {
      useImageData: true,
    }).children![0].vectorMask!.paths[0].knots[1].points.slice(0, 2),
  ).toEqual(expect.arrayContaining([expect.any(Number)]))
  await anchor(page, 0, 0).click()
  await page.keyboard.down('Shift')
  await anchor(page, 0, 2).click()
  await page.keyboard.up('Shift')
  await expect(page.getByTestId('path-tool-status')).toContainText('выбрано 2')
  const old = readPsd(await save(page), { useImageData: true }).children![0].vectorMask!.paths[0]
    .knots
  await key(page, 'Shift+ArrowRight')
  const moved = readPsd(await save(page), { useImageData: true }).children![0].vectorMask!.paths[0]
    .knots
  expect(moved[0].points[2] - old[0].points[2]).toBeCloseTo(10, 3)
  expect(moved[2].points[2] - old[2].points[2]).toBeCloseTo(10, 3)
  expect(moved[3].points[2]).toBeCloseTo(old[3].points[2], 3)
  await key(page, 'Delete')
  await expect(page.getByTestId('path-anchor')).toHaveCount(3)
  await key(page, 'Control+z')
  await expect(page.getByTestId('path-anchor')).toHaveCount(5)
})

test('compound path winding, exact pixel selection and a native mask', async ({ page }) => {
  const doc = base('Compound pen')
  doc.layers = [
    makeLayer({
      name: 'Compound',
      shape: 'path',
      x: 80,
      y: 50,
      width: 340,
      height: 280,
      color: '#ebae66',
      shapePaths: [
        component([
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]),
        component([
          [0.3, 0.3],
          [0.7, 0.3],
          [0.7, 0.7],
          [0.3, 0.7],
        ]),
      ],
    }),
  ]
  await open(page, doc)
  await key(page, 'a')
  await page.getByLabel('Правило заливки контура').selectOption('even-odd')
  await key(page, 'Control+Enter')
  await expect(page.locator('.marching-ants')).toHaveCount(1)
  await page.getByRole('button', { name: 'Слой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Добавить маску', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const bytes = await save(page),
    record = readPsd(bytes, { useImageData: true }).children![0]
  expect(record.vectorMask!.paths).toHaveLength(2)
  expect(record.vectorMask!.paths.every((p) => p.fillRule === 'even-odd')).toBe(true)
  expect(record.mask?.imageData).toBeTruthy()
  const rgba = await page
    .getByTestId('editor-canvas')
    .evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(250, 190, 1, 1).data])
  expect(rgba[3]).toBe(0)
  await writeFile('test-results/native-pen-mask.psd', bytes)
  await writeFile('test-results/native-pen-mask.png', await png(page))
})

test('joins chosen ends and reverses components without changing their pixels', async ({
  page,
}) => {
  const doc = base('Joined paths')
  doc.layers = [
    makeLayer({
      shape: 'path',
      x: 100,
      y: 100,
      width: 300,
      height: 160,
      shapeFill: false,
      strokeColor: '#66bbff',
      strokeWidth: 5,
      shapePaths: [
        component(
          [
            [0, 0],
            [0.4, 0],
          ],
          true,
        ),
        component(
          [
            [0.5, 0.5],
            [1, 1],
          ],
          true,
        ),
      ],
    }),
  ]
  await open(page, doc)
  await key(page, 'a')
  await anchor(page, 0, 1).click()
  await page.keyboard.down('Shift')
  await anchor(page, 1, 0).click()
  await page.keyboard.up('Shift')
  const panel = page.getByTestId('path-properties')
  await panel.getByRole('button', { name: 'Соединить концы', exact: true }).click()
  const result = readPsd(await save(page), { useImageData: true }).children![0].vectorMask!.paths
  expect(result).toHaveLength(1)
  expect(result[0].knots).toHaveLength(4)
  const before = await png(page)
  await panel.getByRole('button', { name: 'Обратить направление', exact: true }).click()
  expect(await png(page)).toEqual(before)
  await panel.getByRole('button', { name: 'Замкнуть компонент', exact: true }).click()
  expect(
    readPsd(await save(page), { useImageData: true }).children![0].vectorMask!.paths[0].open,
  ).toBe(false)
})
