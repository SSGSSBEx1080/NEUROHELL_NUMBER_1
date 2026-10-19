import type { Layer, Point, ShapePath, Tool } from '../types'
import { localPoint } from './document'
import { layerPoint, parseShapePaths, pathBounds, shapePaths } from './shapeGeometry'

export interface PathNode {
  path: number
  index: number
}
export type NodePart = 'anchor' | 'in' | 'out'
export type NodeMode = 'corner' | 'smooth' | 'independent'
export const MAX_EDIT_NODES = 2048
export const pathTools: Tool[] = ['pen', 'node', 'add-anchor', 'delete-anchor', 'convert-anchor']
export const nodeKey = (n: PathNode) => `${n.path}:${n.index}`
export const sameNode = (a: PathNode, b: PathNode) => a.path === b.path && a.index === b.index
const at = (points: number[], part: NodePart): Point => {
  const i = part === 'in' ? 0 : part === 'out' ? 4 : 2
  return { x: points[i], y: points[i + 1] }
}
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})
export function assertEditablePath(layer: Layer) {
  if (layer.kind !== 'shape') throw new Error('Выбери векторную фигуру или контур')
  if (layer.warp)
    throw new Error(
      'Перед правкой узлов сбрось перспективу в свойствах. Исходный контур не растрируется.',
    )
  if (shapePaths(layer).reduce((n, p) => n + p.knots.length, 0) > MAX_EDIT_NODES)
    throw new Error(
      `Редактор узлов: до ${MAX_EDIT_NODES} точек на слой. Более сложный исходник сохраняется без упрощения.`,
    )
}
export function normalizedPaths(layer: Layer): ShapePath[] {
  return shapePaths(layer).map((p) => ({
    ...p,
    knots: p.knots.map((k) => ({
      ...k,
      points: k.points.map((v, i) => v / (i % 2 ? layer.height : layer.width)),
    })),
  }))
}
export function convertToPath(layer: Layer): Partial<Layer> {
  assertEditablePath(layer)
  return { shape: 'path', shapePaths: normalizedPaths(layer) }
}
export function pathNodePosition(
  layer: Layer,
  node: PathNode,
  part: NodePart = 'anchor',
): Point | undefined {
  const knot = shapePaths(layer)[node.path]?.knots[node.index]
  return knot && layerPoint(layer, at(knot.points, part))
}
export function pathLocalPoint(layer: Layer, point: Point): Point {
  const p = localPoint(layer, point)
  return { x: layer.flipX ? layer.width - p.x : p.x, y: layer.flipY ? layer.height - p.y : p.y }
}
/** Rebase edited curves onto their exact bounds. A mask keeps its world placement;
 * this is a change of coordinate basis, not a resize of mask pixels or a new bitmap.
 */
