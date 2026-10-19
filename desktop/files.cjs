'use strict'
const path = require('node:path')
const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const approved = new Map()
const allowed = new Set([
  '.psd',
  '.psb',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.777',
  '.json',
  '.cube',
])
function validateSaveRequest(value) {
  if (
    !value ||
    typeof value.name !== 'string' ||
    value.name.length > 240 ||
    !(value.bytes instanceof Uint8Array) ||
    !value.bytes.length ||
    value.bytes.byteLength > 128 * 1024 * 1024
  )
    throw new Error('Недопустимые данные сохранения (до 128 МиБ)')
  const name = path
    .basename(value.name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
  if (!allowed.has(path.extname(name).toLowerCase()))
    throw new Error('Неподдерживаемый формат сохранения')
  if (path.extname(name).toLowerCase() === '.cube') {
    if (value.bytes.byteLength > 2 * 1024 * 1024) throw new Error('CUBE: до 2 МиБ')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(value.bytes)
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
      !/(^|\n)\s*LUT_3D_SIZE\s+\d+\s*(\r?\n|$)/.test(text)
    )
      throw new Error('Ожидается текстовая таблица CUBE, не исполняемый или бинарный файл')
  }
  const documentId =
    typeof value.documentId === 'string' && value.documentId.length <= 128
      ? value.documentId
      : undefined
  return { name, bytes: value.bytes, documentId, saveAs: value.saveAs === true }
}
/** Same-directory atomic replace: a failed encode/write never truncates the existing user's PSD. */
async function atomicWrite(filename, bytes) {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  )
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await fs.rename(temporary, filename)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}
async function saveFile(value, window, dialog, downloads) {
  const { name, bytes, documentId, saveAs } = validateSaveRequest(value)
  const key = documentId ? `${documentId}:${path.extname(name).toLowerCase()}` : undefined
  let filename = key && !saveAs ? approved.get(key) : undefined
  if (!filename) {
    const ext = path.extname(name).slice(1).toLowerCase()
    const result = await dialog.showSaveDialog(window, {
      title: 'ФШ 777 — сохранить файл',
      buttonLabel: 'Сохранить',
      defaultPath: path.join(downloads, name),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    })
    if (result.canceled || !result.filePath) return { state: 'cancelled', name }
    filename = result.filePath
  }
  try {
    await atomicWrite(filename, bytes)
    if (key) {
      approved.delete(key)
      approved.set(key, filename)
      if (approved.size > 32) approved.delete(approved.keys().next().value)
    }
    return { state: 'completed', name: path.basename(filename) }
  } catch (error) {
    return {
      state: 'interrupted',
      name: path.basename(filename),
      message: `Не удалось записать файл (${error.code || 'ошибка'}). Проверь место на диске, права и не открыт ли он другой программой. Исходный файл не обрезан.`,
    }
  }
}
const batchFolders = new Map()
/**
 * The renderer never sees or supplies a filesystem path: it receives an opaque
 * id for a folder the user picked in the native dialog, and every batch file
 * is written inside that folder under a validated basename, without overwriting.
 */
async function chooseBatchFolder(window, dialog) {
  const result = await dialog.showOpenDialog(window, {
    title: 'ФШ777 ULTRA — папка для пакетного вывода',
    buttonLabel: 'Выбрать папку вывода',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths?.length) return { state: 'cancelled', name: '' }
  const folder = result.filePaths[0]
  const stat = await fs.stat(folder).catch(() => undefined)
  if (!stat?.isDirectory()) throw new Error('Выбранная папка вывода недоступна')
  const id = randomUUID()
  batchFolders.set(id, folder)
  if (batchFolders.size > 4) batchFolders.delete(batchFolders.keys().next().value)
  return { state: 'completed', id, name: path.basename(folder) || folder }
}
async function saveBatchFile(value) {
  const { name, bytes } = validateSaveRequest(value)
  const folder = typeof value?.folderId === 'string' ? batchFolders.get(value.folderId) : undefined
  if (!folder) throw new Error('Папка пакетного вывода не выбрана или уже недоступна')
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length) || 'file'
  for (let attempt = 1; attempt <= 100; attempt++) {
    const candidate = attempt === 1 ? name : `${stem} (${attempt})${ext}`
    const target = path.join(folder, candidate)
    if (path.dirname(target) !== folder) throw new Error('Недопустимое имя файла пакета')
    try {
      await fs.access(target)
      continue // Never overwrite an existing file during batch output.
    } catch {
      await atomicWrite(target, bytes)
      return { state: 'completed', name: candidate }
    }
  }
  return {
    state: 'interrupted',
    name,
    message: 'Не нашлось свободного имени файла в папке вывода (100 совпадений).',
  }
}
module.exports = { validateSaveRequest, atomicWrite, saveFile, chooseBatchFolder, saveBatchFile }
