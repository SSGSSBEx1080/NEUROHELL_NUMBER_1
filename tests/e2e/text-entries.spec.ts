import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument } from '../../src/engine/document'
import { encodeProject, decodeProject } from '../../src/engine/psdMetadata'
import { sealProject } from '../../src/engine/psdIntegrity'
initializeCanvas(
  () => {
    throw new Error('No canvas in structural verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
async function init(page: Page) {
  await page.goto('/')
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function open(page: Page, name: string, value: unknown) {
  await page.getByLabel('Открыть изображение или проект').setInputFiles({
    name,
    mimeType: name.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'application/json',
    buffer: Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
  })
  if (name.endsWith('.psd')) {
    await expect(page.locator('.busy-overlay')).toBeHidden()
    const profileOpen = page.getByRole('button', { name: 'Открыть', exact: true })
    if (await profileOpen.isVisible()) await profileOpen.click()
  } else await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
  await expect(page.locator('.busy-overlay')).toBeHidden()
}
async function save(page: Page) {
  await page.getByTestId('canvas-viewport').focus()
  const event = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const d = await event
  await expect(page.locator('.busy-overlay')).toBeHidden()
  return readFile((await d.path())!)
}
async function pixels(page: Page) {
  return page.getByTestId('editor-canvas').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    return c.toDataURL()
  })
}
const legacyEntry = {
  id: 'old-entry',
  source: 'Исходный материал',
  translation: 'Сохранённый текст',
  speaker: 'Метка 1',
  note: 'Заметка',
  status: 'proofread',
}

test('fresh workspace offers general tools, never loads compatibility artwork and has no dedicated practice screen', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  await init(page)
  await expect(page.getByTestId('open-layout-demo')).toHaveCount(0)
  await expect(page.locator('.home-layout-card')).toHaveCount(0)
  await expect(page.getByTestId('home-screen')).not.toContainText(
    /манг|manga|реплик|пузыр|тайпсет|скринтон/i,
  )
  await open(page, 'blank.777', newDocument(320, 240, 'Документ'))
  await expect(page.getByLabel('Рабочая среда')).toHaveValue('standard')
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Текстовые блоки', exact: true })).toContainText(
    'Текстовые блоки документа',
  )
  await expect(page.locator('.editor-shell')).not.toContainText(
    /манг|manga|реплик|пузыр|тайпсет|скринтон|персонаж|сценарий перевода/i,
  )
  expect(
    requests.some(
      (url) =>
        url.startsWith('/compat/') || url.includes('/demo-layout') || url.includes('/demo-manga'),
    ),
  ).toBe(false)
  await page.screenshot({ path: 'test-results/general-workspace.png' })
})

test('old project entries and panel preferences migrate without replacing user content or links', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'fsh777-panels',
      JSON.stringify({ preset: 'layout', tab: 'translation', width: 360, split: 0.66 }),
    ),
  )
  await init(page)
  const doc = {
    ...newDocument(420, 260, 'Сохранённый документ'),
    layers: [
      makeLayer({
        id: 'linked-text',
        kind: 'text',
        name: 'Сохранённый слой',
        text: 'Сохранённый текст',
        fontFamily: 'Manrope',
        fontSize: 26,
        x: 40,
        y: 50,
        width: 300,
        height: 130,
        textFrame: {
          shape: 'ellipse',
          padding: 10,
          autoFit: true,
          minFontSize: 12,
          verticalAlign: 'middle',
        },
      }),
    ],
    script: [{ ...legacyEntry, layerId: 'linked-text' }],
  }
  await open(page, 'older.777', doc)
  await expect(page.getByLabel('Рабочая среда')).toHaveValue('texts')
  await expect(page.getByLabel('Содержимое текстового блока')).toHaveValue('Сохранённый текст')
  await expect(page.getByLabel('Метка', { exact: true })).toHaveValue('Метка 1')
  await expect(page.getByLabel('Статус текстового блока')).toHaveValue('checked')
  await page.getByLabel('Содержимое текстового блока').fill('Обновлённое содержимое')
  await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(1)
  const psd = readPsd(await save(page), { useImageData: true }),
    own = decodeProject(psd.imageResources?.xmpMetadata) as typeof doc & {
      textEntries: { text: string; label: string; layerId: string }[]
    }
  expect(own).not.toHaveProperty('script')
  expect(own.textEntries[0]).toMatchObject({
    text: 'Обновлённое содержимое',
    label: 'Метка 1',
    layerId: 'linked-text',
  })
  expect(own.layers[0].textFrame?.shape).toBe('ellipse')
  expect(psd.children?.find((l) => l.text)?.text?.text?.replace(/\s/g, '')).toBe(
    'Обновлённоесодержимое',
  )
})

