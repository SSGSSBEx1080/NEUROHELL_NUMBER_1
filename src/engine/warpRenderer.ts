import type { Layer, Point } from '../types'
import { homography, project } from './projection'
import { hasStyles } from './styles'
const cache = new Map<
  string,
  {
    layer: Layer
    image: HTMLCanvasElement
    left: number
    top: number
    width: number
    height: number
  }
>()
const ignore = new Set(['x', 'y', 'rotation', 'opacity', 'blendMode', 'name', 'visible', 'locked'])
const same = (a: Layer, b: Layer) =>
  Object.keys(a).length === Object.keys(b).length &&
  (Object.keys(a) as (keyof Layer)[]).every((k) => ignore.has(k) || a[k] === b[k])
export function clearWarpCache() {
  cache.clear()
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}
function triangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  s: Point[],
  d: Point[],
  expansion: number,
) {
  const [p, q, r] = s,
    det = p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y)
  if (Math.abs(det) < 1e-9) return
  const coefficients = (v: number[]) => [
    (v[0] * (q.y - r.y) + v[1] * (r.y - p.y) + v[2] * (p.y - q.y)) / det,
    (v[0] * (r.x - q.x) + v[1] * (p.x - r.x) + v[2] * (q.x - p.x)) / det,
    (v[0] * (q.x * r.y - r.x * q.y) +
      v[1] * (r.x * p.y - p.x * r.y) +
      v[2] * (p.x * q.y - q.x * p.y)) /
      det,
  ]
  const x = coefficients(d.map((p) => p.x)),
    y = coefficients(d.map((p) => p.y)),
    center = { x: (d[0].x + d[1].x + d[2].x) / 3, y: (d[0].y + d[1].y + d[2].y) / 3 }
  const edge = d.map((p) => {
    const length = Math.hypot(p.x - center.x, p.y - center.y) || 1
    return {
      x: p.x + ((p.x - center.x) / length) * expansion,
      y: p.y + ((p.y - center.y) / length) * expansion,
    }
  })
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(edge[0].x, edge[0].y)
  ctx.lineTo(edge[1].x, edge[1].y)
  ctx.lineTo(edge[2].x, edge[2].y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(x[0], y[0], x[1], y[1], x[2], y[2])
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}
/** Perspective is applied to a cached raster of the editable source, not destructively to its text or pixels. */
export function renderWarped(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  drawBase: (ctx: CanvasRenderingContext2D) => void,
  volatile = false,
) {
  let entry = cache.get(layer.id)
  if (volatile || !entry || !same(entry.layer, layer)) {
    const matrix = homography(layer.warp!),
      pad = hasStyles(layer.styles) ? 200 : 0
    const sourceW = layer.width + pad * 2,
      sourceH = layer.height + pad * 2,
      sourceScale = Math.min(1, 4096 / sourceW, 4096 / sourceH)
    const source = canvas(sourceW * sourceScale, sourceH * sourceScale),
      s = source.getContext('2d')!
    s.scale(source.width / sourceW, source.height / sourceH)
    s.translate(pad, pad)
    drawBase(s)
    const mapped = (u: number, v: number) => {
      const p = project(
        matrix,
        (u * sourceW - pad) / layer.width,
        (v * sourceH - pad) / layer.height,
      )
      return {
        x: Math.max(-32768, Math.min(32768, p.x * layer.width)),
        y: Math.max(-32768, Math.min(32768, p.y * layer.height)),
      }
    }
    const corners = [mapped(0, 0), mapped(1, 0), mapped(1, 1), mapped(0, 1)],
      left = Math.floor(Math.min(...corners.map((p) => p.x))) - 1,
      top = Math.floor(Math.min(...corners.map((p) => p.y))) - 1
    const width = Math.ceil(Math.max(...corners.map((p) => p.x)) - left) + 1,
      height = Math.ceil(Math.max(...corners.map((p) => p.y)) - top) + 1
    const quality = Math.min(1, 4096 / width, 4096 / height),
      output = canvas(width * quality, height * quality),
      o = output.getContext('2d')!
    o.scale(output.width / width, output.height / height)
    o.translate(-left, -top)
    const n = 20
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const uv = [
          { x: x / n, y: y / n },
          { x: (x + 1) / n, y: y / n },
          { x: (x + 1) / n, y: (y + 1) / n },
          { x: x / n, y: (y + 1) / n },
        ]
        const dest = uv.map((p) => mapped(p.x, p.y)),
          origin = uv.map((p) => ({ x: p.x * source.width, y: p.y * source.height }))
        for (const indices of [
          [0, 1, 2],
          [0, 2, 3],
        ])
          triangle(
            o,
            source,
            indices.map((i) => origin[i]),
            indices.map((i) => dest[i]),
            0.8 / quality,
          )
      }
    entry = { layer, image: output, left, top, width, height }
    cache.set(layer.id, entry)
    let bytes = [...cache.values()].reduce((sum, v) => sum + v.image.width * v.image.height * 4, 0)
    for (const [key, value] of cache) {
      if (bytes <= 64 * 1024 * 1024 && cache.size <= 8) break
      if (key !== layer.id) {
        bytes -= value.image.width * value.image.height * 4
        cache.delete(key)
      }
    }
  }
  ctx.drawImage(entry.image, entry.left, entry.top, entry.width, entry.height)
}
