import { createRequire } from 'node:module'
const { textBlocksFixture } = createRequire(import.meta.url)('../fixtures/editor/text-blocks.cjs')
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { expect, test, type Page } from '@playwright/test'
async function blank(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.locator('.home-new').click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Название проекта', { exact: true }).fill('Макет тест')
  await modal.getByLabel('Ширина нового холста').fill('300')
  await modal.getByLabel('Высота нового холста').fill('200')
  await modal.getByRole('button', { name: 'Прозрачный', exact: true }).click()
  await modal.getByRole('button', { name: 'Создать проект', exact: true }).click()
  const encoded = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#f8f8f8'
    ctx.fillRect(0, 0, 300, 200)
    ctx.fillStyle = '#171717'
    ctx.fillRect(108, 80, 48, 17)
    ctx.strokeRect(30, 25, 240, 150)
    return c.toDataURL().split(',')[1]
  })
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'lettered.png',
    mimeType: 'image/png',
    buffer: Buffer.from(encoded, 'base64'),
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect.poll(() => pixels(page)).toEqual([23, 248])
}
async function outline(page: Page) {
  await page.keyboard.press('j')
  const b = (await page.locator('.artboard').boundingBox())!,
    scale = b.width / 300
  const path = [
    [100, 72],
    [164, 72],
    [164, 105],
    [100, 105],
    [100, 72],
  ]
  await page.mouse.move(b.x + path[0][0] * scale, b.y + path[0][1] * scale)
  await page.mouse.down()
  for (const [x, y] of path.slice(1))
    await page.mouse.move(b.x + x * scale, b.y + y * scale, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toContainText('Восстановление области')
}
async function pixels(page: Page) {
  return page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement) => {
    const x = c.getContext('2d')!
    return [x.getImageData(120, 85, 1, 1).data[0], x.getImageData(50, 50, 1, 1).data[0]]
  })
}
test('J restores outlined lettering on a separate layer; preview, cancellation and undo are real', async ({
  page,
}) => {
  await blank(page)
  const before = await pixels(page)
  expect(before).toEqual([23, 248])
  await outline(page)
  await expect(
    page.getByRole('button', { name: 'Применить на новый слой', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('[data-testid=repair-preview]')).toBeVisible()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await pixels(page)).toEqual(before)
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await outline(page)
  await page.getByRole('button', { name: 'Применить на новый слой', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect.poll(() => pixels(page)).toEqual([248, 248])
  await page.keyboard.press('Control+z')
  await expect.poll(() => pixels(page)).toEqual(before)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => pixels(page)).toEqual([248, 248])
})

test('J subtype and donor protection expose real settings and safe errors', async ({ page }) => {
  await blank(page)
  await page.keyboard.press('j')
  await page.keyboard.press('Shift+j')
  await expect(page.locator('[data-tool=repair-box]')).toHaveAttribute('aria-pressed', 'true')
  await outline(page)
  const modal = page.getByRole('dialog')
  await expect(
    modal.getByRole('button', { name: 'Применить на новый слой', exact: true }),
  ).toBeEnabled()
  await modal.getByLabel('Метод восстановления').selectOption('texture')
  await modal.getByLabel('Радиус заплатки', { exact: true }).fill('3')
  await modal.getByRole('button', { name: 'Зона образцов', exact: true }).click()
  await expect(modal).toContainText('Зелёный — разрешённые образцы')
  await modal.getByRole('button', { name: 'Зона образцов', exact: true }).click()
  await expect(
    modal.getByRole('button', { name: 'Применить на новый слой', exact: true }),
  ).toBeEnabled()
  await modal.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
})

initializeCanvas(
  () => {
    throw new Error('No DOM in verification')
  },
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  }),
)
async function savePsd(page: Page) {
  await page.getByTestId('canvas-viewport').focus()
  const downloading = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await downloading
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}

