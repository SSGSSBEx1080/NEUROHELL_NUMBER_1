import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd, type Layer } from 'ag-psd'
initializeCanvas(
  () => {
    throw new Error('No canvas in file verification')
  },
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  }),
)
const flatten = (layers: Layer[]): Layer[] =>
  layers.flatMap((l) => [l, ...flatten(l.children || [])])
/** 64×32 PSD: pixel mask shows x<48, vector rectangle shows x>=16, baked real mask shows only 16<=x<48. */
function dualMaskData() {
  const width = 64,
    height = 32,
    gray = (fn: (x: number) => number) => {
      const data = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        const v = fn(i % width)
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
        data[i * 4 + 3] = 255
      }
      return { width, height, data }
    },
    knot = (x: number, y: number) => ({ linked: true, points: [x, y, x, y, x, y] })
  return {
    width,
    height,
    gray,
    mask: {
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      defaultColor: 0,
      imageData: gray((x) => (x < 48 ? 255 : 0)),
    },
    realMask: {
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      defaultColor: 0,
      imageData: gray((x) => (x >= 16 && x < 48 ? 255 : 0)),
    },
    vectorMask: {
      paths: [
        {
          open: false,
          operation: 'combine' as const,
          fillRule: 'non-zero' as const,
          knots: [knot(16, 0), knot(64, 0), knot(64, 32), knot(16, 32)],
        },
      ],
    },
  }
}
for (const fixture of ['groups', 'masks', 'effects'])
  test(`real PSD ${fixture}: no-edit save is byte-identical; metadata edit retains structures`, async ({
    page,
  }) => {
    const original = await readFile(`tests/fixtures/psd/${fixture}.psd`)
    await page.goto('/')
    await expect(page.locator('.busy-overlay')).toBeHidden()
    await page
      .getByLabel('Открыть изображение или проект')
      .setInputFiles(`tests/fixtures/psd/${fixture}.psd`)
    // These fixtures carry matching sRGB ICC profiles: opening must be direct,
    // with neither the old layer/compatibility gate nor a profile question.
    await expect(page.getByRole('button', { name: 'Отчёт импорта', exact: true })).toBeVisible()
    await expect(page.getByText('Несоответствие встроенного профиля')).toBeHidden()
    await expect(page.locator('.busy-overlay')).toBeHidden()
    const save = async () => {
      const promise = page.waitForEvent('download')
      await page.keyboard.press('Control+s')
      const download = await promise
      expect(download.suggestedFilename()).toMatch(/\.psd$/)
      await expect(page.locator('.busy-overlay')).toBeHidden()
      return readFile((await download.path())!)
    }
    expect((await save()).equals(original)).toBe(true)
    const first = page.locator('.layer-row').first()
    await first.locator('.layer-name').dblclick()
    await page.getByLabel('Название слоя').fill('Сохранённая структура')
    await page.getByLabel('Название слоя').press('Enter')
    await page.locator('.document-bar').click({ position: { x: 350, y: 20 } })
    const exported = await save()
    const before = readPsd(original, { useImageData: true, skipThumbnail: true }),
      after = readPsd(exported, { useImageData: true, skipThumbnail: true })
    expect(after.imageResources?.versionInfo?.hasRealMergedData).toBe(true)
    const a = flatten(before.children || []),
      b = flatten(after.children || [])
    expect(b).toHaveLength(a.length)
    expect(b.filter((l) => l.children).length).toBe(a.filter((l) => l.children).length)
    expect(b.filter((l) => l.mask?.imageData).length).toBe(
      a.filter((l) => l.mask?.imageData).length,
    )
    expect(b.filter((l) => l.effects).length).toBe(a.filter((l) => l.effects).length)
    await writeFile(`test-results/exported-${fixture}.psd`, exported)
    expect(
      Buffer.from(after.imageData!.data.buffer).equals(Buffer.from(before.imageData!.data.buffer)),
    ).toBe(true)
    expect(b.some((l) => l.name === 'Сохранённая структура')).toBe(true)
  })

