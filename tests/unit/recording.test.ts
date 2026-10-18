import { describe, expect, it } from 'vitest'
import { makeLayer, newDocument } from '../../src/engine/document'
import {
  startRecording,
  recordEditorEvent,
  resumeRecording,
  type Recording,
} from '../../src/engine/actionRecorder'
import {
  actionBlockers,
  parseActionCommand,
  parseActionSet,
  runAction,
  type StudioAction,
} from '../../src/engine/actions'
import { defaultStyles } from '../../src/engine/styles'
import { duplicateLayers } from '../../src/engine/layerOperations'
import type { EditorDocument, Layer } from '../../src/types'
const action = (recording: Recording): StudioAction => ({
  id: 'test',
  name: recording.name,
  source: 'test',
  steps: recording.steps,
})
const setup = () => {
  const layer = makeLayer({
    kind: 'text',
    name: 'Текст',
    text: 'Привет',
    fontSize: 20,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
  })
  return { ...newDocument(), layers: [layer] }
}
const edit = (doc: EditorDocument, patch: Partial<Layer>) => ({
  ...doc,
  layers: [{ ...doc.layers[0], ...patch }, ...doc.layers.slice(1)],
})
const record = (r: Recording, before: EditorDocument, after: EditorDocument, label = 'Изменение') =>
  recordEditorEvent(r, {
    type: 'commit',
    before,
    after,
    label,
    selectedId: before.layers[0]?.id || null,
  })
