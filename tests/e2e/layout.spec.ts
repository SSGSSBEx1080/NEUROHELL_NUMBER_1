import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { defaultLayout } from '../../src/engine/layout'
import type { EditorDocument } from '../../src/types'
initializeCanvas(
  () => {
    throw new Error('No DOM')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function start(page: Page, doc: EditorDocument) {
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
async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}
async function png(page: Page) {
  return page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return c.toDataURL()
  })
}
async function drag(page: Page, from: [number, number], to: [number, number], modifier?: string) {
  if (modifier) await page.keyboard.down(modifier)
  await page.mouse.move(...from)
  await page.mouse.down()
  await page.mouse.move(...to, { steps: 6 })
  await page.mouse.up()
  if (modifier) await page.keyboard.up(modifier)
}
test('guides and asymmetric grid survive native PSD without XMP and never enter merged pixels', async ({
  page,
}) => {
  const doc = newDocument(320, 200, 'Native guides', '#204060')
  doc.layers = [makeLayer({ name: 'Patch', x: 40, y: 70, width: 70, height: 60, color: '#edbb80' })]
  await start(page, doc)
  const before = await png(page)
  await menu(page, 'Вид', 'Направляющие и сетка…')
  await page.getByLabel('Положение новой направляющей').fill('25%')
  await page.getByRole('button', { name: 'Добавить направляющую', exact: true }).click()
  await page.getByLabel('Ось новой направляющей').selectOption('y')
  await page.getByLabel('Положение новой направляющей').fill('50%')
  await page.getByRole('button', { name: 'Добавить направляющую', exact: true }).click()
  await page.getByRole('button', { name: 'Сетка и привязка', exact: true }).click()
  await page.getByLabel('Шаг сетки X', { exact: true }).fill('40')
  await page.getByLabel('Шаг сетки Y', { exact: true }).fill('60')
  await page.getByLabel('Показывать сетку').check()
  await page.getByRole('button', { name: 'Применить разметку', exact: true }).click()
  await expect(page.getByTestId('document-guide')).toHaveCount(2)
  await expect(page.getByTestId('document-grid')).toBeVisible()
  expect(await png(page)).toBe(before)
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true })
  expect(psd.imageResources?.gridAndGuidesInformation).toEqual({
    grid: { horizontal: 1280, vertical: 1920 },
    guides: [
      { location: 80, direction: 'vertical' },
      { location: 100, direction: 'horizontal' },
    ],
  })
  await writeFile('test-results/native-guides.psd', bytes)
  await writeFile('test-results/native-guides.png', Buffer.from(before.split(',')[1], 'base64'))
  if (psd.imageResources) delete psd.imageResources.xmpMetadata
  const native = Buffer.from(writePsd(psd))
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'native-guides-only.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: native,
  })
  await page.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.getByTestId('document-guide')).toHaveCount(2)
  expect(await save(page)).toEqual(native)
})
test('ruler drag, keyboard, deletion and undo affect guides only, without repainting the pixel stack', async ({
  page,
}) => {
  await start(page, newDocument(320, 200, 'Guide gestures', '#204060'))
  await png(page)
  await page.evaluate(async () => {
    await document.fonts.ready
    ;(window as any).__mainPaints = 0
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args: Parameters<typeof clear>) {
      if (
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.dataset.testid === 'editor-canvas'
      )
        (window as any).__mainPaints++
      return clear.apply(this, args)
    }
  })
  const c = (await page.getByTestId('editor-canvas').boundingBox())!,
    rx = (await page.locator('.ruler-x').boundingBox())!,
    ry = (await page.locator('.ruler-y').boundingBox())!
  await drag(page, [c.x + 140, rx.y + 8], [c.x + 140, c.y + 80])
  await drag(page, [ry.x + 8, c.y + 40], [c.x + 120, c.y + 40])
  await expect(page.getByTestId('document-guide')).toHaveCount(2)
  const guide = page.getByRole('button', { name: 'Вертикальная направляющая 120 px', exact: true })
  await guide.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(
    page.getByRole('button', { name: 'Вертикальная направляющая 130 px', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(guide).toBeVisible()
  await guide.focus()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('document-guide')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('document-guide')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).__mainPaints)).toBe(0)
  await drag(page, [c.x + 120, c.y + 30], [c.x - 30, c.y + 30])
  await expect(page.getByTestId('document-guide')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('document-guide')).toHaveCount(2)
})
test('moving layers snaps their actual bounds to guides and Ctrl temporarily bypasses snapping', async ({
  page,
}) => {
  const doc = newDocument(300, 200, 'Snap', '#204060')
  doc.layers = [makeLayer({ name: 'Patch', x: 20, y: 30, width: 40, height: 30, color: '#ee9944' })]
  doc.layout = {
    ...defaultLayout(),
    snapDocument: false,
    guides: [{ id: 'guide', axis: 'x', position: 160 }],
  }
  await start(page, doc)
  const c = (await page.getByTestId('editor-canvas').boundingBox())!
  await drag(page, [c.x + 40, c.y + 45], [c.x + 136, c.y + 45])
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('120')
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await drag(page, [c.x + 40, c.y + 45], [c.x + 136, c.y + 45], 'Control')
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('116')
})
test('layout generation has real margins/gutters, lock prevents drag, and canvas anchors move guides with layers', async ({
  page,
}) => {
  const doc = newDocument(300, 200, 'Anchors', '#204060')
  doc.layers = [
    makeLayer({ name: 'Patch', x: 10, y: 20, width: 100, height: 80, color: '#ee9944' }),
  ]
  doc.layout = {
    ...defaultLayout(),
    guides: [
      { id: 'x', axis: 'x', position: 50 },
      { id: 'y', axis: 'y', position: 80 },
    ],
  }
  await start(page, doc)
  await menu(page, 'Изображение', 'Размер холста…')
  await page.getByLabel('Новая ширина').fill('500')
  await page.getByLabel('Новая высота').fill('400')
  await page.getByRole('button', { name: 'Нижний правый', exact: true }).click()
  await page.getByRole('button', { name: 'Применить размер', exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('210')
  await expect(page.getByLabel('Y', { exact: true })).toHaveValue('220')
  await expect(
    page.getByRole('button', { name: 'Вертикальная направляющая 250 px', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Горизонтальная направляющая 280 px', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  await expect(page.locator('.document-meta')).toContainText('300 × 200')
  await menu(page, 'Вид', 'Направляющие и сетка…')
  await page.getByRole('button', { name: 'Макет', exact: true }).click()
  await page.getByRole('button', { name: 'Правило третей', exact: true }).click()
  await page.getByRole('button', { name: 'Построить макет', exact: true }).click()
  await page.getByRole('button', { name: 'Направляющие', exact: true }).click()
  await page.getByLabel('Заблокировать направляющие').check()
  await page.getByRole('button', { name: 'Применить разметку', exact: true }).click()
  await expect(page.getByTestId('document-guide')).toHaveCount(8)
  const before = await save(page),
    native = readPsd(before, { useImageData: true }).imageResources!.gridAndGuidesInformation!
      .guides!
  expect(native.filter((g) => g.direction === 'vertical').map((g) => g.location)).toEqual([
    0, 100, 200, 300,
  ])
  const c = (await page.getByTestId('editor-canvas').boundingBox())!,
    r = (await page.locator('.ruler-x').boundingBox())!
  await drag(page, [c.x + 150, r.y + 8], [c.x + 150, c.y + 100])
  await expect(page.getByTestId('document-guide')).toHaveCount(8)
  await expect(page.locator('.toast')).toContainText('заблокированы')
})
test('Shift range selection aligns and distributes multiple native shapes in one undo', async ({
  page,
}) => {
  const doc = newDocument(400, 240, 'Arrangement', '#204060')
  doc.layers = [
    makeLayer({ name: 'A', x: 20, y: 20, width: 40, height: 30 }),
    makeLayer({ name: 'B', x: 100, y: 70, width: 80, height: 30 }),
    makeLayer({ name: 'C', x: 280, y: 140, width: 40, height: 30 }),
  ]
  await start(page, doc)
  await page.locator('.layer-row').filter({ hasText: /^A$/ }).click()
  await page
    .locator('.layer-row')
    .filter({ hasText: /^C$/ })
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-selection-note')).toContainText('3 слоёв')
  await page.getByRole('button', { name: 'Выровнять…', exact: true }).click()
  await page.getByLabel('Относительно чего выравнивать').selectOption('canvas')
  await page.getByRole('button', { name: 'По верхнему краю', exact: true }).click()
  let native = readPsd(await save(page), { useImageData: true }).children!.filter(
    (l) => l.vectorMask,
  )
  expect(native).toHaveLength(3)
  expect(
    native.every(
      (l) => l.vectorOrigination?.keyDescriptorList?.[0].keyOriginShapeBoundingBox?.top.value === 0,
    ),
  ).toBe(true)
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: 'Выровнять…', exact: true }).click()
  await page.getByRole('button', { name: 'Равные интервалы по X', exact: true }).click()
  native = readPsd(await save(page), { useImageData: true }).children!.filter((l) => l.vectorMask)
  expect(
    native.map(
      (l) => l.vectorOrigination?.keyDescriptorList?.[0].keyOriginShapeBoundingBox?.left.value,
    ),
  ).toEqual([20, 130, 280])
})
test('canvas alignment uses point-text ink rather than its obsolete logical width and keeps TypeLayer', async ({
  page,
}) => {
  const doc = newDocument(420, 180, 'Type alignment', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Measured',
      text: 'Широкий текст',
      x: 10,
      y: 50,
      width: 8,
      height: 8,
      fontFamily: 'Manrope',
      fontSize: 34,
      fontWeight: 600,
      color: '#ffffff',
    }),
  ]
  await start(page, doc)
  await menu(page, 'Слой', 'Выравнивание и интервалы…')
  await page.getByRole('button', { name: 'По центру горизонтально', exact: true }).click()
  const center = await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let min = c.width,
      max = 0
    for (let i = 3; i < d.length; i += 4)
      if (d[i]) {
        const x = ((i - 3) / 4) % c.width
        min = Math.min(min, x)
        max = Math.max(max, x)
      }
    return (min + max + 1) / 2
  })
  expect(Math.abs(center - 210)).toBeLessThanOrEqual(1)
  expect(readPsd(await save(page), { useImageData: true }).children![0].text?.text).toBe(
    'Широкий текст',
  )
})

