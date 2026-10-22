import type { BlendMode } from '../types'

/**
 * Photoshop blend modes that Canvas2D cannot express as a
 * `globalCompositeOperation`. They are composited per pixel over a flat
 * rendering of the layer, following the published formulas (W3C Compositing
 * and Blending for the separable light modes; Adobe's own verbal definitions
 * for Subtract/Divide/Darker Color/Lighter Color). This is our arithmetic on
 * the standard formulas, not Adobe's engine.
 */
export const PIXEL_BLEND_MODES = [
  'dissolve',
  'linear-burn',
  'darker-color',
  'lighter-color',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'subtract',
  'divide',
] as const
export type PixelBlendMode = (typeof PIXEL_BLEND_MODES)[number]
export const isPixelBlendMode = (mode: BlendMode): mode is PixelBlendMode =>
  (PIXEL_BLEND_MODES as readonly string[]).includes(mode)

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v)
const colorBurn = (d: number, s: number) =>
  d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s)
const colorDodge = (d: number, s: number) => (d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s)))

/** Separable per-channel blend on 0..1 values. Dissolve and the two
 * whole-color modes are not separable and are handled by blendColor. */
export function blendChannel(mode: PixelBlendMode, d: number, s: number): number {
  switch (mode) {
    case 'linear-burn':
      return clamp01(d + s - 1)
    case 'vivid-light':
      return s <= 0.5 ? colorBurn(d, 2 * s) : colorDodge(d, 2 * (s - 0.5))
    case 'linear-light':
      return clamp01(d + 2 * s - 1)
    case 'pin-light':
      return s <= 0.5 ? Math.min(d, 2 * s) : Math.max(d, 2 * s - 1)
    case 'hard-mix':
      // Adobe: per channel, 255 when backdrop+source >= 255, else 0.
      return d + s >= 1 ? 1 : 0
    case 'subtract':
      return clamp01(d - s)
    case 'divide':
      return s === 0 ? (d === 0 ? 0 : 1) : Math.min(1, d / s)
    default:
      return s
  }
}

/** Full RGB blend (non-premultiplied 0..1 triples). */
export function blendColor(
  mode: PixelBlendMode,
  backdrop: ArrayLike<number>,
  source: ArrayLike<number>,
  out: number[],
) {
  if (mode === 'darker-color' || mode === 'lighter-color') {
    // Adobe compares the total of all channel values and keeps one whole color.
    const bd = backdrop[0] + backdrop[1] + backdrop[2],
      bs = source[0] + source[1] + source[2],
      pick = mode === 'darker-color' ? (bd <= bs ? backdrop : source) : bd >= bs ? backdrop : source
    out[0] = pick[0]
    out[1] = pick[1]
    out[2] = pick[2]
    return
  }
  out[0] = blendChannel(mode, backdrop[0], source[0])
  out[1] = blendChannel(mode, backdrop[1], source[1])
  out[2] = blendChannel(mode, backdrop[2], source[2])
}

/** Stable per-pixel hash for Dissolve, in 0..1. Deterministic so repeated
 * renders of the same document never shimmer. */
export const dissolveHash = (x: number, y: number) => {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ 0x9e3779b9) | 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Composite `source` over `backdrop` in place (both RGBA byte buffers of the
 * same size), using W3C blend-then-source-over arithmetic with the layer
 * opacity folded into the source alpha:
 *   αo = αs + αb·(1−αs)
 *   Co = (αs·(1−αb)·Cs + αs·αb·B(Cb,Cs) + (1−αs)·αb·Cb) / αo
 * Dissolve instead replaces whole pixels with probability αs (stable hash),
 * the replaced pixels acting as fully opaque source.
 */
export function compositePixelBlend(
  backdrop: Uint8ClampedArray,
  source: Uint8ClampedArray,
  mode: PixelBlendMode,
  opacity: number,
  width: number,
  originX = 0,
  originY = 0,
) {
  if (backdrop.length !== source.length || backdrop.length % 4)
    throw new Error('Некорректные буферы пиксельного наложения')
  const strength = clamp01(opacity)
  if (!strength) return
  const bd = [0, 0, 0],
    sd = [0, 0, 0],
    blended = [0, 0, 0]
  for (let i = 0; i < backdrop.length; i += 4) {
    const as = (source[i + 3] / 255) * strength
    if (!as) continue
    const ab = backdrop[i + 3] / 255
    if (mode === 'dissolve') {
      const p = i / 4,
        x = originX + (p % width),
        y = originY + Math.floor(p / width)
      if (dissolveHash(x, y) >= as) continue
      backdrop[i] = source[i]
      backdrop[i + 1] = source[i + 1]
      backdrop[i + 2] = source[i + 2]
      // A chosen dissolve pixel acts as a fully opaque source pixel.
      backdrop[i + 3] = 255
      continue
    }
    bd[0] = backdrop[i] / 255
    bd[1] = backdrop[i + 1] / 255
    bd[2] = backdrop[i + 2] / 255
    sd[0] = source[i] / 255
    sd[1] = source[i + 1] / 255
    sd[2] = source[i + 2] / 255
    blendColor(mode, bd, sd, blended)
    const ao = as + ab * (1 - as)
    if (!ao) {
      backdrop[i + 3] = 0
      continue
    }
    for (let c = 0; c < 3; c++) {
      const co = (as * (1 - ab) * sd[c] + as * ab * blended[c] + (1 - as) * ab * bd[c]) / ao
      backdrop[i + c] = Math.round(clamp01(co) * 255)
    }
    backdrop[i + 3] = Math.round(ao * 255)
  }
}
