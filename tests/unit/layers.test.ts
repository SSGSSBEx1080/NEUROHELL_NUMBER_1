import { trimInactiveHistories } from '../../src/engine/history'
import { describe, expect, it } from 'vitest'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import {
  deleteLayers,
  duplicateLayers,
  groupLayers,
  moveLayer,
  ungroupLayers,
  visibleLayerRows,
} from '../../src/engine/layerOperations'
const setup = () => {
  const d = newDocument(100, 100, 'test', 'transparent')
  d.layers = ['a', 'b', 'c'].map((name) => makeLayer({ name, x: 10, y: 20, width: 20, height: 20 }))
  return d
}
describe('group structure', () => {
  it('groups selected siblings, unfolds real descendants and ungroups without orphans', () => {
    const before = setup(),
      { document: doc, selectedId } = groupLayers(before, [
        before.layers[0].id,
        before.layers[1].id,
      ])
    expect(doc.layers.filter((l) => l.parentId === selectedId)).toHaveLength(2)
    expect(visibleLayerRows(doc).filter((r) => r.depth === 1)).toHaveLength(2)
    expect(parseProject(doc).layers).toHaveLength(4)
    const after = ungroupLayers(doc, selectedId)
    expect(after.layers).toHaveLength(3)
    expect(after.layers.every((l) => !l.parentId)).toBe(true)
    expect(deleteLayers(doc, selectedId).layers.map((l) => l.name)).toEqual(['c'])
  })
  it('duplicates complete groups with fresh IDs and linked mask translation', () => {
    const before = setup(),
      grouped = groupLayers(before, [before.layers[0].id, before.layers[1].id])
    const layer = grouped.document.layers.find((l) => l.id === grouped.selectedId)!
    layer.mask = {
      src: 'data:image/png;base64,',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      enabled: true,
      linked: true,
      density: 1,
      feather: 0,
      defaultColor: 255,
    }
    const result = duplicateLayers(grouped.document, grouped.selectedId)
    expect(result.document.layers).toHaveLength(7)
    expect(new Set(result.document.layers.map((l) => l.id)).size).toBe(7)
    expect(result.document.layers.filter((l) => l.parentId === result.selectedId)).toHaveLength(2)
    const clone = result.document.layers.find((l) => l.id === result.selectedId)!
    expect(clone.mask?.x).toBe(24)
    expect(clone.x).toBe(24)
  })
  it('reparents explicitly and rejects cycles and locked destinations', () => {
    const d = setup(),
      grouped = groupLayers(d, [d.layers[0].id]),
      id = grouped.selectedId
    const moved = moveLayer(grouped.document, d.layers[1].id, 0, id)
    expect(moved.layers.find((l) => l.id === d.layers[1].id)?.parentId).toBe(id)
    expect(() => moveLayer(moved, id, 0, id)).toThrow(/самой себя/)
    const locked = {
      ...moved,
      layers: moved.layers.map((l) => (l.id === id ? { ...l, locked: true } : l)),
    }
    expect(() => moveLayer(locked, d.layers[2].id, 0, id)).toThrow(/разблокируй/)
    expect(deleteLayers(locked, d.layers[0].id)).toBe(locked)
  })
  it('does not silently discard a group mask when ungrouping', () => {
    const { document: doc, selectedId } = groupLayers(setup(), [])
    doc.layers.find((l) => l.id === selectedId)!.opacity = 0.5
    expect(() => ungroupLayers(doc, selectedId)).toThrow(/наложения/)
  })
})

it('the aggregate history target never evicts an open document or the active undo stack', () => {
  const before = setup(),
    after = { ...before, layers: before.layers.map((l) => ({ ...l, src: 'a'.repeat(100) })) }
  const entries = [before, after].map((document) => ({
    document,
    label: 'test',
    time: 0,
    selectedId: null,
  }))
  const sessions = new Map(
    ['active', 'inactive'].map((id) => [id, { document: after, entries, index: 1 }]),
  )
  expect(trimInactiveHistories(sessions, 'active', 10)).toBe(true)
  expect(sessions.get('active')!.entries).toHaveLength(2)
  expect(sessions.get('inactive')!.entries).toHaveLength(1)
  expect(sessions.get('inactive')!.document).toBe(after)
})
