export interface GradientStop {
  position: number
  color: string
  /** Where the 50% mix with the next stop sits, 0..1 of the segment. Default 0.5. */
  midpoint?: number
}
export interface GradientOpacityStop {
  position: number
  opacity: number
  midpoint?: number
}
export type GradientColorModel = 'rgb' | 'hsb' | 'lab'
export interface NoiseGradientSpec {
  /** 0 = long smooth transitions, 1 = many hard bands. */
  roughness: number
  model: GradientColorModel
  seed: number
  /** Per-channel fractions 0..1 in the model space; index 3 is alpha. */
  min: number[]
  max: number[]
  restrictColors: boolean
  transparency: boolean
}
export interface GradientDefinition {
  name: string
  kind: 'solid' | 'noise'
  stops: GradientStop[]
  opacityStops: GradientOpacityStop[]
  noise?: NoiseGradientSpec
}
export const MAX_GRADIENT_STOPS = 16
export const MAX_GRADIENT_OPACITY_STOPS = 16
export const GRADIENT_QUANTUM = 1 / 4096
export const rgbFromHex = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
export const hexFromRgb = (r: number, g: number, b: number) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
const quantize = (v: number) => Math.round(v * 4096) / 4096
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** PSD midpoint semantics: the 50% blend sits at `m` of the segment instead of half way. */
export function warpMidpoint(f: number, midpoint?: number): number {
  const m = Math.max(0.01, Math.min(0.99, midpoint ?? 0.5))
  const t = clamp01(f)
  return t < m ? (0.5 * t) / m : 0.5 + (0.5 * (t - m)) / (1 - m)
}

export function parseGradientStops(input: unknown): GradientStop[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_GRADIENT_STOPS)
    throw new Error('Градиент: от 2 до 16 цветовых точек')
  const stops = input
    .map((v) => {
      if (
        !v ||
        typeof v !== 'object' ||
        typeof v.position !== 'number' ||
        !Number.isFinite(v.position) ||
        v.position < 0 ||
        v.position > 1 ||
        typeof v.color !== 'string' ||
        !/^#[a-f0-9]{6}$/i.test(v.color) ||
        (v.midpoint !== undefined &&
          (typeof v.midpoint !== 'number' ||
            !Number.isFinite(v.midpoint) ||
            v.midpoint < 0 ||
            v.midpoint > 1))
      )
        throw new Error('Некорректная цветовая точка градиента')
      const stop: GradientStop = {
        position: quantize(v.position),
        color: v.color.toLowerCase(),
      }
      if (v.midpoint !== undefined && Math.abs(v.midpoint - 0.5) > 1e-9)
        stop.midpoint = quantize(clamp01(v.midpoint))
      return stop
    })
    .sort((a, b) => a.position - b.position)
  if (stops.some((s, i) => i && s.position === stops[i - 1].position))
    throw new Error('Цветовые точки должны иметь разные позиции (шаг 1/4096)')
  return stops
}
export function parseGradientOpacityStops(input: unknown): GradientOpacityStop[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_GRADIENT_OPACITY_STOPS)
    throw new Error('Градиент: от 2 до 16 точек прозрачности')
  const stops = input
    .map((v) => {
      if (
        !v ||
        typeof v !== 'object' ||
        typeof v.position !== 'number' ||
        !Number.isFinite(v.position) ||
        v.position < 0 ||
        v.position > 1 ||
        typeof v.opacity !== 'number' ||
        !Number.isFinite(v.opacity) ||
        (v.midpoint !== undefined &&
          (typeof v.midpoint !== 'number' ||
            !Number.isFinite(v.midpoint) ||
            v.midpoint < 0 ||
            v.midpoint > 1))
      )
        throw new Error('Некорректная точка прозрачности градиента')
      const stop: GradientOpacityStop = {
        position: quantize(v.position),
        opacity: quantize(clamp01(v.opacity)),
      }
      if (v.midpoint !== undefined && Math.abs(v.midpoint - 0.5) > 1e-9)
        stop.midpoint = quantize(clamp01(v.midpoint))
      return stop
    })
    .sort((a, b) => a.position - b.position)
  if (stops.some((s, i) => i && s.position === stops[i - 1].position))
    throw new Error('Точки прозрачности должны иметь разные позиции (шаг 1/4096)')
  return stops
}
export const opaqueOpacityStops = (): GradientOpacityStop[] => [
  { position: 0, opacity: 1 },
  { position: 1, opacity: 1 },
]
const channelBounds = (input: unknown, fallback: number): number[] => {
  const values = Array.isArray(input) ? input : []
  return [0, 1, 2, 3].map((i) => {
    const v = values[i]
    return quantize(typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback)
  })
}
export function defaultNoiseSpec(): NoiseGradientSpec {
  return {
    roughness: 0.5,
    model: 'rgb',
    seed: 777,
    min: [0, 0, 0, 0],
    max: [1, 1, 1, 1],
    restrictColors: false,
    transparency: false,
  }
}
export function parseNoiseGradientSpec(input: unknown): NoiseGradientSpec {
  if (!input || typeof input !== 'object') return defaultNoiseSpec()
  const v = input as Record<string, unknown>
  const spec = defaultNoiseSpec()
  if (typeof v.roughness === 'number' && Number.isFinite(v.roughness))
    spec.roughness = quantize(clamp01(v.roughness))
  if (v.model === 'rgb' || v.model === 'hsb' || v.model === 'lab') spec.model = v.model
  if (typeof v.seed === 'number' && Number.isFinite(v.seed))
    spec.seed = Math.floor(Math.abs(v.seed)) % 4294967296
  spec.min = channelBounds(v.min, 0)
  spec.max = channelBounds(v.max, 1)
  for (let i = 0; i < 4; i++) if (spec.max[i] < spec.min[i]) spec.max[i] = spec.min[i]
  spec.restrictColors = v.restrictColors === true
  spec.transparency = v.transparency === true
  return spec
}
export function solidGradient(
  stops: GradientStop[],
  opacityStops: GradientOpacityStop[] = opaqueOpacityStops(),
  name = 'Градиент',
): GradientDefinition {
  return {
    name,
    kind: 'solid',
    stops: parseGradientStops(stops),
    opacityStops: parseGradientOpacityStops(opacityStops),
  }
}
export function parseGradientDefinition(input: unknown): GradientDefinition {
  if (!input || typeof input !== 'object') throw new Error('Некорректный градиент')
  if (JSON.stringify(input).length > 8000) throw new Error('Слишком большой градиент')
  const v = input as Record<string, unknown>
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : 'Градиент'
  const stops = parseGradientStops(v.stops)
  const opacityStops =
    v.opacityStops === undefined ? opaqueOpacityStops() : parseGradientOpacityStops(v.opacityStops)
  if (v.kind === 'noise')
    return { name, kind: 'noise', stops, opacityStops, noise: parseNoiseGradientSpec(v.noise) }
  return { name, kind: 'solid', stops, opacityStops }
}

