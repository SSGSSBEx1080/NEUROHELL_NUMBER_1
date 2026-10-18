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

async function alphaBounds(page: Page) {
  return page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement) => {
    const p = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let left = c.width,
      top = c.height,
      right = -1,
      bottom = -1
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (p[(y * c.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x)
          bottom = Math.max(bottom, y)
        }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  })
}
async function selectionBounds(page: Page) {
  return page.getByTestId('transform-outline').evaluate((e: SVGGraphicsElement) => {
    const r = e.getBBox()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

test('point text hitbox follows actual glyph ink, font changes and long text; native point export is not a narrow paragraph box', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(960, 500, 'Point geometry', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Point',
      text: 'Редактор 777',
      x: 60,
      y: 60,
      width: 22,
      height: 12,
      fontFamily: 'Manrope',
      fontSize: 60,
      fontWeight: 700,
      italic: true,
      letterSpacing: 1,
      color: '#171717',
    }),
  ]
  await open(page, 'point.777', Buffer.from(JSON.stringify(doc)))
  await page.getByLabel('Масштаб холста').selectOption('1')
  await expect.poll(async () => (await alphaBounds(page)).width).toBeGreaterThan(300)
  const ink = await alphaBounds(page),
    selection = await selectionBounds(page)
  expect(Math.abs(selection.x + 60 - ink.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(selection.y + 60 - ink.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(selection.width - ink.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(selection.height - ink.height)).toBeLessThanOrEqual(2)
  expect(Number(await page.getByLabel('Ш', { exact: true }).inputValue())).toBeCloseTo(
    selection.width,
    1,
  )
  const board = (await page.locator('.artboard').boundingBox())!
  await page.mouse.click(board.x + 700, board.y + 300)
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
  await page.mouse.click(board.x + ink.x + ink.width - 10, board.y + ink.y + ink.height / 2)
  await expect(page.locator('.layer-row.selected')).toContainText('Point')
  await page.getByLabel('Размер', { exact: true }).fill('72')
  await page.getByLabel('Размер', { exact: true }).press('Enter')
  await expect
    .poll(async () => (await selectionBounds(page)).width)
    .toBeGreaterThan(selection.width * 1.15)
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true, skipThumbnail: true }),
    text = psd.children![0]
  expect(text.text!.shapeType).toBe('point')
  expect(text.text!.boxBounds).toBeUndefined()
  expect(text.text!.text).toBe('Редактор 777')
  expect(text.imageData!.width).toBeGreaterThan(400)
  expect(text.text!.bounds!.right.value - text.text!.bounds!.left.value).toBeGreaterThan(400)
  await writeFile('test-results/native-point.psd', bytes)
  await writeFile('test-results/native-point.png', await png(page))
  await page.getByRole('button', { name: 'Отчёт PSD', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Текстовые слои')
  await expect(page.getByRole('dialog')).toContainText('PostScript')
  await page.getByRole('button', { name: 'Понятно', exact: true }).click()
  delete psd.imageResources!.xmpMetadata
  await open(page, 'point-native.psd', Buffer.from(writePsd(psd)))
  await page.locator('.layer-row').filter({ hasText: 'Point' }).click()
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('Редактор 777')
  await page.getByLabel('Текст слоя', { exact: true }).fill('Новый текст')
  await page.getByLabel('Текст слоя', { exact: true }).press('Control+Enter')
  const edited = readPsd(await save(page), { useImageData: true, skipThumbnail: true })
  expect(edited.children![0].text!.text).toBe('Новый текст')
  expect(edited.children![0].text!.shapeType).toBe('point')
})

test('point text corner resize anchors actual glyphs; Shift stretches and Ctrl moves the visible perspective handle', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(850, 500, 'Text transforms', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Type',
      text: 'Геометрия',
      x: 80,
      y: 70,
      width: 20,
      height: 10,
      fontFamily: 'Manrope',
      fontSize: 50,
      color: '#222222',
    }),
  ]
  await open(page, 'transforms.777', Buffer.from(JSON.stringify(doc)))
  await page.getByLabel('Масштаб холста').selectOption('1')
  const box = (await page.locator('[data-handle=se]').boundingBox())!,
    old = await alphaBounds(page),
    before = await selectionBounds(page)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box.x + box.width / 2 + before.width * 0.3,
    box.y + box.height / 2 + before.height * 0.3,
    { steps: 8 },
  )
  await page.mouse.up()
  const scaled = await alphaBounds(page)
  expect(Math.abs(scaled.x - old.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(scaled.y - old.y)).toBeLessThanOrEqual(2)
  expect(scaled.width / old.width).toBeGreaterThan(1.25)
  expect(scaled.height / old.height).toBeGreaterThan(1.2)
  const east = (await page.locator('[data-handle=se]').boundingBox())!,
    font = Number(await page.getByLabel('Размер', { exact: true }).inputValue())
  await page.keyboard.down('Shift')
  await page.mouse.move(east.x + 3, east.y + 3)
  await page.mouse.down()
  await page.mouse.move(east.x + 83, east.y + 3, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect(Number(await page.getByLabel('Размер', { exact: true }).inputValue())).toBeCloseTo(font, 0)
  const corner = (await page.locator('[data-handle=se]').boundingBox())!
  await page.keyboard.down('Control')
  await page.mouse.move(corner.x + 3, corner.y + 3)
  await page.mouse.down()
  await page.mouse.move(corner.x + 18, corner.y + 13, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  const moved = (await page.locator('[data-handle=se]').boundingBox())!
  expect(moved.x - corner.x).toBeCloseTo(15, 0)
  expect(moved.y - corner.y).toBeCloseTo(10, 0)
  await expect(
    page.getByRole('button', { name: 'Сбросить перспективу', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  const undone = (await page.locator('[data-handle=se]').boundingBox())!
  expect(undone.x).toBeCloseTo(corner.x, 0)
})

test('native type survives flips, affine shear and color adjustment; projective/blurred content remains editable inside real smart objects', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(900, 600, 'Native text transforms', '#ffffff')
  const text = (name: string, y: number) =>
    makeLayer({
      kind: 'text',
      name,
      text: 'Текст 777',
      x: 100,
      y,
      width: 270,
      height: 65,
      fontFamily: 'Manrope',
      fontSize: 44,
      color: '#113355',
    })
  doc.layers = [
    { ...text('Reflected', 35), flipX: true },
    {
      ...text('Sheared', 140),
      warp: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1.2, y: 1 },
        { x: 0.2, y: 1 },
      ],
    },
    { ...text('Color', 245), adjustments: { ...text('base', 0).adjustments, invert: 100 } },
    {
      ...text('Perspective', 355),
      warp: [
        { x: 0, y: 0 },
        { x: 1, y: 0.1 },
        { x: 0.9, y: 1 },
        { x: 0.1, y: 0.9 },
      ],
    },
    { ...text('Blur', 465), adjustments: { ...text('base', 0).adjustments, blur: 2 } },
  ]
  await open(page, 'native-transforms.777', Buffer.from(JSON.stringify(doc)))
  await page.getByLabel('Масштаб холста').selectOption('1')
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true, skipThumbnail: true }),
    layers = flatten(psd.children || [])
  expect(layers.find((l) => l.name === 'Reflected')!.text!.transform![0]).toBeCloseTo(-1)
  expect(layers.find((l) => l.name === 'Sheared')!.text!.transform![2]).toBeGreaterThan(0.5)
  const color = layers.find((l) => l.name === 'Color')!.text!.style!.fillColor as {
    r: number
    g: number
    b: number
  }
  expect(color.r).toBeCloseTo(238, 2)
  expect(color.g).toBeCloseTo(204, 2)
  expect(color.b).toBeCloseTo(170, 2)
  for (const name of ['Perspective', 'Blur']) {
    const layer = layers.find((l) => l.name === name)!
    expect(layer.placedLayer).toBeTruthy()
    const file = psd.linkedFiles!.find((f) => f.id === layer.placedLayer!.id)!
    const nested = readPsd(file.data!, { useImageData: true, skipThumbnail: true })
    expect(nested.children![0].text!.text).toBe('Текст 777')
    expect(nested.children![0].text!.shapeType).toBe('point')
  }
  expect(layers.find((l) => l.name === 'Blur')!.placedLayer!.filter!.list[0].type).toBe(
    'gaussian blur',
  )
  await writeFile('test-results/native-text-transforms.psd', bytes)
  await writeFile('test-results/native-text-transforms.png', await png(page))
  await page.getByRole('button', { name: 'Отчёт PSD', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('вложенный PSD')
})

for (const mode of ['native-text', 'native-text-box'])
  test(`external ${mode} imports as directly editable type without XMP`, async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.busy-overlay')).toBeHidden()
    const bytes = await readFile(`tests/fixtures/psd/${mode}.psd`)
    await open(page, `${mode}.psd`, bytes)
    await page.locator('.layer-row').first().click()
    await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('TEST')
    expect((await save(page)).equals(bytes)).toBe(true)
    await page.getByLabel('Текст слоя', { exact: true }).fill('EDIT')
    await page.getByLabel('Текст слоя', { exact: true }).press('Control+Enter')
    const edited = readPsd(await save(page), { useImageData: true, skipThumbnail: true })
    expect(edited.children![0].text!.text).toBe('EDIT')
    expect(edited.children![0].text!.shapeType).toBe(mode.endsWith('box') ? 'box' : 'point')
  })

test('external native text edits cannot be overwritten by stale private XMP', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(500, 300, 'Integrity', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Editable',
      text: 'Original',
      x: 40,
      y: 40,
      fontFamily: 'Manrope',
      fontSize: 40,
    }),
  ]
  await open(page, 'integrity.777', Buffer.from(JSON.stringify(doc)))
  const bytes = await save(page),
    native = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  expect(native.imageResources!.xmpMetadata).toMatch(/sha256="[a-f0-9]{64}"/)
  native.children![0].text!.text = 'Changed externally'
  // Intentionally retain all XMP from the old file, like an external editor may do.
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'externally-edited.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: Buffer.from(writePsd(native)),
  })
  await expect(page.getByRole('dialog')).toContainText(
    'Устаревший внутренний проект проигнорирован',
  )
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await page.locator('.layer-row').first().click()
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('Changed externally')
})

