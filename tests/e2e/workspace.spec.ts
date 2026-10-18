import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
initializeCanvas(() => { throw new Error('No native canvas required') }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }))
async function start(page: Page) { await page.goto('/'); await expect(page.locator('.busy-overlay')).toBeHidden() }
async function create(page: Page, name: string) {
  if (await page.getByTestId('home-screen').isVisible()) await page.locator('.home-new').click(); else await page.getByRole('button', { name: 'Создать новый проект', exact: true }).click()
  const modal = page.getByRole('dialog'); await modal.getByLabel('Название проекта', { exact: true }).fill(name)
  await modal.getByLabel('Ширина нового холста').fill('300'); await modal.getByLabel('Высота нового холста').fill('200'); await modal.getByRole('button', { name: 'Прозрачный', exact: true }).click(); await modal.getByRole('button', { name: 'Создать проект', exact: true }).click()
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
}
async function drag(page: Page, from: number[], to: number[]) { const b = (await page.locator('.artboard').boundingBox())!; await page.mouse.move(b.x + from[0], b.y + from[1]); await page.mouse.down(); await page.mouse.move(b.x + to[0], b.y + to[1], { steps: 8 }); await page.mouse.up(); await expect(page.locator('.busy-overlay')).toBeHidden() }
async function pixel(page: Page, x: number, y: number) { return page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement, p) => [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data], { x, y }) }
async function psd(page: Page) { const promise = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const d = await promise; expect(d.suggestedFilename()).toMatch(/\.psd$/); await expect(page.locator('.busy-overlay')).toBeHidden(); return readFile((await d.path())!) }
async function menu(page: Page, name: string) { await page.getByRole('button', { name: 'Слой', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click() }

test('home has no fabricated recents; recovery is offered, not silently opened; Konami is UI-only', async ({ page }) => {
  await start(page); await expect(page.getByTestId('home-screen')).toBeVisible(); await expect(page.locator('.recent-card')).toHaveCount(0)
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(key)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora'); await expect(page.locator('.recent-card')).toHaveCount(0)
  await create(page, 'Восстановление'); await page.keyboard.press('g'); await drag(page, [120, 90], [121, 90]); await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
  await page.reload(); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.getByTestId('home-screen')).toBeVisible(); await expect(page.getByTestId('editor-canvas')).toHaveCount(0)
  await page.getByTestId('restore-project').click(); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.locator('.layer-row')).toHaveCount(1); await expect.poll(async () => (await pixel(page, 120, 90))[3]).toBe(255)
  await page.getByRole('button', { name: 'На главную', exact: true }).click(); await expect(page.locator('.recent-card')).toHaveCount(1); await expect(page.locator('.recent-preview img')).toBeVisible()
})

test('document tabs retain independent undo stacks; image size is a real undoable operation', async ({ page }) => {
  await start(page); await create(page, 'Первый'); await page.keyboard.press('u'); await drag(page, [30, 30], [130, 100])
  await create(page, 'Второй'); await expect(page.locator('.layer-row')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true })).toBeDisabled()
  await page.locator('.document-tab.inactive').getByRole('button', { name: 'Первый.psd', exact: true }).click(); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.keyboard.press('Control+z'); await expect(page.locator('.layer-row')).toHaveCount(0); await page.keyboard.press('Control+Shift+z'); await expect(page.locator('.layer-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Изображение', exact: true }).click(); await page.getByRole('menuitem', { name: 'Размер изображения…', exact: true }).click()
  await page.getByLabel('Новая ширина').fill('600'); await page.getByRole('button', { name: 'Применить размер', exact: true }).click()
  await expect(page.locator('.document-meta')).toContainText('600 × 400'); await page.keyboard.press('Control+z'); await expect(page.locator('.document-meta')).toContainText('300 × 200')
  await page.getByRole('button', { name: 'Закрыть вкладку: Первый', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть вкладку', exact: true }).click(); await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.document-name')).toContainText('Второй'); await expect(page.locator('.layer-row')).toHaveCount(0)
})

test('groups collapse, duplicate and delete complete subtrees and export native children', async ({ page }) => {
  await start(page); await create(page, 'Группы'); await page.keyboard.press('u'); await drag(page, [30, 30], [130, 100]); await page.keyboard.press('u'); await drag(page, [150, 60], [260, 150])
  const rows = page.locator('.layer-row'); await rows.first().click(); await rows.last().click({ modifiers: ['Control'] }); await page.keyboard.press('Control+g')
  await expect(rows).toHaveCount(3); await expect(page.getByRole('button', { name: 'Свернуть группу: Группа' })).toBeVisible()
  const file = await psd(page), parsed = readPsd(file, { useImageData: true, skipThumbnail: true }); expect(parsed.children).toHaveLength(1); expect(parsed.children![0].children).toHaveLength(2)
  await page.getByRole('button', { name: 'Свернуть группу: Группа' }).click(); await expect(rows).toHaveCount(1)
  await page.keyboard.press('Control+j'); await expect(rows).toHaveCount(2); await page.keyboard.press('Control+z'); await expect(rows).toHaveCount(1)
  await page.keyboard.press('Delete'); await expect(rows).toHaveCount(0); await page.keyboard.press('Control+z'); await expect(rows).toHaveCount(1)
})