const compiled = new WeakMap<
  GradientStop[],
  { positions: number[]; colors: number[][]; midpoints: number[] }
>()
const compiledOpacity = new WeakMap<
  GradientOpacityStop[],
  { positions: number[]; opacities: number[]; midpoints: number[] }
>()
/** Index of the stop at or before t; positions are sorted and non-empty. Allocation-free. */
function segmentIndex(positions: number[], t: number): number {
  let lo = 0,
    hi = positions.length - 1
  if (t <= positions[0]) return 0
  if (t >= positions[hi]) return Math.max(0, hi - 1)
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (positions[mid] > t) hi = mid
    else lo = mid
  }
  return lo
}
export function gradientColor(stops: GradientStop[], value: number, out: number[]) {
  let data = compiled.get(stops)
  if (!data) {
    data = {
      positions: stops.map((s) => s.position),
      colors: stops.map((s) => rgbFromHex(s.color)),
      midpoints: stops.map((s) => s.midpoint ?? 0.5),
    }
    compiled.set(stops, data)
  }
  const t = clamp01(value),
    lo = segmentIndex(data.positions, t),
    hi = Math.min(data.positions.length - 1, lo + 1)
  const raw =
    data.positions[hi] === data.positions[lo]
      ? 0
      : Math.max(
          0,
          Math.min(1, (t - data.positions[lo]) / (data.positions[hi] - data.positions[lo])),
        )
  const f = warpMidpoint(raw, data.midpoints[lo])
  for (let c = 0; c < 3; c++)
    out[c] = data.colors[lo][c] + (data.colors[hi][c] - data.colors[lo][c]) * f
}
export function gradientOpacityAt(stops: GradientOpacityStop[], value: number): number {
  let data = compiledOpacity.get(stops)
  if (!data) {
    data = {
      positions: stops.map((s) => s.position),
      opacities: stops.map((s) => s.opacity),
      midpoints: stops.map((s) => s.midpoint ?? 0.5),
    }
    compiledOpacity.set(stops, data)
  }
  const t = clamp01(value),
    lo = segmentIndex(data.positions, t),
    hi = Math.min(data.positions.length - 1, lo + 1)
  const raw =
    data.positions[hi] === data.positions[lo]
      ? 0
      : Math.max(
          0,
          Math.min(1, (t - data.positions[lo]) / (data.positions[hi] - data.positions[lo])),
        )
  const f = warpMidpoint(raw, data.midpoints[lo])
  return data.opacities[lo] + (data.opacities[hi] - data.opacities[lo]) * f
}

