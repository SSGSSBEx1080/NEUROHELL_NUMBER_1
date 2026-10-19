import { cacheImage, getImage, pruneImageCache } from '../../src/engine/render'
import { describe, expect, it } from 'vitest'
import {
  defaultRasterFilter,
  parseRasterFilter,
  processRasterFilter,
  rasterFilterNames,
  type RasterFilterKind,
  type RasterFilter,
} from '../../src/engine/rasterFilters'
import { transformMaskPixels } from '../../src/engine/maskOperations'
import { insertFilteredCopy } from '../../src/engine/filterLayers'
import { makeLayer, newDocument } from '../../src/engine/document'
const all = Object.keys(rasterFilterNames) as RasterFilterKind[]
const rgba = Uint8ClampedArray.from({ length: 7 * 5 * 4 }, (_, i) =>
  i % 4 === 3 ? (Math.floor(i / 4) % 3 ? 255 : 128) : (i * 73 + 37) % 256,
)
const run = (
  filter: RasterFilter,
  pixels = rgba,
  width = 7,
  height = 5,
  mask?: Uint8ClampedArray,
) => processRasterFilter({ width, height, pixels, filter, mask })
describe('bounded deterministic raster filters', () => {
  it.each(all)('%s preserves source alpha and never mutates the input', (type) => {
    const before = rgba.slice(),
      out = run(defaultRasterFilter(type))
    expect(rgba).toEqual(before)
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(rgba[i])
    expect(run(defaultRasterFilter(type), rgba, 7, 5, new Uint8ClampedArray(35))).toEqual(rgba)
  })
  it('weighted premultiplication prevents invisible RGB contaminating blur and mosaic', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0])
    expect([...run({ type: 'highpass', radius: 2 }, pixels, 2, 1)]).toEqual([
      128, 128, 128, 255, 0, 0, 255, 0,
    ])
    expect([
      ...run({ type: 'unsharp', radius: 2, amount: 500, threshold: 0 }, pixels, 2, 1),
    ]).toEqual([...pixels])
    expect([...run({ type: 'mosaic', size: 2 }, pixels, 2, 1)]).toEqual([...pixels])
  })
  it('mosaic averages RGB weighted by alpha without changing individual alpha', () => {
    const p = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128])
    expect([...run({ type: 'mosaic', size: 2 }, p, 2, 1)]).toEqual([
      170, 85, 0, 255, 170, 85, 0, 128,
    ])
  })
  it('sliding weighted median equals a brute-force reference, including clamped borders', () => {
    const result = run({ type: 'median', radius: 2 })
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 7; x++)
        for (let c = 0; c < 3; c++) {
          const samples: { v: number; a: number }[] = []
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const i =
                (Math.max(0, Math.min(4, y + dy)) * 7 + Math.max(0, Math.min(6, x + dx))) * 4
              samples.push({ v: rgba[i + c], a: rgba[i + 3] })
            }
          samples.sort((a, b) => a.v - b.v)
          const half = samples.reduce((n, v) => n + v.a, 0) / 2
          let sum = 0,
            median = 0
          for (const sample of samples) {
            sum += sample.a
            if (sum > half) {
              median = sample.v
              break
            }
          }
          expect(result[(y * 7 + x) * 4 + c], `${x},${y},${c}`).toBe(median)
        }
  })
  it('noise is seeded/reproducible and monochrome noise changes all gray channels equally', () => {
    const p = Uint8ClampedArray.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : 128)),
      f: RasterFilter = {
        type: 'noise',
        amount: 12,
        seed: 777,
        distribution: 'gaussian',
        monochrome: true,
      }
    const a = run(f, p, 4, 4)
    expect(run(f, p, 4, 4)).toEqual(a)
    expect(run({ ...f, seed: 123 }, p, 4, 4)).not.toEqual(a)
    for (let i = 0; i < a.length; i += 4) expect([a[i + 1], a[i + 2]]).toEqual([a[i], a[i]])
    expect(run({ ...f, amount: 0 }, p, 4, 4)).toEqual(p)
  })
  it('constant images stay constant with unsharp/median, High Pass is neutral and Sobel finds actual edges', () => {
    const flat = Uint8ClampedArray.from({ length: 100 }, (_, i) => (i % 4 === 3 ? 128 : 80))
    expect(run({ type: 'unsharp', radius: 30, amount: 500, threshold: 0 }, flat, 5, 5)).toEqual(
      flat,
    )
    expect(run({ type: 'median', radius: 5 }, flat, 5, 5)).toEqual(flat)
    expect(
      [...run({ type: 'highpass', radius: 3 }, flat, 5, 5)]
        .filter((_, i) => i % 4 !== 3)
        .every((v) => v === 128),
    ).toBe(true)
    const edges = Uint8ClampedArray.from({ length: 5 * 3 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.floor(i / 4) % 5 < 2 ? 0 : 255,
      ),
      out = run({ type: 'edges', strength: 1 }, edges, 5, 3)
    expect(out[(1 * 5 + 1) * 4]).toBe(0)
    expect(out[(1 * 5 + 4) * 4]).toBe(255)
  })
  it('feathered selection blends the filtered RGB once and never expands transparency', () => {
    const mask = new Uint8ClampedArray(35).fill(128),
      f = defaultRasterFilter('noise'),
      full = run(f),
      partial = run(f, rgba, 7, 5, mask)
    for (let i = 0; i < rgba.length; i++)
      expect(partial[i]).toBe(
        i % 4 === 3 ? rgba[i] : Math.round(rgba[i] + ((full[i] - rgba[i]) * 128) / 255),
      )
  })
  it('validates algorithms, finite parameters, dimensions and mask sizes before processing', () => {
    expect(() => parseRasterFilter({ type: 'code' })).toThrow()
    expect(() => parseRasterFilter({ type: 'noise', seed: NaN })).toThrow()
    expect(() => parseRasterFilter({ type: 'median', radius: 100 })).toThrow()
    expect(() =>
      processRasterFilter({
        width: 4096,
        height: 4096,
        pixels: new Uint8ClampedArray(1),
        filter: defaultRasterFilter('noise'),
      }),
    ).toThrow('8 Мп')
    expect(() => run(defaultRasterFilter('median'), rgba, 7, 5, new Uint8ClampedArray(1))).toThrow()
  })
})
describe('source preservation and mask-only commands', () => {
  it('inverts mask color, not alpha; preserves hidden RGB and uniform reveal/hide', () => {
    const p = new Uint8ClampedArray([20, 40, 60, 128, 0, 0, 0, 255])
    expect([...transformMaskPixels(p, 'invert')]).toEqual([235, 215, 195, 128, 255, 255, 255, 255])
    expect([...transformMaskPixels(p, 'white')]).toEqual([255, 255, 255, 128, 255, 255, 255, 255])
    expect([...transformMaskPixels(p, 'black')]).toEqual([0, 0, 0, 128, 0, 0, 0, 255])
    expect([...p]).toEqual([20, 40, 60, 128, 0, 0, 0, 255])
  })
  it('inserts a distinct raster result, hides but retains the original and preserves clipping scope', () => {
    const doc = newDocument(20, 20),
      source = makeLayer({ kind: 'image', name: 'Original', clipping: true }),
      copy = makeLayer({ kind: 'image', name: 'Filtered' })
    doc.layers = [source]
    const next = insertFilteredCopy(doc, source.id, copy)
    expect(next.layers).toHaveLength(2)
    expect(next.layers[0]).toMatchObject({ id: source.id, visible: false })
    expect(next.layers[1]).toMatchObject({ id: copy.id, clipping: true })
    expect(source.visible).toBe(true)
    expect(doc.layers).toHaveLength(1)
    expect(insertFilteredCopy(doc, source.id, copy, false).layers[0].visible).toBe(true)
    expect(() =>
      insertFilteredCopy({ ...doc, layers: [{ ...source, locked: true }] }, source.id, copy),
    ).toThrow()
  })
})

it('persistent bitmap cache keys are immutable; volatile mask previews remain replaceable', () => {
  const a = { width: 1, height: 1 } as HTMLCanvasElement,
    b = { width: 1, height: 1 } as HTMLCanvasElement
  cacheImage('test:immutable', a)
  cacheImage('test:immutable', b)
  expect(getImage('test:immutable')).toBe(a)
  cacheImage('mask-preview:test', a)
  cacheImage('mask-preview:test', b)
  expect(getImage('mask-preview:test')).toBe(b)
  pruneImageCache([])
})
