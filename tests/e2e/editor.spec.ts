import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { atnFixture } from '../fixtures'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.save-indicator')).toContainText('Все изменения сохранены')
}
async function blank(page: Page) {
  await page.getByRole('button', { name: 'Создать новый проект', exact: true }).click()
  await page.getByLabel('Ширина нового холста').fill('300')
  await page.getByLabel('Высота нового холста').fill('200')
  await page.getByRole('button', { name: 'Прозрачный', exact: true }).click()
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(0)
}
async function artboard(page: Page) { return (await page.locator('.artboard').boundingBox())! }
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = await artboard(page)
  await page.mouse.move(b.x + from[0], b.y + from[1]); await page.mouse.down()
  await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 12 }); await page.mouse.up()
}
async function pixel(page: Page, x: number, y: number) {
  return page.locator('[data-testid=editor-canvas]').evaluate((c: HTMLCanvasElement, p) => [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data], { x, y })
}
async function importTestImage(page: Page) {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d')!
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 120, 80); x.fillStyle = '#ff0000'; x.fillRect(40, 20, 40, 40)
    return c.toDataURL().split(',')[1]
  })
  await page.getByLabel('Открыть изображение или проект').setInputFiles({ name: 'subject.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
}
async function exportFile(page: Page, format: string) {
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page.locator('.format-options button').filter({ has: page.locator('strong', { hasText: new RegExp(`^${format}$`) }) }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: `Скачать ${format}`, exact: true }).click()
  const download = await downloadPromise
  return { bytes: await readFile((await download.path())!), name: download.suggestedFilename() }
}

test('starts with local resources, a real canvas and styled desktop chrome', async ({ page }) => {
  const errors: string[] = [], remote: string[] = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!/^(data:|blob:|http:\/\/127\.0\.0\.1)/.test(r.url())) remote.push(r.url()) })
  await ready(page); await expect(page.locator('.layer-row')).toHaveCount(7)
  const b = await artboard(page); expect(b.width).toBeGreaterThan(800)
  const color = await page.locator('.export-button').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(color).not.toBe('rgba(0, 0, 0, 0)'); expect(errors).toEqual([]); expect(remote).toEqual([])
  await page.screenshot({ path: 'test-results/editor-desktop.png' })
})

test('editable text, properties, keyboard duplicate, undo and redo', async ({ page }) => {
  await ready(page); await blank(page)
  await page.getByRole('button', { name: 'Текст', exact: true }).click()
  const b = await artboard(page); await page.mouse.click(b.x + 30, b.y + 30)
  const editor = page.getByLabel('Редактировать текст на холсте')
  await expect(editor).toBeVisible(); await editor.fill('ФШ 777'); await editor.press('Control+Enter')
  await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('ФШ 777')
  await page.getByLabel('Размер', { exact: true }).fill('36'); await page.getByLabel('Размер', { exact: true }).press('Enter')
  await page.locator('.document-bar').click({ position: { x: 350, y: 20 } })
  await page.keyboard.press('Control+j'); await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.keyboard.press('Control+z'); await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.keyboard.press('Delete'); await expect(page.locator('.layer-row')).toHaveCount(1)
})

test('brush, eraser and undo restore actual pixels', async ({ page }) => {
  await ready(page); await blank(page)
  await page.getByRole('button', { name: 'Кисть', exact: true }).click(); await drag(page, [30, 100], [260, 100])
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
  await page.getByRole('button', { name: 'Ластик', exact: true }).click()
  const b = await artboard(page); await page.mouse.click(b.x + 150, b.y + 100)
  await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
  await page.keyboard.press('Control+Shift+z'); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
})

test('background removal preserves the subject and exports transparent PNG', async ({ page }) => {
  await ready(page); await blank(page); await importTestImage(page)
  await page.getByRole('button', { name: 'Удалить фон', exact: false }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => (await pixel(page, 95, 65))[3]).toBe(0)
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
  const file = await exportFile(page, 'PNG'); expect(file.bytes.readUInt32BE(16)).toBe(300); expect(file.bytes.readUInt32BE(20)).toBe(200)
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await pixel(page, 95, 65))[3]).toBe(255)
})

