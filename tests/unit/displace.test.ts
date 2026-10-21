import { describe, expect, it } from 'vitest'
import {
  applyDisplace,
  parseDisplaceOptions,
  processDisplace,
  type DisplaceOptions,
} from '../../src/engine/displace'

const grayRow = (values: number[]) => {
  const pixels = new Uint8ClampedArray(values.length * 4)
  values.forEach((value, x) => {
    const i = x * 4
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value
    pixels[i + 3] = 255
  })
  return pixels
}

const solidMap = (r: number, g = r, b = 73, a = 255) => new Uint8ClampedArray([r, g, b, a])

const options: DisplaceOptions = {
  horizontalScale: 1.5625, // black (128 away from neutral) moves exactly +2 px
  verticalScale: 0,
  fit: 'stretch',
  edges: 'repeat',
}

describe('displacement-map warp', () => {
  it('moves black right, white left, and keeps channel 128 neutral', () => {
    const source = grayRow([0, 0, 0, 0, 255, 0, 0, 0, 0]),
      base = {
        width: 9,
        height: 1,
        pixels: source,
        mapWidth: 1,
        mapHeight: 1,
        options,
      }
    const black = applyDisplace({ ...base, mapPixels: solidMap(0) }),
      whiteScale = { ...options, horizontalScale: 200 / 127 }, // white is 127 from neutral
      white = applyDisplace({ ...base, options: whiteScale, mapPixels: solidMap(255) }),
      neutral = processDisplace({ ...base, mapPixels: solidMap(128) })
    expect(black[6 * 4]).toBe(255)
    expect(black[4 * 4]).toBe(0)
    expect(white[2 * 4]).toBe(255)
    expect(white[4 * 4]).toBe(0)
    expect(neutral.pixels).toEqual(source)
    expect(neutral.maxDisplacement).toBe(0)
    expect(source[4 * 4]).toBe(255)
  })

  it('uses red horizontally and green vertically while ignoring blue', () => {
    const w = 5,
      h = 5,
      source = new Uint8ClampedArray(w * h * 4)
    source[(2 * w + 2) * 4] = 255
    source[(2 * w + 2) * 4 + 3] = 255
    const run = (blue: number) =>
      applyDisplace({
        width: w,
        height: h,
        pixels: source,
        mapWidth: 1,
        mapHeight: 1,
        // R=64 gives dx=+2 at 3.125%; G=192 gives dy=-2.
        mapPixels: solidMap(64, 192, blue),
        options: { horizontalScale: 3.125, verticalScale: 3.125, fit: 'stretch', edges: 'repeat' },
      })
    const out = run(0)
    expect(out[(0 * w + 4) * 4]).toBe(255)
    expect(run(255)).toEqual(out)
  })

  it('repeats or wraps source edges according to the undefined-area policy', () => {
    const source = grayRow([10, 30, 50, 70, 90]),
      base = {
        width: 5,
        height: 1,
        pixels: source,
        mapWidth: 1,
        mapHeight: 1,
        mapPixels: solidMap(0),
      }
    expect(applyDisplace({ ...base, options })[0]).toBe(10)
    expect(applyDisplace({ ...base, options: { ...options, edges: 'wrap' } })[0]).toBe(70)
  })

  it('stretches the map across the fit rectangle or repeats it as tiles', () => {
    const source = grayRow([0, 40, 80, 120]),
      map = new Uint8ClampedArray([128, 128, 0, 255, 0, 0, 0, 255]),
      base = {
        width: 4,
        height: 1,
        pixels: source,
        mapWidth: 2,
        mapHeight: 1,
        mapPixels: map,
      }
    const stretched = applyDisplace({ ...base, options }),
      tiled = applyDisplace({ ...base, options: { ...options, fit: 'tile' } })
    // Stretch at x=2 samples map 0.75 (value 32, dx=1.5), averaging source 0 and 40.
    expect(stretched[2 * 4]).toBe(20)
    // Tile at x=2 returns to the neutral first map pixel.
    expect(tiled[2 * 4]).toBe(80)
    expect(tiled[3 * 4]).toBe(40)

    const wide = grayRow([0, 20, 40, 60, 80, 100, 120, 140]),
      fitted = applyDisplace({
        width: 8,
        height: 1,
        pixels: wide,
        mapWidth: 2,
        mapHeight: 1,
        mapPixels: map,
        fitRect: { x: 4, y: 0, width: 4, height: 1 },
        options,
      })
    expect(fitted[3 * 4]).toBe(60)
    expect(fitted[7 * 4]).toBe(100)
  })

  it('composites transparent map pixels over white and scales displacement with the mask', () => {
    const source = grayRow([0, 20, 40, 60, 80]),
      base = { width: 5, height: 1, pixels: source, mapWidth: 1, mapHeight: 1, options }
    expect(applyDisplace({ ...base, mapPixels: solidMap(0, 0, 0, 0) })).toEqual(
      applyDisplace({ ...base, mapPixels: solidMap(255) }),
    )

    const masked = processDisplace({
      ...base,
      mapPixels: solidMap(0),
      mask: new Uint8ClampedArray([0, 0, 0, 0, 128]),
    })
    expect(masked.pixels[2 * 4]).toBe(40)
    expect(masked.pixels[4 * 4]).toBeGreaterThan(55)
    expect(masked.pixels[4 * 4]).toBeLessThan(65)
    expect(masked.maxDisplacement).toBeCloseTo(256 / 255, 5)
  })

  it('moves alpha together with RGB and validates inputs before work', () => {
    const source = new Uint8ClampedArray([
      0, 0, 0, 0, 0, 0, 0, 0, 200, 100, 50, 128, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    const out = applyDisplace({
      width: 5,
      height: 1,
      pixels: source,
      mapWidth: 1,
      mapHeight: 1,
      mapPixels: solidMap(0),
      options,
    })
    expect([...out.slice(4 * 4, 5 * 4)]).toEqual([200, 100, 50, 128])
    expect(parseDisplaceOptions({})).toEqual({
      horizontalScale: 10,
      verticalScale: 10,
      fit: 'stretch',
      edges: 'repeat',
    })
    expect(() => parseDisplaceOptions({ horizontalScale: 1000 })).toThrow()
    expect(() => parseDisplaceOptions({ fit: 'cover' })).toThrow()
    expect(() =>
      processDisplace({
        width: 2,
        height: 1,
        pixels: new Uint8ClampedArray(4),
        mapWidth: 1,
        mapHeight: 1,
        mapPixels: solidMap(0),
        options,
      }),
    ).toThrow()
    expect(() =>
      processDisplace({
        width: 2,
        height: 1,
        pixels: new Uint8ClampedArray(8),
        mapWidth: 1,
        mapHeight: 1,
        mapPixels: solidMap(0),
        fitRect: { x: 1, y: 0, width: 2, height: 1 },
        options,
      }),
    ).toThrow()
  })
})
