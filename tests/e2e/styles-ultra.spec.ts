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

test('Blend If hides a layer by underlying and own luminance and exports native PSD ranges', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  // Backdrop: black left half + white right half on two layers.
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [2, 2], [148, 198])
  await page.getByLabel('Цвет фигуры').fill('#000000')
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [152, 2], [298, 198])
  await page.getByLabel('Цвет фигуры').fill('#ffffff')
  // Top: red over everything.
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [2, 2], [298, 198])
  await page.getByLabel('Цвет фигуры').fill('#ff0000')
  await expect.poll(async () => await pixel(page, 75, 100)).toEqual([255, 0, 0, 255])

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Параметры наложения', exact: false }).click()
  await expect(page.getByTestId('blend-if-controls')).toBeVisible()
  // Underlying gray: hide where the backdrop is darker than 128.
  await page.getByRole('slider', { name: 'Нижний слой — Тени: скрывать ниже' }).fill('128')
  await page.getByRole('slider', { name: 'Нижний слой — Тени: переход до' }).fill('128')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 75, 100)).toEqual([0, 0, 0, 255])
  await expect.poll(async () => await pixel(page, 225, 100)).toEqual([255, 0, 0, 255])

  // This layer: red luminance is 77, so hiding above 50 removes it everywhere.
  // (The layer now also has an fx mark button, so target the explicit open button.)
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Параметры наложения', exact: false }).click()
  await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
  await page.getByRole('slider', { name: 'Этот слой — Света: переход от' }).fill('50')
  await page.getByRole('slider', { name: 'Этот слой — Света: скрывать выше' }).fill('50')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 225, 100)).toEqual([255, 255, 255, 255])
  await expect.poll(async () => await pixel(page, 75, 100)).toEqual([0, 0, 0, 255])

  // The ranges travel natively in the PSD layer record, not in our sidecar.
  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.blendingRanges)
  expect(layer?.blendingRanges?.compositeGrayBlendSource).toEqual([0, 0, 50, 50])
  expect(layer?.blendingRanges?.ranges).toHaveLength(3)
})

test('gradient-filled stroke and radial gradient overlay render real shapes', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [240, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  // Stroke filled with the default ULTRA gradient (violet -> orange, top -> bottom).
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await expect(page.getByTestId('effect-instance-list')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('16')
  await page.getByLabel('Тип заливки обводки').selectOption('gradient')
  await page.getByRole('checkbox', { name: 'Дизеринг градиента обводки' }).check()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect
    .poll(async () => {
      const p = await pixel(page, 150, 41)
      return p[3] === 255 && p[2] > p[0]
    })
    .toBe(true) // violet near the top
  await expect
    .poll(async () => {
      const p = await pixel(page, 150, 159)
      return p[3] === 255 && p[0] > p[2]
    })
    .toBe(true) // orange near the bottom

  // Radial overlay: gradient start in the middle, end towards the corners.
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Градиент', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByLabel('Стиль градиента наложения').selectOption('radial')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect
    .poll(async () => {
      const p = await pixel(page, 150, 100)
      return p[3] === 255 && p[2] > p[0]
    })
    .toBe(true)
  await expect
    .poll(async () => {
      const p = await pixel(page, 66, 56)
      return p[3] === 255 && p[0] > p[2]
    })
    .toBe(true)

  // Screen blends the violet radial centre with the #808080 shape instead of
  // replacing it: (182,163,255) over (128,128,128) becomes (219,209,255).
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Градиент', exact: false }).click()
  await page.getByLabel('Режим наложения градиента').selectOption('screen')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([219, 209, 255, 255])

  // Color Overlay is above Gradient Overlay. Difference with white therefore
  // inverts the already-screened centre to (36,46,0), rather than being
  // screened away by a gradient incorrectly painted after it.
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Наложение цвета', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByLabel('Цвет наложения').fill('#ffffff')
  await page.getByLabel('Режим наложения цвета').selectOption('difference')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([36, 46, 0, 255])

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.gradientOverlay?.length)
  expect(layer?.effects?.stroke?.[0].gradient?.dither).toBe(true)
  expect(layer?.effects?.gradientOverlay?.[0].blendMode).toBe('screen')
  expect(layer?.effects?.solidFill?.[0].blendMode).toBe('difference')
})

