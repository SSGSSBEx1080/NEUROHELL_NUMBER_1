import { describe, expect, it } from 'vitest'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import {
  parseTextEntries,
  parseTextEntriesFile,
  textEntriesFile,
} from '../../src/engine/textEntriesFormat'
import { placeTextEntry } from '../../src/engine/textEntries'
import { sameVisual } from '../../src/engine/psdSource'
import type { TextEntry } from '../../src/types'
const entry: TextEntry = {
  id: 'line-1',
  source: 'Исходный текст',
  text: 'Новый текст',
  label: 'Блок 01',
  note: 'Заметка',
  status: 'ready',
}
describe('Text entry data and transactional placement', () => {
  it('creates editable framed text and its link in one immutable document', () => {
    const doc = { ...newDocument(600, 800), textEntries: [entry] }
    const result = placeTextEntry(doc, entry.id, { x: 20, y: 40, width: 140, height: 100 })
    expect(result.document.layers[0]).toMatchObject({
      kind: 'text',
      text: 'Новый текст',
      x: 20,
      y: 40,
      width: 140,
      textFrame: { shape: 'rectangle' },
    })
    expect(result.document.textEntries![0].layerId).toBe(result.selectedId)
    expect(doc.layers).toHaveLength(0)
    expect(entry.layerId).toBeUndefined()
    expect(placeTextEntry(result.document, entry.id).document.layers).toHaveLength(1)
  })
  it('honors ancestor locks, one-to-one links and layer limits without partial writes', () => {
    const group = makeLayer({ kind: 'group', locked: true }),
      target = makeLayer({ kind: 'text', parentId: group.id })
    const doc = {
      ...newDocument(),
      layers: [group, target],
      textEntries: [{ ...entry, layerId: target.id }],
    }
    expect(() => placeTextEntry(doc, entry.id)).toThrow(/незаблокированный/)
    const unlocked = {
      ...doc,
      layers: [target],
      textEntries: [entry, { ...entry, id: 'line-2', layerId: target.id }],
    }
    expect(() => placeTextEntry(unlocked, entry.id, null, target.id)).toThrow(/уже связан/)
    expect(() =>
      placeTextEntry(
        { ...doc, layers: Array.from({ length: 100 }, () => makeLayer()), textEntries: [entry] },
        entry.id,
      ),
    ).toThrow(/100/)
    expect(() =>
      placeTextEntry({ ...doc, textEntries: [{ ...entry, text: '   ' }] }, entry.id),
    ).toThrow(/введи/)
  })
  it('roundtrips in project data but text-entry-only edits never dirty visual preservation', () => {
    const doc = newDocument()
    expect(sameVisual(doc, { ...doc, textEntries: [entry] })).toBe(true)
    const result = placeTextEntry({ ...doc, textEntries: [entry] }, entry.id)
    const parsed = parseProject(JSON.parse(JSON.stringify(result.document)))
    expect(parsed.textEntries).toEqual(result.document.textEntries)
    expect(parsed.layers[0].textFrame).toEqual(result.document.layers[0].textFrame)
    expect(
      parseProject({ ...doc, textEntries: [{ ...entry, layerId: 'missing' }] }).textEntries![0]
        .layerId,
    ).toBeUndefined()
  })
  it('exchanges only bounded data, regenerates IDs and never applies imported foreign links', () => {
    const input = JSON.parse(textEntriesFile('Page 1', [{ ...entry, layerId: 'secret-layer' }]))
    expect(input.entries[0].layerId).toBeUndefined()
    input.entries[0].layerId = 'external-layer'
    const parsed = parseTextEntriesFile(input)
    expect(parsed[0]).toMatchObject({ ...entry, id: expect.any(String), layerId: undefined })
    expect(parsed[0].id).not.toBe(entry.id)
    expect(() => parseTextEntries([{ ...entry, text: 'x'.repeat(5001) }])).toThrow(/5000/)
    expect(() => parseTextEntries(Array(201).fill(entry))).toThrow(/200/)
    expect(() => parseTextEntries([entry, entry])).toThrow(/уникальными/)
    expect(() => parseTextEntriesFile({ version: 2, entries: [entry] })).toThrow()
  })
})

