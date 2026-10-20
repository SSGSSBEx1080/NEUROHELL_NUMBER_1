import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  applyCorrection,
  applyCorrectionInPlace,
  curveValue,
  histogram,
} from '../../src/engine/adjustmentMath'
import {
  correctionNames,
  defaultCorrection,
  parseCorrection,
  type CorrectionKind,
  type Correction,
} from '../../src/engine/adjustmentTypes'
import { exportAdjustment, importAdjustment } from '../../src/engine/psdAdjustments'
import { makeLayer, newDocument, parseProject, hitTest } from '../../src/engine/document'
import { duplicateLayers } from '../../src/engine/layerOperations'
import { parseActionCommand } from '../../src/engine/actionSchema'
import { runAction } from '../../src/engine/actions'
initializeCanvas(
  () => {
    throw new Error('No canvas needed for native adjustment verification')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
const all = Object.keys(correctionNames) as CorrectionKind[]
const rgba = new Uint8ClampedArray([32, 96, 224, 255, 30, 140, 220, 128, 45, 80, 120, 0])
describe('non-destructive adjustment mathematics', () => {
  it.each(
    all.filter(
      (k) => !['invert', 'posterize', 'threshold', 'black & white', 'gradient map'].includes(k),
    ),
  )('%s default is identity, including hidden RGB and alpha', (type) => {
    const source = Uint8ClampedArray.from({ length: 256 * 4 }, (_, i) =>
      i % 4 === 3 ? i % 256 : (i * 37) % 256,
    )
    expect(applyCorrection(source, defaultCorrection(type))).toEqual(source)
    expect(source[0]).toBe(0)
  })
  it.each(all)('%s never changes backdrop alpha', (type) => {
    const result = applyCorrection(rgba, defaultCorrection(type), 0.7)
    expect([result[3], result[7], result[11]]).toEqual([255, 128, 0])
    expect(result.slice(8)).toEqual(rgba.slice(8))
  })
  it.each(all)('%s in-place result is byte-identical to the copying apply', (type) => {
    // Deterministic pseudo-random buffer incl. transparent pixels; guards the
    // render-path fast loop and the in-place aliasing contract forever.
    let seed = 1234567
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const source = Uint8ClampedArray.from({ length: 257 * 4 }, (_, i) =>
      i % 4 === 3 ? (random() < 0.2 ? 0 : 255) : Math.floor(random() * 256),
    )
    const mask = Uint8ClampedArray.from({ length: 257 }, () => Math.floor(random() * 256))
    const correction = defaultCorrection(type)
    for (const args of [
      [0.85, undefined, undefined],
      [1, mask, undefined],
      [0.6, undefined, 'multiply'],
      [0, undefined, undefined],
    ] as const) {
      const expected = applyCorrection(source, correction, args[0], args[1], args[2] as never)
      const inPlace = new Uint8ClampedArray(source)
      applyCorrectionInPlace(inPlace, correction, args[0], args[1], args[2] as never)
      expect(inPlace).toEqual(expected)
    }
  })
  it('mixes masked strength once, without doubling semitransparent alpha', () => {
    expect([
      ...applyCorrection(rgba, { type: 'invert' }, 0.5, new Uint8ClampedArray([255, 0, 255])),
    ]).toEqual([128, 128, 128, 255, 30, 140, 220, 128, 45, 80, 120, 0])
    expect(applyCorrection(rgba, { type: 'invert' }, 0)).toEqual(rgba)
    expect(() => applyCorrection(rgba, { type: 'invert' }, 1, new Uint8ClampedArray(2))).toThrow()
  })
  it('levels map black/white, gamma, channel and output endpoints', () => {
    const c = defaultCorrection('levels') as Extract<Correction, { type: 'levels' }>
    c.channels.rgb = { black: 32, white: 224, gamma: 2, outBlack: 10, outWhite: 240 }
    const out = applyCorrection(new Uint8ClampedArray([32, 80, 224, 255]), c)
    expect([...out]).toEqual([10, 125, 240, 255])
  })
  it('natural curves interpolate anchors exactly and clamp only at the RGB limits', () => {
    const points = [
      { input: 0, output: 0 },
      { input: 64, output: 240 },
      { input: 192, output: 16 },
      { input: 255, output: 128 },
    ]
    for (const p of points) expect(curveValue(points, p.input)).toBeCloseTo(p.output, 8)
    for (let i = 0; i < points.length - 1; i++)
      for (let x = points[i].input; x < points[i + 1].input; x += 0.5) {
        const value = curveValue(points, x)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(255)
      }
  })
  it('exposure, channel mixer, threshold, posterize and hue have numerical reference values', () => {
    expect([
      ...applyCorrection(new Uint8ClampedArray([30, 60, 120, 90]), {
        type: 'exposure',
        exposure: 1,
        offset: 0,
        gamma: 1,
      }),
    ]).toEqual([41, 82, 164, 90])
    const c = defaultCorrection('channel mixer') as Extract<Correction, { type: 'channel mixer' }>
    c.red = { red: 0, green: 0, blue: 100, constant: 0 }
    c.blue = { red: 100, green: 0, blue: 0, constant: 0 }
    expect([...applyCorrection(rgba, c)].slice(0, 4)).toEqual([224, 96, 32, 255])
    expect([
      ...applyCorrection(new Uint8ClampedArray([255, 0, 0, 255]), {
        type: 'hue/saturation',
        hue: 120,
        saturation: 0,
        lightness: 0,
      }),
    ]).toEqual([0, 255, 0, 255])
    expect([...applyCorrection(rgba, { type: 'posterize', levels: 2 })].slice(0, 4)).toEqual([
      0, 0, 255, 255,
    ])
    expect([...applyCorrection(rgba, { type: 'threshold', level: 128 })].slice(0, 4)).toEqual([
      0, 0, 0, 255,
    ])
  })
  it('blending changes RGB but retains alpha, histogram weights transparency', () => {
    const out = applyCorrection(
      new Uint8ClampedArray([128, 128, 128, 128]),
      { type: 'invert' },
      1,
      undefined,
      'multiply',
    )
    expect([...out]).toEqual([64, 64, 64, 128])
    const h = histogram(rgba)
    expect(h.pixels).toBeCloseTo(1 + 128 / 255)
    expect(h.red[32]).toBe(1)
    expect(h.red[30]).toBeCloseTo(128 / 255)
    expect(h.red[45]).toBe(0)
  })
})
describe('editable PSD adjustment structures and safe model', () => {
  it.each(all)('writes and reads native %s, with NO supplemental project', (type) => {
    const a = defaultCorrection(type)
    const bytes = writePsd({
      width: 2,
      height: 1,
      imageData: {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([64, 128, 192, 255, 255, 255, 255, 255]),
      },
      children: [{ name: type, adjustment: exportAdjustment(a) }],
    })
    const psd = readPsd(bytes, { useImageData: true })
    expect(psd.children?.[0].adjustment?.type).toBe(type)
    expect(importAdjustment(psd.children?.[0].adjustment)).toEqual(a)
    expect(psd.imageResources?.xmpMetadata).toBeUndefined()
  })
  it('does not pretend to support tinted B&W, color ranges, lookup or modern Adobe light algorithms', () => {
    expect(importAdjustment({ type: 'black & white', useTint: true })).toBeUndefined()
    expect(importAdjustment({ type: 'brightness/contrast', useLegacy: false })).toBeUndefined()
    expect(importAdjustment({ type: 'color lookup', name: 'custom.cube' })).toBeUndefined()
    expect(
      importAdjustment({
        type: 'hue/saturation',
        reds: { a: 0, b: 0, c: 0, d: 0, hue: 20, saturation: 0, lightness: 0 },
      }),
    ).toBeUndefined()
  })
  it('rejects unknown types, nonfinite parameters, duplicate or unbounded curve points', () => {
    expect(() => parseCorrection({ type: 'script' })).toThrow()
    expect(() => parseCorrection({ type: 'exposure', exposure: Infinity })).toThrow()
    expect(() =>
      parseCorrection({
        type: 'curves',
        channels: {
          rgb: [
            { input: 1, output: 0 },
            { input: 1, output: 20 },
          ],
        },
      }),
    ).toThrow()
    expect(() =>
      parseCorrection({
        type: 'curves',
        channels: { rgb: Array.from({ length: 17 }, (_, i) => ({ input: i, output: i })) },
      }),
    ).toThrow()
    expect(
      parseCorrection({ type: 'levels', channels: { rgb: { black: 300, white: 0, gamma: 0 } } }),
    ).toMatchObject({ channels: { rgb: { black: 254, white: 255, gamma: 0.1 } } })
  })
  it('serializes the model, avoids hit-test stealing, duplicates without moving the adjustment', () => {
    const doc = newDocument(120, 80),
      layer = makeLayer({
        kind: 'adjustment',
        correction: defaultCorrection('curves'),
        x: 30,
        width: 12,
      })
    doc.layers = [layer]
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0]).toMatchObject({ kind: 'adjustment', x: 0, width: 120, height: 80 })
    expect(hitTest(parsed.layers[0], { x: 20, y: 20 })).toBe(false)
    const copy = duplicateLayers(parsed, layer.id)
    expect(copy.document.layers[1]).toMatchObject({ x: 0, y: 0, correction: layer.correction })
  })
  it('records/replays validated correction parameters, blocks wrong-target and legacy raster commands atomically', () => {
    const command = parseActionCommand({
      type: 'properties',
      values: { correction: { type: 'exposure', exposure: 2, offset: 0, gamma: 1 } },
    })!
    const doc = newDocument(80, 80),
      layer = makeLayer({ kind: 'adjustment', correction: defaultCorrection('exposure') })
    doc.layers = [layer]
    const action = {
      id: 'test',
      name: 'Test',
      steps: [{ id: 's', name: 'Correction', enabled: true, command }],
    }
    expect(runAction(doc, layer.id, action).document.layers[0].correction).toMatchObject({
      exposure: 2,
    })
    expect(layer.correction).toMatchObject({ exposure: 0 })
    const wrong = { ...doc, layers: [{ ...layer, kind: 'shape' as const }] }
    expect(() => runAction(wrong, layer.id, action)).toThrow('корректирующий')
    expect(() =>
      runAction(doc, layer.id, {
        ...action,
        steps: [{ ...action.steps[0], command: { type: 'invert' } }],
      }),
    ).toThrow('растровые')
  })
})
