import { expect, test, type Page } from '@playwright/test'

async function blank(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  if (await page.getByTestId('open-demo').isVisible()) await page.getByTestId('open-demo').click()
  await page.getByRole('button', { name: 'Создать новый проект', exact: true }).click()
  await page.getByLabel('Ширина нового холста').fill('300')
  await page.getByLabel('Высота нового холста').fill('200')
  await page.getByRole('button', { name: 'Прозрачный', exact: true }).click()
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(0)
}
async function points(page: Page, points: number[][]) {
  const b = (await page.locator('.artboard').boundingBox())!
  await page.mouse.move(b.x + points[0][0], b.y + points[0][1])
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function pixel(page: Page, x: number, y: number) {
  return page
    .getByTestId('editor-canvas')
    .evaluate(
      (c: HTMLCanvasElement, p) => [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data],
      { x, y },
    )
}
async function image(page: Page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    const x = c.getContext('2d')!
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, 300, 200)
    x.fillStyle = '#ff0000'
    x.fillRect(40, 40, 40, 40)
    return c.toDataURL().split(',')[1]
  })
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.busy-overlay')).toBeHidden()
}

test('right click and long press reveal real subtypes; Shift+L cycles', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Лассо', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Прямолинейное лассо' }).click()
  await expect(page.locator('[data-tool=polygon-lasso]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Shift+l')
  await expect(page.locator('[data-tool=magnetic-lasso]')).toHaveAttribute('aria-pressed', 'true')
  const b = (await page.getByRole('button', { name: 'Прямоугольник', exact: true }).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await expect(page.getByRole('menu', { name: 'Подтипы инструмента' })).toBeVisible()
  await page.mouse.up()
  await page.getByRole('menuitem', { name: 'Эллипс' }).click()
  await expect(page.locator('[data-tool=ellipse]')).toHaveAttribute('aria-pressed', 'true')
})

test('freehand lasso erases the polygon, not its rectangular bounds; undo and deselect', async ({
  page,
}) => {
  await blank(page)
  await image(page)
  await page.keyboard.press('l')
  await points(page, [
    [100, 30],
    [230, 30],
    [100, 160],
    [100, 30],
  ])
  await page.getByRole('button', { name: 'Стереть', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => (await pixel(page, 120, 50))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 220, 145))[3]).toBe(255)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pixel(page, 120, 50))[3]).toBe(255)
  await page.keyboard.press('Control+d')
  await expect(page.locator('.selection-actions')).toBeHidden()
})

test('polygon selection closes with Enter and constrains the brush', async ({ page }) => {
  await blank(page)
  await page.keyboard.press('l')
  await page.keyboard.press('Shift+l')
  const b = (await page.locator('.artboard').boundingBox())!
  for (const [x, y] of [
    [70, 30],
    [230, 30],
    [70, 170],
  ])
    await page.mouse.click(b.x + x, b.y + y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.selection-actions')).toBeVisible()
  await page.keyboard.press('b')
  await page.getByLabel('Размер', { exact: true }).fill('40')
  await page.getByLabel('Размер', { exact: true }).press('Enter')
  await points(page, [
    [20, 90],
    [270, 90],
  ])
  await expect.poll(async () => (await pixel(page, 100, 90))[3]).toBe(255)
  await expect.poll(async () => (await pixel(page, 40, 90))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 250, 90))[3]).toBe(0)
})