test('area text wraps with editable native PSD type and roundtrips its frame', async ({ page }) => {
  await blank(page)
  await page.keyboard.press('t')
  await page.keyboard.press('Shift+t')
  const b = (await page.locator('.artboard').boundingBox())!,
    s = b.width / 300
  await page.mouse.move(b.x + 75 * s, b.y + 45 * s)
  await page.mouse.down()
  await page.mouse.move(b.x + 225 * s, b.y + 160 * s, { steps: 8 })
  await page.mouse.up()
  const field = page.getByLabel('Текст слоя', { exact: true })
  await expect(field).toBeFocused()
  await field.fill('Это текстовый блок. Его нужно разместить в рамке.')
  await field.blur()
  await page.getByLabel('Режим текста').selectOption('ellipse')
  await expect(page.getByTestId('text-layout-status')).not.toContainText('Переполнение')
  const data = await savePsd(page),
    psd = readPsd(data, { useImageData: true, skipThumbnail: true })
  const type = psd.children?.find((l) => l.text)
  expect(type?.text?.text.replace(/\s/g, '')).toBe(
    'Это текстовый блок. Его нужно разместить в рамке.'.replace(/\s/g, ''),
  )
  expect(type?.text?.style?.fontSize).toBeLessThanOrEqual(29)
  expect(type?.text?.paragraphStyleRuns!.length).toBeGreaterThan(1)
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles({ name: 'layout-text.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: data })
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.locator('.layer-row').filter({ hasText: 'Текстовая рамка' }).click()
  await expect(page.getByLabel('Режим текста')).toHaveValue('ellipse')
  await expect(field).toHaveValue('Это текстовый блок. Его нужно разместить в рамке.')
  await page.getByLabel('Авторазмер по рамке', { exact: true }).uncheck()
  await page.getByLabel('Размер', { exact: true }).fill('80')
  await page.getByLabel('Размер', { exact: true }).blur()
  await expect(page.getByTestId('text-layout-status')).toContainText('Переполнение')
})

test('text collection is local, places linked type once, survives PSD and data exchange', async ({
  page,
}) => {
  await blank(page)
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить первый текстовый блок', exact: true }).click()
  await page.getByLabel('Исходный текст блока').fill('Исходный образец')
  await page.getByLabel('Содержимое текстового блока').fill('Текстовый блок')
  await page.getByLabel('Статус текстового блока').selectOption('checked')
  await page.getByRole('button', { name: 'Создать текстовый слой', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.getByLabel('Содержимое текстового блока').fill('Новое содержимое')
  await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  const data = await savePsd(page)
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'text-entries.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: data,
  })
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await expect(page.getByLabel('Содержимое текстового блока')).toHaveValue('Новое содержимое')
  await expect(page.getByLabel('Исходный текст блока')).toHaveValue('Исходный образец')
  await expect(page.getByLabel('Статус текстового блока')).toHaveValue('checked')
  const exporting = page.waitForEvent('download')
  await page
    .getByRole('region', { name: 'Текстовые блоки' })
    .getByRole('button', { name: 'Экспорт текстовых блоков', exact: true })
    .click()
  const downloaded = await exporting
  const bytes = await readFile((await downloaded.path())!)
  const exported = JSON.parse(bytes.toString())
  expect(exported.entries[0].layerId).toBeUndefined()
  await page
    .getByLabel('Импорт текстовых блоков')
    .setInputFiles({ name: 'exchange.777texts.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.locator('.text-entry-list > button')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Создать текстовый слой', exact: true }),
  ).toBeVisible()
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.text-entry-list > button')).toHaveCount(1)
})

async function beginRecording(page: Page, name = 'Макет — запись') {
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Наборы операций…', exact: true }).click()
  await page.getByLabel('Название новой записи').fill(name)
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Запись операции' })).toBeVisible()
}
async function actions(page: Page) {
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Наборы операций…', exact: true }).click()
}

test('real recording captures final property changes and duplicate; replay is one undo with editable validated steps', async ({
  page,
}) => {
  await blank(page)
  const initialX = Number(await page.getByLabel('X', { exact: true }).inputValue())
  await beginRecording(page)
  await page.getByLabel('X', { exact: true }).fill('25')
  await page.getByLabel('X', { exact: true }).fill('30')
  await expect(page.getByTestId('recorded-step-count')).toContainText('0 шагов')
  await page.getByLabel('X', { exact: true }).blur()
  await expect(page.getByTestId('recorded-step-count')).toContainText('1 шагов')
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press('Control+i')
  await page.keyboard.press('Control+j')
  await expect(page.getByTestId('recorded-step-count')).toContainText('3 шагов')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByLabel('Название операции', { exact: true })).toHaveValue('Макет — запись')
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать набор', exact: true }).click()
  const file = await saving
  const library = JSON.parse(await readFile((await file.path())!, 'utf8'))
  const recorded = library.actions.at(-1)
  expect(library.version).toBe(2)
  expect(recorded.steps.map((s: { command: { type: string } }) => s.command.type)).toEqual([
    'transform',
    'adjust',
    'duplicate',
  ])
  await page.getByRole('button', { name: 'Параметры шага 1', exact: true }).click()
  await page.getByLabel('Данные шага JSON').fill('{"type":"eval","code":"alert(1)"}')
  await page.getByRole('button', { name: 'Применить параметры', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('не поддерживается')
  await page.getByLabel('Данные шага JSON').fill(JSON.stringify(recorded.steps[0].command))
  await page.getByRole('button', { name: 'Применить параметры', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click()
  await page.getByTestId('canvas-viewport').focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(String(initialX))
  await actions(page)
  await page.getByRole('button', { name: 'Выполнить операцию', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('54')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(String(initialX))
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.layer-row')).toHaveCount(2)
})

test('recording marks selection and J unsupported instead of pretending to record pixels', async ({
  page,
}) => {
  await blank(page)
  await beginRecording(page, 'Неподдерживаемый J')
  await outline(page)
  await page.getByRole('button', { name: 'Применить на новый слой', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Запись операции' })).toContainText(
    '2 неподдерживаемых',
  )
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выполнить операцию', exact: true })).toBeDisabled()
  await expect(page.locator('.action-warning')).toContainText('ничего не будет молча пропущено')
  await expect(page.locator('.layer-row')).toHaveCount(2)
})

test('recording pause skips changes and an interrupted draft recovers as data, never auto-runs', async ({
  page,
}) => {
  await blank(page)
  await beginRecording(page, 'Восстановимая запись')
  await page.getByRole('button', { name: 'Пауза', exact: true }).click()
  await page.getByLabel('X', { exact: true }).fill('40')
  await page.getByLabel('X', { exact: true }).blur()
  await expect(page.getByTestId('recorded-step-count')).toContainText('0 шагов')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByLabel('X', { exact: true }).fill('50')
  await page.getByLabel('X', { exact: true }).blur()
  await expect(page.getByTestId('recorded-step-count')).toContainText('1 шагов')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('fsh777-action-recording') || '{}').actions?.[0]?.steps
            .length,
      ),
    )
    .toBe(1)
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
  await page.reload()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByTestId('restore-project').click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.getByRole('region', { name: 'Запись операции' })).toHaveCount(0)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('50')
  await actions(page)
  await expect(page.locator('.actions-list')).toContainText('Восстановленная запись 777')
  await expect(page.getByLabel('Название операции', { exact: true })).toHaveValue(
    'Восстановимая запись',
  )
  await page.getByRole('button', { name: 'Выполнить операцию', exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('60')
})

test('panels resize, dock left, float, retain the text-entry cursor and restore safely on a smaller display', async ({
  page,
}) => {
  await blank(page)
  const inspector = page.getByRole('complementary', { name: 'Свойства и слои' }),
    initial = (await inspector.boundingBox())!
  const handle = (await page
    .getByRole('separator', { name: 'Ширина панелей', exact: true })
    .boundingBox())!
  await page.mouse.move(handle.x + 3, handle.y + 120)
  await page.mouse.down()
  await page.mouse.move(handle.x - 57, handle.y + 120, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBe(initial.width + 60)
  const originalX = await page.getByLabel('X', { exact: true }).inputValue()
  await page.getByRole('separator', { name: 'Ширина панелей', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBe(initial.width + 70)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(originalX)
  const escapeHandle = (await page
    .getByRole('separator', { name: 'Ширина панелей', exact: true })
    .boundingBox())!
  await page.mouse.move(escapeHandle.x + 3, escapeHandle.y + 120)
  await page.mouse.down()
  await page.mouse.move(escapeHandle.x - 37, escapeHandle.y + 120, { steps: 3 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBe(initial.width + 70)
  await page.getByRole('tab', { name: 'Слой', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(originalX)
  const upper = page.locator('.dock-upper'),
    height = (await upper.boundingBox())!.height,
    divider = (await page.getByRole('separator', { name: 'Высота верхней панели' }).boundingBox())!
  await page.mouse.move(divider.x + 40, divider.y + 3)
  await page.mouse.down()
  await page.mouse.move(divider.x + 40, divider.y + 73, { steps: 6 })
  await page.mouse.up()
  expect((await upper.boundingBox())!.height).toBeGreaterThan(height + 45)
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить первый текстовый блок', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить текстовый блок', exact: true }).click()
  await page.getByLabel('Содержимое текстового блока').fill('Второй текстовый блок')
  await page.getByLabel('Содержимое текстового блока').blur()
  await page.getByRole('tab', { name: 'Слой', exact: true }).click()
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await expect(page.getByLabel('Содержимое текстового блока')).toHaveValue('Второй текстовый блок')
  await page.getByRole('button', { name: 'Панели слева', exact: true }).click()
  expect((await inspector.boundingBox())!.x).toBeLessThan(100)
  await page.getByRole('button', { name: 'Открепить панели', exact: true }).click()
  await expect(inspector).toHaveCSS('position', 'fixed')
  const before = (await inspector.boundingBox())!,
    grip = (await page
      .getByRole('button', { name: 'Переместить панели', exact: true })
      .boundingBox())!
  await page.mouse.move(grip.x + 5, grip.y + 5)
  await page.mouse.down()
  await page.mouse.move(grip.x - 75, grip.y + 35, { steps: 7 })
  await page.mouse.up()
  expect((await inspector.boundingBox())!.x).toBeCloseTo(before.x - 80, 0)
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
  await page.reload()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByTestId('restore-project').click()
  await expect(inspector).toHaveCSS('position', 'fixed')
  await page.setViewportSize({ width: 980, height: 720 })
  await expect
    .poll(async () => {
      const b = (await inspector.boundingBox())!
      return b.x + b.width <= 980 && b.y + b.height <= 720
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Сбросить рабочую среду', exact: true }).click()
  await expect(inspector).toHaveCSS('position', 'relative')
  await expect(page.getByLabel('Рабочая среда')).toHaveValue('standard')
})

test('synthetic fixture completes repair and linked text placement and exports independent-check fixtures', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'text-blocks.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(textBlocksFixture())),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(4)
  await page.getByLabel('Рабочая среда').selectOption('texts')
  await page.getByTestId('canvas-viewport').focus()
  const dark = () =>
    page.getByTestId('editor-canvas').evaluate((c: HTMLCanvasElement) => {
      const sx = c.width / 896,
        sy = c.height / 1200,
        data = c
          .getContext('2d')!
          .getImageData(
            Math.floor(135 * sx),
            Math.floor(175 * sy),
            Math.floor(185 * sx),
            Math.floor(105 * sy),
          ).data
      let n = 0
      for (let p = 0; p < data.length; p += 4) if (data[p] < 120 && data[p + 3] > 200) n++
      return n
    })
  await expect.poll(dark).toBeGreaterThan(50)
  await page.keyboard.press('j')
  const box = (await page.locator('.artboard').boundingBox())!,
    scale = box.width / 896
  await page.mouse.move(box.x + 125 * scale, box.y + 165 * scale)
  await page.mouse.down()
  for (const [x, y] of [
    [330, 165],
    [330, 280],
    [125, 280],
    [125, 165],
  ])
    await page.mouse.move(box.x + x * scale, box.y + y * scale, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByLabel('Под верхними текстовыми слоями')).not.toBeChecked()
  await page.getByLabel('Под верхними текстовыми слоями').check()
  await page.getByRole('button', { name: 'Применить на новый слой', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(5)
  await expect.poll(dark).toBe(0)
  await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
  await expect.poll(dark).toBeGreaterThan(50)
  await writeFile('test-results/text-block-workflow.psd', await savePsd(page))
  await page
    .locator('.header-actions')
    .getByRole('button', { name: 'Экспорт', exact: true })
    .click()
  await page
    .locator('.format-options button')
    .filter({ has: page.locator('strong', { hasText: /^PNG$/ }) })
    .click()
  const saving = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click()
  const download = await saving
  await writeFile('test-results/text-block-workflow.png', await readFile((await download.path())!))
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.screenshot({ path: 'test-results/text-block-workspace.png' })
})

test('donor strokes interpolate, Shift restores samples, preview slider avoids RGBA rewrites and reset recalculates', async ({
  page,
}) => {
  await blank(page)
  await outline(page)
  const apply = page.getByRole('button', { name: 'Применить на новый слой', exact: true }),
    preview = page.getByTestId('repair-preview')
  const sample = (x: number, y: number) =>
    preview.evaluate(
      (c: HTMLCanvasElement, [x, y]) =>
        Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data),
      [x, y],
    )
  await expect(apply).toBeEnabled()
  const range = page.getByLabel('Сравнение до и после')
  await range.focus()
  await page.keyboard.press('Home')
  await expect.poll(async () => (await sample(120, 85))[0]).toBe(248)
  await page.evaluate(() => {
    const w = window as typeof window & { __repairWrites: number }
    w.__repairWrites = 0
    const original = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      w.__repairWrites += args[0].width * args[0].height
      Reflect.apply(original, this, args)
    }
  })
  await page.keyboard.press('End')
  await expect.poll(async () => (await sample(120, 85))[0]).toBe(23)
  await page.keyboard.press('Home')
  await expect.poll(async () => (await sample(120, 85))[0]).toBe(248)
  expect(
    await page.evaluate(
      () => (window as typeof window & { __repairWrites: number }).__repairWrites,
    ),
  ).toBe(0)
  await page.getByRole('button', { name: 'Зона образцов', exact: true }).click()
  await expect
    .poll(async () => {
      const c = await sample(140, 50)
      return c[1] > c[0]
    })
    .toBe(true)
  await page.evaluate(
    () => ((window as typeof window & { __repairWrites: number }).__repairWrites = 0),
  )
  const b = (await preview.boundingBox())!,
    x = (n: number) => b.x + (n * b.width) / 300,
    y = b.y + (50 * b.height) / 200
  await page.mouse.move(x(50), y)
  await page.mouse.down()
  await page.mouse.move(x(230), y, { steps: 1 })
  await expect
    .poll(async () => {
      const c = await sample(140, 50)
      return c[0] > c[1]
    })
    .toBe(true)
  expect(
    await page.evaluate(
      () => (window as typeof window & { __repairWrites: number }).__repairWrites,
    ),
  ).toBeLessThan(30000)
  await page.mouse.up()
  await expect(apply).toBeEnabled()
  await page.keyboard.down('Shift')
  await page.mouse.move(x(140), y)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect
    .poll(async () => {
      const c = await sample(140, 50)
      return c[1] > c[0]
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Сбросить запреты образцов', exact: true }).click()
  await expect
    .poll(async () => {
      const c = await sample(60, 50)
      return c[1] > c[0]
    })
    .toBe(true)
  await expect(apply).toBeEnabled()
  await page.getByLabel('Под верхними текстовыми слоями').check()
  await expect(apply).toBeDisabled()
  await expect(apply).toBeEnabled()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(await pixels(page)).toEqual([23, 248])
})

test('cancelling active texture reconstruction terminates its actual worker without changing the document', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as typeof window & { __repairs: { started: number; terminated: number } }
    w.__repairs = { started: 0, terminated: 0 }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      repair: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.repair = String(url).includes('repair.worker')
        if (this.repair) w.__repairs.started++
      }
      terminate() {
        if (this.repair) w.__repairs.terminated++
        super.terminate()
      }
    }
  })
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 640
    const ctx = c.getContext('2d')!,
      im = ctx.createImageData(640, 640)
    for (let y = 0; y < 640; y++)
      for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 4,
          v = 80 + ((x * 17 + y * 37) % 176)
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v
        im.data[i + 3] = 255
      }
    ctx.putImageData(im, 0, 0)
    ctx.fillStyle = '#111'
    ctx.fillRect(170, 170, 300, 300)
    return c.toDataURL().split(',')[1]
  })
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'texture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const before = await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
      // Import hides its busy state before the scheduled scene frame. Capture
      // the rendered image, not the browser's initial 300x150 blank canvas.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return c.toDataURL()
    }),
    b = (await page.locator('.artboard').boundingBox())!,
    scale = b.width / 640
  await page.keyboard.press('j')
  await page.mouse.move(b.x + 170 * scale, b.y + 170 * scale)
  await page.mouse.down()
  for (const [x, y] of [
    [470, 170],
    [470, 470],
    [170, 470],
    [170, 170],
  ])
    await page.mouse.move(b.x + x * scale, b.y + y * scale, { steps: 3 })
  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __repairs: { started: number } }).__repairs.started,
      ),
    )
    .toBeGreaterThan(0)
  await expect(
    page.getByRole('button', { name: 'Применить на новый слой', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  const stats = await page.evaluate(
    () =>
      (window as typeof window & { __repairs: { started: number; terminated: number } }).__repairs,
  )
  expect(stats.terminated).toBe(stats.started)
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(
    await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
      // Import hides its busy state before the scheduled scene frame. Capture
      // the rendered image, not the browser's initial 300x150 blank canvas.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return c.toDataURL()
    }),
  ).toBe(before)
})