test('mask painting is nondestructive, undoable and removal is explicit', async ({ page }) => {
  await start(page); await create(page, 'Маска'); await page.keyboard.press('g'); await drag(page, [100, 100], [101, 100])
  await page.getByRole('button', { name: 'Добавить маску слоя', exact: true }).click(); await expect(page.locator('.busy-overlay')).toBeHidden()
  await drag(page, [60, 100], [240, 100]); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
  const file = await psd(page), parsed = readPsd(file, { useImageData: true, skipThumbnail: true }), layer = parsed.children![0]
  expect(layer.mask?.imageData).toBeTruthy(); expect(layer.imageData!.data[((100 - layer.top!) * layer.imageData!.width + 150 - layer.left!) * 4 + 3]).toBe(255)
  await page.keyboard.press('Control+z'); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
  await page.keyboard.press('Control+Shift+z'); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(0)
  await page.getByRole('button', { name: 'Удалить', exact: true }).click(); await expect(page.locator('.layer-mask-thumbnail')).toHaveCount(0); await expect.poll(async () => (await pixel(page, 150, 100))[3]).toBe(255)
})

test('smart-object content opens separately, applies atomically and writes a native linked PSD', async ({ page }) => {
  await start(page); await create(page, 'Смарт'); await page.keyboard.press('t'); const b = (await page.locator('.artboard').boundingBox())!; await page.mouse.click(b.x + 30, b.y + 30)
  const text = page.getByLabel('Текст слоя', { exact: true }); await text.fill('OLD'); await text.press('Control+Enter')
  await menu(page, 'Преобразовать в смарт-объект'); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.locator('.smart-thumbnail-mark')).toHaveCount(1)
  await page.getByRole('button', { name: 'Редактировать содержимое', exact: false }).click(); await expect(page.locator('.busy-overlay')).toBeHidden(); await expect(page.locator('.smart-document-bar')).toBeVisible()
  await text.fill('NEW'); await text.press('Control+Enter'); await page.getByRole('button', { name: 'Применить в документ · Ctrl+S', exact: true }).click(); await expect(page.locator('.busy-overlay')).toBeHidden()
  const parsed = readPsd(await psd(page), { useImageData: true, skipThumbnail: true }); expect(parsed.children![0].placedLayer).toBeTruthy(); const linked = parsed.linkedFiles!.find(l => l.data)!
  const inner = readPsd(linked.data!, { useImageData: true, skipThumbnail: true }); expect(inner.children!.some(l => l.text?.text === 'NEW')).toBe(true)
  await page.keyboard.press('Control+z'); const old = readPsd(await psd(page), { useImageData: true, skipThumbnail: true }); const oldInner = readPsd(old.linkedFiles!.find(l => l.data)!.data!, { useImageData: true, skipThumbnail: true }); expect(oldInner.children!.some(l => l.text?.text === 'OLD')).toBe(true)
})

test('clipping shares the base opacity and does not paint outside its alpha', async ({ page }) => {
  await start(page); await create(page, 'Обтравка'); await page.keyboard.press('u'); await drag(page, [50, 40], [170, 160])
  const opacity = page.locator('.layers-panel').getByLabel('Непр.', { exact: true }); await opacity.fill('50'); await opacity.press('Enter')
  await page.keyboard.press('u'); await drag(page, [100, 20], [240, 180]); await page.getByLabel('Цвет фигуры', { exact: true }).fill('#00ff00'); await page.locator('.workspace-status').click({ position: { x: 100, y: 15 } })
  await page.getByRole('checkbox', { name: 'Обтравка по нижнему слою', exact: true }).check(); await expect.poll(async () => pixel(page, 120, 100)).toEqual([0, 255, 0, 128]); await expect.poll(async () => (await pixel(page, 220, 100))[3]).toBe(0)
})

for (const transform of ['rotated', 'flipped', 'perspective']) test(`${transform} painted mask keeps native pixels and a real merged image for an independent reader`, async ({ page }) => {
  await start(page); await create(page, 'Native mask'); await page.keyboard.press('u'); await drag(page, [80, 50], [220, 150])
  await page.getByRole('button', { name: 'Добавить маску слоя', exact: true }).click(); await expect(page.locator('.busy-overlay')).toBeHidden(); await drag(page, [95, 60], [95, 140])
  await page.keyboard.press('v')
  if (transform === 'rotated') { await page.getByRole('spinbutton', { name: '∠', exact: true }).fill('30'); await page.getByRole('spinbutton', { name: '∠', exact: true }).press('Enter') }
  else if (transform === 'flipped') await page.getByRole('button', { name: 'Отразить по горизонтали', exact: true }).click()
  else { const handle = (await page.locator('[data-handle=ne]').boundingBox())!; await page.keyboard.down('Control'); await page.mouse.move(handle.x + 3, handle.y + 3); await page.mouse.down(); await page.mouse.move(handle.x - 15, handle.y + 25, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Control') }
  const bytes = await psd(page); await writeFile(`test-results/native-mask-${transform}.psd`, bytes)
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click(); const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click(); const png = await promise; await writeFile(`test-results/native-mask-${transform}.png`, await readFile((await png.path())!))
  const native = readPsd(bytes, { useImageData: true, skipThumbnail: true }); expect(native.imageResources?.versionInfo?.hasRealMergedData).toBe(true); expect(native.children![0].mask?.imageData).toBeTruthy()
})
