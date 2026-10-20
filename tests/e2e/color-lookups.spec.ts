import { withoutXmpResource } from '../../src/engine/psdBinary'
import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { identityCube, parseCubeFile, serializeCube } from '../../src/engine/colorLut'
import { defaultCorrection } from '../../src/engine/adjustmentTypes'
import type { EditorDocument } from '../../src/types'
initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function open(page: Page, doc: EditorDocument) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: doc.name + '.777',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  })
  await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function fixture(page: Page, name: string) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 128
    const ctx = c.getContext('2d')!,
      p = ctx.createImageData(256, 128)
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4
        p.data[i] = x
        p.data[i + 1] = y * 2
        p.data[i + 2] = 255 - x
        p.data[i + 3] = y < 64 ? 128 : 255
      }
    ctx.putImageData(p, 0, 0)
    return c.toDataURL()
  })
  const doc = newDocument(256, 128, name, 'transparent')
  doc.layers = [makeLayer({ name: 'Original RGB', kind: 'image', width: 256, height: 128, src })]
  await open(page, doc)
  return doc
}
async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const e = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const d = await e
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await d.path())!)
}
async function png(page: Page) {
  return Buffer.from(
    await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return c.toDataURL().split(',')[1]
    }),
    'base64',
  )
}
async function nativeOnly(page: Page, bytes: Buffer) {
  const buffer = withoutXmpResource(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'native-color-only.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: Buffer.from(buffer),
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
}

test('RGB photo filter stays native, preserves source and alpha, and edits without XMP', async ({
  page,
}) => {
  await fixture(page, 'Native photo filter')
  await menu(page, 'Коррекция', 'Фотофильтр')
  await page.getByLabel('Цвет фотофильтра', { exact: true }).fill('#f09950')
  await page.getByLabel('Плотность фотофильтра', { exact: true }).fill('29')
  await page.getByLabel('Плотность фотофильтра', { exact: true }).press('Enter')
  await page.getByLabel('Сохранять светимость фотофильтра', { exact: true }).uncheck()
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true })
  expect(psd.children![1].adjustment).toMatchObject({
    type: 'photo filter',
    density: 0.29,
    preserveLuminosity: false,
    color: { r: 240, g: 153, b: 80 },
  })
  expect(psd.children![0].name).toBe('Original RGB')
  await writeFile('test-results/native-colour-photo.psd', bytes)
  await writeFile('test-results/native-colour-photo.png', await png(page))
  await nativeOnly(page, bytes)
  await page.locator('.layer-row').filter({ hasText: 'Фотофильтр' }).click()
  await expect(page.getByLabel('Плотность фотофильтра', { exact: true })).toHaveValue('29')
  // Adding a mask preserves the raw photo record; that codec path must keep 29%, too.
  await menu(page, 'Слой', 'Добавить маску')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  expect(readPsd(await save(page), { useImageData: true }).children![1].adjustment).toMatchObject({
    type: 'photo filter',
    density: 0.29,
  })

  await page.getByLabel('Плотность фотофильтра', { exact: true }).fill('58')
  await page.getByLabel('Плотность фотофильтра', { exact: true }).press('Enter')
  expect(readPsd(await save(page), { useImageData: true }).children![1].adjustment).toMatchObject({
    type: 'photo filter',
    density: 0.58,
  })
})

