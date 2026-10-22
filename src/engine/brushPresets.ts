import type { SampleInfo } from 'ag-psd'
import type { BrushTipDefinition, ToolSettings } from '../types'

export type BrushPresetSettings = Partial<
  Pick<
    ToolSettings,
    | 'brushSize'
    | 'brushOpacity'
    | 'brushHardness'
    | 'brushSpacing'
    | 'brushSmoothing'
    | 'pressureSize'
    | 'pressureOpacity'
    | 'brushAngle'
    | 'brushRoundness'
    | 'brushFlipX'
    | 'brushFlipY'
    | 'brushMinimumDiameter'
    | 'brushMinimumRoundness'
    | 'brushMinimumOpacity'
    | 'brushSizeJitter'
    | 'brushOpacityJitter'
    | 'brushAngleJitter'
    | 'brushRoundnessJitter'
    | 'brushAngleControl'
    | 'brushFlipXJitter'
    | 'brushFlipYJitter'
    | 'brushScatter'
    | 'brushScatterBothAxes'
    | 'brushScatterCount'
    | 'brushCountJitter'
  >
>

export interface BrushPreset {
  id: string
  name: string
  source: 'builtin' | 'library' | 'abr' | 'image'
  tip?: BrushTipDefinition
  settings: BrushPresetSettings
  unsupported?: string[]
}

export interface AbrImportedPreset {
  id: string
  name: string
  settings: BrushPresetSettings
  sample?: SampleInfo
  unsupported: string[]
}

export interface AbrImportResult {
  presets: AbrImportedPreset[]
  warnings: string[]
  patternCount: number
}

export const MAX_ABR_BYTES = 96 * 1024 * 1024
export const MAX_BRUSH_TIP_EDGE = 512
export const MAX_BRUSH_TIP_PIXELS = 262_144

export const clampBrushNumber = (value: number, min: number, max: number, fallback = min) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

let fallbackId = 0
export const brushPresetId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `brush-${Date.now()}-${++fallbackId}`

export function sanitizeBrushPresetSettings(input: unknown): BrushPresetSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>,
    out: Record<string, unknown> = {},
    numbers: Record<string, [number, number]> = {
      brushSize: [1, 500],
      brushOpacity: [1, 100],
      brushHardness: [0, 100],
      brushSpacing: [1, 1000],
      brushSmoothing: [0, 100],
      brushAngle: [-180, 180],
      brushRoundness: [1, 100],
      brushMinimumDiameter: [0, 100],
      brushMinimumRoundness: [1, 100],
      brushMinimumOpacity: [0, 100],
      brushSizeJitter: [0, 100],
      brushOpacityJitter: [0, 100],
      brushAngleJitter: [0, 100],
      brushRoundnessJitter: [0, 100],
      brushScatter: [0, 1000],
      brushScatterCount: [1, 16],
      brushCountJitter: [0, 100],
    },
    booleans = [
      'pressureSize',
      'pressureOpacity',
      'brushFlipX',
      'brushFlipY',
      'brushFlipXJitter',
      'brushFlipYJitter',
      'brushScatterBothAxes',
    ]
  for (const [key, [min, max]] of Object.entries(numbers))
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key]))
      out[key] =
        key === 'brushScatterCount'
          ? Math.round(clampBrushNumber(raw[key] as number, min, max))
          : clampBrushNumber(raw[key] as number, min, max)
  for (const key of booleans) if (typeof raw[key] === 'boolean') out[key] = raw[key]
  if (
    raw.brushAngleControl === 'direction' ||
    raw.brushAngleControl === 'initial' ||
    raw.brushAngleControl === 'off'
  )
    out.brushAngleControl = raw.brushAngleControl
  return out as BrushPresetSettings
}

const RELEVANT_SETTING_KEYS = [
  'brushSize',
  'brushOpacity',
  'brushHardness',
  'brushSpacing',
  'brushSmoothing',
  'pressureSize',
  'pressureOpacity',
  'brushAngle',
  'brushRoundness',
  'brushFlipX',
  'brushFlipY',
  'brushMinimumDiameter',
  'brushMinimumRoundness',
  'brushMinimumOpacity',
  'brushSizeJitter',
  'brushOpacityJitter',
  'brushAngleJitter',
  'brushRoundnessJitter',
  'brushAngleControl',
  'brushFlipXJitter',
  'brushFlipYJitter',
  'brushScatter',
  'brushScatterBothAxes',
  'brushScatterCount',
  'brushCountJitter',
] as const