test('gradient overlay dither changes quantization locally and exports natively', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [40, 40], [260, 160])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Градиент', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByLabel('Библиотека градиентов').selectOption('0') // Чёрный → белый
  await page.getByLabel('Стиль градиента наложения').selectOption('linear')
  await page.getByRole('slider', { name: 'Угол градиента' }).fill('0')
  await page.getByRole('slider', { name: 'Масштаб градиента' }).fill('400')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  // Wait for the actual 400% black-to-white ramp, not merely for the opaque
  // gray rectangle that was already visible before the style was applied.
  await expect
    .poll(async () => {
      const left = (await pixel(page, 60, 100))[0]
      const right = (await pixel(page, 239, 100))[0]
      return left < 110 && right > 145
    })
    .toBe(true)

  const regionStats = () =>
    page.locator('[data-testid=editor-canvas]').evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(60, 60, 180, 80).data
      const values: number[] = []
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        values.push(data[i])
        sum += data[i]
      }
      return { values, mean: sum / values.length }
    })
  const before = await regionStats()

  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Градиент', exact: false }).click()
  await page
    .getByRole('checkbox', { name: 'Дизеринг градиента (меньше полос на плавных переходах)' })
    .check()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect
    .poll(async () => {
      const after = await regionStats()
      return after.values.some((value, index) => value !== before.values[index])
    })
    .toBe(true)

  const after = await regionStats()
  let changed = 0
  let maxDifference = 0
  for (let i = 0; i < before.values.length; i++) {
    const difference = Math.abs(after.values[i] - before.values[i])
    if (difference) changed++
    maxDifference = Math.max(maxDifference, difference)
  }
  expect(changed).toBeGreaterThan(100)
  expect(maxDifference).toBeLessThanOrEqual(2)
  expect(Math.abs(after.mean - before.mean)).toBeLessThan(0.75)

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.gradientOverlay?.length)
  expect(layer?.effects?.gradientOverlay?.[0].dither).toBe(true)
})

test('pattern overlay and pattern-filled stroke render tiles and export native Patt resources', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [240, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  const background = [36, 31, 56, 255] // #241f38
  const foreground = [182, 163, 255, 255] // #b6a3ff
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Узор', exact: true }).click()
  await expect(page.getByTestId('pattern-definition-editor')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Масштаб узора' }).fill('50')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  // The default 32 px checker at 50% has 8 px quadrants in layer space.
  await expect.poll(async () => await pixel(page, 72, 54)).toEqual(foreground)
  await expect.poll(async () => await pixel(page, 80, 54)).toEqual(background)

  // A +8 px phase shifts the scaled tile by exactly one quadrant. Switching
  // the same edit to Multiply proves the pattern now blends with the gray
  // shape: foreground/background become (91,82,128) and (18,16,28).
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Узор', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Фаза узора X' }).fill('8')
  await page.getByRole('spinbutton', { name: 'Фаза узора X' }).press('Enter')
  await page.getByLabel('Режим наложения узора').selectOption('multiply')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 72, 54)).toEqual([18, 16, 28, 255])
  await expect.poll(async () => await pixel(page, 80, 54)).toEqual([91, 82, 128, 255])

  // An inside stroke gets its own differently coloured checker tile.
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Обводка', exact: false }).click()
  await expect(page.getByTestId('effect-instance-list')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('16')
  await page.locator('.style-controls').getByLabel('Положение обводки').selectOption('inside')
  await page.getByLabel('Тип заливки обводки').selectOption('pattern')
  await expect(page.getByTestId('pattern-definition-editor')).toBeVisible()
  await page.getByLabel('Узор обводки: основной цвет').fill('#00ff00')
  await page.getByLabel('Узор обводки: цвет фона').fill('#0000ff')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 72, 58)).toEqual([0, 0, 255, 255])
  await expect.poll(async () => await pixel(page, 84, 58)).toEqual([0, 255, 0, 255])

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.patternOverlay)
  expect(layer?.effects?.patternOverlay?.blendMode).toBe('multiply')
  expect(layer?.effects?.patternOverlay?.scale).toBeCloseTo(0.5, 2)
  expect(layer?.effects?.patternOverlay?.phase).toEqual({ x: 8, y: 0 })
  expect(layer?.effects?.stroke?.[0].fillType).toBe('pattern')
  const overlayId = layer?.effects?.patternOverlay?.pattern?.id
  const strokeId = layer?.effects?.stroke?.[0].pattern?.id
  expect(overlayId).toBeTruthy()
  expect(strokeId).toBeTruthy()
  expect(strokeId).not.toBe(overlayId)
  expect(parsed.patterns).toHaveLength(2)
  const overlayTile = parsed.patterns?.find((p) => p.id === overlayId)
  expect(overlayTile?.bounds).toMatchObject({ w: 32, h: 32 })
  expect([...(overlayTile?.data.slice(16 * 4, 16 * 4 + 4) || [])]).toEqual(foreground)

  parsed.imageResources = {}
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  const stripped = (withoutXmp.children || []).find((l) => l.effects?.patternOverlay)
  expect(withoutXmp.patterns).toHaveLength(2)
  expect(stripped?.effects?.stroke?.[0].pattern?.id).toBe(strokeId)
})

