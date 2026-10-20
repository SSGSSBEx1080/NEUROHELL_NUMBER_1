import type { EffectContourDefinition, EffectContourPoint } from '../types'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
export const MAX_EFFECT_CONTOUR_POINTS = 32
export const CUSTOM_EFFECT_CONTOUR_NAME = 'Пользовательский'
const clonePoints = (points: EffectContourPoint[]) => points.map((p) => ({ ...p }))

export function linearEffectContour(): EffectContourDefinition {
  return {
    name: 'Линейный',
    points: [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
  }
}

const sampled = (name: string, fn: (x: number) => number): EffectContourDefinition => ({
  name,
  points: Array.from({ length: 9 }, (_, i) => {
    const x = i / 8
    return { x: byte(x * 255), y: byte(clamp01(fn(x)) * 255) }
  }),
})

/** Own mathematical presets; imported PSD curve names/points are preserved separately. */
export const effectContourPresets: EffectContourDefinition[] = [
  linearEffectContour(),
  sampled('S-кривая', (x) => x * x * (3 - 2 * x)),
  sampled('Полукруг', (x) => Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)))),
  {
    name: 'Конус',
    points: [
      { x: 0, y: 0 },
      { x: 128, y: 255 },
      { x: 255, y: 0 },
    ],
  },
  {
    name: 'Обратный конус',
    points: [
      { x: 0, y: 255 },
      { x: 128, y: 0 },
      { x: 255, y: 255 },
    ],
  },
  {
    name: 'Двойное кольцо',
    points: [
      { x: 0, y: 0 },
      { x: 64, y: 255 },
      { x: 128, y: 0 },
      { x: 191, y: 255 },
      { x: 255, y: 0 },
    ],
  },
  {
    name: 'Нисходящий',
    points: [
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ],
  },
  {
    name: 'Ступени',
    points: [
      { x: 0, y: 0 },
      { x: 62, y: 0 },
      { x: 66, y: 85 },
      { x: 126, y: 85 },
      { x: 130, y: 170 },
      { x: 190, y: 170 },
      { x: 194, y: 255 },
      { x: 255, y: 255 },
    ],
  },
]

export const cloneEffectContour = (
  definition: EffectContourDefinition,
): EffectContourDefinition => ({
  name: definition.name,
  points: clonePoints(definition.points),
})

export function effectContourPreset(name: string): EffectContourDefinition {
  const preset = effectContourPresets.find((item) => item.name === name)
  return preset ? cloneEffectContour(preset) : linearEffectContour()
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

function cleanContourName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const clean = v
    .replace(/(?:\\0|\0)+$/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 80)
  return clean || fallback
}

function downsample(points: EffectContourPoint[], max: number): EffectContourPoint[] {
  if (points.length <= max) return points
  const result: EffectContourPoint[] = []
  for (let i = 0; i < max; i++) {
    const point = points[Math.round((i * (points.length - 1)) / (max - 1))]
    if (!result.length || result[result.length - 1].x !== point.x) result.push(point)
  }
  return result
}

/** Single validation gateway for project, library, action and PSD contour curves. */
export function parseEffectContour(
  input: unknown,
  fallback: EffectContourDefinition = linearEffectContour(),
): EffectContourDefinition {
  const value = record(input)
  if (!value) return cloneEffectContour(fallback)
  const raw = Array.isArray(value.points)
    ? value.points
    : Array.isArray(value.curve)
      ? value.curve
      : []
  const byX = new Map<number, EffectContourPoint>()
  for (const item of raw.slice(0, 128)) {
    const point = record(item)
    if (!point) continue
    const x =
      typeof point.x === 'number' ? point.x : typeof point.input === 'number' ? point.input : NaN
    const y =
      typeof point.y === 'number' ? point.y : typeof point.output === 'number' ? point.output : NaN
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const clean = { x: byte(x), y: byte(y) }
    byX.set(clean.x, clean)
  }
  const points = downsample(
    [...byX.values()].sort((a, b) => a.x - b.x),
    MAX_EFFECT_CONTOUR_POINTS,
  )
  if (points.length < 2) return cloneEffectContour(fallback)
  return {
    name: cleanContourName(value.name, fallback.name),
    points,
  }
}

function sampleRaw(definition: EffectContourDefinition, u: number): number {
  const points = definition.points
  if (!points.length) return clamp01(u)
  const x = clamp01(u) * 255
  if (x <= points[0].x) return points[0].y / 255
  const last = points[points.length - 1]
  if (x >= last.x) return last.y / 255
  for (let i = 1; i < points.length; i++) {
    const right = points[i]
    if (x > right.x) continue
    const left = points[i - 1]
    const span = Math.max(1, right.x - left.x)
    return (left.y + ((right.y - left.y) * (x - left.x)) / span) / 255
  }
  return last.y / 255
}

/** Optional antialiasing is a three-tap average one byte either side of the input. */
export function sampleEffectContour(
  definition: EffectContourDefinition | undefined,
  u: number,
  antialiased = false,
): number {
  if (!definition) return clamp01(u)
  const value = clamp01(u)
  if (!antialiased) return sampleRaw(definition, value)
  const step = 1 / 255
  return clamp01(
    (sampleRaw(definition, Math.max(0, value - step)) +
      sampleRaw(definition, value) +
      sampleRaw(definition, Math.min(1, value + step))) /
      3,
  )
}

