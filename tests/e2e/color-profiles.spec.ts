import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  buildIccProfile,
  builtinColorProfile,
  parseIccProfile,
} from '../../src/engine/colorProfiles'
import { imageResourceData, withPsdIccProfile } from '../../src/engine/psdBinary'

async function ready(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
}

async function dropPsd(page: Page, bytes: Buffer, name: string) {
  await page.evaluate(
    ({ base64, fileName }) => {
      const binary = atob(base64)
      const data = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
      const transfer = new DataTransfer()
      transfer.items.add(new File([data], fileName, { type: 'image/vnd.adobe.photoshop' }))
      const target = document.querySelector('.editor-app')!
      for (const type of ['dragenter', 'dragover', 'drop'])
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        )
    },
    { base64: bytes.toString('base64'), fileName: name },
  )
}

async function choosePsd(page: Page, bytes: Buffer, name: string) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name,
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: bytes,
  })
}

async function pixel(page: Page, x: number, y: number) {
  return page
    .locator('[data-testid=editor-canvas]')
    .evaluate(
      (canvas: HTMLCanvasElement, point) => [
        ...canvas.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data,
      ],
      { x, y },
    )
}

test('dragging a matching sRGB PSD opens it directly; layer details move to an optional report', async ({
  page,
}) => {
  await ready(page)
  await dropPsd(page, await readFile('tests/fixtures/psd/groups.psd'), 'groups.psd')

  await expect(page.getByRole('button', { name: 'Отчёт импорта', exact: true })).toBeVisible()
  await expect(page.getByText('Несоответствие встроенного профиля')).toBeHidden()
  await expect(page.getByText('Рабочая копия PSD')).toBeHidden()
  await expect(page.getByRole('button', { name: 'sRGB IEC61966-2.1', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Отчёт импорта', exact: true }).click()
  await expect(page.getByText('Сведения об импорте PSD')).toBeVisible()
  await expect(page.getByText(/совпадает с рабочим пространством sRGB/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
})

test('a PSD without ICC gets only the Missing Profile question, not the old layers gate', async ({
  page,
}) => {
  const source = await readFile('tests/fixtures/psd/groups.psd')
  const untagged = Buffer.from(withPsdIccProfile(source.buffer.slice(0)))
  await ready(page)
  await choosePsd(page, untagged, 'untagged.psd')

  await expect(page.getByText('Отсутствует цветовой профиль')).toBeVisible()
  await expect(page.getByText('Рабочая копия PSD')).toBeHidden()
  await expect(page.getByText(/слоёв и групп/)).toBeHidden()
  await expect(
    page.getByRole('radio', { name: /Оставить как есть \(без управления цветом\)/ }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Открыть', exact: true }).click()

  await expect(page.locator('.busy-overlay')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Без профиля · предпросмотр sRGB', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отчёт импорта', exact: true })).toBeVisible()
})

test('Adobe RGB PSD can be converted to working sRGB and then saved with an sRGB ICC', async ({
  page,
}) => {
  const source = await readFile('tests/fixtures/psd/groups.psd')
  const AdobeProfile = buildIccProfile(builtinColorProfile('adobe-rgb-1998')!)
  const tagged = Buffer.from(withPsdIccProfile(source.buffer.slice(0), AdobeProfile))

  const openWith = async (target: Page, discard: boolean) => {
    await ready(target)
    await choosePsd(target, tagged, 'adobe-rgb.psd')
    await expect(target.getByText('Несоответствие встроенного профиля')).toBeVisible()
    await expect(target.getByText('Adobe RGB (1998)')).toBeVisible()
    if (discard) await target.getByRole('radio', { name: /Отбросить встроенный профиль/ }).check()
    else
      await expect(
        target.getByRole('radio', { name: /Преобразовать цвета документа/ }),
      ).toBeChecked()
    await target.getByRole('button', { name: 'Открыть', exact: true }).click()
    await expect(target.locator('.busy-overlay')).toBeHidden()
    await expect
      .poll(async () => (await pixel(target, 60, 55))[3], { timeout: 15_000 })
      .toBeGreaterThan(200)
    return pixel(target, 60, 55)
  }

  const discarded = await openWith(page, true)
  const convertedPage = await page.context().newPage()
  const converted = await openWith(convertedPage, false)
  expect(converted.slice(0, 3)).not.toEqual(discarded.slice(0, 3))
  await expect(
    convertedPage.getByRole('button', { name: 'sRGB IEC61966-2.1', exact: true }),
  ).toBeVisible()

  const downloadPromise = convertedPage.waitForEvent('download')
  await convertedPage.keyboard.press('Control+s')
  const download = await downloadPromise
  const saved = await readFile((await download.path())!)
  const embedded = imageResourceData(saved.buffer.slice(0), 1039)
  expect(embedded).toBeDefined()
  expect(parseIccProfile(embedded!)?.recognizedId).toBe('srgb-iec61966-2-1')
  await convertedPage.close()
})

function grayscalePsd(profileId: 'sgray' | 'gray-gamma-1.8'): Buffer {
  const width = 200
  const height = 100
  const header = Buffer.alloc(26)
  header.write('8BPS', 0, 'ascii')
  header.writeUInt16BE(1, 4)
  header.writeUInt16BE(1, 12)
  header.writeUInt32BE(height, 14)
  header.writeUInt32BE(width, 18)
  header.writeUInt16BE(8, 22)
  header.writeUInt16BE(1, 24)
  const plane = Buffer.alloc(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) plane[y * width + x] = x < width / 2 ? 128 : 200
  const bare = Buffer.concat([
    header,
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from([0, 0]),
    plane,
  ])
  return Buffer.from(
    withPsdIccProfile(
      bare.buffer.slice(bare.byteOffset, bare.byteOffset + bare.byteLength),
      buildIccProfile(builtinColorProfile(profileId)!),
    ),
  )
}

test('grayscale PSD profiles are picked up: sGray opens directly and Gray Gamma 1.8 converts', async ({
  page,
}) => {
  await ready(page)
  await choosePsd(page, grayscalePsd('sgray'), 'gray-sgray.psd')
  await expect(page.getByText('Отсутствует цветовой профиль')).toBeHidden()
  await expect(page.getByText('Несоответствие встроенного профиля')).toBeHidden()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  await expect.poll(async () => await pixel(page, 50, 50)).toEqual([128, 128, 128, 255])

  const convertedPage = await page.context().newPage()
  await ready(convertedPage)
  await choosePsd(convertedPage, grayscalePsd('gray-gamma-1.8'), 'gray-gamma.psd')
  await expect(convertedPage.getByText('Несоответствие встроенного профиля')).toBeVisible()
  await expect(convertedPage.getByText('Gray Gamma 1.8')).toBeVisible()
  await expect(convertedPage.getByText('Оттенки серого / 8 бит')).toBeVisible()
  await convertedPage.getByRole('button', { name: 'Открыть', exact: true }).click()
  await expect(convertedPage.locator('.busy-overlay')).toBeHidden()
  await expect.poll(async () => (await pixel(convertedPage, 50, 50))[0]).toBeGreaterThan(140)
  const converted = await pixel(convertedPage, 50, 50)
  expect(converted[0]).toBe(converted[1])
  expect(converted[1]).toBe(converted[2])
  await convertedPage.close()
})

test('flat PNG export can convert a copy to sGray and embed its ICC', async ({ page }) => {
  await ready(page)
  await choosePsd(page, await readFile('tests/fixtures/psd/groups.psd'), 'groups.psd')
  await expect(page.getByRole('button', { name: 'Отчёт импорта', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page.getByLabel('Профиль назначения экспорта').selectOption('sgray')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click()
  const download = await downloadPromise
  const png = await readFile((await download.path())!)
  expect(png.toString('latin1')).toContain('iCCP')
  expect(png.toString('latin1')).toContain('sGray')
})

test('settings policy converts mismatched PSDs without asking, and the document profile command is undoable', async ({
  page,
}) => {
  await ready(page)
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Цвет', exact: true }).click()
  await page.getByLabel('Политика несовпадения профиля PSD').selectOption('convert')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()

  const source = await readFile('tests/fixtures/psd/groups.psd')
  const tagged = Buffer.from(
    withPsdIccProfile(
      source.buffer.slice(0),
      buildIccProfile(builtinColorProfile('adobe-rgb-1998')!),
    ),
  )
  await choosePsd(page, tagged, 'adobe-policy.psd')
  await expect(page.getByText('Несоответствие встроенного профиля')).toBeHidden()
  await expect(page.getByText(/Adobe RGB \(1998\) → sRGB/)).toBeVisible()
  await expect(page.locator('.busy-overlay')).toBeHidden()
  const profileButton = page.getByRole('button', { name: 'sRGB IEC61966-2.1', exact: true })
  await expect(profileButton).toBeVisible()
  await expect.poll(async () => (await pixel(page, 60, 55))[3]).toBeGreaterThan(200)
  const before = await pixel(page, 60, 55)

  await profileButton.click()
  await expect(page.getByText('Цветовой профиль документа')).toBeVisible()
  await page.getByRole('radio', { name: /Не управлять цветом этого документа/ }).check()
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Без профиля · предпросмотр sRGB', exact: true }),
  ).toBeVisible()
  expect(await pixel(page, 60, 55)).toEqual(before)

  await page.keyboard.press('Control+z')
  await expect(page.getByRole('button', { name: 'sRGB IEC61966-2.1', exact: true })).toBeVisible()
})
