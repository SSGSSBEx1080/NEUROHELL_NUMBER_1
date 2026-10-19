import { renderCorrection, clearAdjustmentCaches } from './adjustmentRenderer'
import { getTextGeometry, clearTextGeometryCache } from './textGeometry'
import { pixelBounds, rasterBounds, rectPoints } from './layerGeometry'
import { layerPoint } from './shapeGeometry'
import { homography, project, validQuad } from './projection'
import { renderShape } from './shapeRenderer'
import { clearTextLayoutCache, textFont } from './textLayout'
import { isOriginalAppearance, originalSource, prepareSource, sameVisual } from './psdSource'
import { clearWarpCache, renderWarped } from './warpRenderer'
import { sourceDimensions, bundledImageSource } from './imageSafety'
import { clearStyleCache, hasStyles, renderStyled } from './styles'
import { DEFAULT_ADJUSTMENTS, type EditorDocument, type Layer } from '../types'

const images = new Map<string, HTMLImageElement | HTMLCanvasElement>()
const loading = new Map<string, Promise<HTMLImageElement>>()
export const getImage = (src: string) => images.get(src)
function rememberImage(src: string, image: HTMLImageElement | HTMLCanvasElement) {
  images.delete(src)
  images.set(src, image)
  let total = [...images.values()].reduce((n, c) => n + c.width * c.height * 4, 0)
  for (const [key, value] of images) {
    if (total <= 256 * 1024 * 1024 || key === src) break
    total -= value.width * value.height * 4
    images.delete(key)
  }
}
export const cacheImage = (src: string, image: HTMLCanvasElement) => rememberImage(src, image)
export function loadImage(src: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  const existing = images.get(src)
  if (existing) {
    images.delete(src)
    images.set(src, existing)
    return Promise.resolve(existing)
  }
  const pending = loading.get(src)
  if (pending) return pending
  try {
    sourceDimensions(src)
  } catch (error) {
    return Promise.reject(error)
  }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      rememberImage(src, image)
      loading.delete(src)
      resolve(image)
    }
    image.onerror = () => {
      loading.delete(src)
      reject(new Error('Не удалось прочитать изображение'))
    }
    image.src = bundledImageSource(src)
  })
  loading.set(src, promise)
  return promise
}
export function validateRasterBudget(doc: EditorDocument) {
  const sources = [
    ...new Set(doc.layers.flatMap((l) => [l.src, l.mask?.src]).filter((s): s is string => !!s)),
  ]
  let pixels = 0
  for (const src of sources) {
    const size = images.get(src) || sourceDimensions(src)
    pixels += size.width * size.height
    if (pixels > 48_000_000)
      throw new Error(
        'Слишком много растров в одном проекте: до 48 мегапикселей суммарно. Уменьши изображения или объедини слои.',
      )
  }
  return sources
}
const documentFonts = (doc: EditorDocument) =>
  doc.layers
    .filter((l) => l.kind === 'text')
    .map((l) => ({ font: textFont(l, 32), sample: (l.text || 'AaБб').slice(0, 256) }))
