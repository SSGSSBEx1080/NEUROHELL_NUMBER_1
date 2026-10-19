'use strict'
const test = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os')
const {
  nameTableFamily,
  readFontFamilies,
  probeFontFolders,
} = require('../../desktop/fontProbe.cjs')
const { createFontLister } = require('../../desktop/fonts.cjs')
function table(entries) {
  const strings = entries.map((e) => Buffer.from(e.name, 'utf16le').swap16()),
    base = 6 + entries.length * 12
  const data = Buffer.alloc(base + strings.reduce((n, b) => n + b.length, 0))
  data.writeUInt16BE(entries.length, 2)
  data.writeUInt16BE(base, 4)
  let offset = 0
  entries.forEach((entry, i) => {
    const p = 6 + i * 12
    data.writeUInt16BE(3, p)
    data.writeUInt16BE(1, p + 2)
    data.writeUInt16BE(entry.language || 0x409, p + 4)
    data.writeUInt16BE(entry.id, p + 6)
    data.writeUInt16BE(strings[i].length, p + 8)
    data.writeUInt16BE(offset, p + 10)
    strings[i].copy(data, base + offset)
    offset += strings[i].length
  })
  return data
}
function sfnt(name, offset = 28) {
  const names = table([{ id: 16, name }]),
    out = Buffer.alloc(offset + names.length)
  out.writeUInt32BE(0x00010000, 0)
  out.writeUInt16BE(1, 4)
  out.write('name', 12)
  out.writeUInt32BE(offset, 20)
  out.writeUInt32BE(names.length, 24)
  names.copy(out, offset)
  return out
}
test('font name table prefers real typographic/English family and rejects malformed records', () => {
  assert.equal(
    nameTableFamily(
      table([
        { id: 1, name: 'Legacy' },
        { id: 16, name: 'Семейство', language: 0x419 },
        { id: 16, name: 'Real Family' },
      ]),
    ),
    'Real Family',
  )
  assert.equal(nameTableFamily(Buffer.alloc(3)), undefined)
  assert.equal(nameTableFamily(table([{ id: 16, name: 'bad;family' }])), undefined)
  const invalid = table([{ id: 1, name: 'Valid' }])
  invalid.writeUInt16BE(65000, 4)
  assert.equal(nameTableFamily(invalid), undefined)
})
test('bounded sfnt/TTC probe reads family tables, not glyphs, and skips corrupt files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh-font-probe-'))
  try {
    await fs.writeFile(path.join(dir, 'one.ttf'), sfnt('Real One'))
    const a = sfnt('Face A'),
      b = sfnt('Face B'),
      startA = 20,
      startB = 20 + a.length,
      ttc = Buffer.alloc(startB + b.length)
    ttc.write('ttcf')
    ttc.writeUInt32BE(0x00010000, 4)
    ttc.writeUInt32BE(2, 8)
    ttc.writeUInt32BE(startA, 12)
    ttc.writeUInt32BE(startB, 16)
    a.writeUInt32BE(startA + 28, 20)
    b.writeUInt32BE(startB + 28, 20)
    a.copy(ttc, startA)
    b.copy(ttc, startB)
    await fs.writeFile(path.join(dir, 'two.ttc'), ttc)
    await fs.writeFile(path.join(dir, 'bad.otf'), Buffer.from('not a font'))
    assert.deepEqual(await readFontFamilies(path.join(dir, 'two.ttc')), ['Face A', 'Face B'])
    assert.deepEqual(await probeFontFolders([dir, path.join(dir, 'missing')]), [
      'Face A',
      'Face B',
      'Real One',
    ])
    const hostile = sfnt('Hidden')
    hostile.writeUInt32BE(0xffffffff, 20)
    await fs.writeFile(path.join(dir, 'hostile.ttf'), hostile)
    assert.deepEqual(await readFontFamilies(path.join(dir, 'hostile.ttf')), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
test('failed GDI queries use actual folder results, coalesce requests and do not cache rejection', async () => {
  let queries = 0,
    probes = 0
  const list = createFontLister(
    async () => {
      queries++
      throw Object.assign(new Error('slow'), { code: 'ETIMEDOUT' })
    },
    async () => {
      probes++
      return ['Arial', 'Arial', 'Segoe UI']
    },
  )
  assert.deepEqual(await Promise.all([list(), list()]), [
    ['Arial', 'Segoe UI'],
    ['Arial', 'Segoe UI'],
  ])
  assert.equal(queries, 1)
  assert.equal(probes, 1)
  let calls = 0
  const retry = createFontLister(
    async () => {
      calls++
      if (calls === 1) throw new Error('failed')
      return ['Real Family']
    },
    async () => [],
  )
  await assert.rejects(retry())
  assert.deepEqual(await retry(), ['Real Family'])
  assert.equal(calls, 2)
})
