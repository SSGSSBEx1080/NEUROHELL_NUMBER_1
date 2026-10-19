'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const MAX_NAME_BYTES = 1024 * 1024
function nameTableFamily(table) {
  if (table.length < 6 || table.readUInt16BE(0) > 1) return undefined
  const count = table.readUInt16BE(2),
    strings = table.readUInt16BE(4)
  if (count > 4096 || 6 + count * 12 > table.length || strings < 6 + count * 12) return undefined
  let best
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12,
      platform = table.readUInt16BE(p),
      encoding = table.readUInt16BE(p + 2),
      language = table.readUInt16BE(p + 4),
      id = table.readUInt16BE(p + 6),
      length = table.readUInt16BE(p + 8),
      offset = strings + table.readUInt16BE(p + 10)
    if ((id !== 1 && id !== 16) || length < 1 || length > 640 || offset + length > table.length)
      continue
    const raw = table.subarray(offset, offset + length)
    let name
    if (
      (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) &&
      length % 2 === 0
    ) {
      const code = []
      for (let j = 0; j < length; j += 2) code.push(raw.readUInt16BE(j))
      name = String.fromCharCode(...code)
        .replace(/^\uFEFF/, '')
        .trim()
    } else if (platform === 1 && encoding === 0 && raw.every((n) => n < 128))
      name = raw.toString('ascii').trim()
    if (!name || name.length > 160 || /[\x00-\x1f";{}<>]/.test(name)) continue
    const score =
      (id === 16 ? 100 : 0) +
      (language === 0x409 ? 20 : 0) +
      (platform === 3 ? 5 : platform === 0 ? 3 : 0)
    if (!best || score > best.score) best = { name, score }
  }
  return best?.name
}
/** Read table directories and names only, never decode font glyphs or load font code. */
async function readFontFamilies(filename) {
  let file
  try {
    file = await fs.open(filename, 'r')
    const stat = await file.stat()
    const read = async (offset, length) => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        length < 0 ||
        length > MAX_NAME_BYTES ||
        offset + length > stat.size
      )
        throw new Error('Font table bounds')
      const buffer = Buffer.alloc(length),
        result = await file.read(buffer, 0, length, offset)
      if (result.bytesRead !== length) throw new Error('Truncated font')
      return buffer
    }
    const header = await read(0, 12)
    let offsets = [0]
    if (header.toString('ascii', 0, 4) === 'ttcf') {
      const count = header.readUInt32BE(8)
      if (!count || count > 128) return []
      const directory = await read(12, count * 4)
      offsets = Array.from({ length: count }, (_, i) => directory.readUInt32BE(i * 4))
    }
    const names = new Set()
    for (const offset of offsets) {
      const h = await read(offset, 12),
        signature = h.toString('ascii', 0, 4)
      if (h.readUInt32BE(0) !== 0x00010000 && !['OTTO', 'true', 'typ1'].includes(signature))
        continue
      const count = h.readUInt16BE(4)
      if (!count || count > 256) continue
      const tables = await read(offset + 12, count * 16)
      for (let i = 0; i < count; i++) {
        const p = i * 16
        if (tables.toString('ascii', p, p + 4) !== 'name') continue
        const length = tables.readUInt32BE(p + 12)
        if (length > MAX_NAME_BYTES) continue
        const name = nameTableFamily(await read(tables.readUInt32BE(p + 8), length))
        if (name) names.add(name)
      }
    }
    return [...names]
  } catch {
    return []
  } finally {
    await file?.close().catch(() => {})
  }
}
/** Fixed trusted Windows font folders supplied by the main process, not renderer IPC. */
async function probeFontFolders(folders) {
  const files = []
  for (const directory of folders) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries)
      if (entry.isFile() && /\.(ttf|otf|ttc)$/i.test(entry.name) && files.length < 2000)
        files.push(path.join(directory, entry.name))
  }
  let at = 0
  const names = new Set(),
    deadline = Date.now() + 12000
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (at < files.length && Date.now() < deadline) {
        const filename = files[at++]
        for (const family of await readFontFamilies(filename)) names.add(family)
      }
    }),
  )
  return [...names].sort().slice(0, 10000)
}
module.exports = { nameTableFamily, readFontFamilies, probeFontFolders }