test('brush defaults to black, top slider and number stay in sync, Alt-click samples and paints', async ({
  page,
}) => {
  await blank(page)
  await image(page)
  await page.keyboard.press('b')
  const color = page.getByLabel('Цвет инструмента', { exact: true })
  await expect(color).toHaveValue('#000000')
  await expect(page.locator('.tool-color-hex')).toHaveText('#000000')
  const slider = page.getByLabel('Размер — ползунок', { exact: true })
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(page.getByLabel('Размер', { exact: true })).toHaveValue('1')
  await page.getByLabel('Размер', { exact: true }).fill('36')
  await page.getByLabel('Размер', { exact: true }).press('Enter')
  await expect(slider).toHaveValue('36')
  const b = (await page.locator('.artboard').boundingBox())!
  await page.mouse.click(b.x + 150, b.y + 150)
  await expect.poll(async () => pixel(page, 150, 150)).toEqual([0, 0, 0, 255])
  await page.keyboard.down('Alt')
  await page.mouse.move(b.x + 60, b.y + 60)
  await expect(page.getByTestId('canvas-viewport')).toHaveClass(/alt-sampling/)
  await page.mouse.click(b.x + 60, b.y + 60)
  await page.keyboard.up('Alt')
  await expect(color).toHaveValue('#ff0000')
  await expect(page.locator('.tool-color-hex')).toHaveText('#FF0000')
  await page.mouse.click(b.x + 220, b.y + 150)
  await expect.poll(async () => pixel(page, 220, 150)).toEqual([255, 0, 0, 255])
  await expect(page.locator('.busy-overlay')).toBeHidden()
})

test('bucket respects connected-color boundaries and clone uses an Alt source', async ({
  page,
}) => {
  await blank(page)
  await image(page)
  await page.keyboard.press('g')
  await page.getByLabel('Цвет инструмента', { exact: true }).fill('#00ff00')
  const b = (await page.locator('.artboard').boundingBox())!
  await page.mouse.click(b.x + 15, b.y + 15)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => pixel(page, 15, 15)).toEqual([0, 255, 0, 255])
  await expect.poll(async () => pixel(page, 60, 60)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('s')
  await page.keyboard.down('Alt')
  await page.mouse.click(b.x + 60, b.y + 60)
  await page.keyboard.up('Alt')
  await expect(page.locator('.toast')).toContainText('Источник штампа выбран')
  await page.mouse.click(b.x + 180, b.y + 100)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => pixel(page, 180, 100)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('Control+z')
  await expect.poll(async () => pixel(page, 180, 100)).toEqual([0, 255, 0, 255])
})