test('metadata-only edits inside a preserved smart object update its native linked PSD, not only outer XMP', async ({
  page,
}) => {
  const doc = newDocument(400, 180, 'Smart metadata', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Editable source',
      text: 'Нативный текст',
      fontFamily: 'Manrope',
      fontSize: 30,
      width: 10,
      height: 8,
      x: 30,
      y: 50,
      color: '#ffffff',
    }),
  ]
  await start(page, doc)
  await menu(page, 'Слой', 'Преобразовать в смарт-объект')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const original = await save(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'preserved-smart.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: original,
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page
    .getByRole('button', { name: 'Открыть содержимое: Editable source', exact: true })
    .dblclick()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await menu(page, 'Вид', 'Направляющие и сетка…')
  await page.getByLabel('Положение новой направляющей').fill('10')
  await page.getByRole('button', { name: 'Добавить направляющую', exact: true }).click()
  await page.getByRole('button', { name: 'Применить разметку', exact: true }).click()
  await page.locator('.layer-row').first().dblclick()
  // Rename via the explicit F2 layer command, without changing text or pixels.
  await page.locator('.layer-row').first().press('F2')
  await page.getByLabel('Название слоя').fill('Renamed native contents')
  await page.getByLabel('Название слоя').press('Enter')
  await page.getByRole('button', { name: 'Применить в документ · Ctrl+S', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const result = readPsd(await save(page), { useImageData: true }),
    placed = result.children!.find((l) => l.placedLayer)!,
    linked = result.linkedFiles!.find((f) => f.id === placed.placedLayer!.id)!
  const inner = readPsd(linked.data!, { useImageData: true })
  expect(inner.children![0].text?.text).toBe('Нативный текст')
  expect(inner.children![0].name).toBe('Renamed native contents')
  expect(inner.imageResources?.gridAndGuidesInformation?.guides).toEqual([
    { location: 10, direction: 'vertical' },
  ])
})
