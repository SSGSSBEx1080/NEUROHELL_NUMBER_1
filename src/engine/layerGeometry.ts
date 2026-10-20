import type { Layer, Point, Quad, Rect } from '../types'
import { getTextGeometry } from './textGeometry'
import { layerPoint, pointBounds, shapePadding } from './shapeGeometry'
import { homography, project } from './projection'
export const rectPoints = (r: Rect): Quad => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
]
export const expandBounds = (r: Rect, p: number): Rect => ({
  x: r.x - p,
  y: r.y - p,
  width: r.width + p * 2,
  height: r.height + p * 2,
})
/** Outward integer bounds avoid a scale/unscale resampling just to store a bitmap. */
export function pixelBounds(r: Rect): Rect {
  const x = Math.floor(r.x),
    y = Math.floor(r.y)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(r.x + r.width) - x),
    height: Math.max(1, Math.ceil(r.y + r.height) - y),
  }
}
export function localBounds(layer: Layer, flipped = false): Rect {
  const r =
    layer.kind === 'text'
      ? getTextGeometry(layer).bounds
      : { x: 0, y: 0, width: layer.width, height: layer.height }
  return {
    ...r,
    x: flipped && layer.flipX ? layer.width - r.x - r.width : r.x,
    y: flipped && layer.flipY ? layer.height - r.y - r.height : r.y,
  }
}
export function rasterBounds(layer: Layer, effects = false, flipped = false): Rect {
  const s = effects && layer.styles
  const pad =
    (layer.adjustments.blur || 0) * 3 +
    (layer.kind === 'shape' ? shapePadding(layer) : 0) +
    (s
      ? Math.max(
          ...s.strokes.map((e) => (e.enabled ? e.size : 0)),
          ...s.shadows.map((e) =>
            e.enabled ? e.blur * 2 + Math.max(Math.abs(e.x), Math.abs(e.y)) : 0,
          ),
          s.glow.enabled ? s.glow.blur * 2 : 0,
          s.bevel.enabled &&
            (s.bevel.style === 'outer' || s.bevel.style === 'emboss' || s.bevel.style === 'pillow')
            ? s.bevel.size + s.bevel.soften
            : 0,
        )
      : 0) +
    2
  return expandBounds(localBounds(layer, flipped), pad)
}
/** Selection polygon before the outer rotation; the SVG and gesture math share this space. */
export function selectionQuad(layer: Layer): Quad {
  const corners = rectPoints(localBounds(layer, true))
  if (!layer.warp) return corners
  const m = homography(layer.warp)
  return corners.map((p) => {
    const q = project(m, p.x / layer.width, p.y / layer.height)
    return { x: q.x * layer.width, y: q.y * layer.height }
  }) as Quad
}
export const worldBounds = (layer: Layer, raster = false, effects = false) =>
  pointBounds(
    rectPoints(raster ? rasterBounds(layer, effects) : localBounds(layer)).map((p) =>
      layerPoint(layer, p),
    ),
  )
export function visualCenter(layer: Layer) {
  const b = localBounds(layer, true)
  return layerPoint(layer, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, false)
}
export function rotateVisual(layer: Layer, rotation: number): Partial<Layer> {
  const old = visualCenter(layer),
    next = { ...layer, rotation },
    center = visualCenter(next)
  return { rotation, x: layer.x + old.x - center.x, y: layer.y + old.y - center.y }
}
/** Resize real point-text ink. Font size controls Y; horizontal scale controls X.
 * The opposite visual handle stays fixed even with italics, a negative baseline or flips.
 * Never mutate dimensions just because fonts finished loading: history/PSD baselines stay stable.
 */
export function resizePointText(
  layer: Layer,
  target: Rect,
  anchor: Point = { x: 0, y: 0 },
): Partial<Layer> {
  const old = localBounds(layer, true),
    sx = target.width / old.width,
    sy = target.height / old.height
  const size = Math.max(4, Math.min(1000, (layer.fontSize || 48) * sy)),
    actualY = size / (layer.fontSize || 48)
  const next = {
    ...layer,
    width: Math.min(16384, Math.max(1, layer.width * sx)),
    height: Math.min(16384, Math.max(1, layer.height * actualY)),
    fontSize: size,
    textScaleX: Math.max(0.01, Math.min(100, ((layer.textScaleX || 1) * sx) / actualY)),
    letterSpacing: Math.max(-30, Math.min(100, (layer.letterSpacing || 0) * actualY)),
  }
  // Canvas rounds some glyph ink metrics. Correct X using the actual newly measured result.
  const measured = localBounds(next, true)
  next.textScaleX = Math.max(0.01, Math.min(100, (next.textScaleX * target.width) / measured.width))
  const updated = localBounds(next, true)
  const destination = layerPoint(
    layer,
    { x: target.x + target.width * anchor.x, y: target.y + target.height * anchor.y },
    false,
  )
  const origin = layerPoint(
    next,
    { x: updated.x + updated.width * anchor.x, y: updated.y + updated.height * anchor.y },
    false,
  )
  return {
    fontSize: next.fontSize,
    textScaleX: next.textScaleX,
    letterSpacing: next.letterSpacing,
    width: next.width,
    height: next.height,
    x: next.x + destination.x - origin.x,
    y: next.y + destination.y - origin.y,
  }
}
/** Change the homography of the visual selection, not a stale stored text rectangle. */
export function distortVisual(layer: Layer, handle: string, dx: number, dy: number): Quad {
  const r = localBounds(layer, true),
    quad = selectionQuad(layer).map((p) => ({ ...p })) as Quad
  const indices: Record<string, number[]> = {
    nw: [0],
    ne: [1],
    se: [2],
    sw: [3],
    n: [0, 1],
    e: [1, 2],
    s: [2, 3],
    w: [3, 0],
  }
  for (const i of indices[handle] || []) {
    quad[i].x += dx
    quad[i].y += dy
  }
  const m = homography(quad)
  return rectPoints({ x: 0, y: 0, width: layer.width, height: layer.height }).map((p) => {
    const q = project(m, (p.x - r.x) / r.width, (p.y - r.y) / r.height)
    return { x: q.x / layer.width, y: q.y / layer.height }
  }) as Quad
}
