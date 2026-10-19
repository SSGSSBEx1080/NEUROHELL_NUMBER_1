import type { Layer, Point, Rect, ShapeKind, ShapePath } from '../types'
import { homography, project } from './projection'

export const shapeNames: Record<ShapeKind, string> = {
  rectangle: 'Прямоугольник',
  ellipse: 'Эллипс',
  polygon: 'Многоугольник',
  star: 'Звезда',
  line: 'Линия',
  path: 'Контур',
}
export const shapeTools = ['rectangle', 'ellipse', 'polygon', 'star', 'line'] as const
const K = 0.5522847498307936
const knot = (x: number, y: number, ix = x, iy = y, ox = x, oy = y) => ({
  linked: false,
  points: [ix, iy, x, y, ox, oy],
})
export function cornerRadii(layer: Layer): [number, number, number, number] {
  const values = layer.cornerRadii || [
    layer.radius || 0,
    layer.radius || 0,
    layer.radius || 0,
    layer.radius || 0,
  ]
  const [a, b, c, d] = values
  // CSS/Canvas radius normalization: scale ALL corners together instead of clipping independently.
  const factor = Math.min(
    1,
    layer.width / (a + b || 1),
    layer.width / (d + c || 1),
    layer.height / (a + d || 1),
    layer.height / (b + c || 1),
  )
  return values.map((v) => v * factor) as [number, number, number, number]
}
/** Local pixel coordinates. Canvas, hit testing and PSD all use these same cubic curves. */
export function shapePaths(layer: Layer): ShapePath[] {
  const w = layer.width,
    h = layer.height
  if (layer.shape === 'path' && layer.shapePaths)
    return layer.shapePaths.map((p) => ({
      ...p,
      knots: p.knots.map((k) => ({ ...k, points: k.points.map((v, i) => v * (i % 2 ? h : w)) })),
    }))
  let knots: ShapePath['knots']
  if (layer.shape === 'ellipse') {
    const rx = w / 2,
      ry = h / 2
    knots = [
      knot(rx, 0, rx - K * rx, 0, rx + K * rx, 0),
      knot(w, ry, w, ry - K * ry, w, ry + K * ry),
      knot(rx, h, rx + K * rx, h, rx - K * rx, h),
      knot(0, ry, 0, ry + K * ry, 0, ry - K * ry),
    ]
  } else if (layer.shape === 'polygon' || layer.shape === 'star') {
    const count = Math.max(3, Math.min(64, Math.round(layer.sides || 5))),
      star = layer.shape === 'star'
    knots = Array.from({ length: count * (star ? 2 : 1) }, (_, i) => {
      const a = (i * Math.PI * 2) / (count * (star ? 2 : 1)) - Math.PI / 2,
        r = star && i % 2 ? (layer.starRatio ?? 0.45) : 1
      return knot(w / 2 + ((Math.cos(a) * w) / 2) * r, h / 2 + ((Math.sin(a) * h) / 2) * r)
    })
  } else if (layer.shape === 'line') knots = [knot(0, h / 2), knot(w, h / 2)]
  else {
    const [a, b, c, d] = cornerRadii(layer)
    knots = [
      knot(a, 0, a - a * K, 0),
      knot(w - b, 0, w - b, 0, w - b + b * K, 0),
      knot(w, b, w, b - b * K),
      knot(w, h - c, w, h - c, w, h - c + c * K),
      knot(w - c, h, w - c + c * K, h),
      knot(d, h, d, h, d - d * K, h),
      knot(0, h - d, 0, h - d + d * K),
      knot(0, a, 0, a, 0, a - a * K),
    ]
    if (![a, b, c, d].some(Boolean)) knots = [knot(0, 0), knot(w, 0), knot(w, h), knot(0, h)]
  }
  return [{ open: layer.shape === 'line', fillRule: 'non-zero', operation: 'combine', knots }]
}
export function layerPoint(layer: Layer, point: Point, flips = true): Point {
  let x = flips && layer.flipX ? layer.width - point.x : point.x,
    y = flips && layer.flipY ? layer.height - point.y : point.y
  if (layer.warp) {
    const p = project(homography(layer.warp), x / layer.width, y / layer.height)
    x = p.x * layer.width
    y = p.y * layer.height
  }
  const a = (layer.rotation * Math.PI) / 180,
    dx = x - layer.width / 2,
    dy = y - layer.height / 2
  return {
    x: layer.x + layer.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: layer.y + layer.height / 2 + dx * Math.sin(a) + dy * Math.cos(a),
  }
}
export function pointBounds(points: Point[]): Rect {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y)
  const x = Math.min(...xs),
    y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(1e-6, Math.max(...xs) - x),
    height: Math.max(1e-6, Math.max(...ys) - y),
  }
}
const cubic = (p: number[], t: number) => {
  const s = 1 - t
  return s * s * s * p[0] + 3 * s * s * t * p[1] + 3 * s * t * t * p[2] + t * t * t * p[3]
}
/** Exact extrema of cubics, not their (often much larger) control polygon. */
export function pathBounds(paths: ShapePath[]): Rect {
  const points: Point[] = []
  for (const path of paths)
    for (let i = 0; i < path.knots.length; i++) {
      const from = path.knots[i].points,
        to = path.knots[(i + 1) % path.knots.length].points
      points.push({ x: from[2], y: from[3] })
      if (path.open && i === path.knots.length - 1) continue
      const x = [from[2], from[4], to[0], to[2]],
        y = [from[3], from[5], to[1], to[3]]
      for (const v of [x, y]) {
        const a = -v[0] + 3 * v[1] - 3 * v[2] + v[3],
          b = 2 * (v[0] - 2 * v[1] + v[2]),
          c = v[1] - v[0]
        const disc = b * b - 4 * a * c
        const roots =
          Math.abs(a) < 1e-10
            ? Math.abs(b) < 1e-10
              ? []
              : [-c / b]
            : disc < 0
              ? []
              : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)]
        for (const t of roots) if (t > 0 && t < 1) points.push({ x: cubic(x, t), y: cubic(y, t) })
      }
    }
  return points.length ? pointBounds(points) : { x: 0, y: 0, width: 1, height: 1 }
}
export function transformedPaths(layer: Layer): ShapePath[] {
  const paths = shapePaths(layer),
    matrix = layer.warp && homography(layer.warp)
  if (!matrix || Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-9)
    return paths.map((p) => ({
      ...p,
      knots: p.knots.map((k) => ({
        ...k,
        points: [0, 2, 4].flatMap((i) => {
          const q = layerPoint(layer, { x: k.points[i], y: k.points[i + 1] })
          return [q.x, q.y]
        }),
      })),
    }))
  // Projective cubics are rational curves, not ordinary cubics. Adaptively flatten to <=0.15 px.
  let total = 0
  return paths.map((p) => {
    const knots: ShapePath['knots'] = []
    const add = (q: Point) => {
      if (++total > 8192) throw new Error('Слишком сложная перспективная фигура (8192 узла)')
      knots.push(knot(q.x, q.y))
    }
    for (let i = 0; i < p.knots.length - (p.open ? 1 : 0); i++) {
      const a = p.knots[i].points,
        b = p.knots[(i + 1) % p.knots.length].points
      const at = (t: number) =>
        layerPoint(layer, {
          x: cubic([a[2], a[4], b[0], b[2]], t),
          y: cubic([a[3], a[5], b[1], b[3]], t),
        })
      const subdivide = (t0: number, t1: number, q0: Point, q1: Point, depth: number) => {
        const tm = (t0 + t1) / 2,
          mid = at(tm),
          q25 = at((3 * t0 + t1) / 4),
          q75 = at((t0 + 3 * t1) / 4)
        const error = (q: Point, f: number) =>
          Math.hypot(q.x - (q0.x + (q1.x - q0.x) * f), q.y - (q0.y + (q1.y - q0.y) * f))
        if (depth < 14 && Math.max(error(mid, 0.5), error(q25, 0.25), error(q75, 0.75)) > 0.15) {
          subdivide(t0, tm, q0, mid, depth + 1)
          subdivide(tm, t1, mid, q1, depth + 1)
        } else add(q0)
      }
      subdivide(0, 1, at(0), at(1), 0)
      if (p.open && i === p.knots.length - 2) add(at(1))
    }
    return { ...p, knots }
  })
}
export function shapePadding(layer: Layer) {
  const open = layer.shape === 'line' || layer.shapePaths?.some((p) => p.open)
  if (!layer.strokeColor || !layer.strokeWidth || (layer.strokeAlign === 'inside' && !open))
    return 0
  const join = layer.strokeJoin || 'miter',
    factor = join === 'miter' ? layer.strokeMiterLimit || 4 : 1
  return layer.strokeWidth * (layer.strokeAlign === 'outside' && !open ? 1 : 0.5) * factor
}
/** Strict validation: malformed contours must not become a different, seemingly valid rectangle. */
export function parseShapePaths(input: unknown): ShapePath[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || !input.length || input.length > 128)
    throw new Error('Некорректный векторный контур')
  let count = 0
  return input.map((p) => {
    if (
      !p ||
      typeof p !== 'object' ||
      !Array.isArray(p.knots) ||
      p.knots.length < 2 ||
      (count += p.knots.length) > 8192 ||
      (p.operation && p.operation !== 'combine') ||
      !['non-zero', 'even-odd'].includes(p.fillRule)
    )
      throw new Error('Некорректный векторный контур')
    return {
      open: p.open === true,
      operation: p.operation || 'combine',
      fillRule: p.fillRule,
      knots: p.knots.map((k: { linked?: unknown; points?: unknown }) => {
        if (
          !k ||
          !Array.isArray(k.points) ||
          k.points.length !== 6 ||
          k.points.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 32)
        )
          throw new Error('Некорректные узлы векторного контура')
        return { linked: k.linked === true, points: [...k.points] }
      }),
    }
  })
}