test('mask/style offscreens and explicit rasterization retain point text beyond its obsolete rectangle', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const mask = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 700
    c.height = 300
    const x = c.getContext('2d')!
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, 700, 300)
    return c.toDataURL()
  })
  const doc = newDocument(700, 300, 'Text surfaces', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Uncropped',
      text: 'Полный текст',
      x: 40,
      y: 40,
      width: 15,
      height: 10,
      fontFamily: 'Manrope',
      fontSize: 54,
      color: '#182828',
      mask: {
        src: mask,
        x: 0,
        y: 0,
        width: 700,
        height: 300,
        enabled: true,
        linked: true,
        density: 1,
        feather: 0,
        defaultColor: 255,
      },
    }),
  ]
  await open(page, 'surfaces.777', Buffer.from(JSON.stringify(doc)))
  await page.getByLabel('Масштаб холста').selectOption('1')
  await expect.poll(async () => (await alphaBounds(page)).width).toBeGreaterThan(300)
  const before = await alphaBounds(page)
  await page.getByRole('button', { name: 'Слой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Растрировать содержимое', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveCount(0)
  const after = await alphaBounds(page)
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2)
  const saved = readPsd(await save(page), { useImageData: true, skipThumbnail: true })
  expect(saved.children![0].mask).toBeTruthy()
  expect(saved.children![0].imageData!.width).toBeGreaterThan(300)
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('Полный текст')
})

test('opaque projective fills keep their alpha and color across shallow mesh edges', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const doc = newDocument(500, 180, 'Mesh coverage', 'transparent')
  doc.layers = [
    makeLayer({
      name: 'Solid warped shape',
      x: 50,
      y: 60,
      width: 400,
      height: 60,
      color: '#b8a8ff',
      warp: [
        { x: 0.05, y: -0.1 },
        { x: 0.92, y: 0.15 },
        { x: 1.05, y: 1.15 },
        { x: -0.04, y: 0.92 },
      ],
    }),
  ]
  await open(page, 'coverage.777', Buffer.from(JSON.stringify(doc)))
  await expect
    .poll(() =>
      page.getByTestId('editor-canvas').evaluate((canvas: HTMLCanvasElement) => {
        const data = canvas.getContext('2d')!.getImageData(90, 85, 330, 15).data
        let badAlpha = 0,
          maxColorError = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) badAlpha++
          maxColorError = Math.max(
            maxColorError,
            Math.abs(data[i] - 184),
            Math.abs(data[i + 1] - 168),
            Math.abs(data[i + 2] - 255),
          )
        }
        return { badAlpha, maxColorError }
      }),
    )
    .toEqual({ badAlpha: 0, maxColorError: 0 })
})