describe('older document and exchange compatibility', () => {
  const legacy = {
    id: 'legacy-entry',
    source: 'Исходный образец',
    translation: 'Сохранённый текст',
    speaker: 'Метка 1',
    note: 'Заметка',
    status: 'translated',
    layerId: 'legacy-text',
  }
  it('normalizes old metadata without changing user text, IDs, links or existing frame geometry', () => {
    const old = {
      ...newDocument(),
      layers: [
        makeLayer({
          id: 'legacy-text',
          kind: 'text',
          text: 'Сохранённый текст',
          textFrame: {
            shape: 'ellipse',
            padding: 12,
            autoFit: true,
            minFontSize: 10,
            verticalAlign: 'middle',
          },
        }),
      ],
      script: [legacy],
    }
    const snapshot = JSON.stringify(old),
      parsed = parseProject(old)
    expect(parsed.textEntries).toEqual([
      {
        id: legacy.id,
        source: legacy.source,
        text: legacy.translation,
        label: legacy.speaker,
        note: legacy.note,
        status: 'ready',
        layerId: 'legacy-text',
      },
    ])
    expect(parsed.layers[0].textFrame?.shape).toBe('ellipse')
    expect('script' in parsed).toBe(false)
    expect(JSON.stringify(old)).toBe(snapshot)
    const out = JSON.parse(textEntriesFile('Document', parsed.textEntries!))
    expect(out.format).toBe('fsh777-texts')
    expect(out.entries[0]).not.toHaveProperty('translation')
    expect(out.entries[0]).not.toHaveProperty('speaker')
    expect(out.entries[0]).not.toHaveProperty('layerId')
  })
  it('reads old exchange states, remaps only interchange IDs and drops foreign links', () => {
    const entries = parseTextEntriesFile({
      format: 'fsh777-script',
      version: 1,
      entries: [
        legacy,
        { ...legacy, id: 'second', status: 'proofread' },
        { ...legacy, id: 'third', status: 'draft' },
      ],
    })
    expect(entries.map((e) => e.status)).toEqual(['ready', 'checked', 'draft'])
    expect(entries[0].text).toBe(legacy.translation)
    expect(entries.every((e) => !e.layerId)).toBe(true)
    expect(entries[0].id).not.toBe(legacy.id)
  })
  it('migrates embedded documents and refuses ambiguous models instead of discarding one list', () => {
    const inner = { ...newDocument(), script: [legacy] }
    const doc = {
      ...newDocument(),
      layers: [makeLayer({ kind: 'image', src: 'data:image/png;base64,AA==', smart: inner })],
    }
    expect(parseProject(doc).layers[0].smart?.textEntries?.[0].text).toBe(legacy.translation)
    expect(() => parseProject({ ...inner, textEntries: [entry] })).toThrow('два разных')
    expect(() => parseTextEntries([legacy])).toThrow('Неоднозначные')
    expect(() =>
      parseTextEntriesFile({ format: 'fsh777-script', version: 1, entries: [entry] }),
    ).toThrow('Неоднозначные')
  })
  it('never changes the pixel-appearance comparison merely by migrating text metadata', () => {
    const doc = newDocument()
    const parsed = parseProject({ ...doc, script: [legacy] })
    expect(
      sameVisual(parsed, {
        ...parsed,
        textEntries: [{ ...parsed.textEntries![0], text: 'Правка метаданных' }],
      }),
    ).toBe(true)
    expect(
      sameVisual(parsed, {
        ...parsed,
        layers: [makeLayer({ kind: 'text', text: 'Видимые пиксели' })],
      }),
    ).toBe(false)
  })
})
