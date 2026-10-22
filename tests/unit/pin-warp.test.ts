import { describe, expect, it } from 'vitest'
import { applyLiquify } from '../../src/engine/liquify'
import { buildPinWarpField, hasPinWarpMotion, pinWarpForwardAt } from '../../src/engine/pinWarp'

describe('pin warp field', () => {
  it('interpolates sparse pin motion, respects compact influence and locked anchors', () => {
    const moved = { x: 10, y: 10, dx: 12, dy: -4 }
    expect(pinWarpForwardAt(10, 10, [moved], 20)).toEqual({ x: 12, y: -4 })
    expect(pinWarpForwardAt(35, 10, [moved], 20)).toEqual({ x: 0, y: 0 })

    const locked = { x: 20, y: 10, dx: 99, dy: 99, locked: true }
    expect(pinWarpForwardAt(20, 10, [moved, locked], 30)).toEqual({ x: 0, y: 0 })
    const between = pinWarpForwardAt(15, 10, [moved, locked], 30)
    expect(between.x).toBeGreaterThan(0)
    expect(between.x).toBeLessThan(12)
  })

  it('rotation creates tangential local motion around a pin', () => {
    const pin = { x: 10, y: 10, dx: 0, dy: 0, rotation: 90 }
    const east = pinWarpForwardAt(11, 10, [pin], 20)
    // One pixel east of the anchor rotates to one pixel south: (-1, +1).
    expect(east.x).toBeCloseTo(-1, 5)
    expect(east.y).toBeCloseTo(1, 5)
    expect(hasPinWarpMotion([pin])).toBe(true)
  })

  it('inverse field moves a bright dot close to the authored pin target', () => {
    const w = 41,
      h = 25,
      pixels = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 255
    pixels[(12 * w + 14) * 4] = 255
    const field = buildPinWarpField(w, h, [{ x: 14, y: 12, dx: 10, dy: 3 }], 16),
      out = applyLiquify(pixels, field)
    let mass = 0,
      cx = 0,
      cy = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = out[(y * w + x) * 4]
        mass += v
        cx += x * v
        cy += y * v
      }
    expect(mass).toBeGreaterThan(180)
    expect(cx / mass).toBeGreaterThan(22)
    expect(cx / mass).toBeLessThan(26)
    expect(cy / mass).toBeGreaterThan(13.5)
    expect(cy / mass).toBeLessThan(16.5)
  })

  it('empty and locked-only pin sets stay identical', () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    expect([...applyLiquify(pixels, buildPinWarpField(2, 1, [], 10))]).toEqual([...pixels])
    expect(hasPinWarpMotion([{ x: 0, y: 0, dx: 10, dy: 0, locked: true }])).toBe(false)
  })
})