export function isLinearEffectContour(definition?: EffectContourDefinition): boolean {
  if (!definition) return true
  const points = definition.points
  if (!points.length) return true
  const first = points[0]
  const last = points[points.length - 1]
  return (
    first.x <= 1 &&
    first.y <= 1 &&
    last.x >= 254 &&
    last.y >= 254 &&
    points.every((point) => Math.abs(point.y - point.x) <= 1)
  )
}

export function contourWithEditorEndpoints(
  definition: EffectContourDefinition,
): EffectContourDefinition {
  const points = clonePoints(definition.points)
  if (!points.length || points[0].x > 0)
    points.unshift({ x: 0, y: byte(sampleRaw(definition, 0) * 255) })
  if (points[points.length - 1].x < 255)
    points.push({ x: 255, y: byte(sampleRaw(definition, 1) * 255) })
  return { name: definition.name, points }
}

export function matchingContourPreset(
  definition: EffectContourDefinition,
): EffectContourDefinition | undefined {
  const key = JSON.stringify(definition.points)
  return effectContourPresets.find((preset) => JSON.stringify(preset.points) === key)
}

function editorContourPoints(definition: EffectContourDefinition): EffectContourPoint[] {
  const withEndpoints = contourWithEditorEndpoints(parseEffectContour(definition)).points
  return downsample(withEndpoints, MAX_EFFECT_CONTOUR_POINTS)
}

function finishEditedContour(points: EffectContourPoint[]): EffectContourDefinition {
  const custom = parseEffectContour({ name: CUSTOM_EFFECT_CONTOUR_NAME, points })
  const preset = matchingContourPreset(custom)
  return preset ? cloneEffectContour(preset) : custom
}

/**
 * Point-editor operations. The first/last editor points remain at input 0 and
 * 255 (their outputs may move), interior inputs stay strictly ordered, and an
 * edited curve is named either by an exactly matching preset or as custom.
 * An imported PSD name therefore cannot survive silently after its points move.
 */
export function moveEffectContourPoint(
  definition: EffectContourDefinition,
  index: number,
  point: EffectContourPoint,
): EffectContourDefinition {
  const points = editorContourPoints(definition)
  if (!Number.isInteger(index) || index < 0 || index >= points.length)
    return parseEffectContour(definition)
  const previous = points[index - 1],
    next = points[index + 1]
  const minX = index === 0 ? 0 : (previous?.x ?? 0) + 1
  const maxX = index === points.length - 1 ? 255 : (next?.x ?? 255) - 1
  points[index] = {
    x:
      index === 0
        ? 0
        : index === points.length - 1
          ? 255
          : Math.max(
              minX,
              Math.min(maxX, byte(Number.isFinite(point.x) ? point.x : points[index].x)),
            ),
    y: byte(Number.isFinite(point.y) ? point.y : points[index].y),
  }
  return finishEditedContour(points)
}

export function addEffectContourPoint(
  definition: EffectContourDefinition,
  point: EffectContourPoint,
): { contour: EffectContourDefinition; index: number } {
  const points = editorContourPoints(definition)
  const clean = {
    x: Math.max(1, Math.min(254, byte(Number.isFinite(point.x) ? point.x : 128))),
    y: byte(Number.isFinite(point.y) ? point.y : 128),
  }
  const existing = points.findIndex((candidate) => candidate.x === clean.x)
  if (existing >= 0) {
    points[existing] = clean
    return { contour: finishEditedContour(points), index: existing }
  }
  if (points.length >= MAX_EFFECT_CONTOUR_POINTS)
    return { contour: parseEffectContour(definition), index: points.length - 1 }
  const index = points.findIndex((candidate) => candidate.x > clean.x)
  const insertion = index < 0 ? points.length - 1 : index
  points.splice(insertion, 0, clean)
  return { contour: finishEditedContour(points), index: insertion }
}

export function removeEffectContourPoint(
  definition: EffectContourDefinition,
  index: number,
): EffectContourDefinition {
  const points = editorContourPoints(definition)
  if (points.length <= 2 || !Number.isInteger(index) || index <= 0 || index >= points.length - 1)
    return parseEffectContour(definition)
  points.splice(index, 1)
  return finishEditedContour(points)
}

/**
 * Alpha LUT for shadows/glows. Range 0.5 is neutral in this engine: smaller
 * ranges traverse the contour sooner, larger ranges use only its first part.
 */
export function buildContourAlphaLut(
  definition: EffectContourDefinition | undefined,
  antialiased = false,
  range = 0.5,
): Uint8Array {
  const lut = new Uint8Array(256)
  const safeRange = Math.max(0.01, Math.min(1, Number.isFinite(range) ? range : 0.5))
  for (let i = 0; i < 256; i++) {
    const input = clamp01(i / 255 / (safeRange * 2))
    lut[i] = byte(sampleEffectContour(definition, input, antialiased) * 255)
  }
  return lut
}