test('Bevel & Emboss lights the shape, reverses direction and exports natively', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [240, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер фаски' }).fill('16')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // Default PSD light 120°/30° comes from the top-left; the centre stays flat.
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([128, 128, 128, 255])
  await expect.poll(async () => (await pixel(page, 150, 58))[0]).toBeGreaterThan(140)
  await expect.poll(async () => (await pixel(page, 68, 100))[0]).toBeGreaterThan(140)
  await expect.poll(async () => (await pixel(page, 150, 142))[0]).toBeLessThan(110)
  await expect.poll(async () => (await pixel(page, 232, 100))[0]).toBeLessThan(110)
  await expect.poll(async () => (await pixel(page, 150, 42))[3]).toBe(0)

  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByLabel('Направление фаски').selectOption('down')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 150, 58))[0]).toBeLessThan(110)
  await expect.poll(async () => (await pixel(page, 150, 142))[0]).toBeGreaterThan(140)

  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByLabel('Направление фаски').selectOption('up')
  await page.getByLabel('Стиль фаски').selectOption('outer')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect
    .poll(async () => {
      const p = await pixel(page, 150, 42)
      return p[3] === 255 && p[0] > 140
    })
    .toBe(true)
  await expect
    .poll(async () => {
      const p = await pixel(page, 150, 158)
      return p[3] === 255 && p[0] < 110
    })
    .toBe(true)

  // Stroke Emboss shades the actual 18 px inside stroke ring, not the fill.
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Обводка', exact: false }).click()
  await expect(page.getByTestId('effect-instance-list')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('18')
  await page.locator('.style-controls').getByLabel('Положение обводки').selectOption('inside')
  await page.getByLabel('Цвет обводки слоя').fill('#808080')
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByLabel('Стиль фаски').selectOption('stroke')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 150, 58))[0]).toBeGreaterThan(140)
  await expect.poll(async () => (await pixel(page, 150, 142))[0]).toBeLessThan(110)
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([128, 128, 128, 255])
  await expect.poll(async () => (await pixel(page, 150, 42))[3]).toBe(0)

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.bevel)
  expect(layer?.effects?.bevel).toMatchObject({
    enabled: true,
    style: 'stroke emboss',
    technique: 'smooth',
    direction: 'up',
    angle: 120,
    altitude: 30,
    highlightBlendMode: 'screen',
    shadowBlendMode: 'multiply',
    size: { value: 16, units: 'Pixels' },
  })
  expect(layer?.effects?.bevel?.strength).toBeCloseTo(1, 2)
  expect(layer?.effects?.bevel?.contour).toMatchObject({
    name: 'Linear',
    curve: [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
  })
  parsed.imageResources = {}
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  const stripped = (withoutXmp.children || []).find((l) => l.effects?.bevel)
  expect(stripped?.effects?.bevel?.style).toBe('stroke emboss')
})

