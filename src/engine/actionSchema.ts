import { parseShapePaths } from './shapeGeometry'
import { parseCorrection } from './adjustmentTypes'
import type { Adjustments, Layer, LayerStyles, TextFrame } from '../types'
import { normalizeStyles } from './styles'
import { parseTextFrame } from './textLayout'
export type ActionProperties = Partial<
  Pick<
    Layer,
    | 'correction'
    | 'name'
    | 'visible'
    | 'opacity'
    | 'blendMode'
    | 'color'
    | 'text'
    | 'fontFamily'
    | 'fontSize'
    | 'fontWeight'
    | 'italic'
    | 'textAlign'
    | 'lineHeight'
    | 'letterSpacing'
    | 'textScaleX'
    | 'shape'
    | 'shapeFill'
    | 'shapePaths'
    | 'cornerRadii'
    | 'sides'
    | 'starRatio'
    | 'strokeAlign'
    | 'strokeCap'
    | 'strokeJoin'
    | 'strokeMiterLimit'
    | 'strokeDash'
    | 'strokeDashOffset'
    | 'radius'
    | 'strokeColor'
    | 'strokeWidth'
    | 'flipX'
    | 'flipY'
  >
> & { styles?: LayerStyles | null; textFrame?: TextFrame | null }
export type ActionCommand =
  | { type: 'adjust'; values: Partial<Adjustments> }
  | { type: 'invert' | 'flipX' | 'flipY' | 'reset' | 'delete' }
  | { type: 'duplicate'; offset?: { x: number; y: number } }
  | { type: 'rotate'; angle: number }
  | { type: 'properties'; values: ActionProperties }
  | { type: 'transform'; dx: number; dy: number; scaleX: number; scaleY: number; angle: number }
  | { type: 'select'; offset: number }
export const adjustmentLimits: Record<keyof Adjustments, [number, number]> = {
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  blur: [0, 30],
  hue: [-180, 180],
  grayscale: [0, 100],
  sepia: [0, 100],
  invert: [0, 100],
}
const numeric: Record<string, [number, number]> = {
  opacity: [0, 1],
  fontSize: [4, 1000],
  fontWeight: [100, 900],
  lineHeight: [0.5, 4],
  letterSpacing: [-30, 100],
  textScaleX: [0.01, 100],
  sides: [3, 64],
  starRatio: [0.02, 0.98],
  strokeMiterLimit: [1, 20],
  strokeDashOffset: [-2000, 2000],
  radius: [0, 2000],
  strokeWidth: [0, 200],
}
const enums: Record<string, readonly string[]> = {
  shape: ['rectangle', 'ellipse', 'polygon', 'star', 'line', 'path'],
  strokeAlign: ['inside', 'center', 'outside'],
  strokeCap: ['butt', 'round', 'square'],
  strokeJoin: ['miter', 'round', 'bevel'],
  textAlign: ['left', 'center', 'right'],
  blendMode: [
    'source-over',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'soft-light',
    'difference',
    'hard-light',
    'color-dodge',
    'color-burn',
    'exclusion',
    'hue',
    'saturation',
    'color',
    'luminosity',
    'lighter',
  ],
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`Значение шага должно быть от ${min} до ${max}`)
  return v
}
export function parseActionProperties(input: unknown): ActionProperties {
  if (!object(input) || Object.keys(input).length > 50)
    throw new Error('Некорректные свойства операции')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'correction') out[key] = parseCorrection(value)
    else if (Object.hasOwn(numeric, key)) out[key] = finite(value, ...numeric[key])
    else if (Object.hasOwn(enums, key) && typeof value === 'string' && enums[key].includes(value))
      out[key] = value
    else if (
      ['visible', 'italic', 'flipX', 'flipY', 'shapeFill'].includes(key) &&
      typeof value === 'boolean'
    )
      out[key] = value
    else if (
      ['color', 'strokeColor'].includes(key) &&
      typeof value === 'string' &&
      /^#[\da-f]{6}$/i.test(value)
    )
      out[key] = value
    else if (key === 'shapePaths') {
      const paths = parseShapePaths(value)
      if (!paths || paths.reduce((n, p) => n + p.knots.length, 0) > 2048)
        throw new Error('Операция контура: до 2048 узлов')
      out[key] = paths
    } else if (key === 'cornerRadii' && Array.isArray(value) && value.length === 4)
      out[key] = value.map((v) => finite(v, 0, 2000))
    else if (key === 'strokeDash' && Array.isArray(value) && value.length <= 16)
      out[key] = value.map((v) => finite(v, 0, 2000))
    else if (key === 'text' && typeof value === 'string' && value.length <= 20000) out[key] = value
    else if (key === 'name' && typeof value === 'string' && value.length <= 100) out[key] = value
    else if (
      key === 'fontFamily' &&
      typeof value === 'string' &&
      value.length <= 160 &&
      !/[\x00-\x1f\";{}<>]/.test(value)
    )
      out[key] = value
    else if (key === 'styles' && (value === null || object(value))) {
      if (value && JSON.stringify(value).length > 24000)
        throw new Error('Слишком большой стиль операции')
      out[key] = value === null ? null : normalizeStyles(value)
    } else if (key === 'textFrame' && (value === null || object(value)))
      out[key] = value === null ? null : parseTextFrame(value)
    else throw new Error(`Неподдерживаемое свойство операции: ${key.slice(0, 60)}`)
  }
  return out as ActionProperties
}
/** Unknown command types become blockers, not executable extensions. Invalid known commands fail import. */
export function parseActionCommand(input: unknown): ActionCommand | undefined {
  if (!object(input)) return undefined
  const c = input
  if (c.type === 'properties')
    return { type: 'properties', values: parseActionProperties(c.values) }
  if (c.type === 'adjust') {
    if (!object(c.values)) throw new Error('Некорректная цветокоррекция в операции')
    const values: Partial<Adjustments> = {}
    for (const [key, value] of Object.entries(c.values)) {
      if (
        !Object.hasOwn(adjustmentLimits, key) ||
        typeof value !== 'number' ||
        !Number.isFinite(value)
      )
        throw new Error('Некорректная цветокоррекция в операции')
      const [min, max] = adjustmentLimits[key as keyof Adjustments]
      values[key as keyof Adjustments] = Math.max(min, Math.min(max, value))
    }
    return { type: 'adjust', values }
  }
  if (c.type === 'rotate') return { type: 'rotate', angle: finite(c.angle, -36000, 36000) % 360 }
  if (c.type === 'select') {
    const offset = finite(c.offset, -99, 99)
    if (!Number.isInteger(offset)) throw new Error('Смещение выбора слоя должно быть целым')
    return { type: 'select', offset }
  }
  if (c.type === 'transform')
    return {
      type: 'transform',
      dx: finite(c.dx, -32768, 32768),
      dy: finite(c.dy, -32768, 32768),
      scaleX: finite(c.scaleX, 0.01, 100),
      scaleY: finite(c.scaleY, 0.01, 100),
      angle: finite(c.angle, -720, 720),
    }
  if (c.type === 'duplicate') {
    if (c.offset !== undefined && !object(c.offset)) throw new Error('Некорректное смещение копии')
    return {
      type: 'duplicate',
      ...(object(c.offset)
        ? { offset: { x: finite(c.offset.x, -32768, 32768), y: finite(c.offset.y, -32768, 32768) } }
        : {}),
    }
  }
  if (['invert', 'flipX', 'flipY', 'reset', 'delete'].includes(String(c.type)))
    return { type: c.type as 'invert' }
  return undefined
}
