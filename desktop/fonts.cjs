'use strict'
const { execFile } = require('node:child_process')
const path = require('node:path')
const { probeFontFolders } = require('./fontProbe.cjs')
const normalize = (value) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(
        (n) =>
          typeof n === 'string' && n.length > 0 && n.length <= 160 && !/[\x00-\x1f";{}<>]/.test(n),
      ),
    ),
  ]
    .sort()
    .slice(0, 10000)
/** Cache concurrent calls, but never cache a rejected query. Injection is for unit
 * tests only; renderer IPC still accepts no command, path, or font bytes. */
function createFontLister(query, fallback) {
  let pending
  return () => {
    if (!pending)
      pending = (async () => {
        let firstError
        try {
          const names = normalize(await query())
          if (names.length) return names
        } catch (error) {
          firstError = error
        }
        const names = normalize(await fallback())
        if (names.length) return names
        throw new Error(
          `Windows не предоставила перечень шрифтов (${firstError?.code || 'нет данных'}). Можно загрузить TTF/OTF вручную.`,
        )
      })().catch((error) => {
        pending = undefined
        throw error
      })
    return pending
  }
}
const queryWindows = () =>
  new Promise((resolve, reject) => {
    const exe = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    execFile(
      exe,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; @($fonts.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) | ConvertTo-Json -Compress; $fonts.Dispose()',
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (error, output) => {
        if (error) {
          reject(error)
          return
        }
        try {
          resolve(JSON.parse(output.replace(/^\uFEFF/, '').trim()))
        } catch (error) {
          reject(error)
        }
      },
    )
  })
const windowsFonts = createFontLister(queryWindows, () =>
  probeFontFolders([
    path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts'),
    ...(process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')]
      : []),
  ]),
)
function listSystemFonts() {
  if (process.platform !== 'win32')
    return Promise.reject(
      new Error(
        'Автоматический перечень в настольной версии доступен только на Windows. Загрузи TTF/OTF вручную.',
      ),
    )
  return windowsFonts()
}
function trustedFontRequest(event, window) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false
  try {
    const u = new URL(event.senderFrame.url)
    return u.protocol === 'fsh777:' && u.host === 'studio' && !u.username && !u.password
  } catch {
    return false
  }
}
module.exports = { listSystemFonts, trustedFontRequest, createFontLister }
