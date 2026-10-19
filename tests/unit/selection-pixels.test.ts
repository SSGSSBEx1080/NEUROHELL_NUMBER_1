import { describe, expect, it } from 'vitest'
import {
  combineCoverage,
  modifyCoverage,
  rasterSelection,
  selectWand,
  selectColorRange,
  validateSelectionSize,
} from '../../src/engine/selectionPixels'
import { gestureSelectionMode, sampleCoverage, selectionContains } from '../../src/engine/selection'
import { rasterOutline } from '../../src/engine/selectionOutline'
import { trimHistory, trimInactiveHistories } from '../../src/engine/history'
import { makeLayer, newDocument } from '../../src/engine/document'
import { startRecording, recordEditorEvent } from '../../src/engine/actionRecorder'
const rect = (w: number, h: number, x: number, y: number, width: number, height: number) =>
  Uint8ClampedArray.from({ length: w * h }, (_, i) =>
    i % w >= x && i % w < x + width && Math.floor(i / w) >= y && Math.floor(i / w) < y + height
      ? 255
      : 0,
  )
describe('selection coverage and set operations', () => {
  it('preserves fractional coverage, holes and idempotence', () => {
    const a = new Uint8ClampedArray([0, 64, 128, 255]),
      b = new Uint8ClampedArray([255, 128, 64, 0])
    expect([...combineCoverage(a, b, 'add')]).toEqual([255, 128, 128, 255])
    expect([...combineCoverage(a, b, 'subtract')]).toEqual([0, 0, 64, 255])
    expect([...combineCoverage(a, b, 'intersect')]).toEqual([0, 64, 64, 0])
    expect(combineCoverage(a, a, 'add')).toEqual(a)
    expect(combineCoverage(a, a, 'intersect')).toEqual(a)
    expect([...combineCoverage(a, a, 'subtract')]).toEqual([0, 0, 0, 0])
  })
  it('keeps an empty selection distinct from deselection, bounds only nonzero coverage', () => {
    const empty = rasterSelection(new Uint8ClampedArray(36), 6, 6)
    expect(empty).toMatchObject({ width: 0, height: 0 })
    expect(empty.raster).toBeTruthy()
    expect(selectionContains(empty, { x: 2, y: 2 })).toBe(false)
    const s = rasterSelection(rect(20, 10, 4, 3, 6, 5), 20, 10)
    expect(s).toMatchObject({ x: 4, y: 3, width: 6, height: 5 })
    expect(sampleCoverage(s.raster!, 4.5, 3.5)).toBe(255)
    expect(sampleCoverage(s.raster!, 4, 3.5)).toBe(127.5)
    expect(sampleCoverage(s.raster!, -100, 3)).toBe(0)
  })
  it.each([
    ['replace', false, false, 'replace'],
    ['replace', true, false, 'add'],
    ['replace', false, true, 'subtract'],
    ['replace', true, true, 'intersect'],
    ['subtract', false, false, 'subtract'],
  ] as const)('modifiers %s %s %s resolve to %s', (fallback, shiftKey, altKey, expected) =>
    expect(gestureSelectionMode({ shiftKey, altKey }, fallback)).toBe(expected),
  )
  it('merges boundary runs and bounds noisy display paths, never changing coverage', () => {
    const r = rasterSelection(rect(40, 30, 5, 6, 20, 10), 40, 30).raster!
    expect(rasterOutline(r)).toMatchObject({ simplified: false })
    expect(rasterOutline(r).path.match(/M/g)).toHaveLength(4)
    let seed = 1234567
    const noisy = Uint8ClampedArray.from({ length: 256 * 256 }, () => {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        return (seed >>> 0) % 2 ? 255 : 0
      }),
      copy = noisy.slice(),
      n = rasterSelection(noisy, 256, 256).raster!
    expect(rasterOutline(n).path.match(/M/g)?.length || 0).toBeLessThanOrEqual(12000)
    expect(rasterOutline(n).simplified).toBe(true)
    expect(noisy).toEqual(copy)
  })
  it('rejects invalid dimensions and parameters', () => {
    expect(() => validateSelectionSize(4097, 1, 4097)).toThrow()
    expect(() => validateSelectionSize(8, 8, 4)).toThrow()
    expect(() => modifyCoverage(new Uint8ClampedArray(16), 4, 4, 'expand', Infinity)).toThrow()
    expect(() =>
      combineCoverage(new Uint8ClampedArray(1), new Uint8ClampedArray(2), 'add'),
    ).toThrow()
  })
})
describe('Euclidean morphology and feathering', () => {
  it.each(['expand', 'contract'] as const)(
    '%s agrees with a brute-force circular reference, including document edges',
    (kind) => {
      const w = 17,
        h = 13,
        r = 3,
        data = Uint8ClampedArray.from({ length: w * h }, (_, i) =>
          ((i * 9301 + 49297) % 233280) % 11 < 7 ? 255 : 0,
        ),
        actual = modifyCoverage(data, w, h, kind, r)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let expected = data[y * w + x]
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dy * dy > r * r) continue
              const value =
                x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h
                  ? 0
                  : data[(y + dy) * w + x + dx]
              expected = kind === 'expand' ? Math.max(expected, value) : Math.min(expected, value)
            }
          expect(actual[y * w + x], `${x},${y}`).toBe(expected)
        }
    },
  )
  it('handles a single seed, no seeds, all selected, radius zero and border rings', () => {
    const w = 9,
      h = 9,
      point = rect(w, h, 4, 4, 1, 1)
    expect([...modifyCoverage(point, w, h, 'expand', 1)].filter(Boolean)).toHaveLength(5)
    expect(
      [...modifyCoverage(new Uint8ClampedArray(w * h), w, h, 'expand', 100)].some(Boolean),
    ).toBe(false)
    expect(
      [...modifyCoverage(new Uint8ClampedArray(w * h).fill(255), w, h, 'contract', 100)].some(
        Boolean,
      ),
    ).toBe(false)
    expect(modifyCoverage(point, w, h, 'feather', 0)).toEqual(point)
    const square = rect(w, h, 2, 2, 5, 5),
      border = modifyCoverage(square, w, h, 'border', 1)
    expect(border[4 * w + 4]).toBe(0)
    expect(border[2 * w + 4]).toBe(255)
    expect(border[1 * w + 4]).toBe(255)
  })
  it('feathers symmetrically and removes isolated dots by smoothing', () => {
    const point = rect(21, 21, 10, 10, 1, 1),
      soft = modifyCoverage(point, 21, 21, 'feather', 2)
    expect(soft[10 * 21 + 10]).toBeGreaterThan(0)
    expect(soft[10 * 21 + 10]).toBeLessThan(255)
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) expect(soft[y * 21 + x]).toBe(soft[(20 - y) * 21 + 20 - x])
    expect([...modifyCoverage(point, 21, 21, 'smooth', 1)].some(Boolean)).toBe(false)
    expect([...point].filter(Boolean)).toHaveLength(1)
  })
})
describe('color-based selection, not destructive erasing', () => {
  const pixels = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255, 200, 0, 0, 255, 1, 2, 3, 0])
  it('wand separates connected and global matches, including transparent seeds', () => {
    expect([...selectWand(pixels, 4, 1, 0, 0, 0, true)]).toEqual([255, 0, 0, 0])
    expect([...selectWand(pixels, 4, 1, 0, 0, 0, false)]).toEqual([255, 0, 255, 0])
    expect([...selectWand(pixels, 4, 1, 3, 0, 0, true)]).toEqual([0, 0, 0, 255])
    expect([...pixels]).toEqual([200, 0, 0, 255, 0, 200, 0, 255, 200, 0, 0, 255, 1, 2, 3, 0])
  })
  it('color range weights alpha, supports multiple samples, invert and exact zero fuzziness', () => {
    const input = new Uint8ClampedArray([
      20, 40, 60, 128, 20, 40, 61, 255, 200, 0, 0, 255, 20, 40, 60, 0,
    ])
    expect([...selectColorRange(input, 4, 1, [[20, 40, 60]], 0, 'sampled', 128)]).toEqual([
      128, 0, 0, 0,
    ])
    expect([
      ...selectColorRange(
        input,
        4,
        1,
        [
          [20, 40, 60],
          [200, 0, 0],
        ],
        0,
        'sampled',
        128,
      ),
    ]).toEqual([128, 0, 255, 0])
    expect([...selectColorRange(input, 4, 1, [[20, 40, 60]], 0, 'sampled', 128, true)]).toEqual([
      127, 255, 255, 255,
    ])
  })
  it.each(['shadows', 'midtones', 'highlights'] as const)(
    'tonal %s excludes transparent pixels',
    (mode) => {
      const mask = selectColorRange(pixels, 4, 1, [], 30, mode, 128)
      expect(mask[3]).toBe(0)
    },
  )
})
describe('selection history is bounded and action recording is honest', () => {
  it('counts unique raster-selection buffers, including inactive document histories', () => {
    const doc = newDocument(8, 8),
      entries = Array.from({ length: 6 }, (_, i) => ({
        document: doc,
        label: `Selection ${i}`,
        time: i,
        selectedId: null,
        pixelSelection: rasterSelection(new Uint8ClampedArray(64).fill(i), 8, 8),
      }))
    expect(trimHistory(entries, 50, 130)).toHaveLength(2)
    const sessions = new Map([
      ['active', { document: doc, entries: entries.slice(0, 1), index: 0 }],
      ['other', { document: doc, entries, index: 5, pixelSelection: entries[5].pixelSelection }],
    ])
    expect(trimInactiveHistories(sessions, 'active', 130)).toBe(true)
    expect(sessions.get('other')!.entries).toHaveLength(1)
  })
  it('reports a selection operation as an unsupported recorded command, not a silent skip', () => {
    const doc = newDocument(),
      l = makeLayer()
    doc.layers = [l]
    const rec = startRecording(doc, l.id, 'Selection')
    const next = recordEditorEvent(rec, {
      type: 'pixel-selection',
      document: doc,
      selectedId: l.id,
    })
    expect(next.steps).toHaveLength(1)
    expect(next.steps[0].command).toBeUndefined()
    expect(next.steps[0].unsupported).toContain('выделения')
  })
})
