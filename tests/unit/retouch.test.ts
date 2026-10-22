import { describe, expect, it } from 'vitest'
import { applyRetouchDab, type RetouchDab } from '../../src/engine/retouch'

const base: RetouchDab = {
  tool: 'dodge',
  cx: 4,
  cy: 4,
  radius: 3,
  hardness: 1,
  strength: 1,
  range: 'midtones',
  spongeMode: 'desaturate',
  moveX: 0,
  moveY: 0,
}
const rect = (
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y),
        o = (y * w + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  return data
}
const gray = (v: number): [number, number, number, number] => [v, v, v, 255]

describe('retouch dabs', () => {
  it('dodge lightens, burn darkens, and the tonal range gates the effect', () => {
    const dodged = rect(9, 9, () => gray(128))
    applyRetouchDab(dodged, 9, 9, { ...base, tool: 'dodge' })
    expect(dodged[(4 * 9 + 4) * 4]).toBeGreaterThan(128)
    const burned = rect(9, 9, () => gray(128))
    applyRetouchDab(burned, 9, 9, { ...base, tool: 'burn' })
    expect(burned[(4 * 9 + 4) * 4]).toBeLessThan(128)
    // Shadows range barely touches a bright pixel; highlights range does.
    const asShadow = rect(9, 9, () => gray(220))
    applyRetouchDab(asShadow, 9, 9, { ...base, tool: 'dodge', range: 'shadows' })
    const asHighlight = rect(9, 9, () => gray(220))
    applyRetouchDab(asHighlight, 9, 9, { ...base, tool: 'dodge', range: 'highlights' })
    expect(asShadow[(4 * 9 + 4) * 4]).toBe(220)
    expect(asHighlight[(4 * 9 + 4) * 4]).toBeGreaterThan(220)
    // Outside the radius nothing changes.
    expect(dodged[0]).toBe(128)
  })

  it('sponge desaturates toward gray and saturates away from it', () => {
    const desat = rect(9, 9, () => [200, 60, 60, 255])
    applyRetouchDab(desat, 9, 9, { ...base, tool: 'sponge', spongeMode: 'desaturate' })
    const o = (4 * 9 + 4) * 4
    expect(desat[o] - desat[o + 1]).toBeLessThan(140)
    const sat = rect(9, 9, () => [160, 110, 110, 255])
    applyRetouchDab(sat, 9, 9, { ...base, tool: 'sponge', spongeMode: 'saturate' })
    expect(sat[o] - sat[o + 1]).toBeGreaterThan(50)
  })

  it('blur mixes neighbours, sharpen exaggerates the centre detail', () => {
    const checker = (x: number, y: number) => gray((x + y) % 2 ? 255 : 0)
    const blurred = rect(9, 9, checker)
    applyRetouchDab(blurred, 9, 9, { ...base, tool: 'blur-brush' })
    const o = (4 * 9 + 4) * 4
    expect(blurred[o]).toBeGreaterThan(60)
    expect(blurred[o]).toBeLessThan(200)
    const dot = rect(9, 9, (x, y) => gray(x === 4 && y === 4 ? 180 : 100))
    applyRetouchDab(dot, 9, 9, { ...base, tool: 'sharpen-brush' })
    expect(dot[o]).toBeGreaterThan(180)
  })

  it('smudge drags colour along the movement and honours the mask', () => {
    const edge = rect(12, 5, (x) => gray(x < 6 ? 0 : 255))
    applyRetouchDab(edge, 12, 5, {
      ...base,
      tool: 'smudge',
      cx: 7,
      cy: 2,
      radius: 2,
      moveX: 2,
      moveY: 0,
    })
    // The first white pixels pick up the dark colour dragged from behind.
    expect(edge[(2 * 12 + 7) * 4]).toBeLessThan(60)
    const masked = rect(9, 9, () => gray(128)),
      mask = new Uint8ClampedArray(81)
    applyRetouchDab(masked, 9, 9, { ...base, tool: 'burn', mask })
    expect(masked[(4 * 9 + 4) * 4]).toBe(128)
  })
})
