import type { Layer, Selection } from '../types'
import { transformedPaths } from './shapeGeometry'
import { rasterSelection, validateSelectionSize } from './selectionPixels'
import { pathSvg } from './pathEditing'
/** Path coverage, not layer alpha: ignores mask, stroke, FX and opacity by design.
 * Open components are implicitly closed for filling, like Canvas/native vector fill.
 */
export function pathSelection(layer: Layer, width: number, height: number): Selection {
  validateSelectionSize(width, height, width * height)
  if (layer.kind !== 'shape') throw new Error('Выбери векторный контур')
  const paths = transformedPaths(layer),
    canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fill(new Path2D(pathSvg(paths)), paths[0]?.fillRule === 'even-odd' ? 'evenodd' : 'nonzero')
  const rgba = ctx.getImageData(0, 0, width, height).data,
    coverage = new Uint8ClampedArray(width * height)
  for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3]
  return rasterSelection(coverage, width, height)
}
