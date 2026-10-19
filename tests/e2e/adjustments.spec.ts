import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { correctionNames, defaultCorrection } from '../../src/engine/adjustmentTypes'
initializeCanvas(
  () => {
    throw new Error('No DOM in PSD verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function open(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name,
    mimeType: name.endsWith('.777') ? 'application/json' : 'image/vnd.adobe.photoshop',
    buffer,
  })
  await page
    .getByRole('button', {
      name: name.endsWith('.777') ? 'Открыть проект' : 'Открыть рабочую копию',
      exact: true,
    })
    .click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await download
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await file.path())!)
}
async function sample(page: Page, x: number, y: number) {
  return page.getByTestId('editor-canvas').evaluate(
    async (c: HTMLCanvasElement, p) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return [...c.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data]
    },
    { x, y },
  )
}
const closeColor = (actual: number[], expected: number[], tolerance = 2) =>
  expected.forEach((v, i) =>
    expect(Math.abs(v - actual[i]), `channel ${i}: ${actual}`).toBeLessThanOrEqual(tolerance),
  )
async function init(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
test('native Levels, keyboard creation, numerical controls, undo and XMP-free editing', async ({
  page,
}) => {
  await init(page)
  const doc = newDocument(180, 120, 'Live levels', '#808080')
  await open(page, 'levels.777', Buffer.from(JSON.stringify(doc)))
  await page.keyboard.press('Control+l')
  await expect(page.getByTestId('correction-properties')).toBeVisible()
  await expect(page.getByLabel('Тип коррекции')).toHaveValue('levels')
  await page.getByLabel('Вход: чёрный', { exact: true }).fill('64')
  await page.getByLabel('Вход: чёрный', { exact: true }).press('Tab')
  closeColor(await sample(page, 80, 60), [85, 85, 85, 255])
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
  closeColor(await sample(page, 80, 60), [128, 128, 128, 255])
  await page.getByRole('button', { name: 'Повторить (Ctrl+Shift+Z)', exact: true }).click()
  closeColor(await sample(page, 80, 60), [85, 85, 85, 255])
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true }),
    native = psd.children!.find((l) => l.adjustment)!
  expect(native.adjustment).toMatchObject({
    type: 'levels',
    rgb: { shadowInput: 64, highlightInput: 255 },
  })
  if (psd.imageResources) delete psd.imageResources.xmpMetadata
  const stripped = Buffer.from(writePsd(psd))
  await open(page, 'levels-native.psd', stripped)
  expect(await save(page)).toEqual(stripped)
  await page.locator('.layer-row').filter({ hasText: 'Уровни' }).click()
  await expect(page.getByLabel('Вход: чёрный', { exact: true })).toHaveValue('64')
  await page.getByLabel('Гамма уровней', { exact: true }).fill('1.25')
  await page.getByLabel('Гамма уровней', { exact: true }).press('Tab')
  expect(
    readPsd(await save(page), { useImageData: true }).children!.find((l) => l.adjustment)
      ?.adjustment,
  ).toMatchObject({ type: 'levels', rgb: { midtoneInput: 1.25 } })
  await expect(page.getByTestId('histogram')).toBeVisible()
})
test('all fifteen corrections export as native structures, not image layers', async ({ page }) => {
  await init(page)
  const doc = newDocument(200, 140, 'Native adjustments', '#806040')
  await open(page, 'all-adjustments.777', Buffer.from(JSON.stringify(doc)))
  for (const label of Object.values(correctionNames)) {
    await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true }),
    layers = psd.children!.filter((l) => l.adjustment)
  expect(layers).toHaveLength(15)
  expect(layers.map((l) => l.adjustment!.type)).toEqual(Object.keys(correctionNames))
  for (const layer of layers)
    expect(layer.text || layer.placedLayer || layer.vectorFill).toBeFalsy()
  await writeFile('test-results/native-adjustments.psd', bytes)
  await page.getByRole('button', { name: 'Отчёт PSD', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Корректирующие слои')
})
test('masked clipped inversion preserves original alpha and native mask after save', async ({
  page,
}) => {
  await init(page)
  const sources = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 80
    const x = c.getContext('2d')!
    x.fillStyle = 'rgba(40,80,120,0.5)'
    x.fillRect(0, 0, 80, 80)
    const src = c.toDataURL()
    x.clearRect(0, 0, 120, 80)
    x.fillStyle = 'black'
    x.fillRect(0, 0, 120, 80)
    x.fillStyle = 'white'
    x.fillRect(0, 0, 40, 80)
    return { src, mask: x.canvas.toDataURL() }
  })
  const doc = newDocument(120, 80, 'Clipped adjustment', 'transparent'),
    base = makeLayer({ kind: 'image', name: 'Pixels', width: 120, height: 80, src: sources.src })
  doc.layers = [
    base,
    makeLayer({
      kind: 'adjustment',
      name: 'Masked inversion',
      width: 120,
      height: 80,
      correction: { type: 'invert' },
      clipping: true,
      mask: {
        src: sources.mask,
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        enabled: true,
        linked: true,
        density: 1,
        feather: 0,
        defaultColor: 0,
      },
    }),
  ]
  await open(page, 'clipped.777', Buffer.from(JSON.stringify(doc)))
  closeColor(await sample(page, 20, 30), [215, 175, 135, 128])
  closeColor(await sample(page, 60, 30), [40, 80, 120, 128])
  expect((await sample(page, 100, 30))[3]).toBe(0)
  const bytes = await save(page),
    psd = readPsd(bytes, { useImageData: true })
  expect(psd.children![1]).toMatchObject({
    clipping: true,
    adjustment: { type: 'invert' },
    mask: { defaultColor: 0, disabled: false },
  })
  await writeFile('test-results/adjustment-clipped.psd', bytes)
  const png = await page
    .getByTestId('editor-canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL().split(',')[1])
  await writeFile('test-results/adjustment-clipped.png', Buffer.from(png, 'base64'))
  await page.locator('.layer-row').filter({ hasText: 'Masked inversion' }).click()
  await page.getByLabel('Маска включена').uncheck()
  closeColor(await sample(page, 60, 30), [215, 175, 135, 128])
})
test('adjustments respect isolated and pass-through groups and later layers', async ({ page }) => {
  await init(page)
  const doc = newDocument(160, 100, 'Group scope', '#102030'),
    group = makeLayer({ kind: 'group', name: 'Scope', width: 160, height: 100, isolated: true })
  doc.layers = [
    group,
    makeLayer({ parentId: group.id, x: 10, y: 10, width: 35, height: 35, color: '#406080' }),
    makeLayer({
      kind: 'adjustment',
      parentId: group.id,
      name: 'Group inversion',
      correction: { type: 'invert' },
      width: 160,
      height: 100,
    }),
    makeLayer({ x: 100, y: 10, width: 30, height: 30, color: '#aa0011' }),
  ]
  await open(page, 'scope.777', Buffer.from(JSON.stringify(doc)))
  closeColor(await sample(page, 20, 20), [191, 159, 127, 255])
  closeColor(await sample(page, 70, 70), [16, 32, 48, 255])
  closeColor(await sample(page, 110, 20), [170, 0, 17, 255])
  await page.locator('.layer-row').filter({ hasText: 'Scope' }).click()
  await page.getByLabel('Изолировать наложение группы').uncheck()
  closeColor(await sample(page, 70, 70), [239, 223, 207, 255])
  closeColor(await sample(page, 110, 20), [170, 0, 17, 255])
})
test('curve point editing, per-channel presets and selection mask are real undoable changes', async ({
  page,
}) => {
  await init(page)
  const doc = newDocument(220, 140, 'Curves', '#808080')
  await open(page, 'curves.777', Buffer.from(JSON.stringify(doc)))
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+m')
  await expect(page.getByLabel('Тип коррекции')).toHaveValue('curves')
  await expect(page.locator('.layer-mask-thumbnail')).toHaveCount(1)
  await page.getByRole('button', { name: 'Светлее', exact: true }).click()
  closeColor(await sample(page, 50, 50), [164, 164, 164, 255])
  await page.getByLabel('Канал коррекции').selectOption('red')
  const area = page.getByRole('group', { name: 'Редактор кривой' })
  await area.scrollIntoViewIfNeeded()
  const box = (await area.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25)
  await expect(page.getByLabel('Выход кривой', { exact: true })).toHaveValue(/19[01]/)
  const before = await sample(page, 50, 50)
  expect(before[0]).toBeGreaterThan(before[1] + 30)
  const native = readPsd(await save(page), { useImageData: true }).children!.find(
    (l) => l.adjustment?.type === 'curves',
  )!
  expect(native.adjustment).toMatchObject({
    type: 'curves',
    red: expect.arrayContaining([expect.objectContaining({ output: expect.any(Number) })]),
  })
  expect(native.mask).toBeTruthy()
})

