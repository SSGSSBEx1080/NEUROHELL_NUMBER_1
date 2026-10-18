import type { Layer, Point, Selection } from '../types'
import { localPoint } from './document'
export function polygonSelection(points: Point[], feather = 0): Selection | null {
  if (points.length < 3) return null
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  const width = Math.max(...points.map(p => p.x)) - x, height = Math.max(...points.map(p => p.y)) - y
  return width > 0 && height > 0 ? { x, y, width, height, points, feather } : null
}
export function selectionContains(s: Selection, p: Point): boolean {
  let inside = false
  if (s.points) {
    const pts = s.points
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i].y > p.y) !== (pts[j].y > p.y) && p.x < (pts[j].x - pts[i].x) * (p.y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside
  } else if (s.ellipse) inside = ((p.x - s.x - s.width / 2) / (s.width / 2)) ** 2 + ((p.y - s.y - s.height / 2) / (s.height / 2)) ** 2 <= 1
  else inside = p.x >= s.x && p.y >= s.y && p.x < s.x + s.width && p.y < s.y + s.height
  return s.inverted ? !inside : inside
}
export function selectionPath(s: Selection) {
  if (s.points) return `M${s.points.map(p => `${p.x},${p.y}`).join('L')}Z`
  if (s.ellipse) return `M${s.x},${s.y + s.height / 2}a${s.width / 2},${s.height / 2} 0 1,0 ${s.width},0a${s.width / 2},${s.height / 2} 0 1,0 ${-s.width},0`
  return `M${s.x},${s.y}h${s.width}v${s.height}h${-s.width}Z`
}
export function selectionMask(s: Selection, width: number, height: number, layer?: Layer): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = width; c.height = height
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'
  // Sampling polygon edges before inverse perspective keeps warped selections bounded and useful.
  const source = s.points || (s.ellipse ? Array.from({ length: 96 }, (_, i) => ({ x: s.x + s.width / 2 + Math.cos(i * Math.PI / 48) * s.width / 2, y: s.y + s.height / 2 + Math.sin(i * Math.PI / 48) * s.height / 2 })) : [{ x: s.x, y: s.y }, { x: s.x + s.width, y: s.y }, { x: s.x + s.width, y: s.y + s.height }, { x: s.x, y: s.y + s.height }])
  const pts = source.map(p => { const q = layer ? localPoint(layer, p) : p; return layer ? { x: q.x * width / layer.width, y: q.y * height / layer.height } : q })
  if (s.inverted) ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = s.inverted ? 'destination-out' : 'source-over'
  if (s.feather) ctx.filter = `blur(${s.feather * (layer ? width / layer.width : 1)}px)`
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill()
  return c
}
/** Edge attraction for magnetic freehand lasso, not semantic segmentation. */
export function magneticPoint(p: Point, pixels: ImageData, scaleX: number, scaleY: number, radius = 10): Point {
  const x = Math.round(p.x * scaleX), y = Math.round(p.y * scaleY), w = pixels.width, h = pixels.height, d = pixels.data
  let best = -Infinity, bx = x, by = y
  const intensity = (xx: number, yy: number) => { const i = (yy * w + xx) * 4; return (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11) * d[i + 3] / 255 }
  for (let yy = Math.max(1, y - radius); yy < Math.min(h - 1, y + radius); yy++) for (let xx = Math.max(1, x - radius); xx < Math.min(w - 1, x + radius); xx++) {
    const gradient = Math.abs(intensity(xx + 1, yy) - intensity(xx - 1, yy)) + Math.abs(intensity(xx, yy + 1) - intensity(xx, yy - 1))
    const score = gradient - Math.hypot(xx - x, yy - y) * 5
    if (score > best) { best = score; bx = xx; by = yy }
  }
  return { x: bx / scaleX, y: by / scaleY }
}
