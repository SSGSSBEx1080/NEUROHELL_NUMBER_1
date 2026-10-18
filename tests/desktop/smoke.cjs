'use strict'
const { _electron: electron, expect } = require('@playwright/test')
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
      await expect(page.getByRole('dialog')).toBeHidden()
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
    progress('manga practice, native J worker and linked typesetting')
    await page.getByRole('button', { name: 'На главную', exact: true }).click()
    await page.getByTestId('open-manga-demo').click()
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await expect(page.locator('.layer-row')).toHaveCount(4)
    await expect(page.getByLabel('Рабочая среда')).toHaveValue('manga')
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
    await page.locator('.document-bar').click()
    await page.keyboard.press('Control+Alt+r')
    await page.getByLabel('Название новой записи').fill('Windows: тайпсет')
    await page.getByRole('button', { name: 'Начать запись', exact: true }).click()
    await xField.fill(String(xBefore + 10))
    await page.keyboard.press('Control+Alt+r')
    await expect(page.getByRole('dialog').locator('.action-step')).toHaveCount(1)
    await page.getByRole('button', { name: 'Выполнить операцию', exact: true }).click()
    await expect(xField).toHaveValue(String(xBefore + 20))
    await page.locator('.document-bar').click()
    await page.keyboard.press('Control+z')
    await expect(xField).toHaveValue(String(xBefore + 10))
    progress('save manga PSD through native atomic file writer')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.busy-overlay')).toBeHidden({ timeout: 30000 })
    await expect(page.locator('.toast')).toContainText(/Файл сохранён: .+\.psd$/)
    const mangaPsd = (await fs.readdir(temp)).find((file) => file.endsWith('.psd') && file !== psd)
    assert.ok(mangaPsd)
    assert.ok((await fs.stat(path.join(temp, mangaPsd))).size > 10000)
    await fs.mkdir('test-results', { recursive: true })
    await page.screenshot({
      path: executablePath ? 'test-results/desktop-packaged.png' : 'test-results/desktop.png',
    })
    assert.deepEqual(errors, [])
    progress(
      'passed: standalone sandbox, exports/reimport, J worker, linked manga type, recording/replay and native manga PSD',
    )
  } catch (error) {
    await fs.mkdir('test-results', { recursive: true })
    await fs.writeFile(
      'test-results/desktop-errors.txt',
      `${phase}\n${error.stack}\n${errors.join('\n')}\n${consoleMessages.join('\n')}`,
    )
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