test('recording shortcut commits focused input, F-key replay works, and pending full-library recovery is not lost', async ({
  page,
}) => {
  await blank(page)
  await page.keyboard.press('Control+Alt+r')
  await page.getByLabel('Название новой записи').fill('Быстрая запись')
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
  const field = page.getByLabel('X', { exact: true }),
    before = Number(await field.inputValue())
  await field.fill(String(before + 10))
  await expect(page.getByTestId('recorded-step-count')).toHaveText('0 шагов')
  await page.keyboard.press('Control+Alt+r')
  const modal = page.getByRole('dialog')
  await expect(modal.locator('.action-step')).toHaveCount(1)
  await modal.getByLabel('Клавиша операции').selectOption('F8')
  await modal.getByRole('button', { name: 'Закрыть окно', exact: true }).click()
  await page.getByTestId('canvas-viewport').focus()
  await page.keyboard.press('Shift+F8')
  await expect(field).toHaveValue(String(before + 20))
  await page.keyboard.press('Control+z')
  await expect(field).toHaveValue(String(before + 10))
  await page.evaluate(() => {
    const action = (name: string) => ({
      name,
      steps: [{ name: 'Invert', enabled: true, command: { type: 'invert' } }],
    })
    localStorage.setItem(
      'fsh777-actions',
      JSON.stringify({
        version: 2,
        actions: Array.from({ length: 100 }, (_, i) => action('Операция ' + i)),
      }),
    )
    localStorage.setItem(
      'fsh777-action-recording',
      JSON.stringify({ version: 2, actions: [action('Не потерять черновик')] }),
    )
  })
  await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена')
  await page.reload()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByTestId('restore-project').click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.keyboard.press('Control+Alt+r')
  await expect(page.getByRole('alert')).toContainText('набор заполнен')
  expect(await page.evaluate(() => localStorage.getItem('fsh777-action-recording'))).toBeTruthy()
  await page.getByRole('button', { name: 'Удалить операцию', exact: true }).click()
  await expect(page.getByLabel('Название операции', { exact: true })).toHaveValue(
    'Не потерять черновик',
  )
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fsh777-action-recording')))
    .toBeNull()
  await expect(page.locator('.actions-list>button')).toHaveCount(100)
})

