import { readFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { expect, test, type Page } from '@playwright/test'
async function blank(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.locator('.home-new').click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Название проекта', { exact: true }).fill('Манга тест')
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
  await page.locator('.document-bar').click({ position: { x: 300, y: 15 } })
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
  await field.fill('Это новая реплика. Её нужно аккуратно разместить в пузыре.')
  await field.blur()
  await page.getByLabel('Режим текста').selectOption('ellipse')
  await expect(page.getByTestId('text-layout-status')).not.toContainText('Переполнение')
  const data = await savePsd(page),
    psd = readPsd(data, { useImageData: true, skipThumbnail: true })
  const type = psd.children?.find((l) => l.text)
  expect(type?.text?.text.replace(/\s/g, '')).toBe(
    'Это новая реплика. Её нужно аккуратно разместить в пузыре.'.replace(/\s/g, ''),
  )
  expect(type?.text?.style?.fontSize).toBeLessThanOrEqual(29)
  expect(type?.text?.paragraphStyleRuns!.length).toBeGreaterThan(1)
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles({ name: 'manga-text.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: data })
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.locator('.layer-row').filter({ hasText: 'Реплика' }).click()
  await expect(page.getByLabel('Режим текста')).toHaveValue('ellipse')
  await expect(field).toHaveValue('Это новая реплика. Её нужно аккуратно разместить в пузыре.')
  await page.getByLabel('Авторазмер по рамке', { exact: true }).uncheck()
  await page.getByLabel('Размер', { exact: true }).fill('80')
  await page.getByLabel('Размер', { exact: true }).blur()
  await expect(page.getByTestId('text-layout-status')).toContainText('Переполнение')
})

test('translation script is local, places linked type once, survives PSD and data exchange', async ({
  page,
}) => {
  await blank(page)
  await page.getByRole('tab', { name: 'Перевод', exact: true }).click()
  await page.getByRole('button', { name: 'Первая реплика', exact: true }).click()
  await page.getByLabel('Оригинал реплики').fill('こんにちは')
  await page.getByLabel('Перевод реплики').fill('Привет, мир!')
  await page.getByLabel('Статус перевода').selectOption('proofread')
  await page.getByRole('button', { name: 'Создать текстовый слой', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await page.getByLabel('Перевод реплики').fill('До встречи!')
  await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  const data = await savePsd(page)
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles({ name: 'script.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: data })
  await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByRole('tab', { name: 'Перевод', exact: true }).click()
  await expect(page.getByLabel('Перевод реплики')).toHaveValue('До встречи!')
  await expect(page.getByLabel('Оригинал реплики')).toHaveValue('こんにちは')
  await expect(page.getByLabel('Статус перевода')).toHaveValue('proofread')
  const exporting = page.waitForEvent('download')
  await page
    .getByRole('region', { name: 'Сценарий перевода' })
    .getByRole('button', { name: 'Экспорт', exact: true })
    .click()
  const downloaded = await exporting
  const bytes = await readFile((await downloaded.path())!)
  const exported = JSON.parse(bytes.toString())
  expect(exported.entries[0].layerId).toBeUndefined()
  await page
    .getByLabel('Импорт сценария')
    .setInputFiles({ name: 'exchange.777script.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.locator('.script-list > button')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Создать текстовый слой', exact: true }),
  ).toBeVisible()
  await page.locator('.document-bar').click({ position: { x: 300, y: 15 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.script-list > button')).toHaveCount(1)
})

async function beginRecording(page: Page, name = 'Манга — запись') {
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
  await page.locator('.document-bar').click({ position: { x: 300, y: 15 } })
  await page.keyboard.press('Control+i')
  await page.keyboard.press('Control+j')
  await expect(page.getByTestId('recorded-step-count')).toContainText('3 шагов')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByLabel('Название операции', { exact: true })).toHaveValue('Манга — запись')
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
  await page.locator('.document-bar').click({ position: { x: 300, y: 15 } })
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

test('recording marks unsupported J instead of pretending to record pixels', async ({ page }) => {
  await blank(page)
  await beginRecording(page, 'Неподдерживаемый J')
  await outline(page)
  await page.getByRole('button', { name: 'Применить на новый слой', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Запись операции' })).toContainText(
    '1 неподдерживаемых',
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
