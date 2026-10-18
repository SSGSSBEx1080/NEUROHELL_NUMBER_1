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
