import { rasterBounds } from './layerGeometry'
import type { Layer, LayerStyles } from '../types'

export function defaultStyles(): LayerStyles {
  return {
    fillOpacity: 1,
    stroke: { enabled: false, size: 6, color: '#ffffff', position: 'outside' },
    shadow: { enabled: false, color: '#000000', blur: 20, x: 0, y: 12, opacity: 0.55 },
    glow: { enabled: false, color: '#b6a3ff', blur: 20, opacity: 0.7 },
    overlay: { enabled: false, color: '#b6a3ff', opacity: 1 },
    gradient: { enabled: false, from: '#b6a3ff', to: '#fcac79', angle: 45, opacity: 1 },
  }
}
export function normalizeStyles(input: unknown): LayerStyles | undefined {
  if (!input || typeof input !== 'object') return undefined
  const result = defaultStyles(),
    value = input as Record<string, unknown>
  if (typeof value.fillOpacity === 'number' && Number.isFinite(value.fillOpacity))
    result.fillOpacity = Math.max(0, Math.min(1, value.fillOpacity))
  for (const name of ['stroke', 'shadow', 'glow', 'overlay', 'gradient'] as const) {
    const src = value[name]
    if (!src || typeof src !== 'object') continue
    const target = result[name] as unknown as Record<string, unknown>
    for (const [key, v] of Object.entries(src)) {
      if (!(key in target)) continue
      if (key === 'enabled') target[key] = v === true
      else if (
        ['color', 'from', 'to'].includes(key) &&
        typeof v === 'string' &&
        /^#[a-f0-9]{6}$/i.test(v)
      )
        target[key] = v
      else if (key === 'position' && ['outside', 'inside', 'center'].includes(String(v)))
        target[key] = v
      else if (typeof v === 'number' && Number.isFinite(v)) {
        const min = ['x', 'y', 'angle'].includes(key) ? -180 : 0
        const max =
          key === 'opacity'
            ? 1
            : key === 'angle'
              ? 360
              : key === 'size'
                ? 80
                : key === 'blur'
                  ? 100
                  : 180
        target[key] = Math.min(max, Math.max(min, v))
      }
    }
  }
  return result
}
export const hasStyles = (s?: LayerStyles) =>
  !!s &&
  (s.fillOpacity !== 1 ||
    s.stroke.enabled ||
    s.shadow.enabled ||
    s.glow.enabled ||
    s.overlay.enabled ||
    s.gradient.enabled)
const cache = new Map<
  string,
  { layer: Layer; image: HTMLCanvasElement; left: number; top: number; scale: number }
>()
const ignored = new Set([
  'x',
  'y',
  'rotation',
  'opacity',
  'blendMode',
  'name',
  'visible',
  'locked',
  'flipX',
  'flipY',
])
const equalContent = (a: Layer, b: Layer) =>
  Object.keys(a).length === Object.keys(b).length &&
  (Object.keys(a) as (keyof Layer)[]).every((k) => ignored.has(k) || a[k] === b[k])
const surface = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
export function clearStyleCache() {
  cache.clear()
}

/** Original raster layer styles. Cached separately from position/opacity for smooth dragging. */
export function renderStyled(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  draw: (ctx: CanvasRenderingContext2D) => void,
  volatile = false,
) {
  let entry = cache.get(layer.id)
  if (volatile || !entry || !equalContent(entry.layer, layer)) {
    const s = layer.styles!,
      bounds = rasterBounds(layer, true)
    const scale = Math.min(1, 4096 / bounds.width, 4096 / bounds.height)
    const w = Math.max(1, Math.ceil(bounds.width * scale)),
      h = Math.max(1, Math.ceil(bounds.height * scale))
    const base = surface(w, h),
      b = base.getContext('2d')!
    b.scale(scale, scale)
    b.translate(-bounds.x, -bounds.y)
    draw(b)
    const output = surface(w, h),
      o = output.getContext('2d')!
    const tint = (source: HTMLCanvasElement, color: string) => {
      const c = surface(w, h),
        x = c.getContext('2d')!
      x.drawImage(source, 0, 0)
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = color
      x.fillRect(0, 0, w, h)
      return c
    }
    for (const effect of [s.shadow, { ...s.glow, x: 0, y: 0 }])
      if (effect.enabled) {
        const c = surface(w, h),
          x = c.getContext('2d')!
        x.shadowColor = effect.color
        x.shadowBlur = effect.blur * scale
        x.shadowOffsetX = effect.x * scale
        x.shadowOffsetY = effect.y * scale
        x.drawImage(base, 0, 0)
        x.shadowBlur = 0
        x.shadowOffsetX = 0
        x.shadowOffsetY = 0
        x.globalCompositeOperation = 'destination-out'
        x.drawImage(base, 0, 0)
        o.globalAlpha = effect.opacity
        o.drawImage(c, 0, 0)
        o.globalAlpha = 1
      }
    const content = surface(w, h),
      c = content.getContext('2d')!
    c.drawImage(base, 0, 0)
    c.globalCompositeOperation = 'source-atop'
    if (s.overlay.enabled) {
      c.globalAlpha = s.overlay.opacity
      c.fillStyle = s.overlay.color
      c.fillRect(0, 0, w, h)
    }
    if (s.gradient.enabled) {
      const angle = (s.gradient.angle * Math.PI) / 180,
        length = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2
      const dx = Math.cos(angle) * length,
        dy = Math.sin(angle) * length
      const gradient = c.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
      gradient.addColorStop(0, s.gradient.from)
      gradient.addColorStop(1, s.gradient.to)
      c.globalAlpha = s.gradient.opacity
      c.fillStyle = gradient
      c.fillRect(0, 0, w, h)
    }
    o.globalAlpha = s.fillOpacity
    o.drawImage(content, 0, 0)
    o.globalAlpha = 1
    if (s.stroke.enabled && s.stroke.size > 0) {
      const colored = tint(base, s.stroke.color),
        ring = surface(w, h),
        r = ring.getContext('2d')!
      const radius = s.stroke.size * scale * (s.stroke.position === 'center' ? 0.5 : 1)
      const steps = Math.max(16, Math.min(96, Math.ceil(radius * 5)))
      if (s.stroke.position !== 'inside') {
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          r.drawImage(colored, Math.cos(a) * radius, Math.sin(a) * radius)
        }
      } else r.drawImage(colored, 0, 0)
      const inner = surface(w, h),
        ic = inner.getContext('2d')!
      ic.drawImage(base, 0, 0)
      if (s.stroke.position !== 'outside') {
        ic.globalCompositeOperation = 'destination-in'
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          ic.drawImage(base, Math.cos(a) * radius, Math.sin(a) * radius)
        }
      }
      r.globalCompositeOperation = 'destination-out'
      r.drawImage(inner, 0, 0)
      o.drawImage(ring, 0, 0)
    }
    entry = { layer, image: output, left: bounds.x, top: bounds.y, scale }
    cache.set(layer.id, entry)
    let bytes = [...cache.values()].reduce((n, e) => n + e.image.width * e.image.height * 4, 0)
    for (const [key, value] of cache) {
      if (bytes <= 64 * 1024 * 1024 && cache.size <= 12) break
      if (key === layer.id) continue
      bytes -= value.image.width * value.image.height * 4
      cache.delete(key)
    }
  }
  ctx.drawImage(
    entry.image,
    entry.left,
    entry.top,
    entry.image.width / entry.scale,
    entry.image.height / entry.scale,
  )
}