export function reframePath(layer: Layer, paths: ShapePath[]): Partial<Layer> {
  assertEditablePath(layer)
  if (!paths.length || paths.length > 128 || paths.some((p) => p.knots.length < 2))
    throw new Error('Контур должен содержать хотя бы две точки')
  if (paths.reduce((n, p) => n + p.knots.length, 0) > MAX_EDIT_NODES)
    throw new Error(`До ${MAX_EDIT_NODES} редактируемых узлов`)
  if (
    paths.some((p) =>
      p.knots.some((k) => k.points.some((v) => !Number.isFinite(v) || Math.abs(v) > 32768)),
    )
  )
    throw new Error('Координаты контура выходят за безопасный диапазон')
  const bounds = pathBounds(paths),
    width = Math.max(1, bounds.width),
    height = Math.max(1, bounds.height)
  if (width > 16384 || height > 16384) throw new Error('Размер контура превышает 16384 px')
  const center = layerPoint(layer, { x: bounds.x + width / 2, y: bounds.y + height / 2 })
  const x = center.x - width / 2,
    y = center.y - height / 2
  if (Math.abs(x) > 16384 || Math.abs(y) > 16384)
    throw new Error('Контур находится слишком далеко от холста')
  const normalized = paths.map((p) => ({
    ...p,
    knots: p.knots.map((k) => ({
      ...k,
      points: k.points.map(
        (v, i) => (v - (i % 2 ? bounds.y : bounds.x)) / (i % 2 ? height : width),
      ),
    })),
  }))
  return {
    shape: 'path',
    shapePaths: parseShapePaths(normalized),
    x,
    y,
    width,
    height,
    mask: layer.mask
      ? {
          ...layer.mask,
          x: x + layer.mask.x - layer.x - bounds.x,
          y: y + layer.mask.y - layer.y - bounds.y,
        }
      : undefined,
  }
}
export function movePathNodes(layer: Layer, nodes: PathNode[], delta: Point): Partial<Layer> {
  const paths = shapePaths(layer),
    keys = new Set(nodes.map(nodeKey))
  for (const [pi, p] of paths.entries())
    for (const [index, k] of p.knots.entries()) {
      if (!keys.has(nodeKey({ path: pi, index }))) continue
      const world = layerPoint(layer, at(k.points, 'anchor')),
        target = pathLocalPoint(layer, { x: world.x + delta.x, y: world.y + delta.y }),
        dx = target.x - k.points[2],
        dy = target.y - k.points[3]
      k.points = k.points.map((v, i) => v + (i % 2 ? dy : dx))
    }
  return reframePath(layer, paths)
}
export function movePathHandle(
  layer: Layer,
  node: PathNode,
  part: 'in' | 'out',
  world: Point,
  breakLink = false,
): Partial<Layer> {
  const paths = shapePaths(layer),
    k = paths[node.path]?.knots[node.index]
  if (!k) throw new Error('Точка контура больше не существует')
  const target = pathLocalPoint(layer, world),
    i = part === 'in' ? 0 : 4,
    opposite = i === 0 ? 4 : 0,
    a = at(k.points, 'anchor'),
    distance = Math.hypot(target.x - a.x, target.y - a.y),
    otherLength = Math.hypot(k.points[opposite] - a.x, k.points[opposite + 1] - a.y)
  k.points[i] = target.x
  k.points[i + 1] = target.y
  if (breakLink) k.linked = false
  if (k.linked) {
    const ratio = distance > 1e-8 ? otherLength / distance : 0
    k.points[opposite] = a.x - (target.x - a.x) * ratio
    k.points[opposite + 1] = a.y - (target.y - a.y) * ratio
  }
  return reframePath(layer, paths)
}
export function setPathNodeMode(layer: Layer, nodes: PathNode[], mode: NodeMode): Partial<Layer> {
  const paths = shapePaths(layer)
  for (const node of nodes) {
    const path = paths[node.path],
      k = path?.knots[node.index]
    if (!k) continue
    const a = at(k.points, 'anchor')
    if (mode === 'corner') {
      k.points = [a.x, a.y, a.x, a.y, a.x, a.y]
      k.linked = false
      continue
    }
    if (mode === 'independent') {
      k.linked = false
      continue
    }
    const prev = path.knots[(node.index + path.knots.length - 1) % path.knots.length],
      next = path.knots[(node.index + 1) % path.knots.length]
    const p = path.open && !node.index ? a : at(prev.points, 'anchor'),
      n = path.open && node.index === path.knots.length - 1 ? a : at(next.points, 'anchor'),
      length = Math.hypot(n.x - p.x, n.y - p.y),
      dx = length ? (n.x - p.x) / length : 1,
      dy = length ? (n.y - p.y) / length : 0,
      inLength = Math.hypot(a.x - p.x, a.y - p.y) / 3,
      outLength = Math.hypot(n.x - a.x, n.y - a.y) / 3
    k.points = [
      a.x - dx * inLength,
      a.y - dy * inLength,
      a.x,
      a.y,
      a.x + dx * outLength,
      a.y + dy * outLength,
    ]
    k.linked = true
  }
  return reframePath(layer, paths)
}
export function cubicPoint(
  a: ShapePath['knots'][number],
  b: ShapePath['knots'][number],
  t: number,
): Point {
  const p = mix(at(a.points, 'anchor'), at(a.points, 'out'), t),
    q = mix(at(a.points, 'out'), at(b.points, 'in'), t),
    r = mix(at(b.points, 'in'), at(b.points, 'anchor'), t)
  return mix(mix(p, q, t), mix(q, r, t), t)
}
/** Exact De Casteljau subdivision: inserting a node does not change the cubic. */
export function splitPathSegment(layer: Layer, node: PathNode, t = 0.5): Partial<Layer> {
  const paths = shapePaths(layer),
    p = paths[node.path],
    i = node.index
  if (!p || i < 0 || i >= p.knots.length - (p.open ? 1 : 0))
    throw new Error('Нет выбранного сегмента')
  const a = p.knots[i],
    b = p.knots[(i + 1) % p.knots.length],
    u = Math.max(0.001, Math.min(0.999, t)),
    ab = mix(at(a.points, 'anchor'), at(a.points, 'out'), u),
    bc = mix(at(a.points, 'out'), at(b.points, 'in'), u),
    cd = mix(at(b.points, 'in'), at(b.points, 'anchor'), u),
    abc = mix(ab, bc, u),
    bcd = mix(bc, cd, u),
    mid = mix(abc, bcd, u)
  a.points[4] = ab.x
  a.points[5] = ab.y
  b.points[0] = cd.x
  b.points[1] = cd.y
  p.knots.splice(i + 1, 0, { linked: true, points: [abc.x, abc.y, mid.x, mid.y, bcd.x, bcd.y] })
  return reframePath(layer, paths)
}
export function nearestPathSegment(
  layer: Layer,
  point: Point,
  tolerance: number,
): (PathNode & { t: number; distance: number }) | undefined {
  assertEditablePath(layer)
  let best: (PathNode & { t: number; distance: number }) | undefined
  for (const [pi, p] of shapePaths(layer).entries())
    for (let index = 0; index < p.knots.length - (p.open ? 1 : 0); index++) {
      const a = p.knots[index],
        b = p.knots[(index + 1) % p.knots.length]
      const distance = (t: number) => {
        const q = layerPoint(layer, cubicPoint(a, b, t))
        return Math.hypot(q.x - point.x, q.y - point.y)
      }
      let atT = 0,
        error = Infinity
      // A coarse scan followed by a bounded local refinement, including endpoints.
      for (let j = 0; j <= 32; j++) {
        const d = distance(j / 32)
        if (d < error) {
          atT = j / 32
          error = d
        }
      }
      let lo = Math.max(0, atT - 1 / 32),
        hi = Math.min(1, atT + 1 / 32)
      for (let j = 0; j < 14; j++) {
        const x = (2 * lo + hi) / 3,
          y = (lo + 2 * hi) / 3
        if (distance(x) < distance(y)) hi = y
        else lo = x
      }
      const t = (lo + hi) / 2,
        d = distance(t)
      if (d <= tolerance && (!best || d < best.distance)) best = { path: pi, index, t, distance: d }
    }
  return best
}
export function removePathNodes(layer: Layer, nodes: PathNode[]): Partial<Layer> {
  const keys = new Set(nodes.map(nodeKey)),
    paths = shapePaths(layer)
      .map((p, path) => ({
        ...p,
        knots: p.knots.filter((_, index) => !keys.has(nodeKey({ path, index }))),
      }))
      .filter((p) => p.knots.length >= 2)
  if (!paths.length)
    throw new Error('Оставь хотя бы две точки или удали весь слой через панель слоёв')
  return reframePath(layer, paths)
}
export function reversePath(path: ShapePath): ShapePath {
  return {
    ...path,
    knots: [...path.knots].reverse().map((k) => ({
      ...k,
      points: [...k.points.slice(4, 6), ...k.points.slice(2, 4), ...k.points.slice(0, 2)],
    })),
  }
}
export function changePathComponent(
  layer: Layer,
  path: number,
  operation: 'reverse' | 'toggle' | 'duplicate' | 'remove',
): Partial<Layer> {
  const paths = shapePaths(layer),
    p = paths[path]
  if (!p) throw new Error('Компонент контура не найден')
  if (operation === 'reverse') paths[path] = reversePath(p)
  if (operation === 'toggle') paths[path] = { ...p, open: !p.open }
  if (operation === 'duplicate')
    paths.push({ ...p, knots: p.knots.map((k) => ({ ...k, points: k.points.map((v) => v + 16) })) })
  if (operation === 'remove') paths.splice(path, 1)
  return reframePath(layer, paths)
}
export function joinPathEnds(layer: Layer, nodes: PathNode[]): Partial<Layer> {
  if (nodes.length !== 2) throw new Error('Выбери два конца открытых контуров, удерживая Shift')
  const paths = shapePaths(layer),
    [a, b] = nodes,
    p = paths[a.path],
    q = paths[b.path]
  if (
    !p?.open ||
    !q?.open ||
    [a, b].some((n) => n.index !== 0 && n.index !== paths[n.path].knots.length - 1)
  )
    throw new Error('Соединять можно только конечные точки открытых контуров')
  if (sameNode(a, b)) throw new Error('Выбери два разных конца')
  if (a.path === b.path) paths[a.path] = { ...p, open: false }
  else {
    if (p.fillRule !== q.fillRule)
      throw new Error('У соединяемых контуров должны совпадать правила заливки')
    const first = a.index === 0 ? reversePath(p) : p,
      second = b.index === 0 ? q : reversePath(q)
    paths[a.path] = { ...first, knots: [...first.knots, ...second.knots] }
    paths.splice(b.path, 1)
  }
  return reframePath(layer, paths)
}
export function pathSvg(paths: ShapePath[]): string {
  return paths
    .map((p) => {
      if (!p.knots.length) return ''
      let d = `M${p.knots[0].points[2]} ${p.knots[0].points[3]}`
      for (let i = 0; i < p.knots.length - (p.open ? 1 : 0); i++) {
        const a = p.knots[i].points,
          b = p.knots[(i + 1) % p.knots.length].points
        d += `C${a[4]} ${a[5]} ${b[0]} ${b[1]} ${b[2]} ${b[3]}`
      }
      return d + (p.open ? '' : 'Z')
    })
    .join(' ')
}
