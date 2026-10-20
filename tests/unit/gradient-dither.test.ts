import { describe, expect, it } from 'vitest'
import { gradientShapePosition, orderedDitherByte } from '../../src/engine/gradientDither'
import { normalizeStyles } from '../../src/engine/styles'

describe('gradient ordered dithering', () => {
  it('keeps exact 8-bit levels stable at every Bayer position', () => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        expect(orderedDitherByte(0, x, y)).toBe(0)
        expect(orderedDitherByte(128 / 255, x, y)).toBe(128)
        expect(orderedDitherByte(1, x, y)).toBe(255)
      }
  })

  it('distributes a fractional level in exact proportion over the 4x4 cell', () => {
    const values: number[] = []
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) values.push(orderedDitherByte(10.25 / 255, x, y))

    expect(values.filter((value) => value === 11)).toHaveLength(4)
    expect(values.filter((value) => value === 10)).toHaveLength(12)
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(164)
  })

  it('matches the existing Canvas geometry for linear, reflected, radial, angle and diamond', () => {
    expect(gradientShapePosition('linear', 100, 50, 0, 24, 0, 1)).toBeCloseTo(0.005, 6)
    expect(gradientShapePosition('linear', 100, 50, 99, 24, 0, 1)).toBeCloseTo(0.995, 6)
    expect(gradientShapePosition('linear', 100, 50, 49, 0, 90, 1)).toBeCloseTo(0.01, 6)
    expect(gradientShapePosition('reflected', 100, 50, 0, 24, 0, 1)).toBeCloseTo(0.01, 6)
    expect(gradientShapePosition('reflected', 100, 50, 49, 24, 0, 1)).toBeCloseTo(0.99, 6)
    expect(gradientShapePosition('radial', 100, 100, 49, 49, 0, 1)).toBeCloseTo(0.01, 6)
    expect(gradientShapePosition('angle', 100, 100, 99, 49, 0, 1)).toBeCloseTo(0.7484, 3)
    expect(gradientShapePosition('angle', 100, 100, 49, 99, 0, 1)).toBeCloseTo(0.0016, 3)
    expect(gradientShapePosition('diamond', 100, 100, 49, 49, 0, 1)).toBeCloseTo(0.02, 6)
    expect(gradientShapePosition('diamond', 100, 100, 99, 49, 0, 1)).toBeCloseTo(1, 6)
  })

  it('validates dither flags without changing legacy omissions', () => {
    const parsed = normalizeStyles({
      strokes: [{ enabled: true, gradientDither: true }],
      gradients: [{ enabled: true, dither: true }],
    })!
    expect(parsed.strokes[0].gradientDither).toBe(true)
    expect(parsed.gradients[0].dither).toBe(true)

    const legacy = normalizeStyles({
      strokes: [{ enabled: true, gradientDither: 'yes' }],
      gradients: [{ enabled: true, dither: 1 }],
    })!
    expect(legacy.strokes[0].gradientDither).toBeUndefined()
    expect(legacy.gradients[0].dither).toBeUndefined()
  })
})