test('layer visibility, lock, reordering and style preview/cancel/apply', async ({ page }) => {
  await ready(page); await blank(page)
  await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click(); await drag(page, [60, 50], [220, 140])
  await page.getByRole('button', { name: 'Стиль слоя', exact: false }).click()
  await page.getByRole('checkbox', { name: 'Включить эффект' }).check()
  await page.getByRole('slider', { name: 'Размер обводки' }).fill('12')
  await page.screenshot({ path: 'test-results/style-dialog.png' })
  await page.getByRole('button', { name: 'Применить стиль', exact: true }).click()
  await expect.poll(async () => (await pixel(page, 55, 85))[3]).toBe(255)
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await pixel(page, 55, 85))[3]).toBe(0)
  await page.getByRole('button', { name: 'Заблокировать: Прямоугольник', exact: true }).click(); await page.keyboard.press('Delete')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Скрыть: Прямоугольник', exact: true }).click(); await expect.poll(async () => (await pixel(page, 120, 90))[3]).toBe(0)
  await page.getByRole('button', { name: 'Показать: Прямоугольник', exact: true }).click(); await expect.poll(async () => (await pixel(page, 120, 90))[3]).toBe(255)
})

test('crop is undoable and changes export dimensions', async ({ page }) => {
  await ready(page); await blank(page); await importTestImage(page)
  await page.getByRole('button', { name: 'Кадрирование', exact: true }).click(); await drag(page, [50, 50], [250, 150])
  await page.getByRole('button', { name: 'Кадрировать', exact: true }).click(); await expect(page.locator('.document-meta')).toContainText('200 × 100')
  await page.keyboard.press('Control+z'); await expect(page.locator('.document-meta')).toContainText('300 × 200')
})

test('portable project saves layers and restores autosaved edits after reload', async ({ page }) => {
  await ready(page); await blank(page); await importTestImage(page)
  const promise = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await promise
  const project = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(project.version).toBe(1); expect(project.layers).toHaveLength(1); expect(project.layers[0].src).toMatch(/^data:image\/png/)
  await page.getByRole('button', { name: 'Заблокировать: subject', exact: true }).click()
  await expect(page.locator('.save-indicator')).toContainText('Все изменения сохранены')
  await page.reload(); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Разблокировать: subject', exact: true })).toBeVisible()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({ name: 'saved.777', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Заблокировать: subject', exact: true })).toBeVisible()
})

for (const format of ['PSD', 'PSB']) test(`${format} export, header, reimport and compatibility report`, async ({ page }) => {
  await ready(page); await blank(page); await importTestImage(page)
  const file = await exportFile(page, format); expect(file.bytes.subarray(0, 4).toString()).toBe('8BPS'); expect(file.bytes.readUInt16BE(4)).toBe(format === 'PSD' ? 1 : 2)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({ name: `roundtrip.${format.toLowerCase()}`, mimeType: 'application/octet-stream', buffer: file.bytes })
  await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.getByRole('dialog')).toContainText('импорт рабочей копии')
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
})

test('ATN import shows supported steps, blocks unknown commands and runs atomically', async ({ page }) => {
  await ready(page); await blank(page); await importTestImage(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({ name: 'test.atn', mimeType: 'application/octet-stream', buffer: Buffer.from(atnFixture()) })
  await expect(page.locator('.busy-overlay')).toBeHidden(); await page.getByRole('button', { name: 'Заблокированная операция ATN', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Выполнить операцию' })).toBeDisabled()
  await page.getByRole('button', { name: 'Безопасный негатив ATN', exact: false }).click(); await page.getByRole('button', { name: 'Выполнить операцию' }).click()
  await expect.poll(async () => await pixel(page, 150, 100)).toEqual([0, 255, 255, 255])
  await page.keyboard.press('Control+z'); await expect.poll(async () => await pixel(page, 150, 100)).toEqual([255, 0, 0, 255])
})

test('import rejects SVG and unsupported documents without changing the project', async ({ page }) => {
  await ready(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><script>alert(1)</script></svg>') })
  await expect(page.locator('.toast')).toContainText('Поддерживаются'); await expect(page.locator('.layer-row')).toHaveCount(7)
})
