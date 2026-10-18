import { clearWarpCache, renderWarped } from './warpRenderer'
import { sourceDimensions } from './imageSafety'
import { clearStyleCache, hasStyles, renderStyled } from './styles'
import { DEFAULT_ADJUSTMENTS, type EditorDocument, type Layer } from '../types'

const images = new Map<string, HTMLImageElement | HTMLCanvasElement>()
const loading = new Map<string, Promise<HTMLImageElement>>()
export const getImage = (src: string) => images.get(src)
function rememberImage(src: string, image: HTMLImageElement | HTMLCanvasElement) {
  images.delete(src); images.set(src, image)
  let total = [...images.values()].reduce((n, c) => n + c.width * c.height * 4, 0)
  for (const [key, value] of images) {
    if (total <= 128 * 1024 * 1024 || key === src) break
    total -= value.width * value.height * 4; images.delete(key)
  }
}
export const cacheImage = (src: string, image: HTMLCanvasElement) => rememberImage(src, image)
export function loadImage(src: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  const existing = images.get(src)
  if (existing) { images.delete(src); images.set(src, existing); return Promise.resolve(existing) }
  const pending = loading.get(src)
  if (pending) return pending
  try { sourceDimensions(src) } catch (error) { return Promise.reject(error) }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => { rememberImage(src, image); loading.delete(src); resolve(image) }
    image.onerror = () => { loading.delete(src); reject(new Error('Не удалось прочитать изображение')) }
    image.src = src
  })
  loading.set(src, promise)
  return promise
}
export function validateRasterBudget(doc: EditorDocument) {
  const sources = [...new Set(doc.layers.map(l => l.src).filter((s): s is string => !!s))]
  let pixels = 0
  for (const src of sources) {
    const size = images.get(src) || sourceDimensions(src); pixels += size.width * size.height
    if (pixels > 24_000_000) throw new Error('Слишком много растров в одном проекте: до 24 мегапикселей суммарно. Уменьши изображения или объедини слои.')
  }
  return sources
}
export async function prepareDocument(doc: EditorDocument) {
  const sources = validateRasterBudget(doc)
  await Promise.all(sources.map(loadImage))
  await document.fonts.ready
}
export function pruneImageCache(documents: EditorDocument[]) {
  clearStyleCache(); clearWarpCache()
  const keep = new Set(documents.flatMap(d => d.layers.map(l => l.src)))
  for (const src of images.keys()) if (!keep.has(src)) images.delete(src)
}
export function filterString(layer: Layer) {
  const a = layer.adjustments || DEFAULT_ADJUSTMENTS
  return `brightness(${100 + a.brightness}%) contrast(${100 + a.contrast}%) saturate(${100 + a.saturation}%) blur(${a.blur}px) hue-rotate(${a.hue}deg) grayscale(${a.grayscale}%) sepia(${a.sepia}%) invert(${a.invert || 0}%)`
}
export function renderLayer(ctx: CanvasRenderingContext2D, layer: Layer, override?: HTMLCanvasElement, flat = false) {
  if (!flat && (!layer.visible || layer.opacity === 0)) return
  ctx.save()
  if (!flat) {
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = layer.blendMode
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate(layer.rotation * Math.PI / 180)
    ctx.translate(-layer.width / 2, -layer.height / 2)
  }
  if (layer.warp && (override || layer.kind !== 'image' || (layer.src && images.has(layer.src)))) {
    renderWarped(ctx, layer, base => renderLayer(base, { ...layer, warp: undefined }, override, true), !!override); ctx.restore(); return
  }
  if (layer.flipX || layer.flipY) {
    ctx.translate(layer.flipX ? layer.width : 0, layer.flipY ? layer.height : 0)
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
  }
  if (hasStyles(layer.styles) && (override || layer.kind !== 'image' || (layer.src && images.has(layer.src)))) {
    renderStyled(ctx, layer, base => renderLayer(base, { ...layer, styles: undefined, flipX: false, flipY: false }, override, true), !!override)
    ctx.restore(); return
  }
  ctx.filter = filterString(layer)
  if (override) ctx.drawImage(override, 0, 0, layer.width, layer.height)
  else if (layer.kind === 'image' && layer.src) {
    const image = images.get(layer.src)
    if (image) ctx.drawImage(image, 0, 0, layer.width, layer.height)
  } else if (layer.kind === 'shape') {
    ctx.fillStyle = layer.color
    ctx.beginPath()
    if (layer.shape === 'ellipse') ctx.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2)
    else ctx.roundRect(0, 0, layer.width, layer.height, Math.min(layer.radius || 0, layer.width / 2, layer.height / 2))
    ctx.fill()
    if (layer.strokeWidth && layer.strokeColor) {
      ctx.strokeStyle = layer.strokeColor; ctx.lineWidth = layer.strokeWidth; ctx.stroke()
    }
  } else if (layer.kind === 'text') {
    const textScale = layer.textScaleX || 1
    ctx.scale(textScale, 1)
    const size = layer.fontSize || 48
    ctx.font = `${layer.italic ? 'italic ' : ''}${layer.fontWeight || 500} ${size}px "${layer.fontFamily || 'Manrope'}"`
    ctx.fillStyle = layer.color
    ctx.textBaseline = 'top'
    ctx.textAlign = layer.textAlign || 'left'
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.letterSpacing || 0}px`
    const x = layer.textAlign === 'center' ? layer.width / 2 : layer.textAlign === 'right' ? layer.width : 0
    ;(layer.text || '').split('\n').forEach((line, i) => ctx.fillText(line, x / textScale, i * size * (layer.lineHeight || 1.2)))
  }
  ctx.restore()
}
export function renderDocument(ctx: CanvasRenderingContext2D, doc: EditorDocument, overrides?: Map<string, HTMLCanvasElement>, hideId?: string) {
  ctx.clearRect(0, 0, doc.width, doc.height)
  if (doc.background !== 'transparent') { ctx.fillStyle = doc.background; ctx.fillRect(0, 0, doc.width, doc.height) }
  for (const layer of doc.layers) if (layer.id !== hideId) {
    const override = overrides?.get(layer.id)
    renderLayer(ctx, override ? { ...layer, adjustments: { ...DEFAULT_ADJUSTMENTS }, flipX: false, flipY: false } : layer, override)
  }
}
export async function rasterizeLayer(layer: Layer): Promise<HTMLCanvasElement> {
  if (layer.src) await loadImage(layer.src)
  const canvas = document.createElement('canvas')
  // Raster editing is bounded even when a layer has been enlarged far beyond the artboard.
  const scale = Math.min(1, 4096 / layer.width, 4096 / layer.height)
  canvas.width = Math.max(1, Math.round(layer.width * scale))
  canvas.height = Math.max(1, Math.round(layer.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.scale(canvas.width / layer.width, canvas.height / layer.height)
  renderLayer(ctx, { ...layer, styles: undefined, warp: undefined }, undefined, true)
  return canvas
}
export async function exportCanvas(doc: EditorDocument, scale = 1, background?: string) {
  await prepareDocument(doc)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(doc.width * scale); canvas.height = Math.round(doc.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  renderDocument(ctx, doc)
  if (background) {
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = background; ctx.fillRect(0, 0, doc.width, doc.height)
  }
  return canvas
}
export function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось сформировать файл')), mime, quality))
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export function bitmapLayer(layer: Layer, canvas: HTMLCanvasElement): Layer {
  const src = canvas.toDataURL('image/png')
  cacheImage(src, canvas)
  return { ...layer, kind: 'image', src, flipX: false, flipY: false, adjustments: { ...DEFAULT_ADJUSTMENTS } }
}