export function brushSettingsFromToolSettings(settings: ToolSettings): BrushPresetSettings {
  const out: Record<string, unknown> = {}
  for (const key of RELEVANT_SETTING_KEYS) if (settings[key] !== undefined) out[key] = settings[key]
  return sanitizeBrushPresetSettings(out)
}

/** Applying a preset explicitly resets every dynamics field it does not set. */
export function toolSettingsForBrushPreset(
  preset: BrushPreset,
  current?: Partial<ToolSettings>,
): Partial<ToolSettings> {
  return {
    brushSize: 30,
    // Opacity and smoothing belong to tool presets, not ordinary brush-tip
    // presets. Preserve the user's live values unless the preset sets them.
    brushOpacity: current?.brushOpacity ?? 100,
    brushHardness: 100,
    brushSpacing: 15,
    brushSmoothing: current?.brushSmoothing ?? 0,
    pressureSize: true,
    pressureOpacity: false,
    brushAngle: 0,
    brushRoundness: 100,
    brushFlipX: false,
    brushFlipY: false,
    brushMinimumDiameter: 0,
    brushMinimumRoundness: 25,
    brushMinimumOpacity: 0,
    brushSizeJitter: 0,
    brushOpacityJitter: 0,
    brushAngleJitter: 0,
    brushRoundnessJitter: 0,
    brushAngleControl: 'off',
    brushFlipXJitter: false,
    brushFlipYJitter: false,
    brushScatter: 0,
    brushScatterBothAxes: false,
    brushScatterCount: 1,
    brushCountJitter: 0,
    ...sanitizeBrushPresetSettings(preset.settings),
    brushTip: preset.tip,
  }
}

export const builtinBrushPresets: BrushPreset[] = [
  {
    id: 'builtin-round-hard',
    name: 'Круглая жёсткая',
    source: 'builtin',
    settings: { brushSize: 30, brushHardness: 100, brushSpacing: 15 },
  },
  {
    id: 'builtin-round-soft',
    name: 'Круглая мягкая',
    source: 'builtin',
    settings: { brushSize: 80, brushHardness: 0, brushSpacing: 12 },
  },
  {
    id: 'builtin-calligraphy',
    name: 'Каллиграфическая −35°',
    source: 'builtin',
    settings: { brushSize: 36, brushHardness: 85, brushAngle: -35, brushRoundness: 24 },
  },
  {
    id: 'builtin-scatter-dots',
    name: 'Рассеянные точки',
    source: 'builtin',
    settings: {
      brushSize: 18,
      brushHardness: 90,
      brushSpacing: 55,
      brushSizeJitter: 65,
      brushOpacityJitter: 35,
      brushScatter: 180,
      brushScatterBothAxes: true,
      brushScatterCount: 3,
      brushCountJitter: 35,
    },
  },
]

/** Box-average a brush alpha mask to the local tip budget. */
export function downscaleBrushAlpha(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge = MAX_BRUSH_TIP_EDGE,
  maxPixels = MAX_BRUSH_TIP_PIXELS,
): { alpha: Uint8ClampedArray; width: number; height: number } {
  if (alpha.length !== width * height) throw new Error('Некорректный размер наконечника кисти')
  const scale = Math.min(
    1,
    maxEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  )
  if (scale >= 1) return { alpha: new Uint8ClampedArray(alpha), width, height }
  const outW = Math.max(1, Math.round(width * scale)),
    outH = Math.max(1, Math.round(height * scale)),
    out = new Uint8ClampedArray(outW * outH)
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor((y * height) / outH),
      y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / outH))
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor((x * width) / outW),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / outW))
      let sum = 0,
        count = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          sum += alpha[yy * width + xx]
          count++
        }
      out[y * outW + x] = count ? sum / count : 0
    }
  }
  return { alpha: out, width: outW, height: outH }
}

/**
 * Converts an ordinary image to a brush mask with Photoshop's Define Brush
 * convention: composite over white, then black paints and white does not.
 */
export function rgbaToBrushAlpha(data: Uint8ClampedArray, width: number, height: number) {
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) {
    const o = i * 4,
      a = data[o + 3] / 255,
      luma = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722
    alpha[i] = 255 - (luma * a + 255 * (1 - a))
  }
  return downscaleBrushAlpha(alpha, width, height)
}

