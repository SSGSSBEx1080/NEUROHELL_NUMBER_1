import { homography } from './projection'
import { combineCoverage, rasterSelection } from './selectionPixels'
import { rasterOutline } from './selectionOutline'
import type { Layer, LayerMask, Point, Selection, SelectionMode, SelectionRaster } from '../types'
import { localPoint } from './document'
export function polygonSelection(points: Point[], feather = 0): Selection | null {
  if (points.length < 3) return null
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - x,
    height = Math.max(...points.map((p) => p.y)) - y
  return width > 0 && height > 0 ? { x, y, width, height, points, feather } : null
}
export function selectionContains(s: Selection, p: Point): boolean {
  let inside = false
  if (s.raster) inside = sampleCoverage(s.raster, p.x, p.y) > 0
  else if (s.points) {
    const pts = s.points
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (
        pts[i].y > p.y !== pts[j].y > p.y &&
        p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x
      )
        inside = !inside
  } else if (s.ellipse)
    inside =
      ((p.x - s.x - s.width / 2) / (s.width / 2)) ** 2 +
        ((p.y - s.y - s.height / 2) / (s.height / 2)) ** 2 <=
      1
  else inside = p.x >= s.x && p.y >= s.y && p.x < s.x + s.width && p.y < s.y + s.height
  return s.inverted ? !inside : inside
}
export function selectionPath(s: Selection) {
  if (s.raster) return rasterOutline(s.raster).path
  if (s.points) return `M${s.points.map((p) => `${p.x},${p.y}`).join('L')}Z`
  if (s.ellipse)
    return `M${s.x},${s.y + s.height / 2}a${s.width / 2},${s.height / 2} 0 1,0 ${s.width},0a${s.width / 2},${s.height / 2} 0 1,0 ${-s.width},0`
  return `M${s.x},${s.y}h${s.width}v${s.height}h${-s.width}Z`
}
export function selectionMask(
  s: Selection,
  width: number,
  height: number,
  layer?: Layer,
  targetMask?: LayerMask,
  sourcePixelsUnflipped = false,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  if (s.raster) {
    const image = ctx.createImageData(width, height),
      matrix = layer?.warp ? homography(layer.warp) : undefined
    const angle = ((layer?.rotation || 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle)
    for (let yy = 0; yy < height; yy++)
      for (let xx = 0; xx < width; xx++) {
        let x = xx + 0.5,
          y = yy + 0.5
        if (layer) {
          let u = x / width,
            v = y / height
          if (targetMask) {
            let lx = targetMask.x - layer.x + u * targetMask.width,
              ly = targetMask.y - layer.y + v * targetMask.height
            if (layer.flipX) lx = layer.width - lx
            if (layer.flipY) ly = layer.height - ly
            u = lx / layer.width
            v = ly / layer.height
          } else if (sourcePixelsUnflipped) {
            if (layer.flipX) u = 1 - u
            if (layer.flipY) v = 1 - v
          }
          const denominator = matrix ? matrix[6] * u + matrix[7] * v + matrix[8] : 1
          const qx = matrix ? (matrix[0] * u + matrix[1] * v + matrix[2]) / denominator : u
          const qy = matrix ? (matrix[3] * u + matrix[4] * v + matrix[5]) / denominator : v
          const dx = (qx - 0.5) * layer.width,
            dy = (qy - 0.5) * layer.height
          x = layer.x + layer.width / 2 + dx * cos - dy * sin
          y = layer.y + layer.height / 2 + dx * sin + dy * cos
        }
        const alpha = sampleCoverage(s.raster, x, y),
          index = (yy * width + xx) * 4
        image.data[index] = image.data[index + 1] = image.data[index + 2] = 255
        image.data[index + 3] = s.inverted ? 255 - alpha : alpha
      }
    ctx.putImageData(image, 0, 0)
    return c
  }
  // Sampling polygon edges before inverse perspective keeps warped selections bounded and useful.
  const source =
    s.points ||
    (s.ellipse
      ? Array.from({ length: 96 }, (_, i) => ({
          x: s.x + s.width / 2 + (Math.cos((i * Math.PI) / 48) * s.width) / 2,
          y: s.y + s.height / 2 + (Math.sin((i * Math.PI) / 48) * s.height) / 2,
        }))
      : [
          { x: s.x, y: s.y },
          { x: s.x + s.width, y: s.y },
          { x: s.x + s.width, y: s.y + s.height },
          { x: s.x, y: s.y + s.height },
        ])
  const pts = source.map((p) => {
    const q = layer ? localPoint(layer, p) : p
    if (layer && sourcePixelsUnflipped && !targetMask) {
      if (layer.flipX) q.x = layer.width - q.x
      if (layer.flipY) q.y = layer.height - q.y
    }
    if (layer && targetMask)
      return {
        x:
          (((layer.flipX ? layer.width - q.x : q.x) + layer.x - targetMask.x) * width) /
          targetMask.width,
        y:
          (((layer.flipY ? layer.height - q.y : q.y) + layer.y - targetMask.y) * height) /
          targetMask.height,
      }
    return layer ? { x: (q.x * width) / layer.width, y: (q.y * height) / layer.height } : q
  })
  if (s.inverted) ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = s.inverted ? 'destination-out' : 'source-over'
  if (s.feather) ctx.filter = `blur(${s.feather * (layer ? width / layer.width : 1)}px)`
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.fill()
  return c
}
/** Edge attraction for magnetic freehand lasso, not semantic segmentation. */
export function magneticPoint(
  p: Point,
  pixels: ImageData,
  scaleX: number,
  scaleY: number,
  radius = 10,
): Point {
  const x = Math.round(p.x * scaleX),
    y = Math.round(p.y * scaleY),
    w = pixels.width,
    h = pixels.height,
    d = pixels.data
  let best = -Infinity,
    bx = x,
    by = y
  const intensity = (xx: number, yy: number) => {
    const i = (yy * w + xx) * 4
    return ((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * d[i + 3]) / 255
  }
  for (let yy = Math.max(1, y - radius); yy < Math.min(h - 1, y + radius); yy++)
    for (let xx = Math.max(1, x - radius); xx < Math.min(w - 1, x + radius); xx++) {
      const gradient =
        Math.abs(intensity(xx + 1, yy) - intensity(xx - 1, yy)) +
        Math.abs(intensity(xx, yy + 1) - intensity(xx, yy - 1))
      const score = gradient - Math.hypot(xx - x, yy - y) * 5
      if (score > best) {
        best = score
        bx = xx
        by = yy
      }
    }
  return { x: bx / scaleX, y: by / scaleY }
}

/** Bilinear coverage with transparent borders, in document coordinates. */
export function sampleCoverage(r: SelectionRaster, x: number, y: number): number {
  x -= r.x + 0.5
  y -= r.y + 0.5
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < -1 ||
    y < -1 ||
    x >= r.width ||
    y >= r.height
  )
    return 0
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0
  const at = (xx: number, yy: number) =>
    xx < 0 || yy < 0 || xx >= r.width || yy >= r.height ? 0 : r.data[yy * r.width + xx]
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  )
}
export function selectionCoverage(s: Selection | null, width: number, height: number, empty = 0) {
  if (!s) return new Uint8ClampedArray(width * height).fill(empty)
  if (
    s.raster &&
    !s.inverted &&
    s.raster.x === 0 &&
    s.raster.y === 0 &&
    s.raster.width === width &&
    s.raster.height === height
  )
    return s.raster.data
  const rgba = selectionMask(s, width, height)
    .getContext('2d')!
    .getImageData(0, 0, width, height).data
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  return alpha
}
export function combineSelection(
  a: Selection | null,
  b: Selection,
  mode: SelectionMode,
  width: number,
  height: number,
): Selection {
  if (mode === 'replace' || (!a && mode === 'add')) return b
  return rasterSelection(
    combineCoverage(selectionCoverage(a, width, height), selectionCoverage(b, width, height), mode),
    width,
    height,
  )
}
export function invertSelection(s: Selection | null, width: number, height: number): Selection {
  return rasterSelection(
    Uint8ClampedArray.from(selectionCoverage(s, width, height), (v) => 255 - v),
    width,
    height,
  )
}
export function gestureSelectionMode(
  e: { shiftKey: boolean; altKey: boolean },
  fallback: SelectionMode = 'replace',
): SelectionMode {
  return e.altKey ? (e.shiftKey ? 'intersect' : 'subtract') : e.shiftKey ? 'add' : fallback
}