/** Deterministic PRNG so a noise gradient is reproducible from its seed alone. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hsvToRgb(h: number, s: number, v: number, out: number[]) {
  const hue = ((h % 1) + 1) % 1,
    i = Math.floor(hue * 6),
    f = hue * 6 - i,
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0:
      out[0] = v
      out[1] = t
      out[2] = p
      break
    case 1:
      out[0] = q
      out[1] = v
      out[2] = p
      break
    case 2:
      out[0] = p
      out[1] = v
      out[2] = t
      break
    case 3:
      out[0] = p
      out[1] = q
      out[2] = v
      break
    case 4:
      out[0] = t
      out[1] = p
      out[2] = v
      break
    default:
      out[0] = v
      out[1] = p
      out[2] = q
  }
}
/** CIE Lab (D65) fractions: L 0..1 -> 0..100, a/b 0..1 -> -128..127. */
function labToRgb(l: number, a: number, b: number, out: number[]) {
  const L = l * 100,
    A = a * 255 - 128,
    B = b * 255 - 128
  const fy = (L + 16) / 116,
    fx = fy + A / 500,
    fz = fy - B / 200
  const inv = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29))
  const x = inv(fx) * 0.95047,
    y = inv(fy),
    z = inv(fz) * 1.08883
  const encode = (linear: number) => {
    const c = Math.max(0, linear)
    return clamp01(c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  }
  out[0] = encode(x * 3.2404542 + y * -1.5371385 + z * -0.4985314)
  out[1] = encode(x * -0.969266 + y * 1.8760108 + z * 0.041556)
  out[2] = encode(x * 0.0556434 + y * -0.2040259 + z * 1.0572252)
}
function modelToRgb(model: GradientColorModel, c0: number, c1: number, c2: number, out: number[]) {
  if (model === 'hsb') hsvToRgb(c0, c1, c2, out)
  else if (model === 'lab') labToRgb(c0, c1, c2, out)
  else {
    out[0] = c0
    out[1] = c1
    out[2] = c2
  }
}
const noiseCache = new Map<string, number[][]>()
/**
 * Independent seeded noise model (not Adobe's algorithm): pseudorandom control
 * colors inside the per-channel ranges, interpolated in the model space.
 * Roughness raises the control density and hardens each transition.
 */
