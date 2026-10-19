import type { Layer, LayerMask } from '../types'
import { applyCorrection } from './adjustmentMath'
const masks = new Map<
  string,
  { mask: LayerMask; matrix: string; width: number; height: number; data: Uint8ClampedArray }
>()
export function clearAdjustmentCaches() {
  masks.clear()
}
function coverage(ctx: CanvasRenderingContext2D, layer: Layer, source: CanvasImageSource) {
  const m = layer.mask!,
    w = ctx.canvas.width,
    h = ctx.canvas.height,
    t = ctx.getTransform(),
    matrix = [t.a, t.b, t.c, t.d, t.e, t.f].join(',')
  const cached = masks.get(layer.id)
  if (
    !m.src.startsWith('mask-preview:') &&
    cached?.mask === m &&
    cached.width === w &&
    cached.height === h &&
    cached.matrix === matrix
  )
    return cached.data
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const p = canvas.getContext('2d', { willReadFrequently: true })!
  p.fillStyle = `rgb(${m.defaultColor},${m.defaultColor},${m.defaultColor})`
  p.fillRect(0, 0, w, h)
  p.setTransform(t)
  if (m.feather)
    p.filter = `blur(${m.feather * Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))}px)`
  p.drawImage(source, m.x, m.y, m.width, m.height)
  const rgba = p.getImageData(0, 0, w, h).data,
    data = new Uint8ClampedArray(w * h)
  for (let i = 0; i < data.length; i++)
    data[i] = Math.round(255 * (1 - m.density) + rgba[i * 4] * m.density)
  masks.delete(layer.id)
  masks.set(layer.id, { mask: m, matrix, width: w, height: h, data })
  let bytes = 0
  for (const entry of masks.values()) bytes += entry.data.byteLength
  for (const [id, entry] of masks) {
    if (bytes <= 64 * 1024 * 1024 && masks.size <= 8) break
    bytes -= entry.data.byteLength
    masks.delete(id)
  }
  return data
}
/** An adjustment changes the RGB of the existing stack, NEVER its alpha or layer pixels. */
export function renderCorrection(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  maskSource?: CanvasImageSource,
) {
  if (!layer.correction || !layer.visible || layer.opacity <= 0) return
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  const mask = layer.mask?.enabled && maskSource ? coverage(ctx, layer, maskSource) : undefined
  image.data.set(
    applyCorrection(image.data, layer.correction, layer.opacity, mask, layer.blendMode),
  )
  ctx.putImageData(image, 0, 0)
}