test('gradient is an undoable layer; preferences and a user font persist locally', async ({
  page,
}) => {
  await blank(page)
  await page.keyboard.press('g')
  await page.keyboard.press('Shift+g')
  await page.getByLabel('Цвет инструмента', { exact: true }).fill('#000000')
  await points(page, [
    [0, 100],
    [299, 100],
  ])
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect((await pixel(page, 20, 100))[0]).toBeLessThan(40)
  expect((await pixel(page, 280, 100))[0]).toBeGreaterThan(220)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(0)
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Графит', exact: true }).click()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite')
  await page.getByRole('button', { name: 'Помощь', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Библиотека шрифтов…', exact: true }).click()
  await page.getByLabel('Загрузить файл шрифта').setInputFiles('public/fonts/catalog/oswald.ttf')
  await expect(page.locator('.font-notice')).toContainText('Установлено файлов: 1')
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click()
  await page.reload()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite')
  const count = await page.evaluate(
    async () =>
      new Promise<number>((resolve, reject) => {
        const r = indexedDB.open('fsh-777-local', 3)
        r.onerror = () => reject(r.error)
        r.onsuccess = () => {
          const q = r.result.transaction('fonts').objectStore('fonts').count()
          q.onsuccess = () => {
            resolve(q.result)
            r.result.close()
          }
        }
      }),
  )
  expect(count).toBe(1)
})

test('retouch brushes edit raster pixels: burn darkens highlights, sponge desaturates, smudge drags colour', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await image(page)
  const before = await pixel(page, 200, 60)
  expect(before).toEqual([255, 255, 255, 255])
  await page.getByRole('button', { name: 'Осветление', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Затемнение' }).click()
  await expect(page.locator('[data-tool=burn]')).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Размер', { exact: true }).fill('30')
  await page.getByLabel('Экспозиция', { exact: true }).fill('100')
  await page.getByLabel('Диапазон тонов').selectOption('highlights')
  await points(page, [
    [190, 60],
    [210, 60],
  ])
  await expect.poll(async () => (await pixel(page, 200, 60))[0]).toBeLessThan(240)
  // Sponge (desaturate by default) pulls the red square toward gray.
  await page.keyboard.press('Shift+o')
  await expect(page.locator('[data-tool=sponge]')).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Сила', { exact: true }).fill('100')
  await points(page, [
    [55, 60],
    [65, 60],
  ])
  const sponged = await pixel(page, 60, 60)
  expect(sponged[0] - sponged[1]).toBeLessThan(200)
  // Smudge drags the (now desaturated) square edge into the white field:
  // pure red desaturates to its BT.709 luma ~55, so the streak is gray.
  await page.getByRole('button', { name: 'Размытие', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Палец' }).click()
  await page.getByLabel('Сила', { exact: true }).fill('100')
  await points(page, [
    [78, 60],
    [96, 60],
  ])
  const smudged = await pixel(page, 90, 60)
  expect(smudged[0]).toBeLessThan(150)
  expect(Math.abs(smudged[0] - smudged[1])).toBeLessThanOrEqual(2)
  expect(smudged[3]).toBe(255)
})

test('brush smoothing cuts the corner while the raw stroke reaches the vertex', async ({
  page,
}) => {
  await blank(page)
  await page.keyboard.press('b')
  await page.getByLabel('Размер', { exact: true }).fill('6')
  const vertex = async () => (await pixel(page, 150, 40))[3]
  await points(page, [
    [60, 100],
    [150, 40],
    [240, 100],
  ])
  await expect.poll(vertex).toBe(255)
  await page.keyboard.press('Control+z')
  await expect.poll(vertex).toBe(0)
  await page.getByLabel('Сглаживание', { exact: true }).fill('100')
  await points(page, [
    [60, 100],
    [150, 40],
    [240, 100],
  ])
  // The pulled-string point never reaches the sharp vertex, but the stroke
  // still lands and catches up to the final raw point on release.
  expect(await vertex()).toBeLessThan(255)
  await expect.poll(async () => (await pixel(page, 238, 100))[3]).toBeGreaterThan(0)
})

test('pen pressure scales the brush dab; mouse input keeps the fixed size', async ({ page }) => {
  await blank(page)
  await page.keyboard.press('b')
  await page.getByLabel('Размер', { exact: true }).fill('40')
  const box = (await page.locator('.artboard').boundingBox())!
  const dab = (x: number, y: number, pressure: number) =>
    page.getByTestId('editor-canvas').evaluate(
      (c, args) => {
        const el = c as unknown as HTMLElement
        // Synthetic pen pointers have no live capture target in Chrome; the
        // stage calls setPointerCapture on its own element, so stub both.
        ;(Element.prototype as any).setPointerCapture = () => {}
        ;(Element.prototype as any).releasePointerCapture = () => {}
        const fire = (type: string) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              pointerType: 'pen',
              pointerId: 41,
              isPrimary: true,
              bubbles: true,
              clientX: args.box.x + args.x * args.ratio,
              clientY: args.box.y + args.y * args.ratio,
              pressure: args.pressure,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          )
        fire('pointerdown')
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            fire('pointerup')
            resolve()
          }, 120),
        )
      },
      { box: { x: box.x, y: box.y }, ratio: box.width / 300, x, y, pressure },
    )
  await dab(80, 100, 1)
  await expect.poll(async () => (await pixel(page, 80, 100))[3]).toBe(255)
  await dab(220, 100, 0.25)
  await expect.poll(async () => (await pixel(page, 220, 100))[3]).toBe(255)
  // 15px off-centre: inside the full-pressure radius (20), outside the
  // light-pressure one (40 * 0.25 / 2 = 5).
  expect((await pixel(page, 95, 100))[3]).toBe(255)
  expect((await pixel(page, 235, 100))[3]).toBe(0)
})