test('Satin shades opposite interior edges, inverts and exports natively', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [240, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Атлас (Satin)', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Непрозрачность атласа' }).fill('100')
  await page.getByRole('slider', { name: 'Угол атласа' }).fill('90')
  await page.getByRole('slider', { name: 'Дистанция атласа' }).fill('20')
  await page.getByRole('slider', { name: 'Размер атласа' }).fill('0')
  await page.getByRole('checkbox', { name: 'Инвертировать атлас' }).uncheck()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // A vertical 20 px two-copy mask touches the top/bottom interior bands only.
  await expect.poll(async () => await pixel(page, 150, 58)).toEqual([0, 0, 0, 255])
  await expect.poll(async () => await pixel(page, 150, 142)).toEqual([0, 0, 0, 255])
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([128, 128, 128, 255])
  await expect.poll(async () => await pixel(page, 68, 100)).toEqual([128, 128, 128, 255])
  await expect.poll(async () => (await pixel(page, 150, 42))[3]).toBe(0)

  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Атлас (Satin)', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Инвертировать атлас' }).check()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([0, 0, 0, 255])
  await expect.poll(async () => await pixel(page, 150, 58)).toEqual([128, 128, 128, 255])

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.satin)
  expect(layer?.effects?.satin).toMatchObject({
    enabled: true,
    blendMode: 'multiply',
    angle: 90,
    distance: { value: 20, units: 'Pixels' },
    size: { value: 0, units: 'Pixels' },
    invert: true,
    antialiased: false,
    contour: {
      name: 'Linear',
      curve: [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ],
    },
  })
  expect(layer?.effects?.satin?.opacity).toBeCloseTo(1, 2)
  parsed.imageResources = {}
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  const stripped = (withoutXmp.children || []).find((l) => l.effects?.satin)
  expect(stripped?.effects?.satin?.distance?.value).toBe(20)
})

