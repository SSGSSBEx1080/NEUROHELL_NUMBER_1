import { describe, expect, it } from 'vitest'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { parseScript, parseScriptFile, scriptFile } from '../../src/engine/scriptFormat'
import { typesetEntry } from '../../src/engine/script'
import { sameVisual } from '../../src/engine/psdSource'
import type { TranslationEntry } from '../../src/types'
const entry: TranslationEntry = {
  id: 'line-1',
  source: 'こんにちは',
  translation: 'Привет!',
  speaker: 'Аки',
  note: 'Спокойно',
  status: 'translated',
}
describe('Translation script data and transactional typesetting', () => {
  it('creates editable framed text and its link in one immutable document', () => {
    const doc = { ...newDocument(600, 800), script: [entry] }
    const result = typesetEntry(doc, entry.id, { x: 20, y: 40, width: 140, height: 100 })
    expect(result.document.layers[0]).toMatchObject({
      kind: 'text',
      text: 'Привет!',
      x: 20,
      y: 40,
      width: 140,
      textFrame: { shape: 'ellipse' },
    })
    expect(result.document.script![0].layerId).toBe(result.selectedId)
    expect(doc.layers).toHaveLength(0)
    expect(entry.layerId).toBeUndefined()
    expect(typesetEntry(result.document, entry.id).document.layers).toHaveLength(1)
  })
  it('honors ancestor locks, one-to-one links and layer limits without partial writes', () => {
    const group = makeLayer({ kind: 'group', locked: true }),
      target = makeLayer({ kind: 'text', parentId: group.id })
    const doc = {
      ...newDocument(),
      layers: [group, target],
      script: [{ ...entry, layerId: target.id }],
    }
    expect(() => typesetEntry(doc, entry.id)).toThrow(/незаблокированный/)
    const unlocked = {
      ...doc,
      layers: [target],
      script: [entry, { ...entry, id: 'line-2', layerId: target.id }],
    }
    expect(() => typesetEntry(unlocked, entry.id, null, target.id)).toThrow(/уже связан/)
    expect(() =>
      typesetEntry(
        { ...doc, layers: Array.from({ length: 100 }, () => makeLayer()), script: [entry] },
        entry.id,
      ),
    ).toThrow(/100/)
    expect(() =>
      typesetEntry({ ...doc, script: [{ ...entry, translation: '   ' }] }, entry.id),
    ).toThrow(/введи/)
  })
  it('roundtrips in project data but script-only edits never dirty visual preservation', () => {
    const doc = newDocument()
    expect(sameVisual(doc, { ...doc, script: [entry] })).toBe(true)
    const result = typesetEntry({ ...doc, script: [entry] }, entry.id)
    const parsed = parseProject(JSON.parse(JSON.stringify(result.document)))
    expect(parsed.script).toEqual(result.document.script)
    expect(parsed.layers[0].textFrame).toEqual(result.document.layers[0].textFrame)
    expect(
      parseProject({ ...doc, script: [{ ...entry, layerId: 'missing' }] }).script![0].layerId,
    ).toBeUndefined()
  })
  it('exchanges only bounded data, regenerates IDs and never applies imported foreign links', () => {
    const input = JSON.parse(scriptFile('Page 1', [{ ...entry, layerId: 'secret-layer' }]))
    expect(input.entries[0].layerId).toBeUndefined()
    input.entries[0].layerId = 'external-layer'
    const parsed = parseScriptFile(input)
    expect(parsed[0]).toMatchObject({ ...entry, id: expect.any(String), layerId: undefined })
    expect(parsed[0].id).not.toBe(entry.id)
    expect(() => parseScript([{ ...entry, translation: 'x'.repeat(5001) }])).toThrow(/5000/)
    expect(() => parseScript(Array(201).fill(entry))).toThrow(/200/)
    expect(() => parseScript([entry, entry])).toThrow(/уникальными/)
    expect(() => parseScriptFile({ version: 2, entries: [entry] })).toThrow()
  })
})
