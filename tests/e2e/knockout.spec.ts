import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { defaultStyles } from '../../src/engine/styles'
import { parsePsdLayerRecords, patchPsdDeepKnockout } from '../../src/engine/psdLayerRecords'
import type { EditorDocument, Layer } from '../../src/types'

initializeCanvas(
  () => {
    throw new Error('No DOM in PSD verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

async function openProject(page: Page, doc: EditorDocument) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: doc.name + '.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}

async function sample(page: Page, x: number, y: number) {
  return page.getByTestId('editor-canvas').evaluate(
    async (c: HTMLCanvasElement, p) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data]
    },
    { x, y },
  )
}

function closeTo(actual: number[], expected: number[], tolerance = 3) {
  expected.forEach((value, i) =>
    expect(Math.abs(value - actual[i]), `channel ${i}: ${actual}`).toBeLessThanOrEqual(tolerance),
  )
}

async function savePsd(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}

const rect = (patch: Partial<Layer>): Layer =>
  makeLayer({
    kind: 'shape',
    shape: 'rectangle',
    shapeFill: true,
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    ...patch,
  })
const fill = (fillOpacity: number) => ({ ...defaultStyles(), fillOpacity })

test('Knockout UI: Deep punches ordinary layers to the document background and writes knko=2', async ({
  page,
}) => {
  const doc = newDocument(240, 160, 'Knockout UI', '#0000ff')
  doc.layers = [
    rect({ name: 'Ordinary bottom', color: '#ff0000' }),
    rect({ name: 'Banner', color: '#00aa00' }),
    rect({
      name: 'Punch',
      color: '#ffff00',
      x: 70,
      y: 40,
      width: 100,
      height: 80,
      styles: fill(0),
    }),
  ]
  await openProject(page, doc)
  await expect.poll(async () => sample(page, 120, 80)).toEqual([0, 170, 0, 255])

  await page.locator('.layer-row').filter({ hasText: 'Punch' }).click()
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Параметры наложения', exact: false }).click()
  await page.getByLabel('Knockout', { exact: true }).selectOption('deep')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // Both the green banner and the ordinary opaque red bottom layer are
  // intermediate layers: only the blue document background can remain.
  await expect.poll(async () => sample(page, 120, 80)).toEqual([0, 0, 255, 255])
  await expect.poll(async () => sample(page, 20, 20)).toEqual([0, 170, 0, 255])
  await expect(page.locator('.layer-fx-mark')).toHaveCount(1)

  const bytes = await savePsd(page)
  const records = parsePsdLayerRecords(bytes)
  expect(records[0]).toMatchObject({ name: 'Фон холста', hasTransparencyChannel: false })
  expect(records.find((r) => r.name === 'Punch')?.knockoutByte).toBe(2)
  expect(readPsd(bytes, { useImageData: true }).imageData).toBeTruthy()
  await writeFile('test-results/knockout-ui.psd', bytes)
  await page.screenshot({ path: 'test-results/knockout-ui.png' })
})

test('Knockout boundaries: isolated groups stop Deep, pass-through Shallow and Deep differ', async ({
  page,
}) => {
  const doc = newDocument(240, 160, 'Knockout groups', '#0000ff')
  const isolated = makeLayer({
    kind: 'group',
    name: 'Isolated',
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    isolated: true,
  })
  const passThrough = makeLayer({
    kind: 'group',
    name: 'Pass through',
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    isolated: false,
  })
  doc.layers = [
    rect({ name: 'Below groups', color: '#00ffff' }),
    isolated,
    rect({
      name: 'Isolated banner',
      parentId: isolated.id,
      color: '#ff0000',
      width: 115,
    }),
    rect({
      name: 'Isolated deep',
      parentId: isolated.id,
      color: '#ffff00',
      x: 30,
      y: 45,
      width: 55,
      height: 70,
      styles: fill(0),
      knockout: 'deep',
    }),
    passThrough,
    rect({
      name: 'Pass banner',
      parentId: passThrough.id,
      color: '#ff00ff',
      x: 125,
      width: 115,
    }),
    rect({
      name: 'Pass shallow',
      parentId: passThrough.id,
      color: '#ffff00',
      x: 140,
      y: 45,
      width: 35,
      height: 70,
      styles: fill(0),
      knockout: 'shallow',
    }),
    rect({
      name: 'Pass deep',
      parentId: passThrough.id,
      color: '#ffff00',
      x: 190,
      y: 45,
      width: 35,
      height: 70,
      styles: fill(0),
      knockout: 'deep',
    }),
  ]
  await openProject(page, doc)
  // Isolated Deep reveals what is below that group (cyan), not the canvas.
  await expect.poll(async () => sample(page, 57, 80)).toEqual([0, 255, 255, 255])
  // Pass-through Shallow stops at that group's starting backdrop (cyan).
  await expect.poll(async () => sample(page, 157, 80)).toEqual([0, 255, 255, 255])
  // Pass-through Deep inherits the document backdrop (blue).
  await expect.poll(async () => sample(page, 207, 80)).toEqual([0, 0, 255, 255])
  await expect.poll(async () => sample(page, 100, 20)).toEqual([255, 0, 0, 255])
  await expect.poll(async () => sample(page, 232, 20)).toEqual([255, 0, 255, 255])
})

test('Knockout separates Fill, overall opacity and blend-mode reveal', async ({ page }) => {
  const doc = newDocument(240, 160, 'Knockout fill', '#0000ff')
  doc.layers = [
    rect({ name: 'Intermediate', color: '#00aa00' }),
    rect({
      name: 'Fill 50',
      color: '#ff0000',
      x: 10,
      y: 35,
      width: 60,
      height: 90,
      styles: fill(0.5),
      knockout: 'deep',
    }),
    rect({
      name: 'Opacity 50',
      color: '#ff0000',
      x: 90,
      y: 35,
      width: 60,
      height: 90,
      opacity: 0.5,
      styles: fill(0),
      knockout: 'deep',
    }),
    rect({
      name: 'Multiply reveal',
      color: '#ffffff',
      x: 170,
      y: 35,
      width: 60,
      height: 90,
      blendMode: 'multiply',
      styles: fill(1),
      knockout: 'deep',
    }),
  ]
  await openProject(page, doc)
  // 50% red over the blue boundary, not over the green intermediate.
  closeTo(await sample(page, 40, 80), [128, 0, 128, 255])
  // Overall opacity is the strength of the hole itself: halfway green→blue.
  closeTo(await sample(page, 120, 80), [0, 85, 128, 255])
  // White Multiply at Fill 100 reveals by blending against blue boundary.
  await expect.poll(async () => sample(page, 200, 80)).toEqual([0, 0, 255, 255])
})

test('Clipped Knockout stops at the clipping base; a group can itself punch', async ({ page }) => {
  const doc = newDocument(240, 160, 'Knockout clipping', '#0000ff')
  const group = makeLayer({
    kind: 'group',
    name: 'Punch group',
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    isolated: true,
    styles: fill(0),
    knockout: 'deep',
  })
  doc.layers = [
    rect({ name: 'Under everything', color: '#00ffff' }),
    rect({ name: 'Clipping base', color: '#ff0000', x: 20, y: 30, width: 90, height: 100 }),
    rect({
      name: 'Clipped paint',
      color: '#ff00ff',
      x: 20,
      y: 30,
      width: 90,
      height: 100,
      clipping: true,
    }),
    rect({
      name: 'Clipped punch',
      color: '#ffff00',
      x: 45,
      y: 55,
      width: 40,
      height: 50,
      clipping: true,
      styles: fill(0),
      knockout: 'deep',
    }),
    rect({ name: 'Right intermediate', color: '#00aa00', x: 130, width: 110 }),
    group,
    rect({
      name: 'Group shape',
      parentId: group.id,
      color: '#ffff00',
      x: 160,
      y: 45,
      width: 55,
      height: 70,
    }),
  ]
  await openProject(page, doc)
  await expect.poll(async () => sample(page, 65, 80)).toEqual([255, 0, 0, 255])
  await expect.poll(async () => sample(page, 30, 40)).toEqual([255, 0, 255, 255])
  // Isolation governs descendants inside the group. The group layer itself
  // is an actor in the root sibling list, so its Deep boundary is the blue
  // document background and it punches the green intermediate below it.
  await expect.poll(async () => sample(page, 187, 80)).toEqual([0, 0, 255, 255])
})

test('Knockout keeps exterior effects outside the shape and blends antialiased edges', async ({
  page,
}) => {
  const doc = newDocument(240, 160, 'Knockout effects', '#0000ff')
  const styled = defaultStyles()
  styled.fillOpacity = 0
  styled.strokes = [{ ...styled.strokes[0], enabled: true, size: 6, color: '#ff0000' }]
  styled.shadows = [{ ...styled.shadows[0], enabled: true, blur: 0, x: 20, y: 0, opacity: 1 }]
  doc.layers = [
    rect({ name: 'Intermediate', color: '#00aa00' }),
    rect({
      name: 'Ellipse punch',
      shape: 'ellipse',
      color: '#ffffff',
      x: 15,
      y: 40,
      width: 70,
      height: 80,
      styles: fill(0),
      knockout: 'deep',
    }),
    rect({
      name: 'Styled punch',
      color: '#ffffff',
      x: 110,
      y: 45,
      width: 70,
      height: 70,
      styles: styled,
      knockout: 'deep',
    }),
  ]
  await openProject(page, doc)
  await expect.poll(async () => sample(page, 50, 80)).toEqual([0, 0, 255, 255])
  const hasAntialiasedEdge = await page
    .getByTestId('editor-canvas')
    .evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i] < 10 &&
          data[i + 1] > 10 &&
          data[i + 1] < 160 &&
          data[i + 2] > 10 &&
          data[i + 2] < 245
        )
          return true
      return false
    })
  expect(hasAntialiasedEdge).toBe(true)

  // Exterior effects are not part of the pre-Fill knockout shape: the center
  // is punched to blue, the outside stroke remains red, and the offset shadow
  // still paints over the untouched green backdrop to the right.
  await expect.poll(async () => sample(page, 145, 80)).toEqual([0, 0, 255, 255])
  await expect.poll(async () => sample(page, 106, 80)).toEqual([255, 0, 0, 255])
  await expect.poll(async () => sample(page, 195, 80)).toEqual([0, 0, 0, 255])
  await expect.poll(async () => sample(page, 225, 80)).toEqual([0, 170, 0, 255])
})

