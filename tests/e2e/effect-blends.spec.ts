import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, type Layer as PsdLayer } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { defaultStyles } from '../../src/engine/styles'
import type { EditorDocument, Layer, LayerStyles } from '../../src/types'

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
    width: 360,
    height: 180,
    ...patch,
  })

const flatten = (layers: PsdLayer[]): PsdLayer[] =>
  layers.flatMap((layer) => [layer, ...flatten(layer.children || [])])

test('exterior Shadow, Glow and Stroke blend with the document backdrop and export natively', async ({
  page,
}) => {
  const doc = newDocument(360, 180, 'Effect blends', 'transparent')
  const shadowStyles: LayerStyles = defaultStyles()
  shadowStyles.shadows = [
    {
      ...shadowStyles.shadows[0],
      enabled: true,
      color: '#00ff00',
      blur: 0,
      x: 35,
      y: 0,
      opacity: 1,
      blendMode: 'subtract',
    },
  ]
  const strokeStyles: LayerStyles = defaultStyles()
  strokeStyles.strokes = [
    {
      ...strokeStyles.strokes[0],
      enabled: true,
      size: 10,
      color: '#00ffff',
      position: 'outside',
      opacity: 1,
      blendMode: 'multiply',
    },
  ]
  const glowStyles: LayerStyles = defaultStyles()
  glowStyles.glow = {
    ...glowStyles.glow,
    enabled: true,
    color: '#00ff00',
    blur: 12,
    opacity: 1,
    blendMode: 'multiply',
  }
  doc.layers = [
    rect({ name: 'Brown backdrop', color: '#804020', width: 120 }),
    rect({ name: 'Yellow backdrop', color: '#ffff00', x: 120, width: 120 }),
    rect({ name: 'Red backdrop', color: '#ff0000', x: 240, width: 120 }),
    rect({
      name: 'Subtract shadow',
      color: '#ffffff',
      x: 30,
      y: 60,
      width: 50,
      height: 60,
      styles: shadowStyles,
    }),
    rect({
      name: 'Multiply stroke',
      color: '#ffffff',
      x: 155,
      y: 60,
      width: 50,
      height: 60,
      styles: strokeStyles,
    }),
    rect({
      name: 'Multiply glow',
      color: '#ffffff',
      x: 275,
      y: 60,
      width: 50,
      height: 60,
      styles: glowStyles,
    }),
  ]
  await openProject(page, doc)

  // Subtract green from brown (128,64,32), rather than painting green Normal.
  await expect.poll(async () => sample(page, 100, 90)).toEqual([128, 0, 32, 255])
  // Multiply cyan over yellow leaves only green.
  await expect.poll(async () => sample(page, 148, 90)).toEqual([0, 255, 0, 255])
  await expect.poll(async () => sample(page, 55, 90)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => sample(page, 180, 90)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => sample(page, 300, 90)).toEqual([255, 255, 255, 255])
  // Adjacent to the edge, a Multiply green glow over red is dark red with
  // essentially no green. A Normal green glow at the same alpha would be olive.
  const glow = await sample(page, 274, 90)
  expect(glow[0]).toBeGreaterThan(90)
  expect(glow[0]).toBeLessThan(180)
  expect(glow[1]).toBeLessThan(25)
  expect(glow[2]).toBeLessThan(25)

  // The dialog edits the same real stroke mode. Screen cyan over yellow = white.
  await page.locator('.layer-row').filter({ hasText: 'Multiply stroke' }).click()
  await page.locator('.style-open-button').click()
  await page.getByLabel('Режим наложения обводки', { exact: true }).selectOption('screen')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => sample(page, 148, 90)).toEqual([255, 255, 255, 255])

  const bytes = await savePsd(page)
  const layers = flatten(readPsd(bytes, { useImageData: true }).children || [])
  expect(layers.find((l) => l.name === 'Subtract shadow')?.effects?.dropShadow?.[0].blendMode).toBe(
    'subtract',
  )
  expect(layers.find((l) => l.name === 'Multiply stroke')?.effects?.stroke?.[0].blendMode).toBe(
    'screen',
  )
  expect(layers.find((l) => l.name === 'Multiply glow')?.effects?.outerGlow?.blendMode).toBe(
    'multiply',
  )
  await writeFile('test-results/effect-blends.psd', bytes)
  await page.screenshot({ path: 'test-results/effect-blends.png' })
})

test('a backdrop effect spilling in from off-canvas stays aligned', async ({ page }) => {
  const doc = newDocument(160, 120, 'Effect blend spill', '#ffff00')
  const shadowStyles: LayerStyles = defaultStyles()
  shadowStyles.shadows = [
    {
      ...shadowStyles.shadows[0],
      enabled: true,
      color: '#00ff00',
      blur: 0,
      x: 40,
      y: 0,
      opacity: 1,
      blendMode: 'subtract',
    },
  ]
  doc.layers = [
    rect({
      name: 'Off canvas shape',
      color: '#ffffff',
      x: -30,
      y: 40,
      width: 50,
      height: 40,
      styles: shadowStyles,
    }),
  ]
  await openProject(page, doc)
  // Subtract green from the yellow document backdrop leaves red.
  await expect.poll(async () => sample(page, 40, 60)).toEqual([255, 0, 0, 255])
  await expect.poll(async () => sample(page, 10, 60)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => sample(page, 100, 60)).toEqual([255, 255, 0, 255])
})

test('inner shadow blends locally, while an isolated group supplies the exterior backdrop', async ({
  page,
}) => {
  const doc = newDocument(320, 180, 'Effect blend groups', '#0000ff')
  const group = makeLayer({
    kind: 'group',
    name: 'Isolated backdrop group',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    isolated: true,
  })
  const screenShadow: LayerStyles = defaultStyles()
  screenShadow.shadows = [
    {
      ...screenShadow.shadows[0],
      enabled: true,
      color: '#ff0000',
      blur: 0,
      x: 35,
      y: 0,
      opacity: 1,
      blendMode: 'screen',
    },
  ]
  const innerShadow: LayerStyles = defaultStyles()
  innerShadow.innerShadows = [
    {
      ...innerShadow.innerShadows[0],
      enabled: true,
      color: '#ffffff',
      blur: 0,
      x: 20,
      y: 0,
      opacity: 1,
      blendMode: 'multiply',
    },
  ]
  doc.layers = [
    group,
    rect({
      name: 'Group green',
      parentId: group.id,
      color: '#00ff00',
      width: 155,
      height: 180,
    }),
    rect({
      name: 'Group screen shadow',
      parentId: group.id,
      color: '#ffffff',
      x: 35,
      y: 60,
      width: 50,
      height: 60,
      styles: screenShadow,
    }),
    rect({
      name: 'Inner multiply',
      color: '#808080',
      x: 205,
      y: 50,
      width: 75,
      height: 80,
      styles: innerShadow,
    }),
  ]
  await openProject(page, doc)
  // Screen red over the isolated group's green is yellow. Against the blue
  // document outside the group it would incorrectly be magenta.
  await expect.poll(async () => sample(page, 105, 90)).toEqual([255, 255, 0, 255])
  // White Multiply inside a gray shape leaves gray; Normal would paint white.
  await expect.poll(async () => sample(page, 210, 90)).toEqual([128, 128, 128, 255])
  await expect.poll(async () => sample(page, 245, 90)).toEqual([128, 128, 128, 255])
})