export async function prepareDocument(doc: EditorDocument) {
  await prepareSource(doc)
  const sources = validateRasterBudget(doc),
    composite = originalSource(doc)?.composite
  if (composite) sources.push(composite)
  const needed = documentFonts(doc).filter(
    ({ font, sample }) => !document.fonts.check(font, sample),
  )
  await Promise.all([
    ...sources.map(loadImage),
    ...needed.map(({ font, sample }) => document.fonts.load(font, sample)),
  ])
  await document.fonts.ready
  if (needed.length) {
    clearRenderCaches()
    window.dispatchEvent(new Event('fsh777-fonts-changed'))
  }
}
export function pruneImageCache(documents: EditorDocument[]) {
  const keep = new Set(
    documents.flatMap((d) => [
      ...d.layers.flatMap((l) => [l.src, l.mask?.src]),
      originalSource(d)?.composite,
    ]),
  )
  for (const src of images.keys()) if (!keep.has(src)) images.delete(src)
}
export function filterString(layer: Layer) {
  const a = layer.adjustments || DEFAULT_ADJUSTMENTS
  return `brightness(${100 + a.brightness}%) contrast(${100 + a.contrast}%) saturate(${100 + a.saturation}%) blur(${a.blur}px) hue-rotate(${a.hue}deg) grayscale(${a.grayscale}%) sepia(${a.sepia}%) invert(${a.invert || 0}%)`
}
export function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  override?: HTMLCanvasElement,
  flat = false,
) {
  if (layer.kind === 'adjustment') return
  if (!flat && (!layer.visible || layer.opacity === 0)) return
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  if (!flat) {
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = layer.blendMode
  }
  if (layer.warp && (override || layer.kind !== 'image' || (layer.src && images.has(layer.src)))) {
    renderWarped(
      ctx,
      layer,
      (base) => renderLayer(base, { ...layer, warp: undefined }, override, true),
      !!override || !!layer.mask?.src.startsWith('mask-preview:'),
      !flat,
    )
    ctx.restore()
    return
  }
  if (!flat) {
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.translate(-layer.width / 2, -layer.height / 2)
  }
  if (layer.flipX || layer.flipY) {
    ctx.translate(layer.flipX ? layer.width : 0, layer.flipY ? layer.height : 0)
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
  }
  if (
    hasStyles(layer.styles) &&
    (override || layer.kind !== 'image' || (layer.src && images.has(layer.src)))
  ) {
    renderStyled(
      ctx,
      layer,
      (base) =>
        renderLayer(
          base,
          { ...layer, styles: undefined, flipX: false, flipY: false },
          override,
          true,
        ),
      !!override || !!layer.mask?.src.startsWith('mask-preview:'),
    )
    ctx.restore()
    return
  }
  if (layer.mask?.enabled && images.has(layer.mask.src)) {
    renderMasked(ctx, layer, override)
    ctx.restore()
    return
  }
  ctx.filter = Object.values(layer.adjustments).some((v) => v !== 0) ? filterString(layer) : 'none'
  if (override) ctx.drawImage(override, 0, 0, layer.width, layer.height)
  else if (layer.kind === 'image' && layer.src) {
    const image = images.get(layer.src)
    if (image) ctx.drawImage(image, 0, 0, layer.width, layer.height)
  } else if (layer.kind === 'shape') {
    renderShape(ctx, layer)
  } else if (layer.kind === 'text') {
    if (ctx.canvas.style.fontSynthesis !== 'weight style')
      ctx.canvas.style.fontSynthesis = 'weight style'
    const textScale = layer.textScaleX || 1
    const geometry = getTextGeometry(layer)
    if (layer.textFrame) {
      const p = layer.textFrame.padding,
        w = layer.width - p * 2,
        h = layer.height - p * 2
      ctx.beginPath()
      if (layer.textFrame.shape === 'ellipse' && w > 0 && h > 0)
        ctx.ellipse(layer.width / 2, layer.height / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      else ctx.rect(p, p, Math.max(0, w), Math.max(0, h))
      ctx.clip()
    }
    ctx.scale(textScale, 1)
    const size = geometry.fontSize
    ctx.font = textFont(layer, size)
    ctx.fillStyle = layer.color
    ctx.textBaseline = layer.textBaseline || 'top'
    ctx.textAlign = layer.textAlign || 'left'
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.letterSpacing || 0}px`
    for (const line of geometry.lines) ctx.fillText(line.text, line.x / textScale, line.y)
  }
  ctx.restore()
}
export function isPrepared(doc: EditorDocument) {
  return (
    document.fonts.status === 'loaded' &&
    documentFonts(doc).every(({ font, sample }) => document.fonts.check(font, sample)) &&
    (!doc.sourceId || !!originalSource(doc)) &&
    doc.layers.every((l) => (!l.src || images.has(l.src)) && (!l.mask || images.has(l.mask.src)))
  )
}
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  doc: EditorDocument,
  overrides?: Map<string, HTMLCanvasElement>,
  hideId?: string,
  clear = true,
) {
  if (clear) ctx.clearRect(0, 0, doc.width, doc.height)
  const original = originalSource(doc)
  if (!overrides?.size && original?.composite && isOriginalAppearance(doc)) {
    const image = images.get(original.composite)
    if (image) {
      ctx.drawImage(image, 0, 0, doc.width, doc.height)
      return
    }
  }
  if (doc.background !== 'transparent') {
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  const transform = ctx.getTransform(),
    width = Math.max(
      1,
      Math.min(4096, Math.ceil(doc.width * Math.hypot(transform.a, transform.b))),
    ),
    height = Math.max(
      1,
      Math.min(4096, Math.ceil(doc.height * Math.hypot(transform.c, transform.d))),
    )
  let allocated = 0
  const surface = () => {
    const bytes = width * height * 4
    if (allocated + bytes > 192 * 1024 * 1024)
      throw new Error(
        'Слишком много вложенных групп для этого размера. Уменьши масштаб просмотра или объедини часть групп перед экспортом.',
      )
    allocated += bytes
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    c.getContext('2d')!.scale(width / doc.width, height / doc.height)
    return c
  }
  const release = (c: HTMLCanvasElement) => {
    allocated -= c.width * c.height * 4
    c.width = c.height = 1
  }
  const draw = (target: CanvasRenderingContext2D, parentId?: string, depth = 0) => {
    if (depth > 12) throw new Error('Превышена поддерживаемая вложенность групп')
    const siblings = doc.layers.filter((l) => l.parentId === parentId)
    const paint = (layer: Layer, out: CanvasRenderingContext2D) => {
      if (layer.kind === 'adjustment') {
        renderCorrection(out, layer, layer.mask ? images.get(layer.mask.src) : undefined)
      } else if (layer.kind === 'group') {
        if (
          !layer.isolated &&
          layer.opacity === 1 &&
          !layer.mask &&
          layer.blendMode === 'source-over' &&
          !hasStyles(layer.styles) &&
          Object.values(layer.adjustments).every((v) => v === 0)
        ) {
          draw(out, layer.id, depth + 1)
          return
        }
        const c = surface()
        try {
          draw(c.getContext('2d')!, layer.id, depth + 1)
          renderLayer(
            out,
            { ...layer, kind: 'image', x: 0, y: 0, width: doc.width, height: doc.height },
            c,
          )
        } finally {
          release(c)
        }
      } else {
        const override = overrides?.get(layer.id)
        renderLayer(
          out,
          override
            ? { ...layer, adjustments: { ...DEFAULT_ADJUSTMENTS }, flipX: false, flipY: false }
            : layer,
          override,
        )
      }
    }
    for (let i = 0; i < siblings.length; i++) {
      const layer = siblings[i]
      if (layer.clipping) continue // Orphan clipping layers have no visible base.
      let end = i + 1
      while (siblings[end]?.clipping) end++
      if (!layer.visible || layer.id === hideId) {
        i = end - 1
        continue
      }
      // A non-clipped adjustment is not a clipping base. Following clipped layers
      // have no pixel alpha to clip to; Photoshop likewise treats it as an empty base.
      if (layer.kind === 'adjustment') {
        paint(layer, target)
        i = end - 1
        continue
      }
      if (end === i + 1) {
        paint(layer, target)
        continue
      }
      // A clipping stack shares the base alpha and base opacity. Normalizing before
      // blending avoids applying that alpha twice at semi-transparent edges.
      const base = surface()
      let group: HTMLCanvasElement | undefined
      try {
        paint({ ...layer, opacity: 1, blendMode: 'source-over' }, base.getContext('2d')!)
        group = surface()
        const x = group.getContext('2d', { willReadFrequently: true })!
        x.drawImage(base, 0, 0, doc.width, doc.height)
        const pixels = x.getImageData(0, 0, width, height)
        for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p]) pixels.data[p] = 255
        x.putImageData(pixels, 0, 0)
        for (let j = i + 1; j < end; j++)
          if (siblings[j].visible && siblings[j].id !== hideId) paint(siblings[j], x)
        x.globalCompositeOperation = 'destination-in'
        x.drawImage(base, 0, 0, doc.width, doc.height)
        target.save()
        target.globalAlpha = layer.opacity
        target.globalCompositeOperation = layer.blendMode
        target.drawImage(group, 0, 0, doc.width, doc.height)
        target.restore()
      } finally {
        release(base)
        if (group) release(group)
      }
      i = end - 1
    }
  }
  draw(ctx)
}
const maskCache = new Map<
  string,
  { key: Layer; image: HTMLCanvasElement; bounds: ReturnType<typeof rasterBounds> }
>()
function renderMasked(ctx: CanvasRenderingContext2D, layer: Layer, override?: HTMLCanvasElement) {
  const m = layer.mask!,
    mask = images.get(m.src)!
  const key = { ...layer, x: 0, y: 0, mask: { ...m, x: m.x - layer.x, y: m.y - layer.y } }
  let cached = maskCache.get(layer.id)
  if (override || m.src.startsWith('mask-preview:') || !cached || !sameVisual(key, cached.key)) {
    const bounds = rasterBounds(layer),
      scale = Math.min(1, 4096 / bounds.width, 4096 / bounds.height)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.ceil(bounds.width * scale))
    c.height = Math.max(1, Math.ceil(bounds.height * scale))
    const x = c.getContext('2d')!
    x.scale(c.width / bounds.width, c.height / bounds.height)
    x.translate(-bounds.x, -bounds.y)
    renderLayer(x, { ...layer, mask: undefined, flipX: false, flipY: false }, override, true)
    const plane = document.createElement('canvas')
    plane.width = c.width
    plane.height = c.height
    const p = plane.getContext('2d', { willReadFrequently: true })!
    p.fillStyle = `rgb(${m.defaultColor},${m.defaultColor},${m.defaultColor})`
    p.fillRect(0, 0, c.width, c.height)
    if (m.feather) p.filter = `blur(${m.feather * scale}px)`
    p.drawImage(
      mask,
      ((m.x - layer.x - bounds.x) * c.width) / bounds.width,
      ((m.y - layer.y - bounds.y) * c.height) / bounds.height,
      (m.width * c.width) / bounds.width,
      (m.height * c.height) / bounds.height,
    )
    const pixels = p.getImageData(0, 0, c.width, c.height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 3] = Math.round(255 * (1 - m.density) + pixels.data[i] * m.density)
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255
    }
    p.putImageData(pixels, 0, 0)
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(plane, 0, 0)
    cached = { key, image: c, bounds }
    maskCache.set(layer.id, cached)
    let bytes = [...maskCache.values()].reduce(
      (sum, v) => sum + v.image.width * v.image.height * 4,
      0,
    )
    for (const [id, entry] of maskCache) {
      if (bytes <= 64 * 1024 * 1024) break
      if (id !== layer.id) {
        bytes -= entry.image.width * entry.image.height * 4
        maskCache.delete(id)
      }
    }
  }
  const b = cached.bounds
  ctx.drawImage(cached.image, b.x, b.y, b.width, b.height)
}
const rasterGeometry = new WeakMap<HTMLCanvasElement, { source: Layer; patch: Partial<Layer> }>()
export async function rasterizeLayer(layer: Layer): Promise<HTMLCanvasElement> {
  if (layer.kind === 'adjustment')
    throw new Error(
      'Корректирующий слой зависит от нижнего стека. Используй «Объединить видимые», чтобы получить растровую копию.',
    )
  if (layer.src) await loadImage(layer.src)
  if (layer.mask) await loadImage(layer.mask.src)
  if (layer.kind === 'text') {
    await document.fonts.load(textFont(layer), (layer.text || 'AaБб').slice(0, 256))
    clearTextGeometryCache()
  }
  const bounds = pixelBounds(
    layer.kind === 'text' || layer.kind === 'shape'
      ? rasterBounds(layer, false, true)
      : { x: 0, y: 0, width: layer.width, height: layer.height },
  )
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 4096 / bounds.width, 4096 / bounds.height)
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale))
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.scale(canvas.width / bounds.width, canvas.height / bounds.height)
  ctx.translate(-bounds.x, -bounds.y)
  renderLayer(
    ctx,
    { ...layer, styles: undefined, warp: undefined, mask: undefined },
    undefined,
    true,
  )
  const center = layerPoint(
    { ...layer, warp: undefined, flipX: false, flipY: false },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  )
  const x = center.x - bounds.width / 2,
    y = center.y - bounds.height / 2
  let warp = layer.warp
  if (warp) {
    const matrix = homography(warp)
    const q = rectPoints(bounds).map((p) => {
      const v = project(matrix, p.x / layer.width, p.y / layer.height)
      return {
        x: (v.x * layer.width - bounds.x) / bounds.width,
        y: (v.y * layer.height - bounds.y) / bounds.height,
      }
    })
    if (!validQuad(q))
      throw new Error(
        'Эту перспективу нельзя растрировать в локальные границы. Сначала сбрось перспективу или объедини видимые слои.',
      )
    warp = q
  }
  const mask = rasterMask(layer),
    styles = layer.styles
  const angle = ((styles?.gradient.angle || 0) * Math.PI) / 180
  rasterGeometry.set(canvas, {
    source: layer,
    patch: {
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      warp,
      mask: mask
        ? { ...mask, x: x + mask.x - layer.x - bounds.x, y: y + mask.y - layer.y - bounds.y }
        : undefined,
      styles:
        styles && (layer.flipX || layer.flipY)
          ? {
              ...styles,
              shadow: {
                ...styles.shadow,
                x: styles.shadow.x * (layer.flipX ? -1 : 1),
                y: styles.shadow.y * (layer.flipY ? -1 : 1),
              },
              gradient: {
                ...styles.gradient,
                angle:
                  (Math.atan2(
                    Math.sin(angle) * (layer.flipY ? -1 : 1),
                    Math.cos(angle) * (layer.flipX ? -1 : 1),
                  ) *
                    180) /
                  Math.PI,
              },
            }
          : styles,
    },
  })
  return canvas
}
export const rasterizedGeometry = (layer: Layer, canvas: HTMLCanvasElement): Partial<Layer> => {
  const metadata = rasterGeometry.get(canvas)
  return metadata?.source === layer ? metadata.patch : { mask: rasterMask(layer) }
}
export async function exportCanvas(doc: EditorDocument, scale = 1, background?: string) {
  await prepareDocument(doc)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(doc.width * scale)
  canvas.height = Math.round(doc.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  renderDocument(ctx, doc)
  if (background) {
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = background
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  return canvas
}
export function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        !blob
          ? reject(new Error('Не удалось сформировать файл'))
          : blob.type !== mime
            ? reject(new Error('Этот формат экспорта не поддерживается. Выбери PNG.'))
            : resolve(blob),
      mime,
      quality,
    ),
  )
}
export async function downloadBlob(
  blob: Blob,
  name: string,
  options: { documentId?: string; saveAs?: boolean } = {},
) {
  if (window.fsh777?.saveFile) {
    if (blob.size > 128 * 1024 * 1024)
      throw new Error('Файл больше 128 МиБ — уменьши масштаб экспорта')
    const result = await window.fsh777.saveFile({
      name,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      ...options,
    })
    if (result.state !== 'completed') throw new Error(result.message || 'Сохранение отменено')
    return result.name
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return name
}
export function bitmapLayer(layer: Layer, canvas: HTMLCanvasElement): Layer {
  const src = canvas.toDataURL('image/png')
  cacheImage(src, canvas)
  return {
    ...layer,
    kind: 'image',
    src,
    ...rasterizedGeometry(layer, canvas),
    flipX: false,
    flipY: false,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  }
}

export async function encodeBitmap(layer: Layer, canvas: HTMLCanvasElement): Promise<Layer> {
  const blob = await canvasBlob(canvas, 'image/png')
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  cacheImage(src, canvas)
  return {
    ...layer,
    kind: 'image',
    src,
    ...rasterizedGeometry(layer, canvas),
    flipX: false,
    flipY: false,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  }
}

export function clearRenderCaches() {
  clearAdjustmentCaches()
  maskCache.clear()
  clearStyleCache()
  clearWarpCache()
  clearTextLayoutCache()
  clearTextGeometryCache()
}

function rasterMask(layer: Layer): Layer['mask'] {
  const m = layer.mask
  if (!m || (!layer.flipX && !layer.flipY)) return m
  const image = images.get(m.src)
  if (!image) return m
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const x = c.getContext('2d')!
  x.translate(layer.flipX ? c.width : 0, layer.flipY ? c.height : 0)
  x.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
  x.drawImage(image, 0, 0)
  const src = c.toDataURL()
  cacheImage(src, c)
  return {
    ...m,
    src,
    x: layer.flipX ? layer.x + layer.width - (m.x - layer.x) - m.width : m.x,
    y: layer.flipY ? layer.y + layer.height - (m.y - layer.y) - m.height : m.y,
  }
}
