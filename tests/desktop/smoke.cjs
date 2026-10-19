'use strict'
const { _electron: electron, expect } = require('@playwright/test')
const { initializeCanvas, readPsd, writePsd } = require('ag-psd')
initializeCanvas(
  () => {
    throw new Error('No browser canvas in native PSD verifier')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
const decodePsd = (bytes) => readPsd(bytes, { useImageData: true, skipThumbnail: true })
const path = require('node:path'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  assert = require('node:assert/strict')
let runningApp,
  phase = 'launch'
const escapeAnnotation = (value) =>
  String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
function progress(message) {
  phase = message
  console.log(`Desktop: ${message}`)
  if (process.env.GITHUB_ACTIONS)
    console.log(`::notice title=Desktop test::${escapeAnnotation(message)}`)
}
function fatal(error) {
  console.error(error)
  if (process.env.GITHUB_ACTIONS)
    console.error(
      `::error title=Desktop test (${escapeAnnotation(phase)})::${escapeAnnotation(`${error.message}\n${error.stack || ''}`)}`,
    )
  runningApp?.process().kill()
  process.exit(1)
}
const watchdog = setTimeout(
  () => fatal(new Error(`Desktop test exceeded 180 seconds at: ${phase}`)),
  180000,
)
watchdog.unref()
;(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh777-smoke-'))
  const executablePath = process.env.FSH777_SMOKE_EXECUTABLE
  progress(executablePath ? 'launch packaged executable' : 'launch development executable')
  const app = (runningApp = await electron.launch({
    executablePath,
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${temp}`],
    timeout: 60000,
  }))
  let page
  const errors = [],
    consoleMessages = []
  try {
    progress('wait for application window')
    page = await app.firstWindow({ timeout: 30000 })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        consoleMessages.push(message.text())
    })
    await page.waitForURL('fsh777://studio/index.html', { timeout: 30000 })
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await page.getByTestId('open-demo').click()
    await expect(page.locator('.layer-row')).toHaveCount(7, { timeout: 15000 })
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
    assert.equal(await page.evaluate(() => window.fsh777.desktop), true)
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), !!executablePath)
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), temp)
    progress('sandbox and custom protocol OK; intercept native save paths')
    // Do not return Session (a native, non-serializable object) from evaluate.
    await app.evaluate(({ session, dialog }, directory) => {
      globalThis.__fshSaveDialogCount = 0
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.__fshSaveDialogCount++
        return {
          canceled: false,
          filePath: directory + '/' + options.defaultPath.split(/[\\/]/).pop(),
        }
      }
      session.defaultSession.on('will-download', (_event, item) => {
        item.setSavePath(directory + '/' + item.getFilename())
      })
    }, temp)
    for (const format of ['PNG', 'JPG', 'WEBP', 'PSD', 'PSB']) {
      progress(`export ${format} to disk`)
      await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
      await page
        .locator('.format-options button')
        .filter({ has: page.locator('strong', { hasText: new RegExp(`^${format}$`) }) })
        .click()
      await page.getByRole('button', { name: `Скачать ${format}`, exact: true }).click()
      // PSD encoding + atomic disk save is asynchronous; use the same bounded budget
      // as the save acknowledgement, rather than Playwright's unrelated 5s default.
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 30000 })
      await expect(page.locator('.toast')).toContainText(
        new RegExp(`Файл сохранён: .+\\.${format.toLowerCase()}$`),
        { timeout: 30000 },
      )
      const filename = (await fs.readdir(temp)).find((file) =>
        file.endsWith('.' + format.toLowerCase()),
      )
      assert.ok(filename, `${format} output was written`)
      const bytes = await fs.readFile(path.join(temp, filename))
      assert.ok(bytes.length > 100)
      if (format === 'PNG') {
        assert.equal(bytes.readUInt32BE(16), 1600)
        assert.equal(bytes.readUInt32BE(20), 1000)
      }
      if (format === 'JPG') assert.equal(bytes.readUInt16BE(0), 0xffd8)
      if (format === 'WEBP') {
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
      }
      if (format === 'PSD' || format === 'PSB') {
        assert.equal(bytes.toString('ascii', 0, 4), '8BPS')
        assert.equal(bytes.readUInt16BE(4), format === 'PSD' ? 1 : 2)
      }
    }
    progress('save standard PSD using Ctrl+S')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.psd$/, {
      timeout: 30000,
    })
    progress('repeat Ctrl+S atomically without truncation')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.busy-overlay')).toBeHidden()
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.psd$/)
    progress('enumerate Windows fonts through trusted IPC')
    const families = await page.evaluate(() => window.fsh777.listFonts())
    assert.ok(families.length > 10)
    assert.ok(families.some((f) => /Arial|Segoe|Times/.test(f)))
    progress('save legacy .777 backup from File menu')
    await page.getByRole('button', { name: 'Файл', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Резервная копия (старый .777)', exact: true }).click()
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.777$/, {
      timeout: 30000,
    })
    const project = (await fs.readdir(temp)).find((file) => file.endsWith('.777'))
    assert.ok(project)
    assert.equal(JSON.parse(await fs.readFile(path.join(temp, project), 'utf8')).layers.length, 7)
    progress('close original tab before reimporting its PSD')
    await page.keyboard.press('Control+w')
    await page.getByRole('button', { name: 'Закрыть вкладку', exact: true }).click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
    progress('reimport PSD through production worker')
    const psd = (await fs.readdir(temp)).find((file) => file.endsWith('.psd'))
    await page.getByLabel('Открыть изображение или проект').setInputFiles(path.join(temp, psd))
    await expect(
      page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }),
    ).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Открыть рабочую копию', exact: true }).click()
    await expect(page.locator('.save-indicator')).toContainText('Автокопия сохранена', {
      timeout: 15000,
    })
    progress('reopened copy must prompt once, not inherit the closed tab save permission')
    const dialogs = await app.evaluate(() => globalThis.__fshSaveDialogCount)
    await page.keyboard.press('Control+s')
    await expect.poll(() => app.evaluate(() => globalThis.__fshSaveDialogCount)).toBe(dialogs + 1)
    await expect(page.locator('.busy-overlay')).toBeHidden()
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.psd$/)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.busy-overlay')).toBeHidden()
    assert.equal(await app.evaluate(() => globalThis.__fshSaveDialogCount), dialogs + 1)
    progress('layout practice, native J worker and linked typesetting')
    await page.getByRole('button', { name: 'На главную', exact: true }).click()
    await page.getByTestId('open-layout-demo').click()
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await expect(page.locator('.layer-row')).toHaveCount(4)
    await expect(page.getByLabel('Рабочая среда')).toHaveValue('layout')
    const board = await page.locator('.artboard').boundingBox(),
      scale = board.width / 896
    await page.keyboard.press('j')
    await page.mouse.move(board.x + 125 * scale, board.y + 165 * scale)
    await page.mouse.down()
    for (const [x, y] of [
      [330, 165],
      [330, 280],
      [125, 280],
      [125, 165],
    ])
      await page.mouse.move(board.x + x * scale, board.y + y * scale, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByLabel('Под верхними текстовыми слоями')).toBeChecked()
    await page
      .getByRole('button', { name: 'Применить на новый слой', exact: true })
      .click({ timeout: 30000 })
    await expect(page.locator('.layer-row')).toHaveCount(5)
    await page.getByRole('button', { name: 'Обновить связанный текст', exact: true }).click()
    await page.getByRole('tab', { name: 'Слой', exact: true }).click()
    await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue(/город уже/)
    progress('record/replay a committed property change in native Windows')
    const xField = page.getByLabel('X', { exact: true }),
      xBefore = Number(await xField.inputValue())
    await page.keyboard.press('Control+Alt+r')
    await page.getByLabel('Название новой записи').fill('Windows: тайпсет')
    await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
    await xField.fill(String(xBefore + 10))
    await page.keyboard.press('Control+Alt+r')
    await expect(page.getByRole('dialog').locator('.action-step')).toHaveCount(1)
    await page.getByRole('button', { name: 'Выполнить операцию', exact: true }).click()
    await expect(xField).toHaveValue(String(xBefore + 20))
    // On a narrow window the middle of the tab strip is the document-name input.
    // Keep Ctrl+Z out of text editing; focus a real non-text UI control explicitly.
    await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
    await page.keyboard.press('Control+z')
    await expect(xField).toHaveValue(String(xBefore + 10))
    progress('save layout PSD through native atomic file writer')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.psd$/)
    const layoutPsd = (await fs.readdir(temp)).find((file) => file.endsWith('.psd') && file !== psd)
    assert.ok(layoutPsd)
    assert.ok((await fs.stat(path.join(temp, layoutPsd))).size > 10000)

    progress('native point bounds, editable vector controls and projected smart type')
    const nativeDoc = {
      version: 1,
      id: 'desktop-native-doc',
      name: 'Native layers',
      width: 800,
      height: 380,
      background: '#f5f2ee',
      dpi: 72,
      layers: [
        {
          id: 'desktop-point',
          name: 'Native point',
          kind: 'text',
          x: 40,
          y: 42,
          width: 16,
          height: 8,
          text: 'Редактируемый текст',
          fontFamily: 'Manrope',
          fontSize: 42,
          fontWeight: 700,
          italic: true,
          color: '#242336',
        },
        {
          id: 'desktop-shape',
          name: 'Native rounded',
          kind: 'shape',
          shape: 'rectangle',
          x: 60,
          y: 180,
          width: 210,
          height: 130,
          color: '#7355c6',
          cornerRadii: [4, 12, 20, 28],
          strokeColor: '#27263d',
          strokeWidth: 6,
          strokeAlign: 'inside',
        },
        {
          id: 'desktop-smart',
          name: 'Native smart',
          kind: 'text',
          x: 410,
          y: 200,
          width: 280,
          height: 55,
          text: 'Трансформация',
          fontFamily: 'Manrope',
          fontSize: 30,
          fontWeight: 600,
          color: '#6349bb',
          warp: [
            { x: 0.04, y: 0.02 },
            { x: 0.93, y: -0.08 },
            { x: 1.08, y: 1.06 },
            { x: 0, y: 1.02 },
          ],
        },
      ],
    }
    await page.getByLabel('Открыть изображение или проект').setInputFiles({
      name: 'native.777',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(nativeDoc)),
    })
    await page.getByRole('button', { name: 'Открыть проект', exact: true }).click()
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await page.locator('.layer-row').filter({ hasText: 'Native point' }).click()
    await expect(page.getByLabel('Текст слоя', { exact: true })).toHaveValue('Редактируемый текст')
    assert.ok(
      Number(await page.getByLabel('Ш', { exact: true }).inputValue()) > 300,
      'Point bounds must not remain at the obsolete 16px width',
    )
    await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator('.toast')).toContainText('Файл сохранён: Native layers.psd', {
      timeout: 30000,
    })
    const native = decodePsd(await fs.readFile(path.join(temp, 'Native layers.psd')))
    const point = native.children.find((l) => l.name === 'Native point')
    assert.equal(point.text.shapeType, 'point')
    assert.ok(point.imageData.width > 300)
    const shape = native.children.find((l) => l.name === 'Native rounded')
    assert.ok(shape.vectorFill && shape.vectorMask && shape.vectorStroke)
    assert.equal(shape.vectorOrigination.keyDescriptorList[0].keyOriginRRectRadii.topLeft.value, 4)

    progress('remove every private XMP and reopen native text, vector and embedded PSD')
    const removePrivate = (document) => {
      if (document.imageResources) delete document.imageResources.xmpMetadata
      for (const linked of document.linkedFiles || []) {
        if (!linked.data) continue
        const contents = decodePsd(linked.data)
        removePrivate(contents)
        linked.data = new Uint8Array(
          writePsd(contents, { noBackground: true, invalidateTextLayers: false }),
        )
      }
    }
    removePrivate(native)
    await page.getByLabel('Открыть изображение или проект').setInputFiles({
      name: 'native-only.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      buffer: Buffer.from(writePsd(native, { noBackground: true, invalidateTextLayers: false })),
    })
    await page
      .getByRole('button', { name: 'Открыть рабочую копию', exact: true })
      .click({ timeout: 30000 })
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await page.locator('.layer-row').filter({ hasText: 'Native point' }).click()
    const nativeText = page.getByLabel('Текст слоя', { exact: true })
    await expect(nativeText).toHaveValue('Редактируемый текст')
    await nativeText.fill('Нативный текст 777')
    await nativeText.press('Control+Enter')
    await page.locator('.layer-row').filter({ hasText: 'Native rounded' }).click()
    await expect(page.getByLabel('Верхний левый угол', { exact: true })).toHaveValue('4')
    await page.getByLabel('Верхний левый угол', { exact: true }).fill('24')
    await page.getByLabel('Верхний левый угол', { exact: true }).press('Enter')
    await expect(page.getByLabel('Нижний правый угол', { exact: true })).toHaveValue('20')
    await page
      .getByRole('button', { name: 'Открыть содержимое: Native smart', exact: true })
      .dblclick()
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await expect(nativeText).toHaveValue('Трансформация')
    await nativeText.fill('Готово')
    await nativeText.press('Control+Enter')
    await page.getByRole('button', { name: 'Применить в документ · Ctrl+S', exact: true }).click()
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator('.toast')).toContainText('Файл сохранён: native-only.psd', {
      timeout: 30000,
    })
    const updated = decodePsd(await fs.readFile(path.join(temp, 'native-only.psd')))
    assert.equal(
      updated.children.find((l) => l.name === 'Native point').text.text,
      'Нативный текст 777',
    )
    assert.equal(
      updated.children.find((l) => l.name === 'Native rounded').vectorOrigination
        .keyDescriptorList[0].keyOriginRRectRadii.topLeft.value,
      24,
    )
    const placed = updated.children.find((l) => l.name === 'Native smart').placedLayer
    const inner = decodePsd(updated.linkedFiles.find((l) => l.id === placed.id).data)
    assert.equal(inner.children[0].text.text, 'Готово')
    progress('0.6 command search creates native Levels in the real Windows renderer')
    const save06 = async () => {
      await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
      await page.keyboard.press('Control+s')
      await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
      await expect(page.locator('.toast')).toContainText('Файл сохранён: native-only.psd', {
        timeout: 30000,
      })
      return decodePsd(await fs.readFile(path.join(temp, 'native-only.psd')))
    }
    await page.locator('.layer-row').filter({ hasText: 'Native rounded' }).click()
    await page.keyboard.press('Control+f')
    await page.getByLabel('Найти команду').fill('levels')
    await page.getByLabel('Найти команду').press('Enter')
    await expect(page.getByLabel('Тип коррекции')).toHaveValue('levels')
    await page.getByLabel('Вход: чёрный', { exact: true }).fill('20')
    await page.getByLabel('Гамма уровней', { exact: true }).fill('1.25')
    await page.getByLabel('Гамма уровней', { exact: true }).press('Tab')
    let expanded = await save06()
    const levels = expanded.children.find((l) => l.adjustment?.type === 'levels')
    assert.equal(levels.adjustment.rgb.shadowInput, 20)
    assert.equal(levels.adjustment.rgb.midtoneInput, 1.25)

    progress('0.6 Quick Mask paints coverage, then creates a native masked Curves layer')
    await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('q')
    await expect(page.getByTestId('quick-mask-overlay')).toBeVisible()
    const region06 = await page.getByTestId('editor-canvas').boundingBox()
    await page.mouse.click(region06.x + region06.width * 0.2, region06.y + region06.height * 0.2)
    await page.keyboard.press('q')
    await page.keyboard.press('Control+m')
    await expect(page.getByLabel('Тип коррекции')).toHaveValue('curves')
    expanded = await save06()
    const curves = expanded.children.find((l) => l.adjustment?.type === 'curves')
    assert.ok(curves.mask?.imageData)
    const coverage06 = curves.mask.imageData.data
    assert.ok(coverage06.some((value, i) => i % 4 === 0 && value === 0))
    assert.ok(coverage06.some((value, i) => i % 4 === 0 && value === 255))

    progress('0.6 grid/guide controls write the standard PSD resource')
    await page.getByRole('button', { name: 'Вид', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Направляющие и сетка…', exact: true }).click()
    await page.getByLabel('Положение новой направляющей').fill('50%')
    await page.getByRole('button', { name: 'Добавить направляющую', exact: true }).click()
    await page.getByRole('button', { name: 'Применить разметку', exact: true }).click()
    expanded = await save06()
    assert.deepEqual(expanded.imageResources.gridAndGuidesInformation.guides, [
      { location: 400, direction: 'vertical' },
    ])

    progress('0.6 Magic Wand uses the production worker without erasing artwork')
    const beforeWand06 = await page.getByTestId('editor-canvas').evaluate(async (c) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return c.toDataURL()
    })
    await page.keyboard.press('w')
    await page.mouse.click(region06.x + region06.width * 0.96, region06.y + region06.height * 0.9)
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    const afterWand06 = await page.getByTestId('editor-canvas').evaluate((c) => c.toDataURL())
    assert.equal(afterWand06, beforeWand06)
    await page.keyboard.press('Control+d')

    progress(
      '0.6 raster filter worker creates a copy, retains the original smart PSD and undoes atomically',
    )
    await page
      .getByRole('button', { name: 'Открыть содержимое: Native smart', exact: true })
      .click()
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Растровые фильтры на копии…', exact: true }).click()
    await page.getByLabel('Растровый фильтр').selectOption('noise')
    await page
      .getByRole('button', { name: 'Применить на копии', exact: true })
      .click({ timeout: 30000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expanded = await save06()
    const original06 = expanded.children.find((l) => l.name === 'Native smart')
    const filtered06 = expanded.children.find((l) => l.name.includes('Добавить шум'))
    assert.ok(original06.placedLayer && original06.hidden)
    assert.ok(filtered06.imageData && !filtered06.placedLayer)
    await page.keyboard.press('Control+z')
    expanded = await save06()
    assert.equal(
      expanded.children.some((l) => l.name.includes('Добавить шум')),
      false,
    )
    assert.equal(expanded.children.find((l) => l.name === 'Native smart').hidden, false)
    progress('0.7 Pen creates real Bezier points; exact node expressions persist as native paths')
    await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).focus()
    await page.keyboard.press('p')
    const region07 = await page.getByTestId('editor-canvas').boundingBox()
    const point07 = (x, y) => [region07.x + region07.width * x, region07.y + region07.height * y]
    await page.mouse.click(...point07(0.65, 0.35))
    await page.mouse.move(...point07(0.83, 0.35))
    await page.mouse.down()
    await page.mouse.move(...point07(0.84, 0.47), { steps: 5 })
    await page.mouse.up()
    await page.mouse.click(...point07(0.74, 0.7))
    await page.mouse.click(...point07(0.65, 0.35))
    await expect(page.getByTestId('path-anchor')).toHaveCount(3)
    await page.getByTestId('path-anchor').nth(1).click()
    const nodeX07 = page.getByRole('spinbutton', { name: 'X узла', exact: true })
    const originalX07 = Number(await nodeX07.inputValue())
    await nodeX07.fill('+=24')
    await nodeX07.press('Enter')
    expanded = await save06()
    const path07 = expanded.children.find((l) => l.name.startsWith('Контур ') && l.vectorMask)
    assert.equal(path07.vectorMask.paths[0].knots.length, 3)
    assert.equal(path07.vectorMask.paths[0].open, false)
    assert.ok(Math.abs(path07.vectorMask.paths[0].knots[1].points[2] - originalX07 - 24) < 0.05)
    assert.notEqual(
      path07.vectorMask.paths[0].knots[1].points[0],
      path07.vectorMask.paths[0].knots[1].points[2],
    )

    progress('0.7 native photo filter and editable gradient-map stops in packaged renderer')
    await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Фотофильтр', exact: true }).click()
    await page.getByLabel('Плотность фотофильтра', { exact: true }).fill('2*29')
    await page.getByLabel('Плотность фотофильтра', { exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Карта градиента', exact: true }).click()
    await page.getByLabel('Пресет карты градиента').selectOption('2')
    expanded = await save06()
    assert.equal(
      expanded.children.find((l) => l.adjustment?.type === 'photo filter').adjustment.density,
      0.58,
    )
    assert.equal(
      expanded.children.find((l) => l.adjustment?.type === 'gradient map').adjustment.colorStops
        .length,
      3,
    )

    progress(
      '0.7 color-stack CUBE uses trusted atomic disk save, then reimports as embedded native LUT',
    )
    await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Экспорт цветового стека CUBE…', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить цветовой стек .cube', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 })
    const cube07 = await fs.readFile(path.join(temp, 'native-only-look.cube'))
    assert.ok(cube07.toString().includes('LUT_3D_SIZE 17'))
    await page.getByRole('button', { name: 'Коррекция', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Поиск цвета · 3D LUT', exact: true }).click()
    await page
      .getByLabel('Загрузить файл CUBE')
      .setInputFiles({ name: 'native-only-look.cube', mimeType: 'text/plain', buffer: cube07 })
    await expect(page.getByTestId('lut-properties')).toContainText('17 × 17 × 17')
    expanded = await save06()
    const lookup07 = expanded.children.find((l) => l.adjustment?.type === 'color lookup').adjustment
    assert.equal(lookup07.lutFormat, 'cube')
    assert.ok(Buffer.from(lookup07.lut3DFileData).toString().includes('LUT_3D_SIZE 17'))
    await page.locator('.layer-row').filter({ hasText: 'Карта градиента' }).click()
    await fs.mkdir('test-results', { recursive: true })
    await page.screenshot({
      path: executablePath ? 'test-results/desktop-packaged.png' : 'test-results/desktop.png',
    })
    assert.deepEqual(errors, [])
    progress(
      'passed: standalone sandbox/exports, J/recording, native text/vector/smart, command search, native adjustments/masks/guides, Quick Mask, Magic Wand, raster-filter worker/source preservation, native Bezier editing, numeric expressions, Photo/GradientMap and native CUBE I/O',
    )
  } catch (error) {
    await fs.mkdir('test-results', { recursive: true })
    await fs.writeFile(
      'test-results/desktop-errors.txt',
      `${phase}\n${error.stack}\n${errors.join('\n')}\n${consoleMessages.join('\n')}`,
    )
    if (page) {
      const state = await page
        .evaluate(() => ({
          focus: {
            tag: document.activeElement?.tagName,
            label: document.activeElement?.getAttribute('aria-label'),
          },
          dialogs: Array.from(document.querySelectorAll('[role=dialog]')).map((node) =>
            node.textContent?.slice(0, 4000),
          ),
          viewport: [innerWidth, innerHeight],
        }))
        .catch(() => null)
      consoleMessages.push(`UI state: ${JSON.stringify(state)}`)
    }
    if (page)
      await page
        .screenshot({ path: 'test-results/desktop-failure.png', timeout: 5000 })
        .catch(() => {})
    error.message += `\nPhase: ${phase}\nRenderer: ${[...errors, ...consoleMessages].join('\n').slice(0, 6000)}`
    throw error
  } finally {
    // A renderer beforeunload handler must not hang CI teardown on a failed test.
    const kill = setTimeout(() => app.process().kill(), 7000)
    kill.unref()
    await app
      .evaluate(({ app }) => {
        app.exit(0)
      })
      .catch(() => {})
    await app.close().catch(() => {})
    clearTimeout(kill)
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
  }
})()
  .then(() => clearTimeout(watchdog))
  .catch(fatal)
