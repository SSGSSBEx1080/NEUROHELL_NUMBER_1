import { describe, it, expect } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  identityCube,
  parseCubeFile,
  parseCubeLut,
  sampleCube,
  serializeCube,
} from '../../src/engine/colorLut'
import { gradientColor, parseGradientStops } from '../../src/engine/gradientRamp'
import { applyCorrection } from '../../src/engine/adjustmentMath'
import { defaultCorrection, parseCorrection } from '../../src/engine/adjustmentTypes'
import {
  exportAdjustment,
  importAdjustment,
  prepareAdjustmentRecords,
} from '../../src/engine/psdAdjustments'
import { makeLayer, newDocument } from '../../src/engine/document'
import { exportableColorStack, sampleColorStack } from '../../src/engine/lutExport'
initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
const roundTrip = (a: ReturnType<typeof exportAdjustment>) =>
  readPsd(writePsd({ width: 1, height: 1, children: [{ adjustment: a }] }), { useImageData: true })
    .children![0].adjustment!
describe('bounded CUBE data and trilinear sampling', () => {
  it('preserves CUBE ordering, comments, Unicode title and domain', () => {
    const c = identityCube()
    c.title = 'Профиль #1'
    c.domainMin = [-0.5, 0, 0.2]
    c.domainMax = [0.8, 1, 2]
    const text =
      '\uFEFF# File header\n' + serializeCube(c).replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2 # grid')
    expect(parseCubeFile(text)).toEqual(c)
    expect(parseCubeLut(c).values).not.toBe(c.values)
  })
  it('interpolates channel order, cross-terms, non-unit domains and clamped endpoints', () => {
    const c = identityCube(3),
      out = [0, 0, 0]
    for (let i = 0; i < c.values.length; i += 3) {
      const [r, g, b] = c.values.slice(i, i + 3)
      c.values[i] = r * r
      c.values[i + 1] = g * b
      c.values[i + 2] = b * b
    }
    sampleCube(c, 0.25, 0.2, 0.75, out)
    expect(out[0]).toBeCloseTo(0.125, 8)
    expect(out[1]).toBeCloseTo(0.15, 8)
    expect(out[2]).toBeCloseTo(0.625, 8)
    const d = identityCube()
    d.domainMin = [0.1, 0.2, 0.3]
    d.domainMax = [0.5, 0.6, 0.7]
    sampleCube(d, 0.3, 0.4, 0.5, out)
    out.forEach((v) => expect(v).toBeCloseTo(0.5, 8))
    sampleCube(d, -10, 10, 0.3, out)
    expect(out).toEqual([0, 1, 0])
  })
  it('changes colors without changing alpha or leaking hidden RGB', () => {
    const c = identityCube()
    for (let i = 0; i < c.values.length; i += 3)
      [c.values[i], c.values[i + 2]] = [c.values[i + 2], c.values[i]]
    expect([
      ...applyCorrection(new Uint8ClampedArray([24, 68, 120, 128, 12, 23, 34, 0]), {
        type: 'color lookup',
        lut: c,
      }),
    ]).toEqual([120, 68, 24, 128, 12, 23, 34, 0])
  })
  it('rejects unsafe, ambiguous, incomplete and unbounded tables instead of accepting prefixes', () => {
    const text = serializeCube(identityCube())
    for (const bad of [
      text + '0 0 0\n',
      text.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 64'),
      text.replace('0 0 0', 'NaN 0 0'),
      text.replace('DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 0 1 1'),
      text.replace('TITLE "Identity"', 'TITLE "Identity"\nLUT_1D_SIZE 16'),
      text + 'alert(1)',
    ])
      expect(() => parseCubeFile(bad)).toThrow()
    expect(() => parseCubeFile(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 МиБ')
    expect(() =>
      parseCubeFile(text.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nLUT_3D_SIZE 2')),
    ).toThrow()
    expect(() => parseCubeLut({ ...identityCube(), values: Array(24).fill(Infinity) })).toThrow()
  })
  it('exports and imports embedded native Color Lookup with no private XMP dependency', () => {
    const c = identityCube(3)
    c.title = 'Custom'
    c.values = c.values.map((v) => Number((1 - v).toFixed(9)))
    const native = roundTrip(exportAdjustment({ type: 'color lookup', lut: c }))
    expect(native.type).toBe('color lookup')
    expect(importAdjustment(native)).toEqual({ type: 'color lookup', lut: c })
    expect(importAdjustment({ ...native, lutFormat: 'look' } as typeof native)).toBeUndefined()
    expect(importAdjustment({ ...native, dither: true } as typeof native)).toBeUndefined()
    expect(importAdjustment({ ...native, tableOrder: 'bgr' } as typeof native)).toBeUndefined()
  })
})
describe('gradient map and RGB photo filter', () => {
  it('maps exact stops and uses a continuous interpolation, including narrow native 1/4096 transitions', () => {
    const stops = parseGradientStops([
        { position: 0, color: '#000000' },
        { position: 0.5, color: '#ff0000' },
        { position: 0.5 + 1 / 4096, color: '#0000ff' },
        { position: 1, color: '#ffffff' },
      ]),
      out = [0, 0, 0]
    gradientColor(stops, 0.5 + 1 / 8192, out)
    expect(out).toEqual([0.5, 0, 0.5])
    gradientColor(stops, -1, out)
    expect(out).toEqual([0, 0, 0])
    gradientColor(stops, 2, out)
    expect(out).toEqual([1, 1, 1])
    expect([
      ...applyCorrection(new Uint8ClampedArray([0, 0, 0, 128, 255, 255, 255, 255]), {
        type: 'gradient map',
        stops,
        reverse: true,
      }),
    ]).toEqual([255, 255, 255, 128, 0, 0, 0, 255])
  })
  it('keeps native quantized stops editable and rejects unsupported interpolation/transparency', () => {
    const model = parseCorrection({
        type: 'gradient map',
        reverse: true,
        stops: [
          { position: 0, color: '#123456' },
          { position: 0.27, color: '#fedcba' },
          { position: 1, color: '#aa77ee' },
        ],
      }),
      native = roundTrip(exportAdjustment(model))
    expect(importAdjustment(native)).toEqual(model)
    if (native.type !== 'gradient map') throw new Error('wrong type')
    expect(native.method).toBeUndefined()
    expect(importAdjustment({ ...native, method: 'perceptual' })).toBeUndefined()
    expect(
      importAdjustment({ ...native, opacityStops: [{ location: 0, midpoint: 0.5, opacity: 0.5 }] }),
    ).toBeUndefined()
    expect(() =>
      parseGradientStops([
        { position: 0, color: '#ffffff' },
        { position: 0.00001, color: '#000000' },
      ]),
    ).toThrow('разные')
    expect(() =>
      parseGradientStops(
        Array.from({ length: 17 }, (_, i) => ({ position: i / 16, color: '#ffffff' })),
      ),
    ).toThrow('16')
  })
  it('has an explicit RGB photo model, neutral density and luminosity preservation', () => {
    const p = new Uint8ClampedArray([100, 100, 100, 128]),
      filter = {
        type: 'photo filter' as const,
        color: '#ff0000',
        density: 100,
        preserveLuminosity: false,
      }
    expect([...applyCorrection(p, filter)]).toEqual([100, 0, 0, 128])
    expect([...applyCorrection(p, { ...filter, preserveLuminosity: true })]).toEqual([
      170, 70, 70, 128,
    ])
    expect(applyCorrection(p, { ...filter, density: 0 })).toEqual(p)
    expect(
      importAdjustment({ type: 'photo filter', color: { l: 50, a: 1, b: 20 }, density: 0.5 }),
    ).toBeUndefined()
  })
  it('round-trips every native integer density without floating-point truncation', () => {
    for (let density = 0; density <= 100; density++) {
      const model = parseCorrection({
        type: 'photo filter',
        color: '#4387c9',
        density,
        preserveLuminosity: true,
      })
      expect(importAdjustment(roundTrip(exportAdjustment(model)))).toEqual(model)
    }
  })
})
describe('portable upper correction stack', () => {
  it('includes ordered opacity/blend-aware global adjustments only, samples independent RGB inputs', () => {
    const doc = newDocument()
    doc.layers = [
      makeLayer({ name: 'Art' }),
      makeLayer({
        kind: 'adjustment',
        name: 'Invert',
        correction: { type: 'invert' },
        opacity: 0.25,
      }),
      makeLayer({
        kind: 'adjustment',
        name: 'Mixer',
        correction: defaultCorrection('channel mixer'),
        blendMode: 'multiply',
      }),
    ]
    expect(exportableColorStack(doc).map((l) => l.name)).toEqual(['Invert', 'Mixer'])
    const cube = sampleColorStack(doc, 3),
      out = [0, 0, 0]
    sampleCube(cube, 0, 0, 0, out)
    // Black -> 25% inversion (64/255) -> multiplied by itself, quantized to RGB/8.
    expect(out).toEqual([16 / 255, 16 / 255, 16 / 255])
    expect(doc.layers).toHaveLength(3)
  })
  it('blocks spatial effects rather than silently producing an incomplete look', () => {
    const doc = newDocument(),
      c = makeLayer({ kind: 'adjustment', correction: { type: 'invert' }, name: 'Masked' })
    for (const patch of [
      { clipping: true },
      {
        mask: {
          src: 'data:image/png;base64,AA==',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          enabled: true,
          linked: true,
          density: 1,
          feather: 0,
          defaultColor: 255,
        },
      },
    ]) {
      doc.layers = [{ ...c, ...patch }]
      expect(() => sampleColorStack(doc)).toThrow('не может сохранить')
    }
    doc.layers = [c, makeLayer()]
    expect(() => sampleColorStack(doc)).toThrow('наверху')
    doc.layers = [makeLayer({ kind: 'group' }), { ...c, parentId: 'group' }]
    expect(() => sampleColorStack(doc)).toThrow()
  })
})

it('preserved raw photo records keep their integer density through codec writes', () => {
  const original = roundTrip(
    exportAdjustment({
      type: 'photo filter',
      color: '#4387c9',
      density: 29,
      preserveLuminosity: true,
    }),
  )
  const tree = [{ name: 'Parent', children: [{ name: 'Renamed', adjustment: original }] }]
  prepareAdjustmentRecords(tree)
  const native = roundTrip(tree[0].children[0].adjustment)
  expect(native).toMatchObject({ type: 'photo filter', density: 0.29 })
})
