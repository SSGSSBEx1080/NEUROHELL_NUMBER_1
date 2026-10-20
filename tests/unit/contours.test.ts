import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  CUSTOM_EFFECT_CONTOUR_NAME,
  MAX_EFFECT_CONTOUR_POINTS,
  addEffectContourPoint,
  buildContourAlphaLut,
  contourWithEditorEndpoints,
  effectContourPreset,
  isLinearEffectContour,
  linearEffectContour,
  matchingContourPreset,
  moveEffectContourPoint,
  parseEffectContour,
  removeEffectContourPoint,
  sampleEffectContour,
} from '../../src/engine/contours'
import { applyBevelToPixels, type RgbaPixelData } from '../../src/engine/bevel'
import { satinMaskField } from '../../src/engine/satin'
import { __psdStyleCodecForTests } from '../../src/engine/psd'
import { defaultBevelStyle, defaultSatinStyle, normalizeStyles } from '../../src/engine/styles'
import type { EffectContourDefinition } from '../../src/types'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

const cone = (): EffectContourDefinition => effectContourPreset('Конус')
const descending = (): EffectContourDefinition => effectContourPreset('Нисходящий')

function rectangle(): RgbaPixelData {
  const width = 41
  const height = 41
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 8; y <= 32; y++)
    for (let x = 8; x <= 32; x++) {
      const i = (y * width + x) * 4
      data[i] = 128
      data[i + 1] = 128
      data[i + 2] = 128
      data[i + 3] = 255
    }
  return { width, height, data }
}

const clone = (pixels: RgbaPixelData): RgbaPixelData => ({
  width: pixels.width,
  height: pixels.height,
  data: new Uint8ClampedArray(pixels.data),
})

const redAt = (pixels: RgbaPixelData, x: number, y: number) =>
  pixels.data[(y * pixels.width + x) * 4]

describe('effect contour parsing and sampling', () => {
  it('accepts PSD curve points, sorts/deduplicates them and cleans the name', () => {
    const literalSlashZero = String.fromCharCode(92) + '0'
    const parsed = parseEffectContour({
      name: `Gaussian${literalSlashZero}`,
      curve: [
        { x: 255.4, y: 300 },
        { x: 64, y: 38 },
        { x: -2, y: -4 },
        { x: 64, y: 41 },
        { x: 'bad', y: 10 },
      ],
    })
    expect(parsed).toEqual({
      name: 'Gaussian',
      points: [
        { x: 0, y: 0 },
        { x: 64, y: 41 },
        { x: 255, y: 255 },
      ],
    })
    expect(parseEffectContour({ name: 'Broken', points: [{ x: 1, y: 2 }] })).toEqual(
      linearEffectContour(),
    )
  })

  it('bounds imported curves to 32 points while retaining both endpoints', () => {
    const parsed = parseEffectContour({
      name: 'Dense',
      points: Array.from({ length: 100 }, (_, i) => ({ x: i * 2, y: i })),
    })
    expect(parsed.points.length).toBeLessThanOrEqual(32)
    expect(parsed.points[0]).toEqual({ x: 0, y: 0 })
    expect(parsed.points.at(-1)).toEqual({ x: 198, y: 99 })
    expect(contourWithEditorEndpoints(parsed).points.at(-1)).toEqual({ x: 255, y: 99 })
  })

  it('samples presets, optionally smoothing a hard contour step', () => {
    expect(sampleEffectContour(linearEffectContour(), 0.37)).toBeCloseTo(0.37)
    expect(sampleEffectContour(cone(), 0)).toBe(0)
    expect(sampleEffectContour(cone(), 128 / 255)).toBe(1)
    expect(sampleEffectContour(cone(), 1)).toBe(0)

    const step: EffectContourDefinition = {
      name: 'Step',
      points: [
        { x: 0, y: 0 },
        { x: 127, y: 0 },
        { x: 128, y: 255 },
        { x: 255, y: 255 },
      ],
    }
    expect(sampleEffectContour(step, 128 / 255)).toBe(1)
    expect(sampleEffectContour(step, 128 / 255, true)).toBeCloseTo(2 / 3)
    expect(matchingContourPreset(cone())?.name).toBe('Конус')
  })

  it('recognizes identity only when the curve really spans the full domain', () => {
    expect(isLinearEffectContour(linearEffectContour())).toBe(true)
    expect(isLinearEffectContour(cone())).toBe(false)
    expect(
      isLinearEffectContour({
        name: 'Partial diagonal',
        points: [
          { x: 64, y: 64 },
          { x: 191, y: 191 },
        ],
      }),
    ).toBe(false)
  })

  it('builds alpha LUTs and moves the effective contour peak with glow Range', () => {
    const linear = buildContourAlphaLut(linearEffectContour())
    expect([...linear]).toEqual(Array.from({ length: 256 }, (_, i) => i))

    const neutral = buildContourAlphaLut(cone())
    const compressed = buildContourAlphaLut(cone(), false, 0.25)
    const stretched = buildContourAlphaLut(cone(), false, 1)
    expect(neutral[128]).toBe(255)
    expect(compressed[64]).toBeGreaterThan(250)
    expect(compressed[128]).toBe(0)
    expect(stretched[128]).toBeGreaterThan(120)
    expect(stretched[128]).toBeLessThan(140)
  })
})