describe('Real recording and validated transactional playback', () => {
  it('records final geometry, typography, color and style; replay is relative and input immutable', () => {
    const doc = setup(),
      after = edit(doc, {
        x: 30,
        y: 40,
        width: 200,
        height: 100,
        fontSize: 30,
        styles: {
          ...defaultStyles(),
          stroke: { enabled: true, size: 2, color: '#ffffff', position: 'outside' },
        },
        adjustments: { ...doc.layers[0].adjustments, contrast: 25 },
      })
    const r = record(startRecording(doc, doc.layers[0].id, 'Тайпсет'), doc, after)
    expect(r.steps.map((s) => s.command?.type)).toEqual(['transform', 'adjust', 'properties'])
    const target = edit(doc, { x: 100, y: 200 }),
      result = runAction(target, target.layers[0].id, action(r))
    expect(result.document.layers[0]).toMatchObject({
      x: 120,
      y: 220,
      width: 200,
      height: 100,
      fontSize: 30,
      styles: after.layers[0].styles,
      adjustments: { contrast: 25 },
    })
    expect(target.layers[0].x).toBe(100)
    expect(doc.layers[0].styles).toBeUndefined()
  })
  it('records actual duplication and applies following properties to the copy', () => {
    const doc = setup(),
      original = doc.layers[0],
      copy = duplicateLayers(doc, original.id, 24)
    let r = record(startRecording(doc, original.id, 'Копия'), doc, copy.document)
    expect(r.steps[0].command).toEqual({ type: 'duplicate', offset: { x: 24, y: 24 } })
    r = recordEditorEvent(r, {
      type: 'selection',
      document: copy.document,
      selectedId: copy.selectedId,
    })
    expect(r.steps).toHaveLength(1)
    const after = {
      ...copy.document,
      layers: copy.document.layers.map((l) =>
        l.id === copy.selectedId ? { ...l, opacity: 0.5 } : l,
      ),
    }
    r = record(r, copy.document, after)
    const result = runAction(doc, original.id, action(r))
    expect(result.document.layers).toHaveLength(2)
    expect(result.document.layers[0]).toBe(original)
    expect(result.document.layers[1]).toMatchObject({ x: 34, opacity: 0.5 })
  })
  it('selects relative stack positions and validates the entire sequence before committing', () => {
    const doc = setup()
    doc.layers.push(makeLayer({ kind: 'image', src: 'data:image/png;base64,AA==' }))
    let r = startRecording(doc, doc.layers[0].id, 'Несколько слоёв')
    r = recordEditorEvent(r, { type: 'selection', document: doc, selectedId: doc.layers[1].id })
    const after = { ...doc, layers: [doc.layers[0], { ...doc.layers[1], opacity: 0.4 }] }
    r = record(r, doc, after)
    expect(r.steps[0].command).toEqual({ type: 'select', offset: 1 })
    expect(runAction(doc, doc.layers[0].id, action(r)).document.layers[1].opacity).toBe(0.4)
    expect(() =>
      runAction({ ...doc, layers: [doc.layers[0]] }, doc.layers[0].id, action(r)),
    ).toThrow(/границы/)
    expect(doc.layers[0].opacity).toBe(1)
  })
  it('keeps linked masks aligned while rejecting painted masks and brush/J/new-content steps', () => {
    const doc = setup()
    doc.layers[0].mask = {
      src: 'data:image/png;base64,AA==',
      x: 15,
      y: 23,
      width: 80,
      height: 30,
      enabled: true,
      linked: true,
      density: 1,
      feather: 0,
      defaultColor: 0,
    }
    const after = edit(doc, {
      x: 30,
      y: 40,
      width: 200,
      height: 100,
      mask: { ...doc.layers[0].mask, x: 40, y: 46, width: 160, height: 60 },
    })
    const r = record(startRecording(doc, doc.layers[0].id, 'Маска'), doc, after)
    expect(actionBlockers(action(r))).toHaveLength(0)
    expect(runAction(doc, doc.layers[0].id, action(r)).document.layers[0].mask).toEqual(
      after.layers[0].mask,
    )
    const painted = edit(doc, {
      mask: { ...doc.layers[0].mask, src: 'data:image/png;base64,AQ==' },
    })
    expect(
      actionBlockers(action(record(startRecording(doc, doc.layers[0].id, 'Кисть'), doc, painted))),
    ).toHaveLength(1)
    const raster = edit(doc, { kind: 'image', src: 'data:image/png;base64,AA==' })
    expect(
      actionBlockers(action(record(startRecording(doc, doc.layers[0].id, 'Растр'), doc, raster))),
    ).toHaveLength(1)
    const repair = {
      ...doc,
      layers: [
        ...doc.layers,
        makeLayer({ kind: 'image', name: 'Восстановление', src: 'data:image/png;base64,AQ==' }),
      ],
    }
    expect(
      actionBlockers(action(record(startRecording(doc, doc.layers[0].id, 'J'), doc, repair))),
    ).toHaveLength(1)
  })
  it('makes history navigation explicit and auto-pauses cross-document operations; pause is genuine', () => {
    const doc = setup(),
      initial = startRecording(doc, doc.layers[0].id, 'Запись')
    const paused = { ...initial, paused: true }
    expect(record(paused, doc, edit(doc, { opacity: 0.5 }))).toBe(paused)
    expect(resumeRecording(paused, doc, doc.layers[0].id).paused).toBe(false)
    const changed = recordEditorEvent(initial, {
      type: 'document',
      document: newDocument(),
      selectedId: null,
    })
    expect(changed.paused).toBe(true)
    expect(actionBlockers(action(changed))).toHaveLength(1)
    expect(() => resumeRecording(changed, newDocument(), null)).toThrow(/исходный/)
    const undo = recordEditorEvent(initial, {
      type: 'history',
      document: doc,
      selectedId: doc.layers[0].id,
    })
    expect(undo.steps[0].unsupported).toMatch(/Undo/)
  })
  it('blocks inherited locks and late invalid commands without mutating earlier layers', () => {
    const doc = setup(),
      id = doc.layers[0].id
    const a: StudioAction = {
      id: 'a',
      name: 'bad',
      source: 'test',
      steps: [
        { name: 'color', enabled: true, command: { type: 'properties', values: { opacity: 0.2 } } },
        {
          name: 'bad',
          enabled: true,
          command: { type: 'transform', dx: 32000, dy: 0, scaleX: 1, scaleY: 1, angle: 0 },
        },
      ],
    }
    expect(() => runAction(doc, id, a)).toThrow(/размеры/)
    expect(doc.layers[0].opacity).toBe(1)
    const group = makeLayer({ kind: 'group', locked: true })
    doc.layers[0].parentId = group.id
    doc.layers.push(group)
    expect(() => runAction(doc, id, a)).toThrow(/группу/)
    expect(() => startRecording(doc, id, 'locked')).toThrow(/незаблокированный/)
  })
  it('strictly validates imported properties, unknown commands, limits and versions', () => {
    for (const values of [
      { src: 'https://bad' },
      { fontSize: Infinity },
      { fontFamily: 'foo";url(x)' },
      { width: 100000 },
      { opacity: -1 },
      JSON.parse('{"__proto__":{"polluted":1}}'),
    ])
      expect(() => parseActionCommand({ type: 'properties', values })).toThrow()
    expect(parseActionCommand({ type: 'eval', code: 'bad' })).toBeUndefined()
    const doc = setup()
    let r = startRecording(doc, doc.layers[0].id, 'Большая запись')
    for (let i = 0; i < 220; i++) r = record(r, doc, edit(doc, { opacity: 0.5 }))
    expect(r.steps.length).toBeLessThanOrEqual(200)
    expect(r.paused).toBe(true)
  })
  it('serializes replayable commands and preserves explicit blockers; delete ends with no selected layer', () => {
    const doc = setup(),
      r = record(startRecording(doc, doc.layers[0].id, 'Удалить'), doc, { ...doc, layers: [] })
    const imported = parseActionSet(
      JSON.parse(JSON.stringify({ version: 2, actions: [action(r)] })),
    )[0]
    expect(runAction(doc, doc.layers[0].id, imported)).toMatchObject({
      selectedId: null,
      document: { layers: [] },
    })
    const blocked = parseActionSet({
      version: 2,
      actions: [
        {
          name: 'blocked',
          steps: [
            { name: 'J', enabled: true, unsupported: 'Локальное восстановление не записано' },
          ],
        },
      ],
    })[0]
    expect(blocked.steps[0].unsupported).toBe('Локальное восстановление не записано')
    expect(() => parseActionSet({ version: '2', actions: [] })).toThrow()
    expect(() =>
      parseActionSet({
        version: 2,
        actions: [
          { name: 'x', steps: Array(201).fill({ name: 'x', command: { type: 'invert' } }) },
        ],
      }),
    ).toThrow()
  })
})
