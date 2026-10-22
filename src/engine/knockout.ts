import type { KnockoutMode } from '../types'

export const KNOCKOUT_MODES: readonly KnockoutMode[] = ['shallow', 'deep']

export function parseKnockout(input: unknown): KnockoutMode | undefined {
  return input === 'shallow' || input === 'deep' ? input : undefined
}

export function isKnockout(input: unknown): input is KnockoutMode {
  return parseKnockout(input) !== undefined
}

export interface KnockoutPunchOptions {
  /** Overall layer opacity. It scales the knockout itself, not just its paint. */
  opacity: number
  /** Fill opacity: scales only the content that can refill the punched area. */
  fillOpacity: number
  /** Normal source-over has an exact refill correction; other blends punch shape coverage. */
  normalBlend: boolean
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/**
 * The fraction of the current backdrop to replace by the knockout boundary
 * before the layer itself is composited.
 *
 * For Normal this solves the PDF/Photoshop knockout relation: geometric
 * coverage (times overall opacity) is the shape, while coverage times Fill
 * is the part of that shape which the layer's own content refills. Thus a
 * fully filled Normal layer is unchanged, Fill 0 reveals the boundary, and
 * semi-transparent antialiasing does not double-count the intermediate
 * backdrop. A non-Normal blend must be evaluated against the knocked-out
 * backdrop even at Fill 100, so it uses effective coverage directly.
 */
export function knockoutPunchFactor(shapeAlpha: number, options: KnockoutPunchOptions): number {
  const shape = clamp01(shapeAlpha / 255) * clamp01(options.opacity)
  if (shape <= 0) return 0
  if (!options.normalBlend) return shape
  const source = shape * clamp01(options.fillOpacity)
  if (source >= shape || source >= 1) return 0
  return clamp01((shape - source) / (1 - source))
}

/**
 * Replace `current` by `boundary` in premultiplied space wherever the
 * pre-Fill layer shape punches. Inputs are straight-alpha RGBA byte arrays
 * (the layout returned by Canvas `getImageData`); `current` is mutated.
 */
export function punchKnockoutPixels(
  current: Uint8ClampedArray,
  boundary: Uint8ClampedArray,
  shape: Uint8ClampedArray,
  options: KnockoutPunchOptions,
): void {
  const length = Math.min(current.length, boundary.length, shape.length)
  for (let i = 0; i + 3 < length; i += 4) {
    const k = knockoutPunchFactor(shape[i + 3], options)
    if (k <= 0) continue
    const ca = current[i + 3] / 255
    const ba = boundary[i + 3] / 255
    const alpha = ca + (ba - ca) * k
    if (alpha <= 0) {
      current[i] = current[i + 1] = current[i + 2] = current[i + 3] = 0
      continue
    }
    for (let c = 0; c < 3; c++) {
      const premultiplied = current[i + c] * ca + (boundary[i + c] * ba - current[i + c] * ca) * k
      current[i + c] = Math.min(255, Math.max(0, premultiplied / alpha))
    }
    current[i + 3] = Math.round(alpha * 255)
  }
}
