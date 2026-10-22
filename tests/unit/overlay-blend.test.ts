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

  it('applies pixel-only Subtract inside the existing alpha', () => {
    const content = pixels(1, 1, [100, 200, 50, 190])
    const fill = pixels(1, 1, [30, 250, 50, 255])

    applyOverlayBlendToPixels(content, fill, 'subtract', 1)

    expect([...content.data]).toEqual([70, 0, 0, 190])
  })

  it('dissolves deterministically to whole source or backdrop pixels, never a mix', () => {
    const width = 100,
      height = 100,
      content = pixels(
        width,
        height,
        Array.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? 255 : 64)),
      ),
      fill = pixels(
        width,
        height,
        Array.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? 255 : 255)),
      )

    applyOverlayBlendToPixels(content, fill, 'dissolve', 0.5)

    let whites = 0
    for (let i = 0; i < content.data.length; i += 4) {
      expect([64, 255]).toContain(content.data[i])
      if (content.data[i] === 255) whites++
    }
    expect(whites / (width * height)).toBeGreaterThan(0.45)
    expect(whites / (width * height)).toBeLessThan(0.55)
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

  it('validates overlay, Satin and bevel blend modes, including pixel-only modes while preserving legacy omission', () => {
    const parsed = normalizeStyles({
      overlays: [{ enabled: true, blendMode: 'hard-light' }],
      gradients: [{ enabled: true, blendMode: 'vivid-light' }],
      pattern: { enabled: true, blendMode: 'color' },
      satin: { enabled: true, blendMode: 'subtract' },
      bevel: { enabled: true, highlightBlendMode: 'hard-mix', shadowBlendMode: 'dissolve' },
    })!

    expect(parsed.overlays[0].blendMode).toBe('hard-light')
    expect(parsed.gradients[0].blendMode).toBe('vivid-light')
    expect(parsed.pattern.blendMode).toBe('color')
    expect(parsed.satin.blendMode).toBe('subtract')
    expect(parsed.bevel.highlightBlendMode).toBe('hard-mix')
    expect(parsed.bevel.shadowBlendMode).toBe('dissolve')

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