test('captures a selected text layer as reusable content without changing the layer or imposing a workflow', async ({
  page,
}) => {
  await init(page)
  const doc = newDocument(400, 240, 'Тексты')
  doc.layers = [
    makeLayer({
      kind: 'text',
      text: 'Сохранённый блок',
      name: 'Исходный слой',
      x: 35,
      y: 40,
      width: 280,
      height: 70,
      fontFamily: 'Manrope',
      fontSize: 24,
    }),
  ]
  await open(page, 'texts.777', doc)
  const before = await pixels(page)
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await page.getByRole('button', { name: 'Из слоя', exact: true }).click()
  await expect(page.getByLabel('Содержимое текстового блока')).toHaveValue('Сохранённый блок')
  await expect(page.getByLabel('Исходный текст блока')).toHaveValue('Сохранённый блок')
  await expect(page.locator('.layer-row')).toHaveCount(1)
  expect(await pixels(page)).toBe(before)
  await page.getByRole('button', { name: 'Создать текстовый слой', exact: true }).click()
  await expect(page.locator('.layer-row')).toHaveCount(2)
  const psd = readPsd(await save(page), { useImageData: true }),
    own = decodeProject(psd.imageResources?.xmpMetadata) as {
      layers: { textFrame?: { shape: string } }[]
    }
  expect(own.layers[1].textFrame?.shape).toBe('rectangle')
  expect(psd.children?.filter((l) => l.text)).toHaveLength(2)
})

test('old PSD metadata opens byte-identically, then saves canonical text blocks with native type', async ({
  page,
}) => {
  await init(page)
  const old = { ...newDocument(240, 160, 'Сохранённые данные'), script: [legacyEntry] }
  const buffer = writePsd({
    width: 240,
    height: 160,
    imageData: { width: 240, height: 160, data: new Uint8ClampedArray(240 * 160 * 4).fill(255) },
    children: [],
    imageResources: { xmpMetadata: encodeProject(old) },
  })
  await sealProject(buffer)
  await open(page, 'legacy-metadata.psd', Buffer.from(buffer))
  expect(await save(page)).toEqual(Buffer.from(buffer))
  await page.getByRole('tab', { name: 'Тексты', exact: true }).click()
  await expect(page.getByLabel('Содержимое текстового блока')).toHaveValue('Сохранённый текст')
  await page.getByText('Дополнительные поля', { exact: true }).click()
  await page.getByLabel('Заметка к текстовому блоку').fill('Новая заметка')
  const updated = readPsd(await save(page), { useImageData: true }),
    meta = decodeProject(updated.imageResources?.xmpMetadata) as { textEntries: { note: string }[] }
  expect(meta).not.toHaveProperty('script')
  expect(meta.textEntries[0].note).toBe('Новая заметка')
  expect(updated.imageData?.data.every((v) => v === 255)).toBe(true)
  await page.getByRole('button', { name: 'Создать текстовый слой', exact: true }).click()
  expect(
    readPsd(await save(page), { useImageData: true }).children?.filter((l) => l.text),
  ).toHaveLength(1)
})

test('imports either text exchange format through the main picker without inheriting foreign bindings', async ({
  page,
}) => {
  await init(page)
  await open(page, 'empty.777', newDocument(320, 200, 'Обмен'))
  for (const [name, content] of [
    [
      'older.777script.json',
      { format: 'fsh777-script', version: 1, entries: [{ ...legacyEntry, layerId: 'foreign' }] },
    ],
    [
      'current.777texts.json',
      {
        format: 'fsh777-texts',
        version: 1,
        entries: [
          {
            id: 'new-record',
            source: '',
            text: 'Новый блок',
            label: '02',
            note: '',
            status: 'ready',
            layerId: 'foreign',
          },
        ],
      },
    ],
  ] as const) {
    await page.getByLabel('Открыть изображение или проект').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(content)),
    })
    await expect(page.locator('.toast')).toContainText('Добавлено 1 текстовых блоков')
  }
  await expect(page.locator('.text-entry-list > button')).toHaveCount(2)
  await expect(page.locator('.layer-row')).toHaveCount(0)
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт текстовых блоков', exact: true }).click()
  const file = await event
  expect(file.suggestedFilename()).toMatch(/\.777texts\.json$/)
  const exported = JSON.parse((await readFile((await file.path())!)).toString())
  expect(exported.format).toBe('fsh777-texts')
  expect(
    exported.entries.every(
      (e: { layerId?: string; translation?: string }) => !e.layerId && e.translation === undefined,
    ),
  ).toBe(true)
  expect(exported.entries.map((e: { status: string }) => e.status)).toEqual(['checked', 'ready'])
})