test('contours reshape shadow falloff and bevel gloss, then export every contour natively', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [80, 50], [220, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  const controls = page.locator('.style-controls')
  await page.getByRole('button', { name: 'Тень', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await controls.getByRole('slider', { name: 'Размытие тени' }).fill('20')
  await controls.getByLabel('Сдвиг X', { exact: true }).fill('50')
  await controls.getByLabel('Сдвиг Y', { exact: true }).fill('0')
  await controls.getByRole('slider', { name: 'Непрозрачность тени' }).fill('100')
  await controls.getByLabel('Контур тени').selectOption('Конус')
  await page.getByRole('button', { name: 'Редактировать точки', exact: true }).click()
  await expect(page.getByTestId('contour-point-editor')).toBeVisible()
  await controls.getByLabel('Точка контура').selectOption('1')
  await controls.getByLabel('Выход точки').fill('90')
  await expect(controls.getByLabel('Контур тени')).toHaveValue('__custom__')
  await page.getByRole('button', { name: 'Добавить точку', exact: true }).click()
  await expect(controls.locator('.contour-editor-point')).toHaveCount(4)
  await page.getByRole('button', { name: 'Скрыть редактор точек', exact: true }).click()

  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await controls.getByRole('slider', { name: 'Размер фаски' }).fill('16')
  await controls.getByLabel('Контур глянца фаски').selectOption('Нисходящий')
  await page.getByRole('checkbox', { name: 'Сглаживание контура глянца' }).check()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // The descending gloss curve exchanges the normally lit top slope and the
  // normally shaded bottom slope; the flat centre remains the source grey.
  await expect.poll(async () => (await pixel(page, 150, 58))[0]).toBeLessThan(110)
  await expect.poll(async () => (await pixel(page, 150, 142))[0]).toBeGreaterThan(140)
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([128, 128, 128, 255])

  // In the displaced drop shadow, the cone maps its opaque core back to
  // transparent and peaks in the blurred falloff: a real halo/ring, not a
  // simple opacity multiplier.
  await expect.poll(async () => (await pixel(page, 230, 100))[3]).toBeLessThan(60)
  await expect.poll(async () => (await pixel(page, 275, 100))[3]).toBeGreaterThan(120)
  await expect.poll(async () => (await pixel(page, 292, 100))[3]).toBeLessThan(40)

  let bytes = await exportPsd(page)
  let parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  let layer = (parsed.children || []).find((l) => l.effects?.dropShadow?.length)
  expect(layer?.effects?.dropShadow?.[0].contour).toEqual({
    name: 'Пользовательский',
    curve: [
      { x: 0, y: 0 },
      { x: 128, y: 230 },
      { x: 192, y: 114 },
      { x: 255, y: 0 },
    ],
  })
  expect(layer?.effects?.bevel?.antialiasGloss).toBe(true)
  expect(layer?.effects?.bevel?.contour?.name).toBe('Нисходящий')
  parsed.imageResources = {}
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  const stripped = (withoutXmp.children || []).find((l) => l.effects?.dropShadow?.length)
  expect(stripped?.effects?.dropShadow?.[0].contour?.name).toBe('Пользовательский')
  expect(stripped?.effects?.bevel?.contour?.name).toBe('Нисходящий')

  // Add the remaining contour-bearing effects through the same UI and prove
  // their curves/ranges also live in native descriptors rather than XMP.
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Внутренняя тень', exact: false }).click()
  await controls.getByRole('slider', { name: 'Размытие тени' }).fill('7')
  await controls.getByLabel('Контур тени').selectOption('Полукруг')

  await page.getByRole('button', { name: 'Внешнее свечение', exact: false }).click()
  await controls.getByRole('slider', { name: 'Радиус свечения' }).fill('12')
  await controls.getByLabel('Контур свечения').selectOption('Ступени')
  await page.getByRole('button', { name: 'Редактировать точки', exact: true }).click()
  await controls.getByLabel('Точка контура').selectOption('3')
  const draggedPoint = controls.locator('.contour-editor-point').nth(3)
  const pointBox = (await draggedPoint.boundingBox())!
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2 + 24, {
    steps: 6,
  })
  await page.mouse.up()
  await expect(controls.getByLabel('Контур свечения')).toHaveValue('__custom__')
  // Normalize the dragged point through the numeric field so the native PSD
  // assertion below is exact rather than dependent on browser pointer pixels.
  await controls.getByLabel('Выход точки').fill('25')
  await page.getByRole('button', { name: 'Скрыть редактор точек', exact: true }).click()
  await controls.getByRole('slider', { name: 'Диапазон контура свечения' }).fill('25')
  await page.getByRole('checkbox', { name: 'Сглаживание контура свечения' }).check()

  await page.getByRole('button', { name: 'Внутреннее свечение', exact: false }).click()
  await controls.getByRole('slider', { name: 'Радиус свечения' }).fill('8')
  await controls.getByLabel('Контур свечения').selectOption('S-кривая')
  await controls.getByRole('slider', { name: 'Диапазон контура свечения' }).fill('80')

  await page.getByRole('button', { name: 'Атлас (Satin)', exact: true }).click()
  await controls.getByRole('slider', { name: 'Размер атласа' }).fill('10')
  await controls.getByLabel('Контур атласа').selectOption('Двойное кольцо')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  bytes = await exportPsd(page)
  parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  layer = (parsed.children || []).find((l) => l.effects?.satin)
  expect(layer?.effects?.innerShadow?.[0].contour?.name).toBe('Полукруг')
  expect(layer?.effects?.outerGlow?.contour?.name).toBe('Пользовательский')
  expect(layer?.effects?.outerGlow?.contour?.curve[3].y).toBe(64)
  expect(layer?.effects?.outerGlow?.contour?.curve[3].x).toBeGreaterThanOrEqual(124)
  expect(layer?.effects?.outerGlow?.contour?.curve[3].x).toBeLessThanOrEqual(128)
  expect(layer?.effects?.outerGlow?.antialiased).toBe(true)
  expect(layer?.effects?.outerGlow?.range).toBeCloseTo(0.25, 2)
  expect(layer?.effects?.innerGlow?.contour?.name).toBe('S-кривая')
  expect(layer?.effects?.innerGlow?.range).toBeCloseTo(0.8, 2)
  expect(layer?.effects?.satin?.contour?.name).toBe('Двойное кольцо')
})

test('batch applies a real action to copies and never downloads under input names', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  const makePng = async (color: string) =>
    Buffer.from(
      await page.evaluate((fill) => {
        const c = document.createElement('canvas')
        c.width = 40
        c.height = 30
        const x = c.getContext('2d')!
        x.fillStyle = fill
        x.fillRect(0, 0, 40, 30)
        return c.toDataURL().split(',')[1]
      }, color),
      'base64',
    )
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Пакетная обработка…', exact: true }).click()
  await expect(page.getByTestId('batch-dialog')).toBeVisible()
  await page.getByLabel('Файлы для пакетной обработки').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: await makePng('#000000') },
    { name: 'two.png', mimeType: 'image/png', buffer: await makePng('#202020') },
  ])
  await page.getByLabel('Операция для пакета').selectOption('negative')
  const downloads: string[] = []
  const paths: string[] = []
  page.on('download', (d) => {
    downloads.push(d.suggestedFilename())
    void d.path().then((p) => p && paths.push(p))
  })
  await page.getByRole('button', { name: 'Запустить пакет', exact: true }).click()
  await expect(page.getByTestId('batch-log')).toContainText('one-ultra.png')
  await expect(page.getByTestId('batch-log')).toContainText('two-ultra.png')
  await expect.poll(() => downloads.length).toBe(2)
  expect(downloads.sort()).toEqual(['one-ultra.png', 'two-ultra.png'])
  await expect.poll(() => paths.length).toBe(2)
  const first = await readFile(paths[0])
  const center = await page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    return [...ctx.getImageData(20, 15, 1, 1).data]
  }, first.toString('base64'))
  // Black or near-black inputs inverted by the action become bright.
  expect(center[0]).toBeGreaterThan(200)
  expect(center[3]).toBe(255)
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

