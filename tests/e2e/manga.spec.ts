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
  await page
    .getByLabel('Открыть изображение или проект')
    .setInputFiles({
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
export { blank, outline }