describe('effect contour point editor operations', () => {
  it('moves interior points only between neighbours and endpoint outputs without moving endpoint inputs', () => {
    const moved = moveEffectContourPoint(cone(), 1, { x: 999, y: -20 })
    expect(moved).toEqual({
      name: CUSTOM_EFFECT_CONTOUR_NAME,
      points: [
        { x: 0, y: 0 },
        { x: 254, y: 0 },
        { x: 255, y: 0 },
      ],
    })
    expect(moveEffectContourPoint(cone(), 0, { x: 80, y: 33 }).points[0]).toEqual({
      x: 0,
      y: 33,
    })
    expect(moveEffectContourPoint(cone(), 2, { x: 20, y: 44 }).points[2]).toEqual({
      x: 255,
      y: 44,
    })
  })

  it('adds, replaces and removes points while renaming an imported curve after it changes', () => {
    const imported: EffectContourDefinition = {
      name: 'Gaussian',
      points: [
        { x: 32, y: 7 },
        { x: 128, y: 166 },
        { x: 223, y: 248 },
      ],
    }
    const added = addEffectContourPoint(imported, { x: 80, y: 70 })
    expect(added.index).toBe(2)
    expect(added.contour.name).toBe(CUSTOM_EFFECT_CONTOUR_NAME)
    expect(added.contour.points).toContainEqual({ x: 80, y: 70 })
    expect(added.contour.points[0].x).toBe(0)
    expect(added.contour.points.at(-1)?.x).toBe(255)

    const replaced = addEffectContourPoint(added.contour, { x: 80, y: 90 })
    expect(replaced.contour.points.filter((point) => point.x === 80)).toEqual([{ x: 80, y: 90 }])
    const removed = removeEffectContourPoint(replaced.contour, replaced.index)
    expect(removed.points.some((point) => point.x === 80)).toBe(false)
    expect(removeEffectContourPoint(removed, 0)).toEqual(removed)
  })

  it('restores a preset name on an exact match and refuses a 33rd point', () => {
    const almostCone: EffectContourDefinition = {
      name: CUSTOM_EFFECT_CONTOUR_NAME,
      points: [
        { x: 0, y: 0 },
        { x: 128, y: 200 },
        { x: 255, y: 0 },
      ],
    }
    expect(moveEffectContourPoint(almostCone, 1, { x: 128, y: 255 })).toEqual(cone())

    let full: EffectContourDefinition = {
      name: 'Dense',
      points: Array.from({ length: MAX_EFFECT_CONTOUR_POINTS }, (_, index) => ({
        x: Math.round((index * 255) / (MAX_EFFECT_CONTOUR_POINTS - 1)),
        y: index * 7,
      })),
    }
    full = parseEffectContour(full)
    expect(full.points).toHaveLength(MAX_EFFECT_CONTOUR_POINTS)
    const refused = addEffectContourPoint(full, { x: 129, y: 12 })
    expect(refused.contour).toEqual(full)
  })
})

describe('contours in the Satin and Bevel pixel engines', () => {
  it('shapes the Satin two-copy difference before applying Invert', () => {
    const base = rectangle()
    const zero: EffectContourDefinition = {
      name: 'Zero',
      points: [
        { x: 0, y: 0 },
        { x: 255, y: 0 },
      ],
    }
    const effect = {
      ...defaultSatinStyle(),
      enabled: true,
      angle: 90,
      distance: 10,
      size: 0,
      antialiased: false,
      contour: zero,
    }
    const normal = satinMaskField(base, { ...effect, invert: false })
    const inverted = satinMaskField(base, { ...effect, invert: true })
    expect(normal[20 * 41 + 20]).toBe(0)
    expect(inverted[20 * 41 + 20]).toBe(1)
    expect(inverted[4 * 41 + 20]).toBe(0)
  })

  it('lets a descending gloss contour exchange bevel highlight and shadow', () => {
    const base = rectangle()
    const linear = clone(base)
    applyBevelToPixels(linear, base, base, {
      ...defaultBevelStyle(),
      enabled: true,
      size: 10,
      depth: 2,
      angle: 90,
      altitude: 30,
    })
    expect(redAt(linear, 20, 10)).toBeGreaterThan(150)
    expect(redAt(linear, 20, 30)).toBeLessThan(100)

    const descended = clone(base)
    applyBevelToPixels(descended, base, base, {
      ...defaultBevelStyle(),
      enabled: true,
      size: 10,
      depth: 2,
      angle: 90,
      altitude: 30,
      glossContour: descending(),
    })
    expect(redAt(descended, 20, 10)).toBeLessThan(100)
    expect(redAt(descended, 20, 30)).toBeGreaterThan(150)
  })
})

