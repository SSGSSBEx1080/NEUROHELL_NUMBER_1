import { rasterBounds } from './layerGeometry'
import {
  applyGradientStops,
  opaqueOpacityStops,
  parseGradientDefinition,
  solidGradient,
  type GradientDefinition,
} from './gradientRamp'
import {
  MAX_STYLE_INSTANCES,
  type ColorOverlayStyle,
  type GlowEffectStyle,
  type GradientOverlayStyle,
  type Layer,
  type LayerStyles,
  type ShadowEffectStyle,
  type StrokeEffectStyle,
} from '../types'

export const STYLE_LIMITS = { strokeSize: 120, blur: 100, offset: 180 } as const

export function defaultGradientOverlayGradient(): GradientDefinition {
  return solidGradient(
    [
      { position: 0, color: '#b6a3ff' },
      { position: 1, color: '#fcac79' },
    ],
    opaqueOpacityStops(),
    'ФШ777 ULTRA',
  )
}
export const defaultStrokeStyle = (): StrokeEffectStyle => ({
  enabled: false,
  size: 6,
  color: '#ffffff',
  position: 'outside',
  opacity: 1,
})
export const defaultShadowStyle = (): ShadowEffectStyle => ({
  enabled: false,
  color: '#000000',
  blur: 20,
  x: 0,
  y: 12,
  opacity: 0.55,
})
export const defaultInnerShadowStyle = (): ShadowEffectStyle => ({
  enabled: false,
  color: '#000000',
  blur: 12,
  x: 0,
  y: 6,
  opacity: 0.5,
})
export const defaultGlowStyle = (): GlowEffectStyle => ({
  enabled: false,
  color: '#b6a3ff',
  blur: 20,
  opacity: 0.7,
})
export const defaultInnerGlowStyle = (): GlowEffectStyle => ({
  enabled: false,
  color: '#ffffff',
  blur: 16,
  opacity: 0.65,
})
export const defaultOverlayStyle = (): ColorOverlayStyle => ({
  enabled: false,
  color: '#b6a3ff',
  opacity: 1,
})
export const defaultGradientOverlayStyle = (): GradientOverlayStyle => ({
  enabled: false,
  gradient: defaultGradientOverlayGradient(),
  angle: 45,
  opacity: 1,
  reverse: false,
})
export function defaultStyles(): LayerStyles {
  return {
    fillOpacity: 1,
    strokes: [defaultStrokeStyle()],
    shadows: [defaultShadowStyle()],
    innerShadows: [defaultInnerShadowStyle()],
    glow: defaultGlowStyle(),
    innerGlow: defaultInnerGlowStyle(),
    overlays: [defaultOverlayStyle()],
    gradients: [defaultGradientOverlayStyle()],
  }
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const color = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v) ? v.toLowerCase() : fallback
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const percent = (v: unknown, fallback: number) => num(v, fallback, 0, 1)

function parseStroke(input: unknown): StrokeEffectStyle {
  const v = record(input),
    d = defaultStrokeStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    size: num(v.size, d.size, 0, STYLE_LIMITS.strokeSize),
    color: color(v.color, d.color),
    position:
      v.position === 'inside' || v.position === 'center' || v.position === 'outside'
        ? v.position
        : d.position,
    opacity: percent(v.opacity, d.opacity),
  }
}
function parseShadow(input: unknown, inner = false): ShadowEffectStyle {
  const v = record(input),
    d = inner ? defaultInnerShadowStyle() : defaultShadowStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    color: color(v.color, d.color),
    blur: num(v.blur, d.blur, 0, STYLE_LIMITS.blur),
    x: num(v.x, d.x, -STYLE_LIMITS.offset, STYLE_LIMITS.offset),
    y: num(v.y, d.y, -STYLE_LIMITS.offset, STYLE_LIMITS.offset),
    opacity: percent(v.opacity, d.opacity),
  }
}
function parseGlow(input: unknown, inner = false): GlowEffectStyle {
  const v = record(input),
    d = inner ? defaultInnerGlowStyle() : defaultGlowStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    color: color(v.color, d.color),
    blur: num(v.blur, d.blur, 0, STYLE_LIMITS.blur),
    opacity: percent(v.opacity, d.opacity),
  }
}
function parseOverlay(input: unknown): ColorOverlayStyle {
  const v = record(input),
    d = defaultOverlayStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    color: color(v.color, d.color),
    opacity: percent(v.opacity, d.opacity),
  }
}
function parseGradientOverlay(input: unknown): GradientOverlayStyle {
  const v = record(input),
    d = defaultGradientOverlayStyle()
  if (!v) return d
  let gradient = d.gradient
  try {
    if (v.gradient !== undefined) gradient = parseGradientDefinition(v.gradient)
    else if (v.from !== undefined || v.to !== undefined)
      // Legacy 0.7 single gradient: two colors become real editable stops.
      gradient = solidGradient(
        [
          { position: 0, color: color(v.from, '#b6a3ff') },
          { position: 1, color: color(v.to, '#fcac79') },
        ],
        opaqueOpacityStops(),
        'ФШ777 ULTRA',
      )
  } catch {
    gradient = d.gradient
  }
  return {
    enabled: v.enabled === true,
    gradient,
    angle: num(v.angle, d.angle, -180, 360),
    opacity: percent(v.opacity, d.opacity),
    reverse: v.reverse === true,
  }
}
const list = <T>(value: unknown, legacy: unknown, parse: (v: unknown) => T, make: () => T): T[] => {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_STYLE_INSTANCES).map(parse)
    return items.length ? items : [make()]
  }
  if (legacy !== undefined) return [parse(legacy)]
  return [make()]
}

