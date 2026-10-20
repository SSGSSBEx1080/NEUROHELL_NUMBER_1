import { rasterBounds } from './layerGeometry'
import {
  applyGradientStops,
  gradientRgbaCss,
  gradientSample,
  opaqueOpacityStops,
  parseGradientDefinition,
  reflectPosition,
  solidGradient,
  type GradientDefinition,
} from './gradientRamp'
import { defaultPatternDefinition, parsePatternDefinition, patternTileCanvas } from './patterns'
import { applyBevelToPixels } from './bevel'
import { applySatinToPixels } from './satin'
import { applyOverlayBlendToPixels } from './overlayBlend'
import { gradientShapePosition, orderedDitherByte } from './gradientDither'
import {
  buildContourAlphaLut,
  isLinearEffectContour,
  linearEffectContour,
  parseEffectContour,
} from './contours'
import {
  MAX_STYLE_INSTANCES,
  type BevelEffectStyle,
  type BlendMode,
  type ColorOverlayStyle,
  type EffectContourDefinition,
  type GlowEffectStyle,
  type GradientOverlayStyle,
  type Layer,
  type LayerStyles,
  type PatternDefinition,
  type PatternOverlayStyle,
  type SatinEffectStyle,
  type ShadowEffectStyle,
  type StrokeEffectStyle,
  type StyleGradientShape,
} from '../types'

export const STYLE_LIMITS = {
  strokeSize: 120,
  blur: 100,
  offset: 180,
  bevelSize: 250,
  bevelSoften: 100,
  satinDistance: 250,
  satinSize: 250,
} as const

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
  fill: 'color',
  gradientShape: 'linear',
  gradientAngle: 90,
  gradientScale: 1,
  gradientReverse: false,
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
  contour: linearEffectContour(),
  antialiased: false,
})
export const defaultInnerShadowStyle = (): ShadowEffectStyle => ({
  enabled: false,
  color: '#000000',
  blur: 12,
  x: 0,
  y: 6,
  opacity: 0.5,
  contour: linearEffectContour(),
  antialiased: false,
})
export const defaultGlowStyle = (): GlowEffectStyle => ({
  enabled: false,
  color: '#b6a3ff',
  blur: 20,
  opacity: 0.7,
  contour: linearEffectContour(),
  antialiased: false,
  range: 0.5,
})
export const defaultInnerGlowStyle = (): GlowEffectStyle => ({
  enabled: false,
  color: '#ffffff',
  blur: 16,
  opacity: 0.65,
  contour: linearEffectContour(),
  antialiased: false,
  range: 0.5,
})
export const defaultOverlayStyle = (): ColorOverlayStyle => ({
  enabled: false,
  color: '#b6a3ff',
  opacity: 1,
})
export const defaultGradientOverlayStyle = (): GradientOverlayStyle => ({
  enabled: false,
  gradient: defaultGradientOverlayGradient(),
  shape: 'linear',
  scale: 1,
  angle: 45,
  opacity: 1,
  reverse: false,
})
export const defaultPatternOverlayStyle = (): PatternOverlayStyle => ({
  enabled: false,
  pattern: defaultPatternDefinition(),
  scale: 1,
  opacity: 1,
  phaseX: 0,
  phaseY: 0,
  align: true,
})
export const defaultBevelStyle = (): BevelEffectStyle => ({
  enabled: false,
  style: 'inner',
  technique: 'smooth',
  depth: 1,
  direction: 'up',
  size: 5,
  soften: 0,
  angle: 120,
  altitude: 30,
  useGlobalLight: true,
  highlightColor: '#ffffff',
  highlightBlendMode: 'screen',
  highlightOpacity: 0.75,
  shadowColor: '#000000',
  shadowBlendMode: 'multiply',
  shadowOpacity: 0.75,
  glossContour: linearEffectContour(),
  antialiasGloss: false,
})
export const defaultSatinStyle = (): SatinEffectStyle => ({
  enabled: false,
  color: '#000000',
  blendMode: 'multiply',
  opacity: 0.5,
  angle: 19,
  distance: 11,
  size: 14,
  invert: true,
  antialiased: false,
  contour: linearEffectContour(),
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
    pattern: defaultPatternOverlayStyle(),
    bevel: defaultBevelStyle(),
    satin: defaultSatinStyle(),
  }
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const color = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v) ? v.toLowerCase() : fallback
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const percent = (v: unknown, fallback: number) => num(v, fallback, 0, 1)
const cyclicAngle = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? ((((v + 180) % 360) + 360) % 360) - 180 : fallback
const BLEND_MODES: BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'lighter',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]
const blendMode = (v: unknown, fallback: BlendMode): BlendMode =>
  BLEND_MODES.includes(v as BlendMode) ? (v as BlendMode) : fallback
