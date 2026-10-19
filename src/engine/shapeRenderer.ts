import type { Layer } from '../types'
import { shapePadding, shapePaths } from './shapeGeometry'
const cache = new Map<string, { layer: Layer; path: Path2D; rule: CanvasFillRule }>()
const keys = [
  'width',
  'height',
  'shape',
  'radius',
  'cornerRadii',
  'sides',
  'starRatio',
  'shapePaths',
] as const
export function canvasShape(layer: Layer) {
  let entry = cache.get(layer.id)
  if (!entry || keys.some((k) => entry!.layer[k] !== layer[k])) {
    const path = new Path2D(),
      paths = shapePaths(layer)
    for (const p of paths) {
      const first = p.knots[0].points
      path.moveTo(first[2], first[3])
      for (let i = 1; i < p.knots.length + (p.open ? 0 : 1); i++) {
        const a = p.knots[i - 1].points,
          b = p.knots[i % p.knots.length].points
        path.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3])
      }
      if (!p.open) path.closePath()
    }
    entry = { layer, path, rule: paths[0]?.fillRule === 'even-odd' ? 'evenodd' : 'nonzero' }
    cache.set(layer.id, entry)
    if (cache.size > 128) cache.delete(cache.keys().next().value!)
  }
  return entry
}
export function configureStroke(ctx: CanvasRenderingContext2D, layer: Layer) {
  ctx.strokeStyle = layer.strokeColor || layer.color
  ctx.lineWidth = layer.strokeWidth || 0
  ctx.lineJoin = layer.strokeJoin || 'miter'
  ctx.lineCap = layer.strokeCap || 'butt'
  ctx.miterLimit = layer.strokeMiterLimit || 4
  ctx.setLineDash(layer.strokeDash || [])
  ctx.lineDashOffset = layer.strokeDashOffset || 0
}
export function renderShape(ctx: CanvasRenderingContext2D, layer: Layer) {
  const { path, rule } = canvasShape(layer)
  if (layer.shapeFill !== false && layer.shape !== 'line') {
    ctx.fillStyle = layer.color
    ctx.fill(path, rule)
  }
  if (!layer.strokeColor || !layer.strokeWidth) return
  ctx.save()
  configureStroke(ctx, layer)
  if (layer.strokeAlign === 'inside' && layer.shape !== 'line') {
    ctx.clip(path, rule)
    ctx.lineWidth *= 2
  } else if (layer.strokeAlign === 'outside' && layer.shape !== 'line') {
    const outside = new Path2D(),
      p = shapePadding(layer) + 4
    outside.rect(-p, -p, layer.width + p * 2, layer.height + p * 2)
    outside.addPath(path)
    ctx.clip(outside, 'evenodd')
    ctx.lineWidth *= 2
  }
  ctx.stroke(path)
  ctx.restore()
}
let hitContext: CanvasRenderingContext2D | undefined
export function hitShape(layer: Layer, x: number, y: number) {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') {
    if (layer.shape === 'ellipse')
      return (
        ((x - layer.width / 2) / (layer.width / 2)) ** 2 +
          ((y - layer.height / 2) / (layer.height / 2)) ** 2 <=
        1
      )
    return x >= 0 && y >= 0 && x <= layer.width && y <= layer.height
  }
  hitContext ||= document.createElement('canvas').getContext('2d')!
  const { path, rule } = canvasShape(layer),
    inside = hitContext.isPointInPath(path, x, y, rule)
  if (layer.shapeFill !== false && layer.shape !== 'line' && inside) return true
  if (!layer.strokeColor || !layer.strokeWidth) return false
  configureStroke(hitContext, layer)
  hitContext.lineWidth = Math.max(
    6,
    layer.strokeWidth *
      (layer.strokeAlign && layer.strokeAlign !== 'center' && layer.shape !== 'line' ? 2 : 1),
  )
  // Small visual handles/lines remain selectable. Gaps in dashes stay non-hit areas.
  const hit = hitContext.isPointInStroke(path, x, y)
  return (
    hit &&
    (layer.strokeAlign === 'inside' ? inside : layer.strokeAlign === 'outside' ? !inside : true)
  )
}
