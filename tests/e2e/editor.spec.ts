import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { atnFixture } from '../fixtures'

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
async function artboard(page: Page) {
  return (await page.locator('.artboard').boundingBox())!
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = await artboard(page)
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
async function importTestImage(page: Page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const x = c.getContext('2d')!
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, 120, 80)
    x.fillStyle = '#ff0000'
    x.fillRect(40, 20, 40, 40)
    return c.toDataURL().split(',')[1]
  })
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'subject.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
}
async function exportFile(page: Page, format: string) {
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page
    .locator('.format-options button')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${format}$`) }) })
    .click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: `Скачать ${format}`, exact: true }).click()
  const download = await downloadPromise
  await expect(page.getByRole('dialog')).toBeHidden()
  return { bytes: await readFile((await download.path())!), name: download.suggestedFilename() }
}

test('starts with local resources, a real canvas and styled desktop chrome', async ({ page }) => {
  const errors: string[] = [],
    remote: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (!/^(data:|blob:|http:\/\/127\.0\.0\.1)/.test(r.url())) remote.push(r.url())
  })
  await ready(page)
  await expect(page.locator('.layer-row')).toHaveCount(7)
  const b = await artboard(page)
  expect(b.width).toBeGreaterThan(800)
  const color = await page
    .locator('.export-button')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(color).not.toBe('rgba(0, 0, 0, 0)')
  expect(errors).toEqual([])
  expect(remote).toEqual([])
  await page.screenshot({ path: 'test-results/editor-desktop.png' })
})

test('editable text, properties, keyboard duplicate, undo and redo', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Текст', exact: true }).click()
  const b = await artboard(page)
  await page.mouse.click(b.x + 30, b.y + 30)
  const editor = page.getByLabel('Текст слоя', { exact: true })
  await expect(editor).toBeVisible()
  await editor.fill('ФШ 777')
  await editor.press('Control+Enter')
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('ФШ 777')
  await page.getByLabel('Размер', { exact: true }).fill('36')
  await page.getByLabel('Размер', { exact: true }).press('Enter')
  await page.locator('.document-bar').click({ position: { x: 350, y: 20 } })
  await page.keyboard.press('Control+j')
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(page.locator('.layer-row')).toHaveCount(1)
})

test('brush, eraser and undo restore actual pixels', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Кисть', exact: true }).click()
  await drag(page, [30, 100], [260, 100])
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
  await page.getByRole('button', { name: 'Ластик', exact: true }).click()
  const b = await artboard(page)
  await page.mouse.click(b.x + 150, b.y + 100)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
})

test('background removal preserves the subject and exports transparent PNG', async ({ page }) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  await page.getByRole('button', { name: 'Удалить фон', exact: false }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => (await pixel(page, 95, 65))[3]).toBe(0)
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
  const file = await exportFile(page, 'PNG')
  expect(file.bytes.readUInt32BE(16)).toBe(300)
  expect(file.bytes.readUInt32BE(20)).toBe(200)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pixel(page, 95, 65))[3]).toBe(255)
})

test('layer visibility, lock, reordering and style preview/cancel/apply', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [60, 50], [220, 140])
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('12')
  await page.screenshot({ path: 'test-results/style-dialog.png' })
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 55, 85))[3]).toBe(255)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await pixel(page, 55, 85))[3]).toBe(0)
  await page.getByRole('button', { name: 'Заблокировать: Прямоугольник', exact: true }).click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Скрыть: Прямоугольник', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 120, 90))[3]).toBe(0)
  await page.getByRole('button', { name: 'Показать: Прямоугольник', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 120, 90))[3]).toBe(255)
})

test('crop is undoable and changes export dimensions', async ({ page }) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  await page.getByRole('button', { name: 'Кадрирование', exact: true }).click()
  await drag(page, [50, 50], [250, 150])
  await page.getByRole('button', { name: 'Кадрировать', exact: true }).click()
  await expect(page.locator('.document-meta')).toContainText('200 × 100')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.document-meta')).toContainText('300 × 200')
})

test('portable project saves layers and restores autosaved edits after reload', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  const standard = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const psd = await standard
  expect(psd.suggestedFilename()).toMatch(/\.psd$/)
  expect((await readFile((await psd.path())!)).subarray(0, 4).toString()).toBe('8BPS')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const promise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Резервная копия (старый .777)', exact: true }).click()
  const download = await promise
  const project = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(project.version).toBe(1)
  expect(project.layers).toHaveLength(1)
  expect(project.layers[0].src).toMatch(/^data:image\/png/)
  await page.getByRole('button', { name: 'Заблокировать: subject', exact: true }).click()
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
  await page.reload()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByTestId('restore-project').click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Разблокировать: subject', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'saved.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Заблокировать: subject', exact: true }),
  ).toBeVisible()
})

for (const format of ['PSD', 'PSB'])
  test(`${format} export, header, reimport and compatibility report`, async ({ page }) => {
    await ready(page)
    await blank(page)
    await importTestImage(page)
    const file = await exportFile(page, format)
    expect(file.bytes.subarray(0, 4).toString()).toBe('8BPS')
    expect(file.bytes.readUInt16BE(4)).toBe(format === 'PSD' ? 1 : 2)
    await page.getByLabel('Открыть изображение или проект').setInputFiles({
      name: `roundtrip.${format.toLowerCase()}`,
      mimeType: 'application/octet-stream',
      buffer: file.bytes,
    })
    await expect(page.locator('.busy-overlay')).toBeHidden()
    await expect(page.getByRole('dialog')).toContainText('импорт рабочей копии')
    await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
    await expect(page.locator('.layer-row')).toHaveCount(1)
    await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
  })

test('ATN import shows supported steps, blocks unknown commands and runs atomically', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'test.atn',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(atnFixture()),
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByRole('button', { name: 'Заблокированная операция ATN', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Выполнить операцию' })).toBeDisabled()
  await page.getByRole('button', { name: 'Безопасный негатив ATN', exact: false }).click()
  await page.getByRole('button', { name: 'Выполнить операцию' }).click()
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([0, 255, 255, 255])
  await page.keyboard.press('Control+z')
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
})

test('import rejects SVG and unsupported documents without changing the project', async ({
  page,
}) => {
  await ready(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
  })
  await expect(page.locator('.toast')).toContainText('Поддерживаются')
  await expect(page.locator('.layer-row')).toHaveCount(7)
})

test('color picker accepts exact HEX and updates a vector layer', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [50, 50], [220, 140])
  await page.getByRole('button', { name: 'Выбрать основной цвет', exact: true }).click()
  await page.getByLabel('HEX цвета').fill('#12AB34')
  await page.getByRole('button', { name: 'Применить цвет' }).click()
  await expect.poll(async () => await pixel(page, 120, 90)).toEqual([18, 171, 52, 255])
})

test('copy/paste and merging produce editable, undoable real layers', async ({ page }) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.keyboard.press('Control+Shift+e')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.layer-name')).toHaveText('Объединённые слои')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(2)
})

test('cancelled style edits do not mutate the layer and tablet chrome stays usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await ready(page)
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })).toBeDisabled()
  await expect(page.locator('.small-screen-note')).toBeHidden()
  expect((await artboard(page)).width).toBeGreaterThan(500)
})

test('Alt-drag duplicates a layer in one undoable gesture', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [50, 50], [150, 130])
  await page.keyboard.down('Alt')
  await drag(page, [80, 80], [130, 100])
  await page.keyboard.up('Alt')
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect(page.locator('.layer-row.selected .layer-name')).toHaveText('Прямоугольник — копия')
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('100')
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('70')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.layer-row')).toHaveCount(2)
})

test('corner resize is proportional by default and free with Shift', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [50, 50], [150, 100])
  const resize = async (dx: number, dy: number) => {
    const h = (await page.locator('[data-handle=se]').boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 8 })
    await page.mouse.up()
  }
  await resize(100, 10)
  const width = Number(await page.getByRole('spinbutton', { name: 'Ш', exact: true }).inputValue()),
    height = Number(await page.getByRole('spinbutton', { name: 'В', exact: true }).inputValue())
  expect(width).toBeCloseTo(200, 0)
  expect(width / height).toBeCloseTo(2, 2)
  await page.keyboard.down('Shift')
  await resize(30, 10)
  await page.keyboard.up('Shift')
  const nextW = Number(await page.getByRole('spinbutton', { name: 'Ш', exact: true }).inputValue()),
    nextH = Number(await page.getByRole('spinbutton', { name: 'В', exact: true }).inputValue())
  expect(nextW).toBeCloseTo(230, 0)
  expect(nextH).toBeCloseTo(110, 0)
})

test('Ctrl corner distortion changes real pixels and survives PSD export', async ({ page }) => {
  await ready(page)
  await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click()
  await drag(page, [50, 50], [150, 150])
  const h = (await page.locator('[data-handle=ne]').boundingBox())!
  await page.keyboard.down('Control')
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 - 20, h.y + h.height / 2 + 30, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect.poll(async () => (await pixel(page, 140, 60))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 80, 100))[3]).toBe(255)
  await expect(page.getByRole('button', { name: 'Сбросить перспективу' })).toBeVisible()
  const file = await exportFile(page, 'PSD')
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'perspective.psd',
    mimeType: 'application/octet-stream',
    buffer: file.bytes,
  })
  await page.getByRole('button', { name: 'Открыть рабочую копию' }).click()
  await expect.poll(async () => (await pixel(page, 140, 60))[3]).toBe(0)
  await expect.poll(async () => (await pixel(page, 80, 100))[3]).toBe(255)
})

async function decodedFile(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(
    async ({ data, mime }) => {
      const image = new Image()
      image.src = `data:${mime};base64,${data}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return {
        width: image.width,
        height: image.height,
        corner: [...ctx.getImageData(5, 5, 1, 1).data],
        subject: [...ctx.getImageData(image.width / 2, image.height / 2, 1, 1).data],
      }
    },
    { data: bytes.toString('base64'), mime },
  )
}
for (const format of ['JPG', 'WEBP'])
  test(`${format} export writes decodable pixels, dimensions and correct background`, async ({
    page,
  }) => {
    await ready(page)
    await blank(page)
    await importTestImage(page)
    const file = await exportFile(page, format)
    const decoded = await decodedFile(
      page,
      file.bytes,
      format === 'JPG' ? 'image/jpeg' : 'image/webp',
    )
    expect(decoded.width).toBe(300)
    expect(decoded.height).toBe(200)
    expect(decoded.subject[0]).toBeGreaterThan(245)
    expect(decoded.subject[1]).toBeLessThan(10)
    expect(decoded.subject[3]).toBe(255)
    if (format === 'JPG') {
      expect(file.bytes.readUInt16BE(0)).toBe(0xffd8)
      expect(decoded.corner).toEqual([255, 255, 255, 255])
    } else {
      expect(file.bytes.toString('ascii', 8, 12)).toBe('WEBP')
      expect(decoded.corner[3]).toBe(0)
    }
  })

test('opaque PNG option really flattens transparency and 2x export doubles dimensions', async ({
  page,
}) => {
  await ready(page)
  await blank(page)
  await importTestImage(page)
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Прозрачный холст' }).uncheck()
  await page.getByLabel('Масштаб экспорта').selectOption('2')
  const promise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click()
  const download = await promise
  await expect(page.getByRole('dialog')).toBeHidden()
  const decoded = await decodedFile(page, await readFile((await download.path())!), 'image/png')
  expect(decoded.width).toBe(600)
  expect(decoded.height).toBe(400)
  expect(decoded.corner).toEqual([255, 255, 255, 255])
  expect(decoded.subject).toEqual([255, 0, 0, 255])
})