const optionalBlendMode = (v: unknown): BlendMode | undefined =>
  BLEND_MODES.includes(v as BlendMode) ? (v as BlendMode) : undefined

const GRADIENT_SHAPES: StyleGradientShape[] = ['linear', 'radial', 'reflected', 'angle', 'diamond']
export const parseGradientShape = (v: unknown, fallback: StyleGradientShape): StyleGradientShape =>
  GRADIENT_SHAPES.includes(v as StyleGradientShape) ? (v as StyleGradientShape) : fallback
function parseGradientValue(input: unknown): GradientDefinition | undefined {
  if (input === undefined) return undefined
  try {
    return parseGradientDefinition(input)
  } catch {
    return undefined
  }
}
function parseStroke(input: unknown): StrokeEffectStyle {
  const v = record(input),
    d = defaultStrokeStyle()
  if (!v) return d
  const gradient = parseGradientValue(v.gradient)
  const pattern = v.pattern === undefined ? undefined : parsePatternDefinition(v.pattern)
  return {
    enabled: v.enabled === true,
    size: num(v.size, d.size, 0, STYLE_LIMITS.strokeSize),
    color: color(v.color, d.color),
    fill:
      v.fill === 'pattern' && pattern
        ? 'pattern'
        : v.fill === 'gradient' && gradient
          ? 'gradient'
          : 'color',
    gradient,
    pattern,
    gradientShape: parseGradientShape(v.gradientShape, d.gradientShape),
    gradientAngle: num(v.gradientAngle, d.gradientAngle, -180, 360),
    gradientScale: num(v.gradientScale, d.gradientScale, 0.1, 4),
    gradientReverse: v.gradientReverse === true,
    gradientDither: v.gradientDither === true ? true : undefined,
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
    contour: parseEffectContour(v.contour, d.contour),
    antialiased: v.antialiased === true,
    useGlobalLight: v.useGlobalLight === true ? true : undefined,
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
    contour: parseEffectContour(v.contour, d.contour),
    antialiased: v.antialiased === true,
    range: num(v.range, d.range ?? 0.5, 0.01, 1),
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
    blendMode: optionalBlendMode(v.blendMode),
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
    shape: parseGradientShape(v.shape, d.shape),
    scale: num(v.scale, d.scale, 0.1, 4),
    angle: num(v.angle, d.angle, -180, 360),
    opacity: percent(v.opacity, d.opacity),
    reverse: v.reverse === true,
    dither: v.dither === true ? true : undefined,
    blendMode: optionalBlendMode(v.blendMode),
  }
}
function parsePatternOverlay(input: unknown): PatternOverlayStyle {
  const v = record(input),
    d = defaultPatternOverlayStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    pattern: parsePatternDefinition(v.pattern) || d.pattern,
    scale: num(v.scale, d.scale, 0.05, 10),
    opacity: percent(v.opacity, d.opacity),
    blendMode: optionalBlendMode(v.blendMode),
    phaseX: num(v.phaseX, d.phaseX, -10000, 10000),
    phaseY: num(v.phaseY, d.phaseY, -10000, 10000),
    align: v.align !== false,
  }
}
function parseBevel(input: unknown): BevelEffectStyle {
  const v = record(input),
    d = defaultBevelStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    style:
      v.style === 'outer' || v.style === 'emboss' || v.style === 'pillow' || v.style === 'stroke'
        ? v.style
        : 'inner',
    technique:
      v.technique === 'chiselHard' || v.technique === 'chiselSoft' ? v.technique : 'smooth',
    depth: num(v.depth, d.depth, 0.01, 10),
    direction: v.direction === 'down' ? 'down' : 'up',
    size: num(v.size, d.size, 0, STYLE_LIMITS.bevelSize),
    soften: num(v.soften, d.soften, 0, STYLE_LIMITS.bevelSoften),
    angle: cyclicAngle(v.angle, d.angle),
    altitude: num(v.altitude, d.altitude, 0, 90),
    useGlobalLight: v.useGlobalLight !== false,
    highlightColor: color(v.highlightColor, d.highlightColor),
    highlightBlendMode: blendMode(v.highlightBlendMode, d.highlightBlendMode),
    highlightOpacity: percent(v.highlightOpacity, d.highlightOpacity),
    shadowColor: color(v.shadowColor, d.shadowColor),
    shadowBlendMode: blendMode(v.shadowBlendMode, d.shadowBlendMode),
    shadowOpacity: percent(v.shadowOpacity, d.shadowOpacity),
    glossContour: parseEffectContour(v.glossContour, d.glossContour),
    antialiasGloss: v.antialiasGloss === true,
  }
}
function parseSatin(input: unknown): SatinEffectStyle {
  const v = record(input),
    d = defaultSatinStyle()
  if (!v) return d
  return {
    enabled: v.enabled === true,
    color: color(v.color, d.color),
    blendMode: blendMode(v.blendMode, d.blendMode),
    opacity: percent(v.opacity, d.opacity),
    angle: cyclicAngle(v.angle, d.angle),
    distance: num(v.distance, d.distance, 0, STYLE_LIMITS.satinDistance),
    size: num(v.size, d.size, 0, STYLE_LIMITS.satinSize),
    invert: v.invert !== false,
    antialiased: v.antialiased === true,
    contour: parseEffectContour(v.contour, d.contour),
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
    pattern: parsePatternOverlay(v.pattern ?? v.patternOverlay),
    bevel: parseBevel(v.bevel ?? v.bevelEmboss),
    satin: parseSatin(v.satin),
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
    s.gradients.some((e) => e.enabled) ||
    s.pattern.enabled ||
    s.bevel.enabled ||
    s.satin.enabled)

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
  if (s.pattern.enabled) parts.push('Узор')
  if (s.bevel.enabled) parts.push('Фаска')
  if (s.satin.enabled) parts.push('Атлас')
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
  clone.pattern = {
    ...clone.pattern,
    phaseX: scaled(clone.pattern.phaseX, -10000, 10000),
    phaseY: scaled(clone.pattern.phaseY, -10000, 10000),
  }
  clone.bevel = {
    ...clone.bevel,
    size: scaled(clone.bevel.size, 0, STYLE_LIMITS.bevelSize),
    soften: scaled(clone.bevel.soften, 0, STYLE_LIMITS.bevelSoften),
  }
  clone.satin = {
    ...clone.satin,
    distance: scaled(clone.satin.distance, 0, STYLE_LIMITS.satinDistance),
    size: scaled(clone.satin.size, 0, STYLE_LIMITS.satinSize),
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
const positionMatters = (layer: Layer) =>
  !!layer.styles?.pattern.enabled && !layer.styles.pattern.align
const equalContent = (a: Layer, b: Layer) =>
  Object.keys(a).length === Object.keys(b).length &&
  (Object.keys(a) as (keyof Layer)[]).every(
    (k) =>
      (ignored.has(k) &&
        !((k === 'x' || k === 'y') && (positionMatters(a) || positionMatters(b)))) ||
      a[k] === b[k],
  )
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
 * Remaps an effect surface's alpha through its contour. A linear contour at
 * the neutral 50% range is exactly the pre-contour rendering, so it stays on
 * the old byte-identical Canvas path and pays no pixel-pass cost.
 */
function applyContourAlpha(
  canvas: HTMLCanvasElement,
  contour: EffectContourDefinition | undefined,
  antialiased = false,
  range = 0.5,
) {
  const safeRange = Math.max(0.01, Math.min(1, Number.isFinite(range) ? range : 0.5))
  if (isLinearEffectContour(contour) && Math.abs(safeRange - 0.5) <= 0.0001) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const lut = buildContourAlphaLut(contour, antialiased, safeRange)
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = lut[pixels.data[i]]
  ctx.putImageData(pixels, 0, 0)
}

/**
 * Fills a w×h context with a gradient in one of the PSD gradient styles.
 * Linear keeps the historical geometry (projected half-length from the
 * centre, multiplied by `scale`); radial reaches the far corners at t=1
 * (before scale); reflected mirrors the ramp around the centre; angle
 * sweeps a conic ramp starting along the style angle; diamond evaluates a
 * rotated L1 norm per pixel (t=1 on the inscribed rhombus, before scale).
 */
export function paintGradientShape(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  definition: GradientDefinition,
  shape: StyleGradientShape,
  angleDeg: number,
  scale = 1,
  reverse = false,
  dither = false,
) {
  const cx = w / 2,
    cy = h / 2,
    angle = (angleDeg * Math.PI) / 180
  if (dither) {
    // Canvas gradients have already been quantized to 8 bits by the time
    // ImageData can be read. Sample the same geometry continuously here and
    // distribute each fractional byte with a stable ordered pattern.
    const image = ctx.createImageData(w, h),
      out = [0, 0, 0, 0]
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = gradientShapePosition(shape, w, h, x, y, angleDeg, scale)
        gradientSample(definition, reverse ? 1 - t : t, out)
        const i = (y * w + x) * 4
        image.data[i] = orderedDitherByte(out[0], x, y)
        image.data[i + 1] = orderedDitherByte(out[1], x, y)
        image.data[i + 2] = orderedDitherByte(out[2], x, y)
        image.data[i + 3] = orderedDitherByte(out[3], x, y)
      }
    ctx.putImageData(image, 0, 0)
    return
  }
  if (shape === 'diamond') {
    const image = ctx.createImageData(w, h),
      out = [0, 0, 0, 0],
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      norm = Math.max(0.0001, scale)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / Math.max(1, cx),
          dy = (y + 0.5 - cy) / Math.max(1, cy),
          rx = dx * cos + dy * sin,
          ry = -dx * sin + dy * cos
        const t = Math.min(1, Math.max(0, (Math.abs(rx) + Math.abs(ry)) / norm))
        gradientSample(definition, reverse ? 1 - t : t, out)
        const i = (y * w + x) * 4
        image.data[i] = Math.round(out[0] * 255)
        image.data[i + 1] = Math.round(out[1] * 255)
        image.data[i + 2] = Math.round(out[2] * 255)
        image.data[i + 3] = Math.round(out[3] * 255)
      }
    ctx.putImageData(image, 0, 0)
    return
  }
  let gradient: CanvasGradient
  if (shape === 'radial') {
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, (Math.hypot(w, h) / 2) * scale)
    applyGradientStops(gradient, definition, reverse)
  } else if (shape === 'angle') {
    gradient = ctx.createConicGradient(angle + Math.PI / 2, cx, cy)
    applyGradientStops(gradient, definition, reverse)
  } else {
    const length = ((Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2) * scale,
      dx = Math.cos(angle) * length,
      dy = Math.sin(angle) * length
    gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
    if (shape === 'reflected') {
      const samples = definition.kind === 'noise' ? 96 : 48
      for (let i = 0; i <= samples; i++) {
        const t = i / samples,
          q = reflectPosition(t)
        gradient.addColorStop(t, gradientRgbaCss(definition, reverse ? 1 - q : q))
      }
    } else applyGradientStops(gradient, definition, reverse)
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

/**
 * Tiles a pattern over a w×h surface. `originX/originY` locate the layer's
 * local (0,0) inside the (padded) surface, in layer units; phase is the tile
 * offset from that origin. Returns false while an image tile is not prepared.
 */
export function paintPatternFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  definition: PatternDefinition,
  patternScale: number,
  phaseX: number,
  phaseY: number,
  originX: number,
  originY: number,
  renderScale: number,
): boolean {
  const tile = patternTileCanvas(definition)
  if (!tile) return false
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return false
  const tileScale = Math.max(0.0001, patternScale * renderScale)
  if (typeof DOMMatrix !== 'undefined' && 'setTransform' in pattern)
    pattern.setTransform(
      new DOMMatrix()
        .translate((originX + phaseX) * renderScale, (originY + phaseY) * renderScale)
        .scale(tileScale, tileScale),
    )
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, w, h)
  return true
}