test('PSD import: raw Deep byte and a true Background channel survive recomposite and save', async ({
  page,
}) => {
  const width = 120
  const height = 80
  const solid = (r: number, g: number, b: number) => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
    return { width, height, data }
  }
  const punchPixels = solid(255, 0, 0)
  for (let y = 0; y < height; y++)
    for (let x = 60; x < width; x++) punchPixels.data[(y * width + x) * 4 + 3] = 0
  const written = writePsd(
    {
      width,
      height,
      // Deliberately magenta: the first paint may use the stored composite,
      // but the forced recomposite below must use our working renderer.
      imageData: solid(255, 0, 255),
      children: [
        {
          id: 11,
          name: 'Background',
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          imageData: solid(0, 0, 255),
        },
        {
          id: 12,
          name: 'Intermediate',
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          imageData: solid(0, 170, 0),
        },
        {
          id: 13,
          name: 'Deep punch',
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          fillOpacity: 0,
          knockout: true,
          imageData: punchPixels,
        },
      ],
    },
    { generateThumbnail: false, noBackground: false },
  )
  const fixture = Buffer.from(patchPsdDeepKnockout(written, [13]))
  expect(parsePsdLayerRecords(fixture)[0].hasTransparencyChannel).toBe(false)

  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'knockout-background.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: fixture,
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const profileOpen = page.getByRole('button', { name: 'Открыть', exact: true })
  if (await profileOpen.isVisible()) await profileOpen.click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByRole('button', { name: 'Добавить пустой слой', exact: true }).click()

  // If Background identity were lost, this would be transparent instead of blue.
  await expect.poll(async () => sample(page, 30, 40)).toEqual([0, 0, 255, 255])
  await expect.poll(async () => sample(page, 90, 40)).toEqual([0, 170, 0, 255])
  await expect(page.locator('.layer-name.background-layer')).toHaveText('Background')

  const exported = await savePsd(page)
  const records = parsePsdLayerRecords(exported)
  expect(records[0]).toMatchObject({ name: 'Background', hasTransparencyChannel: false })
  expect(records.find((r) => r.name === 'Deep punch')?.knockoutByte).toBe(2)
  await writeFile('test-results/knockout-background.psd', exported)
})