describe('contours in persisted styles and native PSD descriptors', () => {
  it('validates contour fields and glow Range through normalizeStyles', () => {
    const styles = normalizeStyles({
      glow: {
        enabled: true,
        color: '#ffffff',
        blur: 8,
        opacity: 0.5,
        range: 99,
        antialiased: true,
        contour: cone(),
      },
      bevel: {
        enabled: true,
        glossContour: descending(),
        antialiasGloss: true,
      },
      satin: {
        enabled: true,
        contour: {
          name: 'Custom',
          points: [
            { x: 0, y: 20 },
            { x: 255, y: 200 },
          ],
        },
      },
    })!
    expect(styles.glow.range).toBe(1)
    expect(styles.glow.antialiased).toBe(true)
    expect(styles.glow.contour?.name).toBe('Конус')
    expect(styles.bevel.antialiasGloss).toBe(true)
    expect(styles.bevel.glossContour?.name).toBe('Нисходящий')
    expect(styles.satin.contour?.points).toEqual([
      { x: 0, y: 20 },
      { x: 255, y: 200 },
    ])
  })

  it('round-trips every supported contour through a binary PSD without XMP', () => {
    const gaussian: EffectContourDefinition = {
      name: 'Gaussian',
      points: [
        { x: 0, y: 0 },
        { x: 64, y: 38 },
        { x: 128, y: 166 },
        { x: 255, y: 255 },
      ],
    }
    const styles = normalizeStyles({
      shadows: [
        {
          enabled: true,
          color: '#000000',
          blur: 9,
          x: 2,
          y: 6,
          opacity: 0.7,
          contour: cone(),
          antialiased: true,
        },
      ],
      innerShadows: [
        {
          enabled: true,
          color: '#102030',
          blur: 7,
          x: 0,
          y: 4,
          opacity: 0.6,
          contour: descending(),
        },
      ],
      glow: {
        enabled: true,
        color: '#ffcc88',
        blur: 12,
        opacity: 0.8,
        contour: gaussian,
        antialiased: true,
        range: 0.8,
      },
      innerGlow: {
        enabled: true,
        color: '#ffffff',
        blur: 8,
        opacity: 0.65,
        contour: effectContourPreset('Ступени'),
        range: 0.25,
      },
      bevel: {
        enabled: true,
        size: 9,
        glossContour: effectContourPreset('Обратный конус'),
        antialiasGloss: true,
      },
      satin: {
        enabled: true,
        contour: effectContourPreset('S-кривая'),
      },
    })!

    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const layer = readPsd(
      writePsd({ width: 4, height: 4, children: [{ name: 'contours', effects }] }),
      { useImageData: true },
    ).children![0]

    expect(layer.effects?.dropShadow?.[0].antialiased).toBe(true)
    expect(layer.effects?.dropShadow?.[0].contour).toEqual({
      name: 'Конус',
      curve: cone().points,
    })
    expect(layer.effects?.innerShadow?.[0].contour?.name).toBe('Нисходящий')
    expect(layer.effects?.outerGlow?.antialiased).toBe(true)
    expect(layer.effects?.outerGlow?.range).toBeCloseTo(0.8)
    expect(layer.effects?.outerGlow?.contour).toEqual({
      name: 'Gaussian',
      curve: gaussian.points,
    })
    expect(layer.effects?.innerGlow?.range).toBeCloseTo(0.25)
    expect(layer.effects?.bevel?.useShape).toBe(false)
    expect(layer.effects?.bevel?.antialiasGloss).toBe(true)
    expect(layer.effects?.bevel?.contour?.name).toBe('Обратный конус')
    expect(layer.effects?.satin?.contour?.name).toBe('S-кривая')

    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.shadows[0].contour).toEqual(cone())
    expect(back.shadows[0].antialiased).toBe(true)
    expect(back.innerShadows[0].contour).toEqual(descending())
    expect(back.glow.contour).toEqual(gaussian)
    expect(back.glow.range).toBeCloseTo(0.8)
    expect(back.innerGlow.range).toBeCloseTo(0.25)
    expect(back.bevel.antialiasGloss).toBe(true)
    expect(back.bevel.glossContour).toEqual(effectContourPreset('Обратный конус'))
    expect(back.satin.contour).toEqual(effectContourPreset('S-кривая'))
  })

  it('does not reinterpret a possible Bevel Contour element curve as gloss when useShape is on', () => {
    const styles = normalizeStyles({
      bevel: { enabled: true, size: 8, glossContour: descending() },
    })!
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    effects.bevel = { ...effects.bevel!, useShape: true }
    const layer = readPsd(
      writePsd({ width: 4, height: 4, children: [{ name: 'shape', effects }] }),
      { useImageData: true },
    ).children![0]
    expect(layer.effects?.bevel?.useShape).toBe(true)

    const warnings: string[] = []
    const back = __psdStyleCodecForTests.importStyles(layer, undefined, (message) =>
      warnings.push(message),
    )!
    expect(back.bevel.glossContour).toEqual(linearEffectContour())
    expect(warnings.some((warning) => warning.includes('MpgS'))).toBe(true)
  })
})
