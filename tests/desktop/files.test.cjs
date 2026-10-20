const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os')
const {
  atomicWrite,
  validateSaveRequest,
  saveFile,
  chooseBatchFolder,
  saveBatchFile,
} = require('../../desktop/files.cjs')
test('native save validates bounded data and format, never accepts renderer paths', () => {
  for (const value of [
    null,
    {},
    { name: 'script.js', bytes: new Uint8Array([1]) },
    { name: 'a.psd', bytes: [] },
    { name: 'a.psd', bytes: new Uint8Array(0) },
  ])
    assert.throws(() => validateSaveRequest(value))
  const good = validateSaveRequest({ name: '../folder/пример.psd', bytes: new Uint8Array([1, 2]) })
  assert.equal(good.name, 'пример.psd')
})
test('atomic save replaces an existing file and leaves no temporary data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh777-write-'))
  try {
    const file = path.join(dir, 'project.psd')
    await fs.writeFile(file, 'old')
    await atomicWrite(file, new Uint8Array([8, 66, 80, 83]))
    assert.deepEqual([...(await fs.readFile(file))], [8, 66, 80, 83])
    assert.deepEqual(await fs.readdir(dir), ['project.psd'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
test('cancelled native Save As does not write; Ctrl+S reuses only a user-approved path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh777-dialog-'))
  try {
    const bytes = new Uint8Array([1, 2, 3]),
      value = { name: 'chosen.psd', bytes, documentId: 'test-document' }
    const cancel = await saveFile(
      value,
      {},
      { showSaveDialog: async () => ({ canceled: true }) },
      dir,
    )
    assert.equal(cancel.state, 'cancelled')
    assert.deepEqual(await fs.readdir(dir), [])
    let calls = 0
    const dialog = {
      showSaveDialog: async () => {
        calls++
        return { canceled: false, filePath: path.join(dir, 'user-selected.psd') }
      },
    }
    assert.equal((await saveFile(value, {}, dialog, dir)).state, 'completed')
    assert.equal(
      (await saveFile({ ...value, bytes: new Uint8Array([4]) }, {}, dialog, dir)).state,
      'completed',
    )
    assert.equal(calls, 1)
    assert.deepEqual([...(await fs.readFile(path.join(dir, 'user-selected.psd')))], [4])
    await saveFile({ ...value, saveAs: true }, {}, dialog, dir)
    assert.equal(calls, 2)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('CUBE export stays an explicitly allowed bounded text format, never an executable path', () => {
  const text = new TextEncoder().encode('TITLE "Safe"\nLUT_3D_SIZE 2\n0 0 0\n')
  assert.equal(validateSaveRequest({ name: 'look.cube', bytes: text }).name, 'look.cube')
  assert.throws(() => validateSaveRequest({ name: 'look.exe', bytes: text }))
  assert.throws(() =>
    validateSaveRequest({ name: 'look.cube', bytes: new Uint8Array([77, 90, 0, 1]) }),
  )
  assert.throws(() =>
    validateSaveRequest({ name: 'look.cube', bytes: new Uint8Array(2 * 1024 * 1024 + 1) }),
  )
  assert.throws(() =>
    validateSaveRequest({ name: 'look.cube', bytes: new TextEncoder().encode('console.log(1)') }),
  )
})

test('batch output writes only inside the user-picked folder and never overwrites', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsh777-batch-'))
  try {
    await assert.rejects(() =>
      saveBatchFile({ folderId: 'missing', name: 'a.png', bytes: new Uint8Array([1]) }),
    )
    const cancelled = await chooseBatchFolder(
      {},
      { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    )
    assert.equal(cancelled.state, 'cancelled')
    const chosen = await chooseBatchFolder(
      {},
      { showOpenDialog: async () => ({ canceled: false, filePaths: [dir] }) },
    )
    assert.equal(chosen.state, 'completed')
    assert.equal(typeof chosen.id, 'string')
    assert.equal(chosen.name, path.basename(dir))
    await fs.writeFile(path.join(dir, 'copy.png'), 'original')
    const first = await saveBatchFile({
      folderId: chosen.id,
      name: '../evil/copy.png',
      bytes: new Uint8Array([9]),
    })
    assert.equal(first.state, 'completed')
    assert.equal(first.name, 'copy (2).png')
    assert.equal(await fs.readFile(path.join(dir, 'copy.png'), 'utf8'), 'original')
    assert.deepEqual([...(await fs.readFile(path.join(dir, 'copy (2).png')))], [9])
    const second = await saveBatchFile({
      folderId: chosen.id,
      name: 'copy.png',
      bytes: new Uint8Array([7]),
    })
    assert.equal(second.name, 'copy (3).png')
    await assert.rejects(() =>
      saveBatchFile({ folderId: chosen.id, name: 'run.exe', bytes: new Uint8Array([1]) }),
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