test('gradient map has real editable stops, keyboard movement, reverse and native reimport', async ({
  page,
}) => {
  await fixture(page, 'Native gradient map')
  await menu(page, 'Коррекция', 'Карта градиента')
  await page.getByLabel('Пресет карты градиента').selectOption('1')
  await page.getByRole('button', { name: 'Цветовая точка 2', exact: true }).click()
  await page.getByLabel('Цвет точки градиента').fill('#a157a0')
  await page.getByLabel('Позиция точки', { exact: true }).fill('27')
  await page.getByLabel('Позиция точки', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Цветовая точка 2', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.getByLabel('Обратить карту градиента', { exact: true }).check()
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true }),
    a = psd.children![1].adjustment!
  expect(a.type).toBe('gradient map')
  if (a.type !== 'gradient map') throw new Error('Wrong type')
  expect(a.method).toBeUndefined()
  expect(a.reverse).toBe(true)
  expect(a.colorStops).toHaveLength(3)
  expect(a.colorStops![1].location).toBe(1107 / 4096)
  await writeFile('test-results/native-colour-gradient.psd', bytes)
  await writeFile('test-results/native-colour-gradient.png', await png(page))
  await nativeOnly(page, bytes)
  await page.locator('.layer-row').filter({ hasText: 'Карта градиента' }).click()
  await expect(page.getByRole('button', { name: 'Цветовая точка 3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить цветовую точку', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Цветовая точка 4', exact: true })).toBeVisible()
  await page.getByLabel('Обратить карту градиента', { exact: true }).uncheck()
  const next = readPsd(await save(page), { useImageData: true }).children![1].adjustment!
  expect(next).toMatchObject({ type: 'gradient map', reverse: false })
  expect(next.type === 'gradient map' && next.colorStops).toHaveLength(4)
  await page.screenshot({ path: 'test-results/color-gradient-ui.png' })
})

test('CUBE import/export, malformed file refusal and XMP-free native Color Lookup', async ({
  page,
}) => {
  await fixture(page, 'Native CUBE')
  await menu(page, 'Коррекция', 'Поиск цвета · 3D LUT')
  const cube = identityCube(3)
  cube.title = 'Channel swap'
  for (let i = 0; i < cube.values.length; i += 3)
    [cube.values[i], cube.values[i + 2]] = [cube.values[i + 2], cube.values[i]]
  const upload = page.getByLabel('Загрузить файл CUBE')
  await upload.setInputFiles({
    name: 'swap.cube',
    mimeType: 'text/plain',
    buffer: Buffer.from(serializeCube(cube)),
  })
  await expect(page.getByTestId('lut-properties')).toContainText('Channel swap')
  await upload.setInputFiles({
    name: 'invalid.cube',
    mimeType: 'text/plain',
    buffer: Buffer.from('LUT_1D_SIZE 2048\n0 0 0'),
  })
  await expect(page.getByTestId('lut-properties').getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('lut-properties')).toContainText('Channel swap')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Экспортировать эту LUT/ }).click()
  const downloaded = await event
  expect(parseCubeFile((await readFile((await downloaded.path())!)).toString())).toEqual(cube)
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true }),
    a = psd.children![1].adjustment!
  expect(a).toMatchObject({ type: 'color lookup', lutFormat: 'cube', lookupType: '3dlut' })
  expect(a.type === 'color lookup' && a.lut3DFileData).toBeTruthy()
  await writeFile('test-results/native-colour-cube.psd', bytes)
  await writeFile('test-results/native-colour-cube.png', await png(page))
  await nativeOnly(page, bytes)
  await page.locator('.layer-row').filter({ hasText: 'Поиск цвета' }).click()
  await expect(page.getByTestId('lut-properties')).toContainText('Channel swap')
  await page.getByRole('button', { name: 'Нейтральная таблица', exact: true }).click()
  const neutral = readPsd(await save(page), { useImageData: true }).children![1].adjustment!
  if (neutral.type !== 'color lookup') throw new Error('Lost native LUT')
  expect(parseCubeFile(new TextDecoder().decode(neutral.lut3DFileData))).toEqual(identityCube())
})

test('exports an actual upper color stack as a reusable 33-grid CUBE, refuses masks', async ({
  page,
}) => {
  const doc = await fixture(page, 'Exported grade')
  doc.layers.push(
    makeLayer({
      name: 'Soft inversion',
      kind: 'adjustment',
      correction: { type: 'invert' },
      opacity: 0.25,
    }),
    makeLayer({
      name: 'Exposure',
      kind: 'adjustment',
      correction: { ...defaultCorrection('exposure'), exposure: 0.5 } as ReturnType<
        typeof defaultCorrection
      >,
    }),
  )
  await open(page, doc)
  const before = await png(page)
  await menu(page, 'Коррекция', 'Экспорт цветового стека CUBE…')
  await page.getByLabel('Сетка экспортируемой LUT').selectOption('33')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Сохранить цветовой стек .cube', exact: true }).click()
  const file = await event
  const text = (await readFile((await file.path())!)).toString(),
    lut = parseCubeFile(text)
  expect(lut.size).toBe(33)
  expect(lut.values).toHaveLength(33 ** 3 * 3)
  expect(lut.values[0]).toBeGreaterThan(0.25)
  expect(await png(page)).toEqual(before)
  await writeFile('test-results/exported-grade.cube', text)
  await page.locator('.layer-row').filter({ hasText: 'Exposure' }).click()
  await page.getByRole('button', { name: 'Слой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Добавить маску', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await menu(page, 'Коррекция', 'Экспорт цветового стека CUBE…')
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('пространственную маску')
  await expect(
    page.getByRole('button', { name: 'Сохранить цветовой стек .cube', exact: true }),
  ).toBeDisabled()
})
