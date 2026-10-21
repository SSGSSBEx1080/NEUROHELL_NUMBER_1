import { describe, expect, it } from 'vitest'
import {
  applyLiquify,
  applyLiquifyBrush,
  createLiquifyField,
  displacementMax,
} from '../../src/engine/liquify'

const make = (w: number, h: number, dotX: number, dotY: number) => {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < px.length; i += 4) px[i + 3] = 255
  px[(dotY * w + dotX) * 4] = 255
  return px
}
const centroidX = (px: Uint8ClampedArray, w: number, h: number) => {
  let sum = 0,
    mass = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = px[(y * w + x) * 4]
      sum += x * v
      mass += v
    }
  return sum / mass
}

describe('liquify field', () => {
  it('identity field reproduces the source exactly', () => {
    const px = make(9, 9, 4, 4)
    expect([...applyLiquify(px, createLiquifyField(9, 9))]).toEqual([...px])
  })

  it('forward warp drags content along the pointer movement', () => {
    const w = 21,
      h = 11,
      px = make(w, h, 8, 5),
      field = createLiquifyField(w, h)
    for (let step = 0; step < 6; step++) applyLiquifyBrush(field, 'push', 8 + step, 5, 5, 1, 0, 1)
    const out = applyLiquify(px, field)
    expect(centroidX(out, w, h)).toBeGreaterThan(centroidX(px, w, h) + 2)
  })

  it('pucker points inward, bloat outward, restore relaxes the field', () => {
    const field = createLiquifyField(11, 11)
    applyLiquifyBrush(field, 'pucker', 5, 5, 5, 0, 0, 1)
    expect(field.dx[5 * 11 + 2]).toBeGreaterThan(0)
    expect(field.dx[5 * 11 + 8]).toBeLessThan(0)
    const before = displacementMax(field)
    expect(before).toBeGreaterThan(0)
    applyLiquifyBrush(field, 'bloat', 5, 5, 5, 0, 0, 1)
    applyLiquifyBrush(field, 'restore', 5, 5, 5, 0, 0, 1)
    expect(displacementMax(field)).toBeLessThan(before)
  })

  it('a zero mask freezes pixels completely', () => {
    const w = 11,
      h = 11,
      px = make(w, h, 5, 5),
      field = createLiquifyField(w, h)
    applyLiquifyBrush(field, 'push', 5, 5, 5, 4, 0, 1)
    const mask = new Uint8ClampedArray(w * h)
    expect([...applyLiquify(px, field, mask)]).toEqual([...px])
  })
})
