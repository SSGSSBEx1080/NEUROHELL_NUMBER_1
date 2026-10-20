import { describe, expect, it } from 'vitest'
import { applySatinToPixels, satinMaskField } from '../../src/engine/satin'
import { defaultSatinStyle, normalizeStyles } from '../../src/engine/styles'
import type { RgbaPixelData } from '../../src/engine/bevel'
import type { SatinEffectStyle } from '../../src/types'

function square(size = 41, gray = 128): RgbaPixelData {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 8; y <= 32; y++)
    for (let x = 8; x <= 32; x++) {
      const i = (y * size + x) * 4
      data[i] = gray
      data[i + 1] = gray
      data[i + 2] = gray
      data[i + 3] = 255
    }
  return { width: size, height: size, data }
}

const clone = (pixels: RgbaPixelData): RgbaPixelData => ({
  width: pixels.width,
  height: pixels.height,
  data: new Uint8ClampedArray(pixels.data),
})

const effect = (patch: Partial<SatinEffectStyle>): SatinEffectStyle => ({
  ...defaultSatinStyle(),
  enabled: true,
  opacity: 1,
  angle: 90,
  distance: 10,
  size: 0,
  invert: false,
  antialiased: true,
  ...patch,
})

const at = (field: Float32Array, x: number, y: number) => field[y * 41 + x]
const pixel = (pixels: RgbaPixelData, x: number, y: number) => {
  const i = (y * pixels.width + x) * 4
  return [...pixels.data.slice(i, i + 4)]
}

describe('satin mask', () => {
  it('is the difference of two alpha copies shifted along the angle axis', () => {
    const mask = satinMaskField(square(), effect({}))
    expect(at(mask, 20, 10)).toBeCloseTo(1)
    expect(at(mask, 20, 30)).toBeCloseTo(1)
    expect(at(mask, 20, 20)).toBeCloseTo(0)
    expect(at(mask, 10, 20)).toBeCloseTo(0)
    expect(at(mask, 20, 4)).toBe(0)
  })

  it('inverts the mask and softens it as Size grows', () => {
    const inverted = satinMaskField(square(), effect({ invert: true }))
    expect(at(inverted, 20, 10)).toBeCloseTo(0)
    expect(at(inverted, 20, 20)).toBeCloseTo(1)

    const soft = satinMaskField(square(), effect({ size: 10 }))
    expect(at(soft, 20, 10)).toBeGreaterThan(0)
    expect(at(soft, 20, 10)).toBeLessThan(1)
  })

  it('uses a horizontal axis at 0 degrees', () => {
    const mask = satinMaskField(square(), effect({ angle: 0 }))
    expect(at(mask, 10, 20)).toBeCloseTo(1)
    expect(at(mask, 30, 20)).toBeCloseTo(1)
    expect(at(mask, 20, 10)).toBeCloseTo(0)
  })
})

describe('satin pixels and parsing', () => {
  it('blends the satin colour only inside the layer alpha', () => {
    const base = square()
    const output = clone(base)
    applySatinToPixels(output, base, base, effect({}))
    expect(pixel(output, 20, 10)).toEqual([0, 0, 0, 255])
    expect(pixel(output, 20, 30)).toEqual([0, 0, 0, 255])
    expect(pixel(output, 20, 20)).toEqual([128, 128, 128, 255])
    expect(pixel(output, 20, 4)).toEqual([0, 0, 0, 0])
  })

  it('validates persisted satin values', () => {
    const styles = normalizeStyles({
      satin: {
        enabled: true,
        color: '#A0B0C0',
        blendMode: 'screen',
        opacity: 4,
        angle: 379,
        distance: 999,
        size: -2,
        invert: false,
        antialiased: true,
      },
    })!
    expect(styles.satin).toEqual({
      enabled: true,
      color: '#a0b0c0',
      blendMode: 'screen',
      opacity: 1,
      angle: 19,
      distance: 250,
      size: 0,
      invert: false,
      antialiased: true,
    })
  })
})
