import { describe, expect, it } from 'vitest'
import {
  blendChannel,
  blendColor,
  compositePixelBlend,
  dissolveHash,
  isPixelBlendMode,
  PIXEL_BLEND_MODES,
} from '../../src/engine/blendModes'

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a])

describe('Photoshop pixel blend modes', () => {
  it('separable formulas match the published definitions', () => {
    expect(blendChannel('linear-burn', 0.8, 0.5)).toBeCloseTo(0.3)
    expect(blendChannel('linear-burn', 0.2, 0.5)).toBe(0)
    expect(blendChannel('linear-light', 0.4, 0.75)).toBeCloseTo(0.9)
    expect(blendChannel('linear-light', 0.4, 0.25)).toBeCloseTo(0)
    // Neutral gray must be identity for the light family.
    for (const mode of ['vivid-light', 'linear-light', 'pin-light'] as const)
      expect(blendChannel(mode, 0.37, 0.5)).toBeCloseTo(0.37)
    // Vivid halves are color burn/dodge around the doubled source.
    expect(blendChannel('vivid-light', 0.5, 0.25)).toBeCloseTo(0)
    expect(blendChannel('vivid-light', 0.5, 0.75)).toBeCloseTo(1)
    // Pin light replaces only outside the doubled-source bounds.
    expect(blendChannel('pin-light', 0.8, 0.25)).toBeCloseTo(0.5)
    expect(blendChannel('pin-light', 0.2, 0.75)).toBeCloseTo(0.5)
    expect(blendChannel('pin-light', 0.6, 0.25)).toBeCloseTo(0.5)
    // Hard Mix thresholds the channel sum (Adobe definition).
    expect(blendChannel('hard-mix', 0.6, 0.5)).toBe(1)
    expect(blendChannel('hard-mix', 0.4, 0.5)).toBe(0)
    // Subtract clips at zero; Divide clips at one and is stable at extremes.
    expect(blendChannel('subtract', 0.8, 0.3)).toBeCloseTo(0.5)
    expect(blendChannel('subtract', 0.2, 0.9)).toBe(0)
    expect(blendChannel('divide', 0.25, 0.5)).toBeCloseTo(0.5)
    expect(blendChannel('divide', 0.5, 0)).toBe(1)
    expect(blendChannel('divide', 0, 0)).toBe(0)
  })

  it('darker/lighter color keep one whole color by channel total', () => {
    const out = [0, 0, 0]
    blendColor('darker-color', [0.9, 0.1, 0.1], [0.2, 0.2, 0.2], out)
    expect(out).toEqual([0.2, 0.2, 0.2])
    blendColor('lighter-color', [0.9, 0.1, 0.1], [0.2, 0.2, 0.2], out)
    expect(out).toEqual([0.9, 0.1, 0.1])
  })

  it('composite over transparency returns the source; opaque source fully blends', () => {
    const back = px(0, 0, 0, 0)
    compositePixelBlend(back, px(200, 100, 50), 'vivid-light', 1, 1)
    expect([...back]).toEqual([200, 100, 50, 255])
    const mid = px(128, 128, 128)
    compositePixelBlend(mid, px(255, 255, 255), 'subtract', 1, 1)
    expect([...mid]).toEqual([0, 0, 0, 255])
    const half = px(100, 100, 100)
    compositePixelBlend(half, px(0, 0, 0), 'linear-light', 0.5, 1)
    // Linear light with black gives 0; at 50% opacity the mix lands halfway.
    expect(half[0]).toBe(50)
  })

  it('dissolve is deterministic, bounded, and roughly proportional to alpha', () => {
    expect(dissolveHash(3, 7)).toBe(dissolveHash(3, 7))
    expect(dissolveHash(3, 7)).not.toBe(dissolveHash(4, 7))
    const width = 64,
      height = 64,
      make = () => {
        const back = new Uint8ClampedArray(width * height * 4),
          src = new Uint8ClampedArray(width * height * 4)
        for (let i = 0; i < src.length; i += 4) {
          src[i] = 255
          src[i + 3] = 128
          back[i + 3] = 255
        }
        compositePixelBlend(back, src, 'dissolve', 1, width)
        return back
      }
    const a = make(),
      b = make()
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    let red = 0
    for (let i = 0; i < a.length; i += 4) if (a[i] === 255) red++
    expect(red / (width * height)).toBeGreaterThan(0.4)
    expect(red / (width * height)).toBeLessThan(0.6)
  })

  it('a cropped blend with a document origin matches the full-frame result', () => {
    const width = 20,
      height = 14,
      crop = { x: 5, y: 4, width: 9, height: 6 },
      make = () => {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            data[i] = (x * 37 + y * 11) % 256
            data[i + 1] = (x * 17 + y * 53) % 256
            data[i + 2] = (x * 91 + y * 7) % 256
            data[i + 3] = 255
          }
        return data
      },
      sourceOf = () => {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 240
          data[i + 1] = 30
          data[i + 2] = 90
          data[i + 3] = 160
        }
        return data
      },
      cropOf = (full: Uint8ClampedArray) => {
        const out = new Uint8ClampedArray(crop.width * crop.height * 4)
        for (let y = 0; y < crop.height; y++) {
          const from = ((crop.y + y) * width + crop.x) * 4
          out.set(full.subarray(from, from + crop.width * 4), y * crop.width * 4)
        }
        return out
      }
    for (const mode of ['subtract', 'dissolve'] as const) {
      const full = make()
      compositePixelBlend(full, sourceOf(), mode, 1, width)
      const cropped = cropOf(make())
      compositePixelBlend(cropped, cropOf(sourceOf()), mode, 1, crop.width, crop.x, crop.y)
      expect([...cropped]).toEqual([...cropOf(full)])
    }
  })

  it('mode registry covers exactly the Canvas-inexpressible Photoshop modes', () => {
    expect(PIXEL_BLEND_MODES).toHaveLength(10)
    expect(isPixelBlendMode('vivid-light')).toBe(true)
    expect(isPixelBlendMode('multiply')).toBe(false)
    expect(isPixelBlendMode('source-over')).toBe(false)
  })
})
