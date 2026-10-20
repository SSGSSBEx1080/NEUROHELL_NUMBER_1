import { describe, expect, it } from 'vitest'
import {
  applyBevelToPixels,
  bevelProfileHeight,
  signedDistanceField,
  type RgbaPixelData,
} from '../../src/engine/bevel'
import { defaultBevelStyle, normalizeStyles } from '../../src/engine/styles'
import type { BevelEffectStyle } from '../../src/types'

const clone = (pixels: RgbaPixelData): RgbaPixelData => ({
  width: pixels.width,
  height: pixels.height,
  data: new Uint8ClampedArray(pixels.data),
})

function image(
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean,
  gray = 128,
): RgbaPixelData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (inside(x, y)) {
        const i = (y * width + x) * 4
        data[i] = gray
        data[i + 1] = gray
        data[i + 2] = gray
        data[i + 3] = 255
      }
  return { width, height, data }
}

const pixel = (pixels: RgbaPixelData, x: number, y: number) => {
  const i = (y * pixels.width + x) * 4
  return [...pixels.data.slice(i, i + 4)]
}

const effect = (patch: Partial<BevelEffectStyle>): BevelEffectStyle => ({
  ...defaultBevelStyle(),
  enabled: true,
  ...patch,
})

describe('bevel distance field', () => {
  it('computes signed Euclidean distances around a rectangle', () => {
    const mask = image(7, 5, (x, y) => x >= 2 && x <= 4 && y >= 1 && y <= 3)
    const field = signedDistanceField(mask)
    expect(field[1 * 7 + 3]).toBeCloseTo(0.5)
    expect(field[2 * 7 + 3]).toBeCloseTo(1.5)
    expect(field[2 * 7]).toBeCloseTo(-1.5)
    expect(field[0]).toBeCloseTo(0.5 - Math.sqrt(5))
  })

  it('keeps the five style height profiles distinct', () => {
    expect(bevelProfileHeight('inner', -2, 10, 'smooth')).toBe(0)
    expect(bevelProfileHeight('inner', 10, 10, 'smooth')).toBe(1)
    expect(bevelProfileHeight('outer', -10, 10, 'chiselHard')).toBe(0)
    expect(bevelProfileHeight('outer', 0, 10, 'chiselHard')).toBe(1)
    expect(bevelProfileHeight('emboss', 0, 10, 'chiselHard')).toBeCloseTo(0.5)
    expect(bevelProfileHeight('pillow', -20, 10, 'smooth')).toBe(1)
    expect(bevelProfileHeight('pillow', 0, 10, 'smooth')).toBe(0)
    expect(bevelProfileHeight('pillow', 20, 10, 'smooth')).toBe(1)
  })
})