/**
 * Single validation gateway for layer styles. New ordered arrays win;
 * a legacy 0.7 single object (`stroke`, `shadow`, `overlay`, `gradient`)
 * migrates into a one-item list without changing its parameters.
 */
export function normalizeStyles(input: unknown): LayerStyles | undefined {
  const v = record(input)
  if (!v) return undefined
  return {
    fillOpacity: percent(v.fillOpacity, 1),
    strokes: list(v.strokes, v.stroke, parseStroke, defaultStrokeStyle),
    shadows: list(v.shadows, v.shadow, (x) => parseShadow(x), defaultShadowStyle),
    innerShadows: list(
      v.innerShadows,
      v.innerShadow,
      (x) => parseShadow(x, true),
      defaultInnerShadowStyle,
    ),
    glow: parseGlow(v.glow),
    innerGlow: parseGlow(v.innerGlow, true),
    overlays: list(v.overlays, v.overlay, parseOverlay, defaultOverlayStyle),
    gradients: list(v.gradients, v.gradient, parseGradientOverlay, defaultGradientOverlayStyle),
  }
}
export const hasStyles = (s?: LayerStyles) =>
  !!s &&
  (s.fillOpacity !== 1 ||
    s.strokes.some((e) => e.enabled) ||
    s.shadows.some((e) => e.enabled) ||
    s.innerShadows.some((e) => e.enabled) ||
    s.glow.enabled ||
    s.innerGlow.enabled ||
    s.overlays.some((e) => e.enabled) ||
    s.gradients.some((e) => e.enabled))

/** Short human summary for the layers panel, e.g. “Обводка ×3 · Тень”. */
export function styleEffectSummary(s?: LayerStyles): string {
  if (!s) return ''
  const parts: string[] = []
  const add = (name: string, count: number) => {
    if (count) parts.push(count > 1 ? `${name} ×${count}` : name)
  }
  add('Обводка', s.strokes.filter((e) => e.enabled).length)
  add('Тень', s.shadows.filter((e) => e.enabled).length)
  add('Внутренняя тень', s.innerShadows.filter((e) => e.enabled).length)
  if (s.glow.enabled) parts.push('Свечение')
  if (s.innerGlow.enabled) parts.push('Внутреннее свечение')
  add('Цвет', s.overlays.filter((e) => e.enabled).length)
  add('Градиент', s.gradients.filter((e) => e.enabled).length)
  if (s.fillOpacity !== 1) parts.push(`Заливка ${Math.round(s.fillOpacity * 100)}%`)
  return parts.join(' · ')
}

/** Scale every distance-like parameter; colors, angles and opacities stay untouched. */
export function scaleLayerStyles(styles: LayerStyles, factor: number): LayerStyles {
  const f = Math.min(4, Math.max(0.05, Number.isFinite(factor) ? factor : 1))
  const scaled = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(v * f * 100) / 100))
  const shadow = (e: ShadowEffectStyle): ShadowEffectStyle => ({
    ...e,
    blur: scaled(e.blur, 0, STYLE_LIMITS.blur),
    x: scaled(e.x, -STYLE_LIMITS.offset, STYLE_LIMITS.offset),
    y: scaled(e.y, -STYLE_LIMITS.offset, STYLE_LIMITS.offset),
  })
  const clone = structuredClone(styles)
  clone.strokes = clone.strokes.map((e) => ({
    ...e,
    size: scaled(e.size, 0, STYLE_LIMITS.strokeSize),
  }))
  clone.shadows = clone.shadows.map(shadow)
  clone.innerShadows = clone.innerShadows.map(shadow)
  clone.glow = { ...clone.glow, blur: scaled(clone.glow.blur, 0, STYLE_LIMITS.blur) }
  clone.innerGlow = {
    ...clone.innerGlow,
    blur: scaled(clone.innerGlow.blur, 0, STYLE_LIMITS.blur),
  }
  return clone
}

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