/**
 * Original raster layer styles. Cached separately from position/opacity for smooth dragging.
 * Paint order (back → front): drop shadows, outer glow, content with color/gradient
 * overlays (attenuated by Fill), Satin, inner shadows/glow, strokes, then Bevel &
 * Emboss as the final lighting pass. Inside each ordered
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
      contour?: EffectContourDefinition
      antialiased?: boolean
      range?: number
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
      applyContourAlpha(c, effect.contour, effect.antialiased, effect.range)
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
    const applyOverlayFill = (
      fill: HTMLCanvasElement,
      mode: BlendMode | undefined,
      opacity: number,
    ) => {
      if (!mode || mode === 'source-over') {
        c.globalAlpha = opacity
        c.drawImage(fill, 0, 0)
        c.globalAlpha = 1
        return
      }
      const contentPixels = c.getImageData(0, 0, w, h)
      const fillPixels = fill.getContext('2d')!.getImageData(0, 0, w, h)
      applyOverlayBlendToPixels(contentPixels, fillPixels, mode, opacity)
      c.putImageData(contentPixels, 0, 0)
    }
    // Photoshop's fixed overlay stack is Pattern at the bottom, then
    // Gradient, then Color on top. Multiple instances within each family
    // retain this dialog's existing list order.
    if (s.pattern.enabled && s.pattern.opacity > 0) {
      const fill = surface(w, h)
      paintPatternFill(
        fill.getContext('2d')!,
        w,
        h,
        s.pattern.pattern,
        s.pattern.scale,
        s.pattern.align ? s.pattern.phaseX : s.pattern.phaseX - layer.x,
        s.pattern.align ? s.pattern.phaseY : s.pattern.phaseY - layer.y,
        -bounds.x,
        -bounds.y,
        scale,
      )
      applyOverlayFill(fill, s.pattern.blendMode, s.pattern.opacity)
    }
    for (const item of [...s.gradients].reverse())
      if (item.enabled && item.opacity > 0) {
        const fill = surface(w, h)
        paintGradientShape(
          fill.getContext('2d')!,
          w,
          h,
          item.gradient,
          item.shape,
          item.angle,
          item.scale,
          item.reverse,
          item.dither === true,
        )
        applyOverlayFill(fill, item.blendMode, item.opacity)
      }
    for (const overlay of [...s.overlays].reverse())
      if (overlay.enabled && overlay.opacity > 0) {
        if (!overlay.blendMode || overlay.blendMode === 'source-over') {
          c.globalAlpha = overlay.opacity
          c.fillStyle = overlay.color
          c.fillRect(0, 0, w, h)
          c.globalAlpha = 1
        } else {
          const fill = surface(w, h)
          const fillContext = fill.getContext('2d')!
          fillContext.fillStyle = overlay.color
          fillContext.fillRect(0, 0, w, h)
          applyOverlayFill(fill, overlay.blendMode, overlay.opacity)
        }
      }
    c.globalAlpha = 1
    // Fill affects only the content; effects before/after keep their own opacity.
    o.globalAlpha = s.fillOpacity
    o.drawImage(content, 0, 0)
    o.globalAlpha = 1

    if (s.satin.enabled && s.satin.opacity > 0) {
      const satinPixels = o.getImageData(0, 0, w, h)
      applySatinToPixels(
        satinPixels,
        b.getImageData(0, 0, w, h),
        c.getImageData(0, 0, w, h),
        s.satin,
        scale,
      )
      o.putImageData(satinPixels, 0, 0)
    }

    const innerEffect = (effect: {
      color: string
      blur: number
      x: number
      y: number
      opacity: number
      contour?: EffectContourDefinition
      antialiased?: boolean
      range?: number
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
      applyContourAlpha(blurred, effect.contour, effect.antialiased, effect.range)
      o.globalAlpha = effect.opacity
      o.drawImage(blurred, 0, 0)
      o.globalAlpha = 1
    }
    for (const effect of [...s.innerShadows].reverse()) if (effect.enabled) innerEffect(effect)
    if (s.innerGlow.enabled) innerEffect({ ...s.innerGlow, x: 0, y: 0 })

    const strokeEmbossRings: { canvas: HTMLCanvasElement; opacity: number }[] = []
    for (const stroke of [...s.strokes].reverse()) {
      if (!stroke.enabled || stroke.size <= 0 || stroke.opacity <= 0) continue
      let colored: HTMLCanvasElement
      if (stroke.fill === 'gradient' && stroke.gradient) {
        const fill = surface(w, h)
        paintGradientShape(
          fill.getContext('2d')!,
          w,
          h,
          stroke.gradient,
          stroke.gradientShape,
          stroke.gradientAngle,
          stroke.gradientScale,
          stroke.gradientReverse,
          stroke.gradientDither === true,
        )
        colored = surface(w, h)
        const cx = colored.getContext('2d')!
        cx.drawImage(base, 0, 0)
        cx.globalCompositeOperation = 'source-in'
        cx.drawImage(fill, 0, 0)
      } else if (stroke.fill === 'pattern' && stroke.pattern) {
        const fill = surface(w, h)
        paintPatternFill(
          fill.getContext('2d')!,
          w,
          h,
          stroke.pattern,
          1,
          0,
          0,
          -bounds.x,
          -bounds.y,
          scale,
        )
        colored = surface(w, h)
        const cx = colored.getContext('2d')!
        cx.drawImage(base, 0, 0)
        cx.globalCompositeOperation = 'source-in'
        cx.drawImage(fill, 0, 0)
      } else colored = tint(base, stroke.color)
      const ring = surface(w, h),
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
      if (s.bevel.enabled && s.bevel.style === 'stroke')
        strokeEmbossRings.push({ canvas: ring, opacity: stroke.opacity })
    }

    if (s.bevel.enabled && s.bevel.size > 0) {
      const outputPixels = o.getImageData(0, 0, w, h)
      if (s.bevel.style === 'stroke') {
        for (const ring of strokeEmbossRings) {
          const maskPixels = ring.canvas.getContext('2d')!.getImageData(0, 0, w, h)
          if (ring.opacity < 1)
            for (let i = 3; i < maskPixels.data.length; i += 4)
              maskPixels.data[i] = Math.round(maskPixels.data[i] * ring.opacity)
          applyBevelToPixels(
            outputPixels,
            maskPixels,
            {
              width: w,
              height: h,
              data: new Uint8ClampedArray(outputPixels.data),
            },
            s.bevel,
            scale,
            'stroke',
          )
        }
      } else {
        applyBevelToPixels(
          outputPixels,
          b.getImageData(0, 0, w, h),
          c.getImageData(0, 0, w, h),
          s.bevel,
          scale,
        )
      }
      o.putImageData(outputPixels, 0, 0)
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
