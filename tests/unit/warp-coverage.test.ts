import { describe, expect, it } from 'vitest'
import { projectPixels } from '../../src/engine/projectiveTexture'
import type { Quad } from '../../src/types'

describe('projective texture coverage', () => {
  it('preserves the alpha of a translucent texture, without double-painting mesh edges', () => {
    const data = new Uint8ClampedArray(12 * 4 * 4)
    for (let i = 0; i < data.length; i += 4) data.set([184, 168, 255, 128], i)
    const quad: Quad = [
      { x: 3, y: 2 },
      { x: 40, y: 4 },
      { x: 44, y: 15 },
      { x: 1, y: 12 },
    ]
    const projected = projectPixels({ data, width: 12, height: 4 }, 48, 20, quad)
    let painted = 0
    for (let i = 0; i < projected.length; i += 4) {
      if (!projected[i + 3]) continue
      painted++
      expect([...projected.slice(i, i + 4)]).toEqual([184, 168, 255, 128])
    }
    expect(painted).toBeGreaterThan(300)
  })
  it('interpolates premultiplied colour, without leaking RGB from transparent pixels', () => {
    const source = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]),
    }
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 0, y: 1 },
    ]
    const result = projectPixels(source, 4, 1, quad)
    expect([...result]).toEqual([255, 0, 0, 255, 255, 0, 0, 191, 255, 0, 0, 64, 0, 0, 0, 0])
  })
  it('is byte-identical for an identity texture and leaves pixels outside its quad transparent', () => {
    const source = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        10, 30, 70, 255, 140, 100, 30, 90, 40, 160, 70, 128, 80, 60, 20, 255,
      ]),
    }
    const quad: Quad = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ]
    const result = projectPixels(source, 4, 4, quad)
    expect([...result.slice(20, 28)]).toEqual([...source.data.slice(0, 8)])
    expect([...result.slice(36, 44)]).toEqual([...source.data.slice(8, 16)])
    expect([...result.slice(0, 16)]).toEqual(Array(16).fill(0))
  })
})
