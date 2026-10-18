import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd, type Layer as PsdLayer } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
initializeCanvas(
  () => {
    throw new Error('No DOM in PSD structural verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
const flatten = (layers: PsdLayer[]): PsdLayer[] =>
  layers.flatMap((l) => [l, ...flatten(l.children || [])])
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}
async function open(page: Page, name: string, bytes: Buffer) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name,
    mimeType: name.endsWith('.777') ? 'application/json' : 'image/vnd.adobe.photoshop',
    buffer: bytes,
  })
  if (name.endsWith('.777'))
    await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  if (name.endsWith('.psd'))
    await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function png(page: Page) {
  const data = await page
    .getByTestId('editor-canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL().split(',')[1])
  return Buffer.from(data, 'base64')
}
test('native shape controls, PSD vector data, groups and XMP-free editable reimport', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(600, 420, 'Native vectors', '#ffffff'),
    group = makeLayer({ kind: 'group', name: 'Vector group', width: 600, height: 420 })
  doc.layers = [
    group,
    makeLayer({
      name: 'Rounded',
      parentId: group.id,
      width: 190,
      height: 110,
      x: 40,
      y: 40,
      color: '#684ee7',
      cornerRadii: [8, 18, 28, 38],
      strokeColor: '#181327',
      strokeWidth: 6,
      strokeAlign: 'outside',
      strokeJoin: 'round',
    }),
    makeLayer({
      name: 'Oval',
      shape: 'ellipse',
      parentId: group.id,
      width: 140,
      height: 90,
      x: 300,
      y: 45,
      color: '#edac64',
    }),
    makeLayer({
      name: 'Star',
      shape: 'star',
      sides: 7,
      starRatio: 0.42,
      x: 65,
      y: 225,
      width: 130,
      height: 130,
      color: '#ce5c8b',
      rotation: 18,
    }),
    makeLayer({
      name: 'Polygon',
      shape: 'polygon',
      sides: 6,
      x: 310,
      y: 230,
      width: 125,
      height: 130,
      color: '#4caa90',
    }),
    makeLayer({
      name: 'Line',
      shape: 'line',
      x: 50,
      y: 185,
      width: 400,
      height: 1,
      color: '#000000',
      strokeColor: '#333333',
      strokeWidth: 3,
      strokeCap: 'round',
    }),
  ]
  await open(page, 'vectors.777', Buffer.from(JSON.stringify(doc)))
  await page.locator('.layer-row').filter({ hasText: 'Rounded' }).click()
  const panel = page.getByTestId('shape-properties')
  await expect(panel.getByLabel('Вид фигуры')).toHaveValue('rectangle')
  await panel.getByLabel('Верхний левый угол', { exact: true }).fill('14')
  await panel.getByLabel('Верхний левый угол', { exact: true }).press('Enter')
  await expect(panel.getByLabel('Нижний правый угол', { exact: true })).toHaveValue('28')
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true, skipThumbnail: true }),
    layers = flatten(psd.children || [])
  expect(layers.filter((l) => l.vectorFill && l.vectorMask)).toHaveLength(5)
  expect(
    layers.find((l) => l.name === 'Rounded')!.vectorOrigination!.keyDescriptorList[0]
      .keyOriginRRectRadii!.topLeft.value,
  ).toBe(14)
  expect(layers.find((l) => l.name === 'Vector group')!.children).toHaveLength(2)
  await writeFile('test-results/native-vectors.psd', bytes)
  await writeFile('test-results/native-vectors.png', await png(page))
  // Remove our private project metadata before the round trip. Native PSD is the only source of editability.
  delete psd.imageResources!.xmpMetadata
  const noXmp = Buffer.from(writePsd(psd))
  await open(page, 'native-only.psd', noXmp)
  await page.locator('.layer-row').filter({ hasText: 'Rounded' }).click()
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('Верхний левый угол', { exact: true })).toHaveValue('14')
  await panel.getByLabel('Цвет фигуры').fill('#ee3344')
  await panel.getByLabel('Положение обводки').selectOption('inside')
  const edited = readPsd(await save(page), { useImageData: true, skipThumbnail: true })
  expect(flatten(edited.children || []).find((l) => l.name === 'Rounded')!.vectorFill).toEqual({
    type: 'color',
    color: { r: 238, g: 51, b: 68 },
  })
  expect(
    flatten(edited.children || []).find((l) => l.name === 'Rounded')!.vectorStroke?.lineAlignment,
  ).toBe('inside')
})

test('external vector fixture stays editable; translation moves native path as well as cached pixels', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await open(page, 'external-shapes.psd', await readFile('tests/fixtures/psd/native-shapes.psd'))
  await page.locator('.layer-row').filter({ hasText: '圆角矩形 1' }).click()
  await expect(page.getByTestId('shape-properties')).toBeVisible()
  await expect(page.getByLabel('Верхний левый угол', { exact: true })).toHaveValue('10')
  const oldX = Number(await page.getByLabel('X', { exact: true }).inputValue())
  await page.getByLabel('X', { exact: true }).fill(String(oldX + 29))
  await page.getByLabel('X', { exact: true }).press('Enter')
  const after = readPsd(await save(page), {
    useImageData: true,
    skipThumbnail: true,
  }).children!.find((l) => l.name === '圆角矩形 1')!
  expect(after.vectorMask!.paths[0].knots[0].points[2]).toBeCloseTo(218, 3)
  expect(after.vectorOrigination!.keyDescriptorList[0].keyOriginShapeBoundingBox!.left.value).toBe(
    208,
  )
})

test('stroke-only shapes are hollow and new shape subtools create actual editable geometry', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(400, 300, 'Outline hit tests', 'transparent')
  doc.layers = [
    makeLayer({ name: 'Behind', width: 300, height: 200, x: 30, y: 30, color: '#123456' }),
    makeLayer({
      name: 'Hollow',
      shapeFill: false,
      width: 200,
      height: 120,
      x: 60,
      y: 60,
      color: '#ff0000',
      strokeColor: '#eebbee',
      strokeWidth: 10,
    }),
  ]
  await open(page, 'hollow.777', Buffer.from(JSON.stringify(doc)))
  const box = (await page.locator('.artboard').boundingBox())!,
    scale = box.width / 400
  await page.keyboard.press('v')
  await page.mouse.click(box.x + 150 * scale, box.y + 120 * scale)
  await expect(page.locator('.layer-row.selected')).toContainText('Behind')
  await page.keyboard.press('u')
  await page.keyboard.press('Shift+u')
  await page.keyboard.press('Shift+u')
  await expect(page.locator('[data-tool=polygon]')).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(box.x + 250 * scale, box.y + 190 * scale)
  await page.mouse.down()
  await page.mouse.move(box.x + 350 * scale, box.y + 280 * scale, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByLabel('Вид фигуры')).toHaveValue('polygon')
  await page.getByLabel('Стороны', { exact: true }).fill('9')
  await page.getByLabel('Стороны', { exact: true }).press('Enter')
  const psd = readPsd(await save(page), { useImageData: true, skipThumbnail: true })
  expect(
    flatten(psd.children || []).find((l) => l.name === 'Многоугольник')!.vectorMask!.paths[0].knots,
  ).toHaveLength(9)
})
