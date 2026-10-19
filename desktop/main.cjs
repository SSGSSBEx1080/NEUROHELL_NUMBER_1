'use strict'
const {
  app,
  BrowserWindow,
  Menu,
  protocol,
  net,
  session,
  nativeTheme,
  screen,
  dialog,
  ipcMain,
} = require('electron')
const { saveFile, chooseBatchFolder, saveBatchFile } = require('./files.cjs')
const { listSystemFonts, trustedFontRequest } = require('./fonts.cjs')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { resolveAsset, mime, CSP } = require('./security.cjs')

app.setName('FSH777')
app.setAppUserModelId('app.fsh777.editor')
const profile = app.commandLine.getSwitchValue('user-data-dir')
if (profile) {
  fs.mkdirSync(path.resolve(profile), { recursive: true })
  app.setPath('userData', path.resolve(profile))
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fsh777',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])
const single = app.requestSingleInstanceLock()
let window
if (!single) app.quit()
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  app
    .whenReady()
    .then(async () => {
      nativeTheme.themeSource = 'dark'
      ipcMain.handle('fsh777:save-file', async (event, value) => {
        if (!trustedFontRequest(event, window)) throw new Error('Untrusted save request')
        return saveFile(value, window, dialog, app.getPath('downloads'))
      })
      ipcMain.handle('fsh777:choose-batch-folder', async (event) => {
        if (!trustedFontRequest(event, window)) throw new Error('Untrusted batch request')
        return chooseBatchFolder(window, dialog)
      })
      ipcMain.handle('fsh777:save-batch-file', async (event, value) => {
        if (!trustedFontRequest(event, window)) throw new Error('Untrusted batch request')
        return saveBatchFile(value)
      })
      ipcMain.handle('fsh777:list-fonts', async (event) => {
        if (!trustedFontRequest(event, window)) throw new Error('Untrusted font request')
        return listSystemFonts()
      })
      Menu.setApplicationMenu(null)
      const root = path.join(__dirname, '..', 'dist')
      protocol.handle('fsh777', async (request) => {
        const file = resolveAsset(root, request.url)
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile())
          return new Response('Not found', { status: 404 })
        try {
          const response = await net.fetch(pathToFileURL(file).toString())
          return new Response(response.body, {
            status: response.status,
            headers: {
              'Content-Type': mime(file),
              'Content-Security-Policy': CSP,
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch {
          return new Response('Cannot read application resource', { status: 500 })
        }
      })
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.on('will-download', (_event, item, contents) => {
        const filename = path.basename(item.getFilename()).replace(/[<>:"|?*]/g, '_')
        item.setSaveDialogOptions({
          title: 'ФШ 777 — сохранить файл',
          buttonLabel: 'Сохранить',
          defaultPath: path.join(app.getPath('downloads'), filename),
        })
        item.once('done', (_e, state) => {
          if (!contents.isDestroyed())
            contents.send('fsh777:download-status', { state, name: filename })
        })
      })
      const createWindow = () => {
        const area = screen.getPrimaryDisplay().workArea
        let saved = {}
        try {
          saved = JSON.parse(
            fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'),
          )
        } catch {
          /* first launch */
        }
        const width = Math.min(area.width, Math.max(900, Number(saved.width) || 1440))
        const height = Math.min(area.height, Math.max(640, Number(saved.height) || 940))
        window = new BrowserWindow({
          width,
          height,
          minWidth: Math.min(900, area.width),
          minHeight: Math.min(640, area.height),
          show: false,
          title: 'ФШ 777 — независимая студия',
          backgroundColor: '#19191e',
          icon: path.join(__dirname, 'icon.png'),
          autoHideMenuBar: true,
          webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            spellcheck: false,
          },
        })
        window.webContents.on('will-prevent-unload', (event) => {
          const response = dialog.showMessageBoxSync(window, {
            type: 'question',
            title: 'ФШ 777 — закрыть проект?',
            message: 'Автосохранение ещё не завершено или недоступно.',
            detail:
              'Останься в редакторе и сохрани проект через Ctrl+S, чтобы не потерять изменения.',
            buttons: ['Остаться', 'Закрыть без ожидания'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          })
          if (response === 1) event.preventDefault()
        })
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', (event, url) => {
          if (!resolveAsset(root, url)) event.preventDefault()
        })
        window.once('ready-to-show', () => {
          if (saved.maximized) window.maximize()
          window.show()
        })
        window.on('close', () => {
          try {
            const bounds = window.getNormalBounds()
            fs.writeFileSync(
              path.join(app.getPath('userData'), 'window.json'),
              JSON.stringify({
                width: bounds.width,
                height: bounds.height,
                maximized: window.isMaximized(),
              }),
            )
          } catch {
            /* the editor also supports read-only user settings */
          }
        })
        window.on('closed', () => {
          window = undefined
        })
        window.loadURL('fsh777://studio/index.html')
      }
      createWindow()
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow()
      })
    })
    .catch((error) => {
      dialog.showErrorBox('Не удалось запустить ФШ 777', String(error.message || error))
      app.quit()
    })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
