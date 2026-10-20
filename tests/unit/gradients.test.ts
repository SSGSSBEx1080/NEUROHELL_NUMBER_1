import { describe, expect, it } from 'vitest'
import { parseCorrection } from '../../src/engine/adjustmentTypes'
import { exportAdjustment, importAdjustment } from '../../src/engine/psdAdjustments'
import {
  defaultNoiseSpec,
  gradientColor,
  gradientCss,
  gradientOpacityAt,
  gradientSample,
  mulberry32,
  noiseControlColors,
  noiseGradientColor,
  parseGradientDefinition,
  parseGradientOpacityStops,
  parseGradientStops,
  solidGradient,
  warpMidpoint,
} from '../../src/engine/gradientRamp'

describe('gradient stops, opacity stops and midpoints', () => {
  it('keeps the old opaque two-stop behaviour identical', () => {
    const stops = parseGradientStops([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ])
    const out = [9, 9, 9]
    gradientColor(stops, 0.25, out)
    expect(out).toEqual([0.25, 0.25, 0.25])
    expect(warpMidpoint(0.3)).toBeCloseTo(0.3)
    expect(warpMidpoint(0.3, 0.5)).toBeCloseTo(0.3)
  })

  it('moves the 50% blend to the midpoint like the PSD descriptor', () => {
    const stops = parseGradientStops([
      { position: 0, color: '#000000', midpoint: 0.25 },
      { position: 1, color: '#ffffff' },
    ])
    const out = [0, 0, 0]
    gradientColor(stops, 0.25, out)
    expect(out[0]).toBeCloseTo(0.5)
    gradientColor(stops, 0.125, out)
    expect(out[0]).toBeCloseTo(0.25)
    gradientColor(stops, 0.625, out)
    expect(out[0]).toBeCloseTo(0.75)
  })

  it('validates and samples opacity stops independently from color stops', () => {
    const stops = parseGradientOpacityStops([
      { position: 0, opacity: 1 },
      { position: 0.5, opacity: 0.2 },
      { position: 1, opacity: 0.8 },
    ])
    expect(gradientOpacityAt(stops, 0)).toBe(1)
    expect(gradientOpacityAt(stops, 0.25)).toBeCloseTo(0.6)
    expect(gradientOpacityAt(stops, 1)).toBeCloseTo(0.8)
    expect(() => parseGradientOpacityStops([{ position: 0, opacity: 1 }])).toThrow()
    expect(() =>
      parseGradientStops([
        { position: 0, color: 'red' },
        { position: 1, color: '#ffffff' },
      ]),
    ).toThrow()
  })

  it('round-trips a full definition and rejects oversized payloads', () => {
    const definition = solidGradient(
      [
        { position: 0, color: '#112233', midpoint: 0.3 },
        { position: 1, color: '#fedcba' },
      ],
      [
        { position: 0, opacity: 0.4 },
        { position: 1, opacity: 1 },
      ],
      'Проверка',
    )
    expect(parseGradientDefinition(JSON.parse(JSON.stringify(definition)))).toEqual(definition)
    expect(() =>
      parseGradientDefinition({ ...definition, name: 'x'.repeat(9000), stops: definition.stops }),
    ).toThrow(/большой градиент/)
    expect(() => parseGradientDefinition({ stops: 'x'.repeat(9000) })).toThrow()
    expect(gradientCss(definition)).toContain('rgba(')
  })
})

describe('gradient map midpoint PSD contract', () => {
  it('exports and re-imports a non-default midpoint as native data', () => {
    const correction = parseCorrection({
      type: 'gradient map',
      reverse: false,
      stops: [
        { position: 0, color: '#102030', midpoint: 0.25 },
        { position: 1, color: '#f0e0d0' },
      ],
    })
    const native = exportAdjustment(correction)
    if (!('colorStops' in native) || !native.colorStops) throw new Error('no native stops')
    expect(native.colorStops[0].midpoint).toBeCloseTo(0.25)
    const back = importAdjustment(native as never)
    if (!back || back.type !== 'gradient map') throw new Error('not re-imported')
    expect(back.stops[0].midpoint).toBeCloseTo(0.25)
  })
})

describe('seeded noise gradients', () => {
  it('is deterministic by seed and differs between seeds', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    const one = [0, 0, 0, 1]
    const two = [0, 0, 0, 1]
    noiseGradientColor({ ...defaultNoiseSpec(), seed: 5 }, 0.37, one)
    noiseGradientColor({ ...defaultNoiseSpec(), seed: 5 }, 0.37, two)
    expect(one).toEqual(two)
    const other = [0, 0, 0, 1]
    noiseGradientColor({ ...defaultNoiseSpec(), seed: 6 }, 0.37, other)
    expect(other).not.toEqual(one)
  })

  it('keeps every control color inside the configured channel ranges', () => {
    const spec = {
      ...defaultNoiseSpec(),
      model: 'rgb' as const,
      min: [0.2, 0.3, 0.4, 0],
      max: [0.5, 0.6, 0.7, 1],
    }
    for (const color of noiseControlColors(spec))
      for (let c = 0; c < 3; c++) {
        expect(color[c]).toBeGreaterThanOrEqual(spec.min[c])
        expect(color[c]).toBeLessThanOrEqual(spec.max[c])
      }
  })

  it('produces valid RGB in hsb and lab models, with optional alpha', () => {
    for (const model of ['hsb', 'lab'] as const) {
      const out = [0, 0, 0, 1]
      noiseGradientColor({ ...defaultNoiseSpec(), model, transparency: true }, 0.61, out)
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(out[c])).toBe(true)
        expect(out[c]).toBeGreaterThanOrEqual(0)
        expect(out[c]).toBeLessThanOrEqual(1)
      }
      expect(out[3]).toBeGreaterThanOrEqual(0)
      expect(out[3]).toBeLessThanOrEqual(1)
    }
    const opaque = [0, 0, 0, 0]
    noiseGradientColor({ ...defaultNoiseSpec(), transparency: false }, 0.2, opaque)
    expect(opaque[3]).toBe(1)
  })

  it('combines noise color with separate opacity stops when sampled as a definition', () => {
    const definition = parseGradientDefinition({
      name: 'noise',
      kind: 'noise',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      opacityStops: [
        { position: 0, opacity: 0 },
        { position: 1, opacity: 1 },
      ],
      noise: defaultNoiseSpec(),
    })
    const out = [0, 0, 0, 1]
    gradientSample(definition, 0, out)
    expect(out[3]).toBe(0)
  })
})
