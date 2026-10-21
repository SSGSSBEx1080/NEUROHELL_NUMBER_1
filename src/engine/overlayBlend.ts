import { blendCorrection } from './adjustmentMath'
import { dissolveHash } from './blendModes'
import type { RgbaPixelData } from './bevel'
import type { BlendMode } from '../types'

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * Blends an overlay fill into layer content without changing content alpha.
 * This is the pixel equivalent of clipping the fill with `source-atop`, but
 * with the effect's RGB blend mode applied first. Fill alpha and the effect
 * opacity control how far each content pixel moves towards the blend result.
 */
export function applyOverlayBlendToPixels(
  content: RgbaPixelData,
  fill: RgbaPixelData,
  mode: BlendMode | undefined,
  opacity: number,
) {
  if (!mode || mode === 'source-over' || opacity <= 0) return
  if (content.width !== fill.width || content.height !== fill.height) {
    throw new Error('Размер заливки наложения не совпадает с размером слоя')
  }
  const strengthScale = clamp01(opacity)
  const blended = [0, 0, 0]
  for (let offset = 0; offset < content.data.length; offset += 4) {
    const contentAlpha = content.data[offset + 3]
    const fillAlpha = fill.data[offset + 3]
    if (!contentAlpha || !fillAlpha) continue
    let amount = (fillAlpha / 255) * strengthScale
    if (mode === 'dissolve') {
      const pixelIndex = offset / 4
      amount =
        dissolveHash(pixelIndex % content.width, Math.floor(pixelIndex / content.width)) < amount
          ? 1
          : 0
    }
    if (amount <= 0) continue
    const r = content.data[offset] / 255
    const g = content.data[offset + 1] / 255
    const b = content.data[offset + 2] / 255
    blended[0] = fill.data[offset] / 255
    blended[1] = fill.data[offset + 1] / 255
    blended[2] = fill.data[offset + 2] / 255
    blendCorrection(mode, r, g, b, blended)
    content.data[offset] = Math.round(clamp01(r + (clamp01(blended[0]) - r) * amount) * 255)
    content.data[offset + 1] = Math.round(clamp01(g + (clamp01(blended[1]) - g) * amount) * 255)
    content.data[offset + 2] = Math.round(clamp01(b + (clamp01(blended[2]) - b) * amount) * 255)
    // Overlay effects recolour existing layer alpha; they never grow it.
    content.data[offset + 3] = contentAlpha
  }
}
