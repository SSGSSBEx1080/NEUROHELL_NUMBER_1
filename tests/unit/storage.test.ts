import { beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { newDocument } from '../../src/engine/document'
import {
  forgetRecent,
  hasPendingWrites,
  loadDocument,
  pruneSourceRecords,
  readRecord,
  recentProjects,
  saveDocument,
  writeRecord,
} from '../../src/engine/storage'
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
describe('recovery storage', () => {
  it('late thumbnail completion never overwrites a newer edit or recovery pointer', async () => {
    const old = newDocument(100, 100, 'old', 'transparent'),
      recent = { ...old, name: 'new' }
    await saveDocument(recent, 'new-thumbnail', true, 200)
    await saveDocument(old, 'old-thumbnail', true, 100)
    expect((await loadDocument())?.name).toBe('new')
    expect((await recentProjects())[0].thumbnail).toBe('new-thumbnail')
    const other = newDocument(100, 100, 'other', 'transparent')
    await saveDocument(other, undefined, true, 150)
    expect((await loadDocument())?.id).toBe(old.id)
    expect(hasPendingWrites()).toBe(false)
  })
  it('retains eight recents, keeps thumbnails across autosaves and respects forget', async () => {
    for (let i = 0; i < 10; i++)
      await saveDocument(newDocument(100, 100, String(i), 'transparent'), `preview-${i}`)
    const recent = await recentProjects()
    expect(recent).toHaveLength(8)
    await saveDocument(recent[0].document)
    expect((await recentProjects())[0].thumbnail).toBe('preview-9')
    await forgetRecent(recent[0].id)
    expect(await loadDocument()).toBeNull()
    expect(await recentProjects()).toHaveLength(7)
  })
  it('prunes old orphaned PSD bytes but preserves referenced and newly imported sources', async () => {
    const createdAt = Date.now() - 2 * 86400000
    for (const id of ['keep', 'nested', 'orphan'])
      await writeRecord('sources', id, { createdAt, bytes: new ArrayBuffer(1) })
    await writeRecord('sources', 'pending', { createdAt: Date.now(), bytes: new ArrayBuffer(1) })
    const doc = newDocument(100, 100, 'kept', 'transparent')
    doc.sourceId = 'keep'
    const nested = newDocument(10, 10, 'inside', 'transparent')
    nested.sourceId = 'nested'
    doc.layers.push({
      id: 'smart',
      name: 'smart',
      kind: 'image',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      opacity: 1,
      rotation: 0,
      visible: true,
      locked: false,
      blendMode: 'source-over',
      smart: nested,
    })
    await saveDocument(doc)
    await pruneSourceRecords(true)
    expect(await readRecord('sources', 'orphan')).toBeUndefined()
    for (const id of ['keep', 'nested', 'pending'])
      expect(await readRecord('sources', id)).toBeTruthy()
  })
})
