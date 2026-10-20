import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  applyBlendIf,
  blendIfRangeFactor,
  blendIfUnderMask,
  defaultBlendIf,
  isBlendIfActive,
  parseBlendIf,
} from '../../src/engine/blendIf'
import { __psdStyleCodecForTests } from '../../src/engine/psd'
import type { BlendIfRanges } from '../../src/types'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

describe('Blend If ranges', () => {
  it('parses, clamps and orders split pairs; pure defaults stay unset', () => {
    expect(parseBlendIf(undefined)).toBeUndefined()
    expect(parseBlendIf({})).toBeUndefined()
    expect(parseBlendIf(defaultBlendIf())).toBeUndefined()
    expect(isBlendIfActive(defaultBlendIf())).toBe(false)
    const parsed = parseBlendIf({
      gray: { source: [200, 40, 999, -5], under: [10, 20, 30, 40] },
      red: { source: [1.6, 2.4, 250, 251] },
    })!
    expect(parsed.gray.source).toEqual([40, 200, 0, 255])
    expect(parsed.gray.under).toEqual([10, 20, 30, 40])
    expect(parsed.red.source).toEqual([2, 2, 250, 251])
    expect(parsed.red.under).toEqual([0, 0, 255, 255])
    expect(isBlendIfActive(parsed)).toBe(true)
  })

  it('ramps factors across split thresholds with hard steps at equal pairs', () => {
    expect(blendIfRangeFactor(0, [0, 0, 255, 255])).toBe(1)
    expect(blendIfRangeFactor(255, [0, 0, 255, 255])).toBe(1)
    expect(blendIfRangeFactor(63, [64, 64, 255, 255])).toBe(0)
    expect(blendIfRangeFactor(64, [64, 64, 255, 255])).toBe(1)
    expect(blendIfRangeFactor(64, [0, 128, 255, 255])).toBeCloseTo(0.5, 6)
    expect(blendIfRangeFactor(128, [0, 0, 128, 255])).toBe(1)
    expect(blendIfRangeFactor(255, [0, 0, 128, 255])).toBe(0)
    expect(blendIfRangeFactor(192, [0, 0, 128, 255])).toBeCloseTo(63 / 127, 6)
  })

  it('modulates alpha by this-layer and underlying pixels independently', () => {
    // 3 pixels: dark gray, bright red, white. Backdrop: black, white, mid gray.
    const result = new Uint8ClampedArray([30, 30, 30, 255, 255, 0, 0, 200, 255, 255, 255, 128])
    const under = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255])
    const ranges: BlendIfRanges = {
      gray: { source: [100, 100, 255, 255], under: [0, 0, 255, 255] },
      red: { source: [0, 0, 255, 255], under: [0, 0, 200, 200] },
      green: { source: [0, 0, 255, 255], under: [0, 0, 255, 255] },
      blue: { source: [0, 0, 255, 255], under: [0, 0, 255, 255] },
    }
    applyBlendIf(result, under, ranges)
    // Dark pixel hidden by its own luminance (30 < 100).
    expect(result[3]).toBe(0)
    // Red pixel: own luminance 77 < 100 hides it too (multiply mode).
    expect(result[7]).toBe(0)
    // White pixel passes source; backdrop red channel 128 <= 200 keeps alpha.
    expect(result[11]).toBe(128)
    // RGB is never touched.
    expect([result[0], result[4], result[8]]).toEqual([30, 255, 255])
  })

  it('builds an underlying-only mask for adjustment layers', () => {
    const under = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    const ranges = defaultBlendIf()
    ranges.gray.under = [128, 128, 255, 255]
    expect([...blendIfUnderMask(under, 2, ranges)]).toEqual([0, 255])
  })

  it('round-trips natively through binary PSD layer blending ranges', () => {
    const ranges = defaultBlendIf()
    ranges.gray.source = [12, 48, 200, 240]
    ranges.gray.under = [0, 0, 180, 255]
    ranges.red.source = [0, 64, 255, 255]
    ranges.blue.under = [24, 24, 255, 255]
    const { exportBlendIf, importBlendIf } = __psdStyleCodecForTests
    const native = exportBlendIf(ranges)!
    expect(native.compositeGrayBlendSource).toEqual([12, 48, 200, 240])
    const bytes = writePsd({
      width: 4,
      height: 4,
      children: [{ name: 'blended', blendingRanges: native }],
    })
    const layer = readPsd(bytes, { useImageData: true }).children![0]
    const imported = importBlendIf(layer)!
    expect(imported).toEqual(parseBlendIf(ranges))
    // Default ranges never force a blendingRanges section into the file.
    expect(exportBlendIf(defaultBlendIf())).toBeUndefined()
    expect(exportBlendIf(undefined)).toBeUndefined()
  })
})