/**
 * Original raster layer styles. Cached separately from position/opacity for smooth dragging.
 * Paint order (back → front): drop shadows, outer glow, content with color/gradient
 * overlays (attenuated by Fill), inner shadows/glow, strokes. Inside each ordered
 * list index 0 is topmost, so lists are painted in reverse.
 */
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
    const tint = (source: HTMLCanvasElement, fill: string) => {
      const c = surface(w, h),
        x = c.getContext('2d')!
      x.drawImage(source, 0, 0)
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = fill
      x.fillRect(0, 0, w, h)
      return c
    }
    const dropShadow = (effect: {
      color: string
      blur: number
      x: number
      y: number
      opacity: number
    }) => {
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
    for (const effect of [...s.shadows].reverse()) if (effect.enabled) dropShadow(effect)
    if (s.glow.enabled) dropShadow({ ...s.glow, x: 0, y: 0 })

    const content = surface(w, h),
      c = content.getContext('2d')!
    c.drawImage(base, 0, 0)
    c.globalCompositeOperation = 'source-atop'
    for (const overlay of [...s.overlays].reverse())
      if (overlay.enabled) {
        c.globalAlpha = overlay.opacity
        c.fillStyle = overlay.color
        c.fillRect(0, 0, w, h)
      }
    for (const item of [...s.gradients].reverse())
      if (item.enabled) {
        const angle = (item.angle * Math.PI) / 180,
          length = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2
        const dx = Math.cos(angle) * length,
          dy = Math.sin(angle) * length
        const gradient = c.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy)
        applyGradientStops(gradient, item.gradient, item.reverse)
        c.globalAlpha = item.opacity
        c.fillStyle = gradient
        c.fillRect(0, 0, w, h)
      }
    c.globalAlpha = 1
    // Fill affects only the content; effects before/after keep their own opacity.
    o.globalAlpha = s.fillOpacity
    o.drawImage(content, 0, 0)
    o.globalAlpha = 1

    const innerEffect = (effect: {
      color: string
      blur: number
      x: number
      y: number
      opacity: number
    }) => {
      const inverted = surface(w, h),
        ix = inverted.getContext('2d')!
      ix.fillStyle = '#000000'
      ix.fillRect(0, 0, w, h)
      ix.globalCompositeOperation = 'destination-out'
      ix.drawImage(base, effect.x * scale, effect.y * scale)
      const blurred = surface(w, h),
        bx = blurred.getContext('2d')!
      bx.filter = `blur(${Math.max(0, effect.blur * scale)}px)`
      bx.drawImage(inverted, 0, 0)
      bx.filter = 'none'
      bx.globalCompositeOperation = 'destination-in'
      bx.drawImage(base, 0, 0)
      bx.globalCompositeOperation = 'source-in'
      bx.fillStyle = effect.color
      bx.fillRect(0, 0, w, h)
      o.globalAlpha = effect.opacity
      o.drawImage(blurred, 0, 0)
      o.globalAlpha = 1
    }
    for (const effect of [...s.innerShadows].reverse()) if (effect.enabled) innerEffect(effect)
    if (s.innerGlow.enabled) innerEffect({ ...s.innerGlow, x: 0, y: 0 })

    for (const stroke of [...s.strokes].reverse()) {
      if (!stroke.enabled || stroke.size <= 0 || stroke.opacity <= 0) continue
      const colored = tint(base, stroke.color),
        ring = surface(w, h),
        r = ring.getContext('2d')!
      const radius = stroke.size * scale * (stroke.position === 'center' ? 0.5 : 1)
      const steps = Math.max(16, Math.min(160, Math.ceil(radius * 5)))
      if (stroke.position !== 'inside') {
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          r.drawImage(colored, Math.cos(a) * radius, Math.sin(a) * radius)
        }
      } else r.drawImage(colored, 0, 0)
      r.globalCompositeOperation = 'destination-out'
      if (stroke.position === 'outside') {
        // The mask to punch out is the base itself; avoid a full-size copy per stroke.
        r.drawImage(base, 0, 0)
      } else {
        const inner = surface(w, h),
          ic = inner.getContext('2d')!
        ic.drawImage(base, 0, 0)
        ic.globalCompositeOperation = 'destination-in'
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          ic.drawImage(base, Math.cos(a) * radius, Math.sin(a) * radius)
        }
        r.drawImage(inner, 0, 0)
      }
      o.globalAlpha = stroke.opacity
      o.drawImage(ring, 0, 0)
      o.globalAlpha = 1
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