test('PSD pixel+vector mask: the baked real mask survives a working recomposite and native save', async ({
  page,
}) => {
  const width = 64,
    height = 32,
    pixels = (fn: (x: number, y: number) => number[]) => {
      const data = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4,
            c = fn(x, y)
          data[i] = c[0]
          data[i + 1] = c[1]
          data[i + 2] = c[2]
          data[i + 3] = c[3] ?? 255
        }
      return { width, height, data }
    },
    gray = (fn: (x: number, y: number) => number) =>
      pixels((x, y) => {
        const v = fn(x, y)
        return [v, v, v, 255]
      }),
    knot = (x: number, y: number) => ({ linked: true, points: [x, y, x, y, x, y] })
  // Pixel mask shows x<48; the vector rectangle shows x>=16. Their baked
  // composite (real mask, channel -3) therefore shows only 16<=x<48.
  const buffer = Buffer.from(
    writePsd({
      width,
      height,
      imageData: pixels((x) => (x >= 16 && x < 48 ? [220, 30, 30] : [245, 245, 245])),
      children: [
        {
          name: 'Фон',
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          imageData: pixels(() => [245, 245, 245]),
        },
        {
          name: 'Красный с двумя масками',
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          imageData: pixels(() => [220, 30, 30]),
          mask: {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            defaultColor: 0,
            imageData: gray((x) => (x < 48 ? 255 : 0)),
          },
          realMask: {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            defaultColor: 0,
            imageData: gray((x) => (x >= 16 && x < 48 ? 255 : 0)),
          },
          vectorMask: {
            paths: [
              {
                open: false,
                operation: 'combine',
                fillRule: 'non-zero',
                knots: [knot(16, 0), knot(64, 0), knot(64, 32), knot(16, 32)],
              },
            ],
          },
        },
      ],
    }),
  )
  const fixture = readPsd(buffer, { useImageData: true, skipThumbnail: true }).children!.find(
    (l) => l.realMask,
  )!
  expect(fixture.mask!.imageData!.data[(16 * width + 8) * 4]).toBe(255)
  expect(fixture.realMask!.imageData!.data[(16 * width + 8) * 4]).toBe(0)
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'dual-mask.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer,
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const profileOpen = page.getByRole('button', { name: 'Открыть', exact: true })
  if (await profileOpen.isVisible()) await profileOpen.click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const sample = (x: number) =>
    page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement, px) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return [...c.getContext('2d')!.getImageData(px, 16, 1, 1).data]
    }, x)
  await expect.poll(() => sample(8)).toEqual([245, 245, 245, 255])
  await expect.poll(() => sample(32)).toEqual([220, 30, 30, 255])
  // A transparent new layer changes nothing visually, but it invalidates the
  // stored original composite: the working renderer must now reproduce the
  // same coverage from the imported layers alone.
  await page.getByRole('button', { name: 'Добавить пустой слой', exact: true }).click()
  await expect.poll(() => sample(8)).toEqual([245, 245, 245, 255])
  await expect.poll(() => sample(32)).toEqual([220, 30, 30, 255])
  await expect.poll(() => sample(56)).toEqual([245, 245, 245, 255])
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const exported = await readFile((await (await download).path())!)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const saved = readPsd(exported, { useImageData: true, skipThumbnail: true })
  const native = flatten(saved.children || []).find((l) => l.name === 'Красный с двумя масками')!
  expect(native.mask?.imageData).toBeTruthy()
  expect(native.realMask?.imageData).toBeTruthy()
  expect(native.vectorMask?.paths).toHaveLength(1)
  expect(native.realMask!.imageData!.data[(16 * width + 8) * 4]).toBe(0)
  expect(native.realMask!.imageData!.data[(16 * width + 32) * 4]).toBe(255)
  expect([...saved.imageData!.data.slice((16 * width + 8) * 4, (16 * width + 8) * 4 + 4)]).toEqual([
    245, 245, 245, 255,
  ])
  await writeFile('test-results/dual-mask-exported.psd', exported)
})

test('PSD adjustment layer with pixel+vector masks keeps its correction through the composite mask', async ({
  page,
}) => {
  const d = dualMaskData()
  const buffer = Buffer.from(
    writePsd({
      width: d.width,
      height: d.height,
      // Photoshop merged result: inversion applies only inside both masks.
      imageData: d.gray((x) => (x >= 16 && x < 48 ? 155 : 100)),
      children: [
        {
          name: 'Серый фон',
          left: 0,
          top: 0,
          right: d.width,
          bottom: d.height,
          imageData: d.gray(() => 100),
        },
        {
          name: 'Инверсия с двумя масками',
          adjustment: { type: 'invert' },
          mask: d.mask,
          realMask: d.realMask,
          vectorMask: d.vectorMask,
        },
      ],
    }),
  )
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name: 'dual-mask-adjustment.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer,
  })
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const profileOpen = page.getByRole('button', { name: 'Открыть', exact: true })
  if (await profileOpen.isVisible()) await profileOpen.click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const sample = (x: number) =>
    page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement, px) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      return [...c.getContext('2d')!.getImageData(px, 16, 1, 1).data]
    }, x)
  await expect.poll(() => sample(32)).toEqual([155, 155, 155, 255])
  // Force the working renderer to recompute the correction from imported data.
  await page.getByRole('button', { name: 'Добавить пустой слой', exact: true }).click()
  await expect.poll(() => sample(8)).toEqual([100, 100, 100, 255])
  await expect.poll(() => sample(32)).toEqual([155, 155, 155, 255])
  await expect.poll(() => sample(56)).toEqual([100, 100, 100, 255])
  await page.locator('.layer-row').filter({ hasText: 'Инверсия с двумя масками' }).click()
  await expect(page.getByTestId('correction-properties')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const exported = await readFile((await (await download).path())!)
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const saved = readPsd(exported, { useImageData: true, skipThumbnail: true })
  const native = flatten(saved.children || []).find((l) => l.name === 'Инверсия с двумя масками')!
  expect(native.adjustment).toMatchObject({ type: 'invert' })
  expect(native.realMask?.imageData).toBeTruthy()
  expect(saved.imageData!.data[(16 * d.width + 32) * 4]).toBe(155)
  expect(saved.imageData!.data[(16 * d.width + 8) * 4]).toBe(100)
})