test('Global Light relights linked shadow and Bevel document-wide, leaves unlinked shadow, and exports PSD resources', async ({
  page,
}) => {
  await ready(page)
  await blank(page)

  // A: a linked drop shadow plus a linked Bevel. Linking the shadow snaps its
  // 18 px distance to the effective 120° master and materializes that master.
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [50, 45], [125, 115])
  await page.getByLabel('Цвет фигуры').fill('#808080')
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  const controls = page.locator('.style-controls')
  await page.getByRole('button', { name: 'Тень', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await controls.getByRole('slider', { name: 'Размытие тени' }).fill('0')
  await controls.getByRole('slider', { name: 'Непрозрачность тени' }).fill('100')
  await controls.getByRole('slider', { name: 'Расстояние тени' }).fill('18')
  await page.getByRole('checkbox', { name: 'Использовать глобальный свет для тени' }).check()
  await expect(controls.getByRole('slider', { name: 'Угол тени' })).toHaveValue('120')
  await expect(controls.getByLabel('Сдвиг X', { exact: true })).toBeDisabled()
  await expect(controls.getByLabel('Сдвиг Y', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await controls.getByRole('slider', { name: 'Размер фаски' }).fill('16')
  await expect(
    page.getByRole('checkbox', { name: 'Использовать глобальный свет для фаски' }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // B: the same 18 px shadow distance, deliberately not linked.
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [190, 45], [265, 115])
  await page.getByLabel('Цвет фигуры').fill('#808080')
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Тень', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await controls.getByRole('slider', { name: 'Размытие тени' }).fill('0')
  await controls.getByRole('slider', { name: 'Непрозрачность тени' }).fill('100')
  await controls.getByRole('slider', { name: 'Угол тени' }).fill('90')
  await controls.getByRole('slider', { name: 'Расстояние тени' }).fill('18')
  await expect(
    page.getByRole('checkbox', { name: 'Использовать глобальный свет для тени' }),
  ).not.toBeChecked()
  await expect(controls.getByLabel('Сдвиг X', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()

  // 120° puts A's shadow bottom-right and lights A's top/left bevel slopes.
  await expect.poll(async () => (await pixel(page, 88, 124))[3]).toBe(255)
  await expect.poll(async () => (await pixel(page, 40, 80))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 228, 124))[3]).toBe(255)
  await expect.poll(async () => (await pixel(page, 180, 80))[3]).toBe(0)
  await expect
    .poll(async () => (await pixel(page, 58, 80))[0] - (await pixel(page, 117, 80))[0])
    .toBeGreaterThan(25)

  await page.getByRole('button', { name: 'Слой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Глобальный свет…', exact: true }).click()
  await expect(page.getByTestId('global-light-dialog')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Угол глобального света' })).toHaveValue('120')
  await expect(page.getByRole('slider', { name: 'Высота глобального света' })).toHaveValue('30')
  await page.getByRole('slider', { name: 'Угол глобального света' }).fill('0')
  await page.getByRole('slider', { name: 'Высота глобального света' }).fill('60')
  await page.screenshot({ path: 'test-results/global-light-dialog.png' })
  await page.getByRole('button', { name: 'Применить глобальный свет', exact: true }).click()

  // 0° is light from the right: only A's linked shadow moves left, and A's
  // right bevel slope becomes the bright one. B's unlinked shadow stays down.
  await expect.poll(async () => (await pixel(page, 40, 80))[3]).toBe(255)
  await expect.poll(async () => (await pixel(page, 88, 124))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 228, 124))[3]).toBe(255)
  await expect.poll(async () => (await pixel(page, 180, 80))[3]).toBe(0)
  await expect
    .poll(async () => (await pixel(page, 117, 80))[0] - (await pixel(page, 58, 80))[0])
    .toBeGreaterThan(20)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pixel(page, 40, 80))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 88, 124))[3]).toBe(255)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await pixel(page, 40, 80))[3]).toBe(255)

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  expect(parsed.imageResources?.globalAngle).toBe(0)
  expect(parsed.imageResources?.globalAltitude).toBe(60)
  const shadowLayers = (parsed.children || []).filter((l) => l.effects?.dropShadow?.length)
  expect(shadowLayers).toHaveLength(2)
  const linked = shadowLayers.find((l) => l.effects?.dropShadow?.[0].useGlobalLight === true)
  const unlinked = shadowLayers.find((l) => l.effects?.dropShadow?.[0].useGlobalLight === false)
  expect(linked?.effects?.dropShadow?.[0].angle).toBeCloseTo(0, 1)
  expect(linked?.effects?.dropShadow?.[0].distance?.value).toBeCloseTo(18, 1)
  expect(linked?.effects?.bevel).toMatchObject({ useGlobalLight: true, angle: 0, altitude: 60 })
  expect(unlinked?.effects?.dropShadow?.[0].angle).toBeCloseTo(90, 1)
  expect(unlinked?.effects?.dropShadow?.[0].distance?.value).toBeCloseTo(18, 1)

  parsed.imageResources = { ...parsed.imageResources, xmpMetadata: undefined }
  const withoutXmp = readPsd(writePsd(parsed), { useImageData: true, skipThumbnail: true })
  expect(withoutXmp.imageResources?.globalAngle).toBe(0)
  expect(withoutXmp.imageResources?.globalAltitude).toBe(60)
  expect(
    (withoutXmp.children || []).some((l) => l.effects?.dropShadow?.[0].useGlobalLight === true),
  ).toBe(true)
})