export function noiseControlColors(spec: NoiseGradientSpec): number[][] {
  const key = JSON.stringify(spec)
  const hit = noiseCache.get(key)
  if (hit) return hit
  const count = Math.round(3 + spec.roughness * 61)
  const random = mulberry32(spec.seed)
  const colors: number[][] = []
  for (let i = 0; i < count; i++) {
    const color = [0, 1, 2, 3].map((c) => {
      const lo = spec.min[c],
        hi = spec.max[c]
      if (spec.restrictColors && c < 3) return random() < 0.5 ? lo : hi
      return lo + random() * (hi - lo)
    })
    colors.push(color)
  }
  if (noiseCache.size > 32) noiseCache.clear()
  noiseCache.set(key, colors)
  return colors
}
export function noiseGradientColor(spec: NoiseGradientSpec, value: number, out: number[]) {
  const colors = noiseControlColors(spec)
  const t = clamp01(value) * (colors.length - 1)
  const lo = Math.min(colors.length - 2, Math.floor(t)),
    raw = t - lo
  // Smooth at low roughness, approaching a hard switch at high roughness.
  const stretched = clamp01(0.5 + (raw - 0.5) * (1 + spec.roughness * 7))
  const f = stretched * stretched * (3 - 2 * stretched),
    a = colors[lo],
    b = colors[lo + 1]
  modelToRgb(
    spec.model,
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
    out,
  )
  out[3] = spec.transparency ? a[3] + (b[3] - a[3]) * f : 1
}
/** Sample any gradient as straight RGBA fractions 0..1. */
export function gradientSample(definition: GradientDefinition, value: number, out: number[]) {
  const t = clamp01(value)
  if (definition.kind === 'noise' && definition.noise) {
    noiseGradientColor(definition.noise, t, out)
    out[3] *= gradientOpacityAt(definition.opacityStops, t)
    return
  }
  gradientColor(definition.stops, t, out)
  out[3] = gradientOpacityAt(definition.opacityStops, t)
}
/** Reused synchronously to build a CSS string; never retained across calls. */
const sampleScratch = [0, 0, 0, 1]
export function gradientRgbaCss(definition: GradientDefinition, value: number): string {
  gradientSample(definition, value, sampleScratch)
  return `rgba(${Math.round(sampleScratch[0] * 255)},${Math.round(sampleScratch[1] * 255)},${Math.round(sampleScratch[2] * 255)},${Math.round(sampleScratch[3] * 1000) / 1000})`
}
/** CSS preview built from real samples, so noise/alpha/midpoints are not decorative. */
export function gradientCss(definition: GradientDefinition, angle = 90, samples = 24): string {
  const stops: string[] = []
  for (let i = 0; i <= samples; i++)
    stops.push(
      `${gradientRgbaCss(definition, i / samples)} ${Math.round((i / samples) * 10000) / 100}%`,
    )
  return `linear-gradient(${angle}deg,${stops.join(',')})`
}
/** Feed a CanvasGradient from real samples (premultiplied by the canvas itself). */
export function applyGradientStops(
  gradient: CanvasGradient,
  definition: GradientDefinition,
  reverse = false,
) {
  const samples = definition.kind === 'noise' ? 96 : 48
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    gradient.addColorStop(t, gradientRgbaCss(definition, reverse ? 1 - t : t))
  }
}
/** Mirror a 0..1 sample position for reflected gradients. */
export const reflectPosition = (t: number) => 1 - Math.abs(1 - 2 * clamp01(t))

export const gradientPresets: { name: string; stops: GradientStop[] }[] = [
  {
    name: 'Чёрный / белый',
    stops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
  },
  {
    name: 'Сумерки',
    stops: [
      { position: 0, color: '#152546' },
      { position: 0.5, color: '#927397' },
      { position: 1, color: '#ffe4bb' },
    ],
  },
  {
    name: 'Медь',
    stops: [
      { position: 0, color: '#261b2b' },
      { position: 0.5, color: '#b46b52' },
      { position: 1, color: '#fff1c4' },
    ],
  },
  {
    name: 'Холодный свет',
    stops: [
      { position: 0, color: '#091e37' },
      { position: 0.5, color: '#4d9ca6' },
      { position: 1, color: '#dff8ed' },
    ],
  },
]
export const gradientDefinitionPresets: GradientDefinition[] = [
  solidGradient(gradientPresets[0].stops, opaqueOpacityStops(), 'Чёрный → белый'),
  solidGradient(
    [
      { position: 0, color: '#7c5cff' },
      { position: 0.55, color: '#00c2ff' },
      { position: 1, color: '#00ffa3' },
    ],
    opaqueOpacityStops(),
    'ULTRA спектр',
  ),
  solidGradient(
    [
      { position: 0, color: '#ffffff' },
      { position: 1, color: '#ffffff' },
    ],
    [
      { position: 0, opacity: 1 },
      { position: 1, opacity: 0 },
    ],
    'Белый → прозрачный',
  ),
  solidGradient(
    [
      { position: 0, color: '#ffd166', midpoint: 0.25 },
      { position: 0.5, color: '#ff5c39', midpoint: 0.75 },
      { position: 1, color: '#7c1d5c' },
    ],
    opaqueOpacityStops(),
    'Закат со сдвигом середины',
  ),
  {
    name: 'Шум RGB 777',
    kind: 'noise',
    stops: gradientPresets[0].stops,
    opacityStops: opaqueOpacityStops(),
    noise: { ...defaultNoiseSpec(), roughness: 0.65, seed: 777 },
  },
  {
    name: 'Шум HSB радуга',
    kind: 'noise',
    stops: gradientPresets[0].stops,
    opacityStops: opaqueOpacityStops(),
    noise: {
      ...defaultNoiseSpec(),
      model: 'hsb',
      roughness: 0.35,
      seed: 42,
      min: [0, 0.55, 0.55, 0],
      max: [1, 1, 1, 1],
    },
  },
]
