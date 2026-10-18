import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { processPixels } from '../../src/engine/pixels'
import { polygonSelection, selectionContains } from '../../src/engine/selection'
import { nativeFontStyle, fontInfo } from '../../src/engine/fonts'
import { ReplaceDocumentCommand, trimHistory } from '../../src/engine/history'
import { newDocument } from '../../src/engine/document'
const pixels = (colors: number[][]) => new Uint8ClampedArray(colors.flat())

describe('selection and bucket', () => {
  it('uses polygon and ellipse membership, including inverted selections', () => {
    const s = polygonSelection([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ])!
    expect(selectionContains(s, { x: 2, y: 2 })).toBe(true)
    expect(selectionContains(s, { x: 8, y: 8 })).toBe(false)
    expect(selectionContains({ ...s, inverted: true }, { x: 8, y: 8 })).toBe(true)
    expect(
      selectionContains({ x: 0, y: 0, width: 10, height: 10, ellipse: true }, { x: 0, y: 0 }),
    ).toBe(false)
    expect(polygonSelection([{ x: 0, y: 0 }])).toBe(null)
  })
  it('fills connected equal colors only and blends opacity through a selection mask', () => {
    const p = pixels([
      [255, 255, 255, 255],
      [255, 0, 0, 255],
      [255, 255, 255, 255],
    ])
    const result = processPixels({
      operation: 'bucket',
      width: 3,
      height: 1,
      pixels: p,
      color: [0, 0, 255, 255],
      tolerance: 1,
    })
    expect([...result]).toEqual([0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255])
    const masked = processPixels({
      operation: 'bucket',
      width: 3,
      height: 1,
      pixels: p,
      color: [0, 0, 255, 255],
      mask: pixels([
        [0, 0, 0, 128],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    })
    expect([...masked.slice(0, 4)]).toEqual([127, 127, 255, 255])
  })
  it('does not flood from a transparent area into opaque black', () => {
    const result = processPixels({
      operation: 'bucket',
      width: 2,
      height: 1,
      pixels: pixels([
        [0, 0, 0, 0],
        [0, 0, 0, 255],
      ]),
      color: [0, 255, 0, 255],
    })
    expect([...result]).toEqual([0, 255, 0, 255, 0, 0, 0, 255])
  })
  it('erases only masked pixels and retains feathered alpha', () => {
    const p = pixels(Array.from({ length: 3 }, () => [255, 255, 255, 255]))
    const result = processPixels({
      operation: 'erase',
      width: 3,
      height: 1,
      pixels: p,
      mask: pixels([
        [0, 0, 0, 255],
        [0, 0, 0, 128],
        [0, 0, 0, 0],
      ]),
      rect: { x: 0, y: 0, width: 3, height: 1 },
    })
    expect([result[3], result[7], result[11]]).toEqual([0, 127, 255])
  })
  it('rejects invalid buffers and unbounded dimensions before allocation', () => {
    expect(() =>
      processPixels({
        operation: 'bucket',
        width: 5000,
        height: 2,
        pixels: new Uint8ClampedArray(40000),
      }),
    ).toThrow()
    expect(() =>
      processPixels({ operation: 'erase', width: 1, height: 1, pixels: new Uint8ClampedArray(4) }),
    ).toThrow()
  })
})
describe('font metadata and command history', () => {
  it('reads a real OFL variable TTF and rejects corrupt name tables', () => {
    const b = readFileSync('public/fonts/catalog/oswald.ttf'),
      data = new Uint8Array(b).buffer
    const info = fontInfo(data, 'fallback')
    expect(info.family).toBe('Oswald')
    expect(info.postscriptName).toMatch(/Oswald/)
    expect(info.weight).toBe('100 900')
    expect(() => fontInfo(new ArrayBuffer(16), 'x')).toThrow()
    const damaged = data.slice(0, 100)
    expect(() => fontInfo(damaged, 'x')).toThrow()
  })
  it('commands restore exact snapshots and trim old transitions', () => {
    const a = newDocument(10, 10, 'A', 'transparent'),
      b = { ...a, name: 'B' },
      c = new ReplaceDocumentCommand(a, b, 'rename')
    expect(c.execute()).toBe(b)
    expect(c.undo()).toBe(a)
    const entries = Array.from({ length: 60 }, (_, time) => ({
      document: a,
      time,
      label: 'step',
      selectedId: null,
      command: c,
    }))
    const result = trimHistory(entries, 10)
    expect(result).toHaveLength(11)
    expect(result[0].command).toBeUndefined()
  })
})

it('uses declared native PostScript instances rather than CSS family names or double bold', () => {
  expect(nativeFontStyle('Manrope', 600)).toEqual({
    font: { name: 'Manrope-SemiBold' },
    fauxBold: false,
    fauxItalic: false,
  })
  expect(nativeFontStyle('Manrope', 700).fauxBold).toBe(false)
  expect(nativeFontStyle('Arial', 700).font.name).toBe('Arial-BoldMT')
  expect(nativeFontStyle('Unknown font', 700, true)).toEqual({
    font: { name: 'Unknown font' },
    fauxBold: true,
    fauxItalic: true,
  })
})