test('cold bundled fonts finish loading before a framed document opens or exports', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/fonts/catalog/oswald.ttf', async (route) => {
    await gate
    await route.continue()
  })
  const request = page.waitForRequest('**/fonts/catalog/oswald.ttf')
  const doc = {
    version: 1,
    id: 'font-cold-start',
    name: 'Cold font',
    width: 300,
    height: 200,
    background: 'transparent',
    layers: [
      {
        id: 'type',
        name: 'Framed Oswald',
        kind: 'text',
        x: 20,
        y: 20,
        width: 260,
        height: 150,
        text: 'WWW iii Первая отрисовка',
        fontFamily: 'Oswald',
        fontSize: 24,
        fontWeight: 600,
        textFrame: {
          shape: 'rectangle',
          padding: 8,
          autoFit: true,
          verticalAlign: 'middle',
          minFontSize: 8,
        },
      },
    ],
  }
  try {
    await page.getByLabel('Открыть изображение или проект').setInputFiles({
      name: 'cold-font.777',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    })
    await request
    await expect(page.locator('.busy-overlay')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть проект', exact: true })).toHaveCount(0)
  } finally {
    release()
  }
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(page.getByLabel('Шрифт', { exact: true })).toHaveValue('Oswald')
  expect(
    await page.evaluate(() => document.fonts.check('600 32px Oswald', 'WWW iii Первая отрисовка')),
  ).toBe(true)
  const c = page.getByTestId('editor-canvas')
  await expect
    .poll(() =>
      c.evaluate((canvas: HTMLCanvasElement) =>
        canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((v, i) => i % 4 === 3 && v > 0),
      ),
    )
    .toBe(true)
  const first = await c.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await page.evaluate(async () => {
    await document.fonts.ready
    window.dispatchEvent(new Event('fsh777-fonts-changed'))
    await new Promise(requestAnimationFrame)
  })
  expect(await c.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(first)
  const psd = readPsd(await savePsd(page), { useImageData: true, skipThumbnail: true })
  expect(psd.children?.find((l) => l.text)?.text?.style?.font?.name).toMatch(/Oswald/)
})
