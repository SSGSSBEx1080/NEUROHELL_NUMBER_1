import type { BlendIfChannel, BlendIfChannelKey, BlendIfQuad, BlendIfRanges } from '../types'

export const DEFAULT_BLEND_IF_QUAD: BlendIfQuad = [0, 0, 255, 255]
export const BLEND_IF_CHANNELS: BlendIfChannelKey[] = ['gray', 'red', 'green', 'blue']
export const blendIfChannelNames: Record<BlendIfChannelKey, string> = {
  gray: 'Серый',
  red: 'Красный',
  green: 'Зелёный',
  blue: 'Синий',
}

const channel = (): BlendIfChannel => ({
  source: [...DEFAULT_BLEND_IF_QUAD],
  under: [...DEFAULT_BLEND_IF_QUAD],
})
export function defaultBlendIf(): BlendIfRanges {
  return { gray: channel(), red: channel(), green: channel(), blue: channel() }
}

const byte = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v))) : fallback
function parseQuad(input: unknown): BlendIfQuad {
  if (!Array.isArray(input)) return [...DEFAULT_BLEND_IF_QUAD]
  let [b0, b1, w0, w1] = [
    byte(input[0], 0),
    byte(input[1], 0),
    byte(input[2], 255),
    byte(input[3], 255),
  ]
  // Each split pair is ordered; the pairs may still overlap each other.
  if (b1 < b0) [b0, b1] = [b1, b0]
  if (w1 < w0) [w0, w1] = [w1, w0]
  return [b0, b1, w0, w1]
}
function parseChannel(input: unknown): BlendIfChannel {
  const v =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined
  return { source: parseQuad(v?.source), under: parseQuad(v?.under) }
}
/** Single validation gateway for Blend If ranges (projects, PSD, actions, libraries). */
export function parseBlendIf(input: unknown): BlendIfRanges | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const v = input as Record<string, unknown>
  const parsed: BlendIfRanges = {
    gray: parseChannel(v.gray),
    red: parseChannel(v.red),
    green: parseChannel(v.green),
    blue: parseChannel(v.blue),
  }
  return isBlendIfActive(parsed) ? parsed : undefined
}

const isDefaultQuad = (q: BlendIfQuad) => q[0] === 0 && q[1] === 0 && q[2] === 255 && q[3] === 255
export function isBlendIfActive(ranges?: BlendIfRanges): boolean {
  if (!ranges) return false
  return BLEND_IF_CHANNELS.some(
    (key) => !isDefaultQuad(ranges[key].source) || !isDefaultQuad(ranges[key].under),
  )
}
export function isBlendIfUnderActive(ranges?: BlendIfRanges): boolean {
  if (!ranges) return false
  return BLEND_IF_CHANNELS.some((key) => !isDefaultQuad(ranges[key].under))
}

/** Visibility factor 0..1 of one channel value (0..255) inside one quad. */
export function blendIfRangeFactor(value: number, quad: BlendIfQuad): number {
  const [b0, b1, w0, w1] = quad
  let f = 1
  if (value < b1) f = b1 > b0 ? Math.max(0, (value - b0) / (b1 - b0)) : value >= b0 ? 1 : 0
  if (value > w0) {
    const top = w1 > w0 ? Math.max(0, (w1 - value) / (w1 - w0)) : value <= w0 ? 1 : 0
    f *= Math.min(1, top)
  }
  return Math.min(1, Math.max(0, f))
}

// Gray channel of Blend If: the same documented luminance weights as corrections.
const lum = (r: number, g: number, b: number) => Math.round(r * 0.3 + g * 0.59 + b * 0.11)

interface CompiledSide {
  tables: (Float64Array | undefined)[] // per channel key index: gray, r, g, b
  any: boolean
}
function compileSide(ranges: BlendIfRanges, side: 'source' | 'under'): CompiledSide {
  const tables = BLEND_IF_CHANNELS.map((key) => {
    const quad = ranges[key][side]
    if (isDefaultQuad(quad)) return undefined
    const table = new Float64Array(256)
    for (let v = 0; v < 256; v++) table[v] = blendIfRangeFactor(v, quad)
    return table
  })
  return { tables, any: tables.some(Boolean) }
}
function sideFactor(side: CompiledSide, data: Uint8ClampedArray, i: number): number {
  let f = 1
  const gray = side.tables[0]
  if (gray) f *= gray[lum(data[i], data[i + 1], data[i + 2])]
  if (f === 0) return 0
  for (let c = 0; c < 3; c++) {
    const table = side.tables[c + 1]
    if (table) {
      f *= table[data[i + c]]
      if (f === 0) return 0
    }
  }
  return f
}

/**
 * Modulates the alpha of `result` (the layer's rendered pixels) by Blend If.
 * This-layer ranges read `result` itself; underlying ranges read `under`,
 * the composite below the layer in the same pixel coordinates. All three
 * buffers must share length; RGB is never touched.
 */
export function applyBlendIf(
  result: Uint8ClampedArray,
  under: Uint8ClampedArray,
  ranges: BlendIfRanges,
) {
  const source = compileSide(ranges, 'source'),
    below = compileSide(ranges, 'under')
  if (!source.any && !below.any) return
  for (let i = 0; i < result.length; i += 4) {
    const alpha = result[i + 3]
    if (!alpha) continue
    let f = 1
    if (source.any) f *= sideFactor(source, result, i)
    if (f > 0 && below.any) f *= sideFactor(below, under, i)
    if (f !== 1) result[i + 3] = Math.round(alpha * f)
  }
}

/**
 * Coverage mask (0..255 per pixel) from the underlying ranges only.
 * Adjustment layers have no pixels of their own, so for them only the
 * underlying side can act — as the strength mask of the correction.
 */
export function blendIfUnderMask(
  under: Uint8ClampedArray,
  pixelCount: number,
  ranges: BlendIfRanges,
): Uint8ClampedArray {
  const below = compileSide(ranges, 'under'),
    mask = new Uint8ClampedArray(pixelCount)
  for (let p = 0, i = 0; p < pixelCount; p++, i += 4)
    mask[p] = below.any ? Math.round(255 * sideFactor(below, under, i)) : 255
  return mask
}
