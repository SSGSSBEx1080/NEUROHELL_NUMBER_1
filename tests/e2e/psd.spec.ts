import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, type Layer } from 'ag-psd'
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
    await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
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
