import { decodeProject } from '../../src/engine/psdMetadata'
import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import type { EditorDocument } from '../../src/types'
initializeCanvas(
  () => {
    throw new Error('No DOM in verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function open(page: Page, doc: EditorDocument) {
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
async function pixels(page: Page) {
  return page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data]
  })
}
async function source(page: Page) {
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const x = c.getContext('2d')!,
      p = x.createImageData(120, 80)
    for (let i = 0; i < p.data.length; i += 4) {
      const odd = (i / 4) % 2
      p.data[i] = odd ? 220 : 30
      p.data[i + 1] = odd ? 80 : 120
      p.data[i + 2] = odd ? 40 : 220
      p.data[i + 3] = 128
    }
    x.putImageData(p, 0, 0)
    return c.toDataURL()
  })
  const doc = newDocument(120, 80, 'Filter source', 'transparent')
  doc.layers = [
    makeLayer({ kind: 'image', name: 'Original', src, width: 120, height: 80, opacity: 0.75 }),
  ]
  return doc
}
test('command search uses actual actions, aliases, wrong keyboard layout and disabled-state guards', async ({
  page,
}) => {
  await ready(page)
  await open(page, newDocument(220, 140, 'Commands', '#204060'))
  await page.keyboard.press('Control+f')
  await expect(page.getByLabel('Найти команду')).toBeFocused()
  await page.getByLabel('Найти команду').fill('filter sharpen')
  await expect(page.getByRole('option', { name: /Растровые фильтры/ })).toBeDisabled()
  await page.getByLabel('Найти команду').fill('levels')
  await page.getByLabel('Найти команду').press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Тип коррекции')).toHaveValue('levels')
  await page.keyboard.press('Control+f')
  await page.getByLabel('Найти команду').fill('rhbdst')
  await page.getByLabel('Найти команду').press('Enter')
  await expect(page.getByLabel('Тип коррекции')).toHaveValue('curves')
  await expect(page.locator('.layer-row')).toHaveCount(2)
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('fsh777-command-recents')!)[0]),
  ).toBe('Коррекция:Кривые')
})
test('mask commands and Ctrl+I edit only mask pixels, keep native type and undo exactly', async ({
  page,
}) => {
  await ready(page)
  const mask = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 70
    const x = c.getContext('2d')!
    x.fillStyle = 'black'
    x.fillRect(0, 0, 240, 70)
    x.fillStyle = 'white'
    x.fillRect(0, 0, 120, 70)
    return c.toDataURL()
  })
  const doc = newDocument(360, 160, 'Mask commands', 'transparent')
  doc.layers = [
    makeLayer({
      kind: 'text',
      name: 'Masked type',
      text: 'Маска текста',
      x: 20,
      y: 50,
      width: 240,
      height: 70,
      fontFamily: 'Manrope',
      fontSize: 36,
      color: '#ffffff',
      mask: {
        src: mask,
        x: 20,
        y: 50,
        width: 240,
        height: 70,
        enabled: true,
        linked: true,
        density: 1,
        feather: 0,
        defaultColor: 0,
      },
    }),
  ]
  await open(page, doc)
  await page.getByRole('button', { name: 'Редактировать маску: Masked type', exact: true }).click()
  await page.keyboard.press('Control+i')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  let psd = readPsd(await save(page), { useImageData: true })
  expect(psd.children![0].text?.text).toBe('Маска текста')
  expect(psd.children![0].mask?.defaultColor).toBe(255)
  expect(psd.children![0].mask?.imageData?.data[0]).toBe(0)
  await page.getByRole('button', { name: 'Маска: проявить всё', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const revealed = await pixels(page)
  psd = readPsd(await save(page), { useImageData: true })
  expect(psd.children![0].text).toBeTruthy()
  expect([...psd.children![0].mask!.imageData!.data].every((v) => v === 255)).toBe(true)
  await page.getByRole('button', { name: 'Маска: скрыть всё', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  expect((await pixels(page)).filter((_, i) => i % 4 === 3).every((v) => v === 0)).toBe(true)
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  expect(await pixels(page)).toEqual(revealed)
})
test('filter preview is cached; selection-limited copy retains the hidden source and exact transparency', async ({
  page,
}) => {
  await ready(page)
  await open(page, await source(page))
  const original = readPsd(await save(page), { useImageData: true }),
    before = await pixels(page)
  await page.keyboard.press('m')
  const box = (await page.getByTestId('editor-canvas').boundingBox())!
  await page.mouse.move(box.x + 1, box.y + 1)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 79, { steps: 4 })
  await page.mouse.up()
  await menu(page, 'Фильтры', 'Растровые фильтры на копии…')
  await page.getByLabel('Растровый фильтр').selectOption('mosaic')
  await page.getByLabel('Размер ячейки', { exact: true }).fill('10')
  await expect(page.getByRole('button', { name: 'Применить на копии', exact: true })).toBeEnabled()
  await page.getByTestId('filter-after').evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  })
  await page.evaluate(() => {
    ;(window as any).__filterDraws = 0
    const draw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.dataset.testid === 'filter-after')
        (window as any).__filterDraws++
      return (draw as any).apply(this, args)
    }
  })
  await page.getByRole('slider', { name: 'Сравнение фильтра', exact: true }).focus()
  await page.keyboard.press('End')
  expect(await page.evaluate(() => (window as any).__filterDraws)).toBe(0)
  expect(await pixels(page)).toEqual(before)
  await page.getByRole('button', { name: 'Применить на копии', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.layer-row')).toHaveCount(2)
  const after = await pixels(page),
    left = (40 * 120 + 20) * 4,
    right = (40 * 120 + 81) * 4
  expect(after.slice(left, left + 3)).not.toEqual(before.slice(left, left + 3))
  expect(after.slice(right, right + 4)).toEqual(before.slice(right, right + 4))
  for (let i = 3; i < after.length; i += 4) expect(after[i]).toBe(before[i])
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true })
  expect(psd.children![0].hidden).toBe(true)
  expect(psd.children![0].imageData?.data).toEqual(original.children![0].imageData?.data)
  expect(psd.children![1].placedLayer).toBeUndefined()
  await writeFile('test-results/raster-filter-copy.psd', bytes)
  const png = await page
    .getByTestId('editor-canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL().split(',')[1])
  await writeFile('test-results/raster-filter-copy.png', Buffer.from(png, 'base64'))
  await page.keyboard.press('Control+z')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(await pixels(page)).toEqual(before)
})
test('all six raster filters run, noise preview is deterministic and cancelling never creates a layer', async ({
  page,
}) => {
  await ready(page)
  await open(page, await source(page))
  const before = await pixels(page)
  await menu(page, 'Фильтры', 'Растровые фильтры на копии…')
  for (const type of ['unsharp', 'highpass', 'median', 'noise', 'mosaic', 'edges']) {
    await page.getByLabel('Растровый фильтр').selectOption(type)
    await expect(
      page.getByRole('button', { name: 'Применить на копии', exact: true }),
    ).toBeEnabled()
    expect(await pixels(page)).toEqual(before)
  }
  await page.getByLabel('Растровый фильтр').selectOption('noise')
  await expect(page.getByRole('button', { name: 'Применить на копии', exact: true })).toBeEnabled()
  const first = await page.getByTestId('filter-after').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return c.toDataURL()
  })
  await page.getByLabel('Зерно генератора', { exact: true }).fill('123')
  await expect(page.getByRole('button', { name: 'Применить на копии', exact: true })).toBeEnabled()
  await page.getByLabel('Зерно генератора', { exact: true }).fill('777')
  await expect(page.getByRole('button', { name: 'Применить на копии', exact: true })).toBeEnabled()
  expect(
    await page.getByTestId('filter-after').evaluate(async (c: HTMLCanvasElement) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return c.toDataURL()
    }),
  ).toBe(first)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(await pixels(page)).toEqual(before)
})
test('filtering a smart object makes an explicit raster copy and preserves its original native embedded PSD', async ({
  page,
}) => {
  await ready(page)
  await open(page, await source(page))
  await menu(page, 'Слой', 'Преобразовать в смарт-объект')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await menu(page, 'Фильтры', 'Растровые фильтры на копии…')
  await page.getByLabel('Растровый фильтр').selectOption('noise')
  await page.getByRole('button', { name: 'Применить на копии', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const psd = readPsd(await save(page), { useImageData: true })
  expect(psd.children![0].placedLayer).toBeTruthy()
  expect(psd.children![0].hidden).toBe(true)
  expect(psd.children![1].placedLayer).toBeUndefined()
  const inner = readPsd(
    psd.linkedFiles!.find((f) => f.id === psd.children![0].placedLayer!.id)!.data!,
    { useImageData: true },
  )
  expect(inner.children?.[0].imageData).toBeTruthy()
})

test('identity filtering preserves live blur, flip, rotation and linked mask without flattening the original', async ({
  page,
}) => {
  await ready(page)
  const doc = await source(page)
  doc.width = 240
  doc.height = 180
  const mask = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const x = c.getContext('2d')!
    const g = x.createLinearGradient(0, 0, 120, 0)
    g.addColorStop(0, '#000000')
    g.addColorStop(1, '#ffffff')
    x.fillStyle = g
    x.fillRect(0, 0, 120, 80)
    return c.toDataURL()
  })
  doc.layers[0] = {
    ...doc.layers[0],
    x: 50,
    y: 40,
    rotation: 17,
    flipX: true,
    mask: {
      src: mask,
      x: 50,
      y: 40,
      width: 120,
      height: 80,
      enabled: true,
      linked: true,
      density: 0.9,
      feather: 2,
      defaultColor: 0,
    },
    adjustments: { ...doc.layers[0].adjustments, blur: 3, hue: 24 },
  }
  await open(page, doc)
  const before = await pixels(page)
  await menu(page, 'Фильтры', 'Растровые фильтры на копии…')
  await page.getByLabel('Растровый фильтр').selectOption('noise')
  await page.getByLabel('Количество шума, %', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Применить на копии', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const after = await pixels(page)
  let worst = 0
  for (let i = 0; i < before.length; i += 4) {
    worst = Math.max(worst, Math.abs(before[i + 3] - after[i + 3]))
    for (let c = 0; c < 3; c++)
      worst = Math.max(
        worst,
        Math.abs((before[i + c] * before[i + 3]) / 255 - (after[i + c] * after[i + 3]) / 255),
      )
  }
  const model = decodeProject(
    readPsd(await save(page), { useImageData: true }).imageResources?.xmpMetadata,
  ) as EditorDocument
  expect(model.layers[0].src).toBe(model.layers[1].src)
  expect(worst).toBeLessThanOrEqual(2)
})

test('explicit rasterization includes blurred image bounds instead of clipping its halo', async ({
  page,
}) => {
  await ready(page)
  const doc = await source(page)
  doc.width = 240
  doc.height = 180
  doc.layers[0] = {
    ...doc.layers[0],
    x: 50,
    y: 40,
    adjustments: { ...doc.layers[0].adjustments, blur: 4 },
  }
  await open(page, doc)
  const before = await pixels(page)
  await menu(page, 'Слой', 'Растрировать содержимое')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const after = await pixels(page)
  let worst = 0
  for (let i = 0; i < before.length; i += 4) {
    worst = Math.max(worst, Math.abs(before[i + 3] - after[i + 3]))
    for (let c = 0; c < 3; c++)
      worst = Math.max(
        worst,
        Math.abs((before[i + c] * before[i + 3]) / 255 - (after[i + c] * after[i + 3]) / 255),
      )
  }
  expect(worst).toBeLessThanOrEqual(2)
  await expect(page.getByLabel('Ш', { exact: true })).toHaveValue('148')
})

test('liquify forward warp drags the edge on an explicit copy and leaves the original intact', async ({
  page,
}) => {
  await ready(page)
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const x = c.getContext('2d')!,
      p = x.createImageData(120, 80)
    for (let yy = 0; yy < 80; yy++)
      for (let xx = 0; xx < 120; xx++) {
        const i = (yy * 120 + xx) * 4,
          v = xx < 60 ? 0 : 255
        p.data[i] = p.data[i + 1] = p.data[i + 2] = v
        p.data[i + 3] = 255
      }
    x.putImageData(p, 0, 0)
    return c.toDataURL()
  })
  const base = newDocument(120, 80, 'Пластика', 'transparent')
  base.layers = [makeLayer({ kind: 'image', name: 'Край', src, width: 120, height: 80 })]
  await open(page, base)
  await menu(page, 'Фильтры', 'Пластика на копии…')
  await page.getByLabel('Размер кисти', { exact: true }).fill('50')
  await page.getByLabel('Плотность', { exact: true }).fill('100')
  const box = await page.getByTestId('liquify-canvas').boundingBox()
  // The view scales 120x80 down; map natural (30..80, 40) through the box.
  const sx = box!.width / 120,
    y = box!.y + 40 * sx
  await page.mouse.move(box!.x + 30 * sx, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + 85 * sx, y, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Применить копию', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Применить копию', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.layer-row')).toHaveCount(2)
  await expect(page.locator('.layer-row').filter({ hasText: 'Край · Пластика' })).toHaveCount(1)
  const after = await pixels(page),
    moved = (40 * 120 + 70) * 4,
    corner = (2 * 120 + 70) * 4
  // Near the stroke the black half was dragged past x=70; far from it the
  // edge stays at x=60 so x=70 remains white.
  expect(after[moved]).toBeLessThan(60)
  expect(after[corner]).toBe(255)
})
