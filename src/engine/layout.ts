import type { EditorDocument, Point, Rect } from '../types'
export interface Guide {
  id: string
  axis: 'x' | 'y'
  position: number
}
export interface DocumentLayout {
  guides: Guide[]
  guideColor: string
  showGuides: boolean
  locked: boolean
  showGrid: boolean
  gridSize: number
  gridSizeY: number
  subdivisions: number
  snap: boolean
  snapGuides: boolean
  snapGrid: boolean
  snapLayers: boolean
  snapDocument: boolean
}
export const defaultLayout = (): DocumentLayout => ({
  guides: [],
  guideColor: '#80c9f6',
  showGuides: true,
  locked: false,
  showGrid: false,
  gridSize: 64,
  gridSizeY: 64,
  subdivisions: 4,
  snap: true,
  snapGuides: true,
  snapGrid: false,
  snapLayers: false,
  snapDocument: true,
})
export const layoutOf = (doc: EditorDocument) => doc.layout || defaultLayout()
const finite = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
export function normalizeLayout(input: unknown): DocumentLayout {
  if (!input || typeof input !== 'object') return defaultLayout()
  const v = input as Record<string, unknown>,
    base = defaultLayout(),
    ids = new Set<string>()
  const guides = Array.isArray(v.guides)
    ? v.guides.slice(0, 200).flatMap((item): Guide[] => {
        if (!item || typeof item !== 'object') return []
        const g = item as Record<string, unknown>
        if (
          !['x', 'y'].includes(String(g.axis)) ||
          typeof g.position !== 'number' ||
          !Number.isFinite(g.position) ||
          g.position < 0 ||
          g.position > 16384
        )
          return []
        let id =
          typeof g.id === 'string' && g.id.length > 0 && g.id.length <= 100
            ? g.id
            : crypto.randomUUID()
        if (ids.has(id)) id = crypto.randomUUID()
        ids.add(id)
        return [{ id, axis: g.axis as 'x' | 'y', position: Math.round(g.position * 32) / 32 }]
      })
    : []
  return {
    guides,
    guideColor:
      typeof v.guideColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.guideColor)
        ? v.guideColor
        : base.guideColor,
    showGuides: v.showGuides !== false,
    locked: v.locked === true,
    showGrid: v.showGrid === true,
    gridSize: finite(v.gridSize, 4, 1024, 64),
    gridSizeY: finite(v.gridSizeY, 4, 1024, finite(v.gridSize, 4, 1024, 64)),
    subdivisions: Math.round(finite(v.subdivisions, 1, 16, 4)),
    snap: v.snap !== false,
    snapGuides: v.snapGuides !== false,
    snapGrid: v.snapGrid === true,
    snapLayers: v.snapLayers === true,
    snapDocument: v.snapDocument !== false,
  }
}
export interface GuideLayoutOptions {
  columns: number
  rows: number
  gutter: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}
export function createGuideLayout(width: number, height: number, o: GuideLayoutOptions): Guide[] {
  if (
    Object.values(o).some((v) => !Number.isFinite(v) || v < 0) ||
    !Number.isInteger(o.columns) ||
    !Number.isInteger(o.rows) ||
    o.columns > 24 ||
    o.rows > 24 ||
    o.gutter > 1024
  )
    throw new Error('Макет: до 24 строк/колонок, неотрицательные поля и промежутки')
  const guides: Guide[] = [],
    seen = new Set<string>()
  const add = (axis: 'x' | 'y', position: number) => {
    const p = Math.round(position * 32) / 32,
      key = `${axis}:${p}`
    if (!seen.has(key)) {
      guides.push({ id: crypto.randomUUID(), axis, position: p })
      seen.add(key)
    }
  }
  const axis = (
    direction: 'x' | 'y',
    length: number,
    first: number,
    last: number,
    count: number,
  ) => {
    const usable = length - first - last - o.gutter * Math.max(0, count - 1)
    if (usable <= 0) throw new Error('Поля и интервалы не оставляют места на холсте')
    if (count === 0) return
    const cell = usable / count
    for (let i = 0; i < count; i++) {
      const start = first + i * (cell + o.gutter)
      add(direction, start)
      add(direction, start + cell)
    }
  }
  axis('x', width, o.marginLeft, o.marginRight, o.columns)
  axis('y', height, o.marginTop, o.marginBottom, o.rows)
  return guides
}
export function transformLayout(
  layout: DocumentLayout | undefined,
  sx = 1,
  sy = 1,
  dx = 0,
  dy = 0,
) {
  if (!layout) return
  return normalizeLayout({
    ...layout,
    guides: layout.guides.map((g) => ({
      ...g,
      position: g.position * (g.axis === 'x' ? sx : sy) + (g.axis === 'x' ? dx : dy),
    })),
  })
}
export interface SnapTargets {
  x: number[]
  y: number[]
}
export function layoutTargets(
  doc: EditorDocument,
  settings: DocumentLayout,
  excludeGuide?: string,
): SnapTargets {
  const targets: SnapTargets = {
    x: settings.snapDocument ? [0, doc.width / 2, doc.width] : [],
    y: settings.snapDocument ? [0, doc.height / 2, doc.height] : [],
  }
  if (settings.showGuides && settings.snapGuides)
    for (const g of settings.guides) if (g.id !== excludeGuide) targets[g.axis].push(g.position)
  return targets
}
export function snapBounds(bounds: Rect, targets: SnapTargets, threshold: number, grid?: Point) {
  const axis = (values: number[], candidates: number[], spacing?: number) => {
    let distance = threshold + 1,
      delta = 0,
      guide: number | null = null
    for (const value of values)
      for (const target of spacing
        ? [...candidates, Math.round(value / spacing) * spacing]
        : candidates) {
        const d = target - value
        if (Math.abs(d) <= threshold && Math.abs(d) < distance) {
          distance = Math.abs(d)
          delta = d
          guide = target
        }
      }
    return { delta, guide }
  }
  const x = axis(
      [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
      targets.x,
      grid?.x,
    ),
    y = axis([bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height], targets.y, grid?.y)
  return { dx: x.delta, dy: y.delta, x: x.guide, y: y.guide }
}
export function snapPoint(
  point: Point,
  targets: SnapTargets,
  threshold: number,
  grid?: Point,
): Point {
  const delta = snapBounds({ ...point, width: 0, height: 0 }, targets, threshold, grid)
  return { x: point.x + delta.dx, y: point.y + delta.dy }
}
export function nativeLayout(layout: DocumentLayout) {
  return {
    grid: {
      horizontal: Math.round(layout.gridSize * 32),
      vertical: Math.round(layout.gridSizeY * 32),
    },
    guides: layout.guides.map((g) => ({
      location: g.position,
      direction: g.axis === 'x' ? ('vertical' as const) : ('horizontal' as const),
    })),
  }
}
export function sameNativeLayout(a: DocumentLayout | undefined, b: DocumentLayout | undefined) {
  return (
    JSON.stringify(a ? nativeLayout(a) : undefined) ===
    JSON.stringify(b ? nativeLayout(b) : undefined)
  )
}