describe('bevel pixel lighting', () => {
  it('lights the top inner slope and shades the bottom for light from above', () => {
    const base = image(41, 41, (x, y) => x >= 8 && x <= 32 && y >= 8 && y <= 32)
    const output = clone(base)
    applyBevelToPixels(output, base, base, effect({ size: 10, depth: 2, angle: 90, altitude: 30 }))
    expect(pixel(output, 20, 10)[0]).toBeGreaterThan(150)
    expect(pixel(output, 20, 30)[0]).toBeLessThan(100)
    expect(pixel(output, 20, 20)).toEqual([128, 128, 128, 255])
  })

  it('reverses the relief for Direction Down', () => {
    const base = image(41, 41, (x, y) => x >= 8 && x <= 32 && y >= 8 && y <= 32)
    const output = clone(base)
    applyBevelToPixels(
      output,
      base,
      base,
      effect({ size: 10, depth: 2, angle: 90, altitude: 30, direction: 'down' }),
    )
    expect(pixel(output, 20, 10)[0]).toBeLessThan(100)
    expect(pixel(output, 20, 30)[0]).toBeGreaterThan(150)
  })

  it('creates a real coloured rim for Outer Bevel', () => {
    const base = image(41, 41, (x, y) => x >= 8 && x <= 32 && y >= 8 && y <= 32)
    const output = clone(base)
    applyBevelToPixels(
      output,
      base,
      base,
      effect({ style: 'outer', size: 8, depth: 2, angle: 90, altitude: 30 }),
    )
    expect(pixel(output, 20, 4)[3]).toBe(255)
    expect(pixel(output, 20, 4)[0]).toBeGreaterThan(150)
    expect(pixel(output, 20, 36)[3]).toBe(255)
    expect(pixel(output, 20, 36)[0]).toBeLessThan(100)
    expect(pixel(output, 0, 0)[3]).toBe(0)
  })

  it('uses the opaque core rather than a faint anti-aliased fringe for the outer rim', () => {
    const base = image(41, 41, (x, y) => x >= 10 && x <= 30 && y >= 10 && y <= 30)
    for (let y = 9; y <= 31; y++)
      for (let x = 9; x <= 31; x++)
        if (x === 9 || x === 31 || y === 9 || y === 31) {
          const i = (y * base.width + x) * 4
          base.data[i] = 128
          base.data[i + 1] = 128
          base.data[i + 2] = 128
          base.data[i + 3] = 16
        }
    const output = clone(base)
    applyBevelToPixels(
      output,
      base,
      base,
      effect({ style: 'outer', size: 8, depth: 2, angle: 90, altitude: 30 }),
    )
    expect(pixel(output, 20, 5)[3]).toBe(255)
  })

  it('keeps emboss and pillow slopes opposite on the outside rim', () => {
    const base = image(41, 41, (x, y) => x >= 8 && x <= 32 && y >= 8 && y <= 32)
    const embossed = clone(base)
    applyBevelToPixels(
      embossed,
      base,
      base,
      effect({ style: 'emboss', size: 8, depth: 2, angle: 90, altitude: 30 }),
    )
    expect(pixel(embossed, 20, 4)[0]).toBeGreaterThan(140)
    expect(pixel(embossed, 20, 36)[0]).toBeLessThan(110)

    const pillow = clone(base)
    applyBevelToPixels(
      pillow,
      base,
      base,
      effect({ style: 'pillow', size: 8, depth: 2, angle: 90, altitude: 30 }),
    )
    expect(pixel(pillow, 20, 4)[0]).toBeLessThan(110)
    expect(pixel(pillow, 20, 36)[0]).toBeGreaterThan(140)
    expect(pixel(pillow, 20, 12)[0]).toBeGreaterThan(140)
    expect(pixel(pillow, 20, 28)[0]).toBeLessThan(110)
  })

  it('shades an actual stroke ring without filling its hole', () => {
    const ring = image(
      41,
      41,
      (x, y) =>
        x >= 8 && x <= 32 && y >= 8 && y <= 32 && !(x >= 14 && x <= 26 && y >= 14 && y <= 26),
    )
    const output = clone(ring)
    applyBevelToPixels(
      output,
      ring,
      ring,
      effect({ style: 'stroke', size: 4, depth: 2, angle: 90, altitude: 30 }),
      1,
      'stroke',
    )
    expect(pixel(output, 20, 9)[0]).toBeGreaterThan(140)
    expect(pixel(output, 20, 31)[0]).toBeLessThan(110)
    expect(pixel(output, 20, 20)[3]).toBe(0)
  })
})

describe('bevel style parsing', () => {
  it('validates and clamps persisted values', () => {
    const styles = normalizeStyles({
      bevel: {
        enabled: true,
        style: 'emboss',
        technique: 'chiselHard',
        depth: 99,
        direction: 'down',
        size: 999,
        soften: -4,
        angle: 999,
        altitude: 120,
        useGlobalLight: false,
        highlightColor: '#ABCDEF',
        highlightBlendMode: 'overlay',
        highlightOpacity: 2,
        shadowColor: 'bad',
        shadowBlendMode: 'not-a-mode',
        shadowOpacity: -1,
      },
    })!
    expect(styles.bevel).toMatchObject({
      enabled: true,
      style: 'emboss',
      technique: 'chiselHard',
      depth: 10,
      direction: 'down',
      size: 250,
      soften: 0,
      angle: -81,
      altitude: 90,
      useGlobalLight: false,
      highlightColor: '#abcdef',
      highlightBlendMode: 'overlay',
      highlightOpacity: 1,
      shadowColor: '#000000',
      shadowBlendMode: 'multiply',
      shadowOpacity: 0,
    })
  })
})