export function encodeBrushAlphaTip(
  inputAlpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  name: string,
  id = brushPresetId(),
): BrushTipDefinition {
  const { alpha, width: w, height: h } = downscaleBrushAlpha(inputAlpha, width, height),
    canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!,
    image = ctx.createImageData(w, h)
  for (let i = 0; i < alpha.length; i++) {
    const o = i * 4
    image.data[o] = image.data[o + 1] = image.data[o + 2] = 255
    image.data[o + 3] = alpha[i]
  }
  ctx.putImageData(image, 0, 0)
  return {
    id: id.slice(0, 100),
    name: name.slice(0, 80),
    width: w,
    height: h,
    src: canvas.toDataURL('image/png'),
  }
}

export function brushPresetFromAbrImport(imported: AbrImportedPreset): BrushPreset {
  return {
    id: imported.id,
    name: imported.name,
    source: 'abr',
    settings: imported.settings,
    unsupported: imported.unsupported,
    tip: imported.sample
      ? encodeBrushAlphaTip(
          imported.sample.alpha,
          imported.sample.bounds.w,
          imported.sample.bounds.h,
          imported.name,
          imported.sample.id || imported.id,
        )
      : undefined,
  }
}

export const BRUSH_LIBRARY_KEY = 'fsh777-brush-library'
const MAX_BRUSH_LIBRARY_ITEMS = 64
const MAX_BRUSH_TIP_SRC_LENGTH = 2_000_000

function parseBrushTip(input: unknown): BrushTipDefinition | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as Record<string, unknown>,
    width = raw.width,
    height = raw.height
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    raw.id.length > 100 ||
    typeof raw.name !== 'string' ||
    !raw.name ||
    raw.name.length > 80 ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_BRUSH_TIP_EDGE ||
    height > MAX_BRUSH_TIP_EDGE ||
    width * height > MAX_BRUSH_TIP_PIXELS ||
    typeof raw.src !== 'string' ||
    raw.src.length > MAX_BRUSH_TIP_SRC_LENGTH ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw.src)
  )
    return undefined
  return { id: raw.id, name: raw.name, width, height, src: raw.src }
}

export function parseBrushPreset(input: unknown): BrushPreset | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    raw.id.length > 100 ||
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    raw.name.length > 80 ||
    (raw.source !== undefined &&
      raw.source !== 'builtin' &&
      raw.source !== 'library' &&
      raw.source !== 'abr' &&
      raw.source !== 'image')
  )
    return null
  const tip = raw.tip === undefined ? undefined : parseBrushTip(raw.tip)
  if (raw.tip !== undefined && !tip) return null
  return {
    id: raw.id,
    name: raw.name.trim(),
    source: (raw.source as BrushPreset['source']) || 'library',
    tip,
    settings: sanitizeBrushPresetSettings(raw.settings),
    unsupported: Array.isArray(raw.unsupported)
      ? raw.unsupported.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : undefined,
  }
}

export function parseBrushLibrary(json: string): BrushPreset[] | null {
  try {
    const root = JSON.parse(json) as unknown,
      items = Array.isArray(root)
        ? root
        : root && typeof root === 'object' && Array.isArray((root as { brushes?: unknown }).brushes)
          ? (root as { brushes: unknown[] }).brushes
          : null
    if (!items) return null
    const parsed = items
      .map(parseBrushPreset)
      .filter((x): x is BrushPreset => !!x)
      .slice(0, MAX_BRUSH_LIBRARY_ITEMS)
    return parsed.length === items.length ? parsed : null
  } catch {
    return null
  }
}

export const loadBrushLibrary = (): BrushPreset[] => {
  try {
    return parseBrushLibrary(localStorage.getItem(BRUSH_LIBRARY_KEY) || '[]') || []
  } catch {
    return []
  }
}

export const saveBrushLibrary = (items: BrushPreset[]): boolean => {
  try {
    localStorage.setItem(
      BRUSH_LIBRARY_KEY,
      JSON.stringify({
        kind: 'fsh777-brush-library',
        version: 1,
        brushes: items.slice(0, MAX_BRUSH_LIBRARY_ITEMS),
      }),
    )
    return true
  } catch {
    // The document/current settings never depend on this storage, but callers
    // must not claim persistence after a quota failure.
    return false
  }
}

export const serializeBrushLibrary = (items: BrushPreset[]) =>
  JSON.stringify({ kind: 'fsh777-brush-library', version: 1, brushes: items }, null, 2)
