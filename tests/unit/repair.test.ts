import { describe, expect, it } from 'vitest'
import { repairPixels, type RepairRequest } from '../../src/engine/repair'
function fixture(paint: (x: number, y: number) => number[], mode: RepairRequest['mode'] = 'auto') {
  const width = 96,
    height = 80,
    pixels = new Uint8ClampedArray(width * height * 4),
    mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels.set([...paint(x, y), 255], (y * width + x) * 4)
  const truth = pixels.slice()
  for (let y = 28; y < 52; y++)
    for (let x = 32; x < 64; x++) {
      const p = y * width + x
      mask[p] = 255
      pixels[p * 4] = pixels[p * 4 + 1] = pixels[p * 4 + 2] = 5
    }
  const request: RepairRequest = {
    width,
    height,
    pixels,
    mask,
    mode,
    radius: 4,
    search: 64,
    expand: 0,
    feather: 0,
  }
  return { request, truth }
}
describe('local layout restoration', () => {
  it('removes lettering on paper exactly without touching any unselected pixel or source', () => {
    const { request, truth } = fixture(() => [247, 246, 240]),
      input = request.pixels.slice()
    const result = repairPixels(request)
    expect(result.mode).toBe('smooth')
    expect(result.filled).toBe(768)
    expect(Buffer.from(result.pixels).equals(Buffer.from(truth))).toBe(true)
    expect(Buffer.from(request.pixels).equals(Buffer.from(input))).toBe(true)
  })
  it('reconstructs an RGB lighting plane instead of smearing boundary colours', () => {
    const { request, truth } = fixture((x, y) => [80 + x, 90 + y, 50 + x + y])
    const result = repairPixels(request)
    expect(result.mode).toBe('smooth')
    expect(Math.max(...result.pixels.map((v, i) => Math.abs(v - truth[i])))).toBeLessThanOrEqual(1)
  })
  it('preserves the phase of a repeating pattern using original source patches', () => {
    const { request, truth } = fixture((x, y) => {
      const v = x % 6 < 2 && y % 6 < 2 ? 35 : 235
      return [v, v, v]
    }, 'texture')
    const progress: number[] = [],
      result = repairPixels(request, (n) => progress.push(n))
    let error = 0,
      count = 0
    for (let p = 0; p < request.mask.length; p++) {
      if (!request.mask[p]) expect(result.pixels[p * 4]).toBe(request.pixels[p * 4])
      else {
        error += Math.abs(result.pixels[p * 4] - truth[p * 4])
        count++
      }
    }
    expect(error / count).toBeLessThan(5)
    expect(result.patches).toBeGreaterThan(1)
    expect(progress.at(-1)).toBe(1)
    expect(Buffer.from(repairPixels(request).pixels).equals(Buffer.from(result.pixels))).toBe(true)
  })
  it('respects prohibited donors and does not fabricate success for impossible selections', () => {
    const { request } = fixture(() => [240, 240, 240], 'texture')
    expect(() => repairPixels({ ...request, donors: new Uint8Array(request.mask.length) })).toThrow(
      /окружения/,
    )
    expect(() =>
      repairPixels({ ...request, mask: new Uint8Array(request.mask.length).fill(255) }),
    ).toThrow(/окружения/)
    expect(() => repairPixels({ ...request, width: 100000 })).toThrow()
    request.pixels[(30 * request.width + 40) * 4 + 3] = 0
    expect(() => repairPixels(request)).toThrow(/непрозрачную/)
  })
  it('expansion and inward feather are bounded, and leave the outer source unchanged', () => {
    const { request } = fixture(() => [255, 255, 255])
    const result = repairPixels({ ...request, expand: 2, feather: 2 })
    expect(result.mask[26 * 96 + 30]).toBeGreaterThan(0)
    expect(result.mask[26 * 96 + 30]).toBeLessThan(255)
    expect(result.mask[25 * 96 + 29]).toBe(0)
    expect(result.pixels[25 * 96 * 4]).toBe(255)
  })
})