test('real effects.psd opens with resource Global Light 132/30 over stored linked 120° descriptors', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles('tests/fixtures/psd/effects.psd')
  await expect(page.getByRole('button', { name: 'Отчёт импорта', exact: true })).toBeVisible()
  await expect(page.locator('.busy-overlay')).toBeHidden()

  await page.getByRole('button', { name: 'Слой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Глобальный свет…', exact: true }).click()
  await expect(page.getByTestId('global-light-dialog')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Угол глобального света' })).toHaveValue('132')
  await expect(page.getByRole('slider', { name: 'Высота глобального света' })).toHaveValue('30')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()

  await page.locator('.layer-row').filter({ hasText: 'drop shadow' }).click()
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Тень', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Использовать глобальный свет для тени' }),
  ).toBeChecked()
  await expect(page.getByRole('slider', { name: 'Угол тени' })).toHaveValue('132')
  await expect(page.getByLabel('Сдвиг X', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click()

  await page.locator('.layer-row').filter({ hasText: 'bevel' }).click()
  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Фаска и тиснение', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Использовать глобальный свет для фаски' }),
  ).toBeChecked()
  await expect(page.getByRole('slider', { name: 'Угол света фаски' })).toHaveValue('132')
  await expect(page.getByRole('slider', { name: 'Высота света фаски' })).toHaveValue('30')
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click()
})

test('pixel-only FX blend modes render in overlays and export natively', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [240, 150])
  await page.getByLabel('Цвет фигуры').fill('#808080')

  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('button', { name: 'Градиент', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByLabel('Стиль градиента наложения').selectOption('radial')
  await page.getByLabel('Режим наложения градиента').selectOption('subtract')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  // The radial centre is (182,163,255); Subtract from #808080 clips to black.
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([0, 0, 0, 255])

  await page.locator('.style-open-button').click()
  await page.getByRole('button', { name: 'Наложение цвета', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByLabel('Цвет наложения').fill('#ffffff')
  await page.getByLabel('Режим наложения цвета').selectOption('dissolve')
  await page.getByRole('slider', { name: 'Непрозрачность цвета' }).fill('50')
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  const dissolvedRatio = () =>
    page.locator('[data-testid=editor-canvas]').evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(130, 85, 40, 30).data
      let whites = 0,
        total = 0
      for (let i = 0; i < data.length; i += 4) {
        total++
        if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) whites++
      }
      return whites / total
    })
  await expect.poll(dissolvedRatio).toBeGreaterThan(0.35)
  expect(await dissolvedRatio()).toBeLessThan(0.65)

  const bytes = await exportPsd(page)
  const parsed = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  const layer = (parsed.children || []).find((l) => l.effects?.gradientOverlay?.length)
  expect(layer?.effects?.gradientOverlay?.[0].blendMode).toBe('subtract')
  expect(layer?.effects?.solidFill?.[0].blendMode).toBe('dissolve')
})
