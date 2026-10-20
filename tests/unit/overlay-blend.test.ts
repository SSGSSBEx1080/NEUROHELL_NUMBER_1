import { describe, expect, it } from 'vitest'
import { applyOverlayBlendToPixels } from '../../src/engine/overlayBlend'
import { normalizeStyles } from '../../src/engine/styles'

const pixels = (width: number, height: number, values: number[]) => ({
  width,
  height,
  data: new Uint8ClampedArray(values),
})

describe('overlay effect blend modes', () => {
  it('blends RGB inside existing alpha and never grows that alpha', () => {
    const content = pixels(3, 1, [200, 100, 50, 128, 10, 20, 30, 0, 200, 100, 50, 77])
    const fill = pixels(3, 1, [128, 255, 0, 255, 255, 255, 255, 255, 255, 0, 128, 128])

    applyOverlayBlendToPixels(content, fill, 'multiply', 1)

    expect([...content.data.slice(0, 4)]).toEqual([100, 100, 0, 128])
    expect([...content.data.slice(4, 8)]).toEqual([10, 20, 30, 0])
    // The last pixel is only half covered by fill alpha, while opacity is 1.
    expect([...content.data.slice(8, 12)]).toEqual([200, 50, 38, 77])
  })

  it('scales the blend by both fill alpha and effect opacity', () => {
    const content = pixels(1, 1, [200, 100, 50, 200])
    const fill = pixels(1, 1, [255, 0, 128, 128])

    applyOverlayBlendToPixels(content, fill, 'screen', 0.5)

    expect([...content.data]).toEqual([214, 100, 76, 200])
  })

  it('keeps undefined and source-over as the Canvas Normal fast path and rejects mismatched fills', () => {
    const content = pixels(1, 1, [10, 20, 30, 40])
    const fill = pixels(1, 1, [250, 240, 230, 255])

    applyOverlayBlendToPixels(content, fill, undefined, 1)
    applyOverlayBlendToPixels(content, fill, 'source-over', 1)
    expect([...content.data]).toEqual([10, 20, 30, 40])
    expect(() =>
      applyOverlayBlendToPixels(content, pixels(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]), 'multiply', 1),
    ).toThrow('Размер заливки наложения')
  })

  it('validates all three overlay blend modes while preserving legacy omission', () => {
    const parsed = normalizeStyles({
      overlays: [{ enabled: true, blendMode: 'hard-light' }],
      gradients: [{ enabled: true, blendMode: 'vivid-light' }],
      pattern: { enabled: true, blendMode: 'color' },
    })!

    expect(parsed.overlays[0].blendMode).toBe('hard-light')
    expect(parsed.gradients[0].blendMode).toBeUndefined()
    expect(parsed.pattern.blendMode).toBe('color')

    const legacy = normalizeStyles({
      overlays: [{ enabled: true }],
      gradients: [{ enabled: true }],
      pattern: { enabled: true },
    })!
    expect(legacy.overlays[0].blendMode).toBeUndefined()
    expect(legacy.gradients[0].blendMode).toBeUndefined()
    expect(legacy.pattern.blendMode).toBeUndefined()
  })
})
