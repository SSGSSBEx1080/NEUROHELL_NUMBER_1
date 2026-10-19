import type { EditorDocument, Layer } from '../types'
import { applyCorrection } from './adjustmentMath'
import { identityCube, type CubeLut } from './colorLut'
import { hasStyles } from './styles'
/** Only the contiguous visible GLOBAL color stack above the artwork is portable as a LUT.
 * Spatial masks, clipping, groups and pixel filters must never be silently omitted.
 */
export function exportableColorStack(doc: EditorDocument): Layer[] {
  const roots = doc.layers.filter((l) => !l.parentId && l.visible && l.opacity > 0),
    top: Layer[] = []
  for (let i = roots.length - 1; i >= 0; i--) {
    const l = roots[i]
    if (l.kind !== 'adjustment') break
    top.unshift(l)
  }
  if (!top.length)
    throw new Error('Размести видимые корректирующие слои наверху документа, над изображением')
  for (const l of top) {
    if (!l.correction) throw new Error(`«${l.name}»: неподдерживаемая коррекция`)
    if (
      l.clipping ||
      l.mask?.enabled ||
      hasStyles(l.styles) ||
      Object.values(l.adjustments).some(Boolean)
    )
      throw new Error(
        `«${l.name}»: LUT не может сохранить пространственную маску, обтравку или стиль. Отключи их либо экспортируй PSD.`,
      )
  }
  return top
}
export function sampleColorStack(doc: EditorDocument, size = 17): CubeLut {
  const layers = exportableColorStack(doc),
    cube = identityCube(size)
  let pixels = new Uint8ClampedArray(size ** 3 * 4)
  for (let i = 0; i < cube.values.length / 3; i++) {
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = Math.round(cube.values[i * 3 + c] * 255)
    pixels[i * 4 + 3] = 255
  }
  for (const l of layers)
    pixels = applyCorrection(pixels, l.correction!, l.opacity, undefined, l.blendMode)
  for (let i = 0; i < cube.values.length / 3; i++)
    for (let c = 0; c < 3; c++) cube.values[i * 3 + c] = pixels[i * 4 + c] / 255
  return { ...cube, title: doc.name.slice(0, 100) }
}