for (const kind of ['levels', 'curves', 'exposure', 'posterize'] as const)
  test(`independent native RGB ${kind} fixture uses nontrivial controls and translucent pixels`, async ({
    page,
  }) => {
    await init(page)
    const src = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 64
      const x = c.getContext('2d')!,
        im = x.createImageData(256, 64)
      for (let y = 0; y < 64; y++)
        for (let xx = 0; xx < 256; xx++) {
          const i = (y * 256 + xx) * 4
          im.data[i] = xx
          im.data[i + 1] = 255 - xx
          im.data[i + 2] = (xx * 3) % 256
          im.data[i + 3] = y < 32 ? 255 : 128
        }
      x.putImageData(im, 0, 0)
      return c.toDataURL()
    })
    const c = defaultCorrection(kind)
    if (c.type === 'levels') {
      c.channels.rgb = { black: 16, white: 240, gamma: 1.2, outBlack: 6, outWhite: 248 }
      c.channels.red = { black: 8, white: 250, gamma: 1.1, outBlack: 0, outWhite: 255 }
      c.channels.green.gamma = 0.9
    }
    if (c.type === 'curves') {
      c.channels.rgb = [
        { input: 0, output: 0 },
        { input: 64, output: 48 },
        { input: 192, output: 210 },
        { input: 255, output: 255 },
      ]
      c.channels.red = [
        { input: 0, output: 0 },
        { input: 128, output: 144 },
        { input: 255, output: 255 },
      ]
    }
    if (c.type === 'exposure') {
      c.exposure = 1
      c.offset = 0.01
      c.gamma = 0.9
    }
    if (c.type === 'posterize') c.levels = 5
    const doc = newDocument(256, 64, `Native ${kind}`, 'transparent')
    doc.layers = [
      makeLayer({ kind: 'image', src, width: 256, height: 64 }),
      makeLayer({ kind: 'adjustment', width: 256, height: 64, correction: c }),
    ]
    await open(page, `${kind}.777`, Buffer.from(JSON.stringify(doc)))
    await writeFile(`test-results/native-tone-${kind}.psd`, await save(page))
    const png = await page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return c.toDataURL().split(',')[1]
    })
    await writeFile(`test-results/native-tone-${kind}.png`, Buffer.from(png, 'base64'))
  })