function syntheticAbrTip(width: number, height: number) {
  const alpha = Array.from({ length: width * height }, (_, i) => (i % width < width / 2 ? 255 : 0)),
    id = Buffer.from('e2e-tip'),
    contentLength = 1 + id.length + 10 + 16 + 2 + 1 + alpha.length,
    paddedContentLength = Math.ceil(contentLength / 4) * 4,
    sectionSize = 4 + paddedContentLength,
    bytes = Buffer.alloc(4 + 8 + 4 + sectionSize)
  let o = 0
  bytes.writeInt16BE(6, o)
  o += 2
  bytes.writeInt16BE(1, o)
  o += 2
  bytes.write('8BIM', o, 'ascii')
  o += 4
  bytes.write('samp', o, 'ascii')
  o += 4
  bytes.writeUInt32BE(sectionSize, o)
  o += 4
  bytes.writeUInt32BE(contentLength, o)
  o += 4
  bytes[o++] = id.length
  id.copy(bytes, o)
  o += id.length + 10
  bytes.writeInt32BE(0, o)
  o += 4
  bytes.writeInt32BE(0, o)
  o += 4
  bytes.writeInt32BE(height, o)
  o += 4
  bytes.writeInt32BE(width, o)
  o += 4
  bytes.writeInt16BE(8, o)
  o += 2
  bytes[o++] = 0
  Buffer.from(alpha).copy(bytes, o)
  return bytes
}

test('ABR sampled tip paints its 255-alpha half; calligraphy and scatter dynamics shape dabs', async ({
  page,
}) => {
  await blank(page)
  await image(page)
  await page.keyboard.press('b')
  await page.getByRole('button', { name: /Кисти, наконечники и динамика/ }).click()
  await expect(page.getByRole('dialog', { name: 'Кисти, наконечники и динамика' })).toBeVisible()
  await page.getByLabel('Импорт ABR-кистей').setInputFiles({
    name: 'e2e.abr',
    mimeType: 'application/octet-stream',
    buffer: syntheticAbrTip(20, 12),
  })
  const applyAbr = page.getByRole('button', { name: 'Применить ABR-кисть Наконечник 1' })
  await expect(applyAbr).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить ABR-кисть Наконечник 1' }).click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fsh777-brush-library') || ''))
    .toContain('Наконечник 1')
  await applyAbr.click()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByLabel('Размер', { exact: true })).toHaveValue('20')
  const b = (await page.locator('.artboard').boundingBox())!
  await page.mouse.click(b.x + 90, b.y + 100)
  await expect.poll(async () => (await pixel(page, 84, 100)).slice(0, 3)).toEqual([0, 0, 0])
  await expect.poll(async () => (await pixel(page, 96, 100)).slice(0, 3)).toEqual([255, 255, 255])

  await page.getByRole('button', { name: /Кисти, наконечники и динамика/ }).click()
  await page.getByRole('button', { name: 'Применить кисть Каллиграфическая −35°' }).click()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.mouse.click(b.x + 220, b.y + 80)
  // Rotated ellipse: a point along the major axis paints, the same distance
  // along the thin perpendicular axis stays untouched.
  await expect.poll(async () => (await pixel(page, 231, 72)).slice(0, 3)).toEqual([0, 0, 0])
  await expect.poll(async () => (await pixel(page, 227, 90)).slice(0, 3)).toEqual([255, 255, 255])

  await page.getByRole('button', { name: /Кисти, наконечники и динамика/ }).click()
  await page.getByRole('button', { name: 'Применить кисть Рассеянные точки' }).click()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await points(page, [
    [30, 160],
    [285, 160],
  ])
  const offLine = await page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement) => {
    const x = c.getContext('2d')!,
      data = x.getImageData(0, 120, 300, 80).data
    let count = 0
    for (let yy = 0; yy < 80; yy++)
      for (let xx = 0; xx < 300; xx++) {
        if (Math.abs(120 + yy - 160) < 16) continue
        const o = (yy * 300 + xx) * 4
        if (data[o + 3] > 0 && data[o] < 80 && data[o + 1] < 80 && data[o + 2] < 80) count++
      }
    return count
  })
  expect(offLine).toBeGreaterThan(20)
})
