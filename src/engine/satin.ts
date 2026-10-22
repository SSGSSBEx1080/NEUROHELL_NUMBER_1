import { blendCorrection } from './adjustmentMath'
import { dissolveHash } from './blendModes'
import { buildContourAlphaLut, isLinearEffectContour } from './contours'
import { rgbFromHex } from './gradientRamp'
import type { RgbaPixelData } from './bevel'
import type { SatinEffectStyle } from '../types'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function blurAlphaField(pixels: RgbaPixelData, radius: number): Float32Array {
  const { width, height } = pixels
  let source = new Float32Array(width * height)
  for (let i = 0; i < source.length; i++) source[i] = pixels.data[i * 4 + 3] / 255
  if (radius < 1) return source
  let target = new Float32Array(source.length)
  const prefix = new Float32Array(Math.max(width, height) + 1)
  const extent = radius * 2 + 1
  // Three zero-padded box passes approximate a Gaussian while preserving the
  // fact that alpha outside the styled surface is really zero.
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let x = 0; x < width; x++) {
        sum += source[y * width + x]
        prefix[x + 1] = sum
      }
      for (let x = 0; x < width; x++) {
        const lo = Math.max(0, x - radius)
        const hi = Math.min(width - 1, x + radius)
        target[y * width + x] = (prefix[hi + 1] - prefix[lo]) / extent
      }
    }
    ;[source, target] = [target, source]
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = 0; y < height; y++) {
        sum += source[y * width + x]
        prefix[y + 1] = sum
      }
      for (let y = 0; y < height; y++) {
        const lo = Math.max(0, y - radius)
        const hi = Math.min(height - 1, y + radius)
        target[y * width + x] = (prefix[hi + 1] - prefix[lo]) / extent
      }
    }
    ;[source, target] = [target, source]
  }
  return source
}

function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  antialiased: boolean,
): number {
  if (!antialiased) {
    const ix = Math.round(x)
    const iy = Math.round(y)
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? 0 : field[iy * width + ix]
  }
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  let result = 0
  for (let oy = 0; oy <= 1; oy++) {
    const iy = y0 + oy
    if (iy < 0 || iy >= height) continue
    for (let ox = 0; ox <= 1; ox++) {
      const ix = x0 + ox
      if (ix < 0 || ix >= width) continue
      result += field[iy * width + ix] * (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy)
    }
  }
  return result
}

/**
 * Satin mask before opacity. The layer alpha is blurred by Size/2, sampled
 * half the Distance before and after each pixel along the PSD angle axis,
 * and the absolute difference of those two copies is shaped by the contour.
 * Invert flips the contoured result (equivalently, it flips the contour).
 * This is an independent model of the documented two-copy behaviour, not
 * Adobe's code or a claim of pixel-identical contour handling.
 */
export function satinMaskField(
  base: RgbaPixelData,
  effect: SatinEffectStyle,
  renderScale = 1,
): Float32Array {
  const { width, height } = base
  const mask = new Float32Array(width * height)
  const scale = Math.max(0.0001, Number.isFinite(renderScale) ? renderScale : 1)
  const blurred = blurAlphaField(base, Math.round((effect.size / 2) * scale))
  const angle = (effect.angle * Math.PI) / 180
  const halfDistance = (effect.distance * scale) / 2
  const dx = Math.cos(angle) * halfDistance
  const dy = -Math.sin(angle) * halfDistance
  const contourLut = isLinearEffectContour(effect.contour)
    ? undefined
    : buildContourAlphaLut(effect.contour, effect.antialiased)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!base.data[i * 4 + 3]) continue
      const before = sampleField(blurred, width, height, x - dx, y - dy, effect.antialiased)
      const after = sampleField(blurred, width, height, x + dx, y + dy, effect.antialiased)
      const difference = clamp01(Math.abs(before - after))
      const shaped = contourLut ? contourLut[Math.round(difference * 255)] / 255 : difference
      mask[i] = effect.invert ? 1 - shaped : shaped
    }
  }
  return mask
}

export function applySatinToPixels(
  output: RgbaPixelData,
  base: RgbaPixelData,
  content: RgbaPixelData,
  effect: SatinEffectStyle,
  renderScale = 1,
) {
  if (
    !effect.enabled ||
    effect.opacity <= 0 ||
    output.width !== base.width ||
    output.height !== base.height ||
    output.width !== content.width ||
    output.height !== content.height ||
    (!effect.invert && effect.distance === 0)
  )
    return
  const mask = satinMaskField(base, effect, renderScale)
  const satinColor = rgbFromHex(effect.color)
  const blended = [0, 0, 0]
  for (let i = 0; i < mask.length; i++) {
    let amount = clamp01(mask[i] * effect.opacity)
    if (effect.blendMode === 'dissolve')
      amount = dissolveHash(i % output.width, Math.floor(i / output.width)) < amount ? 1 : 0
    if (amount <= 0.0001) continue
    const offset = i * 4
    const baseAlpha = base.data[offset + 3] / 255
    if (!baseAlpha) continue
    const outputAlpha = output.data[offset + 3] / 255
    let r: number, g: number, b: number
    if (outputAlpha > 0) {
      r = output.data[offset] / 255
      g = output.data[offset + 1] / 255
      b = output.data[offset + 2] / 255
    } else {
      r = content.data[offset] / 255
      g = content.data[offset + 1] / 255
      b = content.data[offset + 2] / 255
    }
    blended[0] = satinColor[0]
    blended[1] = satinColor[1]
    blended[2] = satinColor[2]
    blendCorrection(effect.blendMode, r, g, b, blended)
    output.data[offset] = Math.round(clamp01(r + (clamp01(blended[0]) - r) * amount) * 255)
    output.data[offset + 1] = Math.round(clamp01(g + (clamp01(blended[1]) - g) * amount) * 255)
    output.data[offset + 2] = Math.round(clamp01(b + (clamp01(blended[2]) - b) * amount) * 255)
    output.data[offset + 3] = Math.round(Math.max(outputAlpha, baseAlpha * amount) * 255)
  }
}
