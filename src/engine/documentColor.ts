import type { EditorDocument, Layer, PatternDefinition } from '../types'
import {
  WORKING_RGB_PROFILE,
  createColorTransform,
  hexToRgbTriplet,
  profilesMatch,
  rgbTripletToHex,
  untaggedDocumentColorProfile,
  workingDocumentColorProfile,
  type ColorProfileModel,
  type RenderingIntent,
} from './colorProfiles'
import { deterministicPatternId } from './patterns'
import { cacheImage, loadImage } from './render'

export type DocumentColorDecisionAction =
  'convert' | 'assign-and-convert' | 'assign-working' | 'discard' | 'leave-untagged'

export interface DocumentColorDecision {
  action: DocumentColorDecisionAction
  /** Embedded profile used by `convert`. */
  source?: ColorProfileModel
  /** Profile the existing colour numbers should be interpreted as before conversion. */
  assigned?: ColorProfileModel
  /** Display name retained in document metadata for non-converting decisions. */
  sourceLabel?: string
  intent?: RenderingIntent
  blackPointCompensation?: boolean
  dither?: boolean
}

const EXCLUDED_KEYS = new Set([
  'id',
  'name',
  'text',
  'src',
  'fontFamily',
  'sourceId',
  'sourcePath',
  'script',
])
const PATTERN_KINDS = new Set(['checker', 'dots', 'stripes', 'diagonal', 'grid', 'noise', 'image'])

function convertHexColors(value: unknown, transform: (hex: string) => string) {
  const seen = new WeakSet<object>()
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 48 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item)) node[index] = transform(item)
        else visit(item, depth + 1)
      })
      return
    }
    const record = node as Record<string, unknown>
    for (const [key, item] of Object.entries(record)) {
      if (EXCLUDED_KEYS.has(key)) continue
      if (typeof item === 'string' && /^#[0-9a-f]{6}$/i.test(item)) record[key] = transform(item)
      else visit(item, depth + 1)
    }
  }
  visit(value, 0)
}

function patternDefinitions(value: unknown): PatternDefinition[] {
  const found: PatternDefinition[] = []
  const seen = new WeakSet<object>()
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 48 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1))
      return
    }
    const record = node as Record<string, unknown>
    if (
      typeof record.kind === 'string' &&
      PATTERN_KINDS.has(record.kind) &&
      typeof record.foreground === 'string' &&
      typeof record.background === 'string' &&
      typeof record.seed === 'number'
    )
      found.push(record as unknown as PatternDefinition)
    Object.values(record).forEach((item) => visit(item, depth + 1))
  }
  visit(value, 0)
  return found
}

async function convertedImageSource(
  src: string,
  transform: ReturnType<typeof createColorTransform>,
): Promise<string> {
  const image = await loadImage(src)
  const width = image.width
  const height = image.height
  if (!width || !height || width * height > 64_000_000)
    throw new Error('Источник слоя слишком большой для преобразования профиля')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas недоступен для преобразования профиля')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height)
  transform.transformPixels(pixels.data, width, height)
  ctx.putImageData(pixels, 0, 0)
  const next = canvas.toDataURL('image/png')
  cacheImage(next, canvas)
  return next
}

async function convertRasterSources(
  doc: EditorDocument,
  transform: ReturnType<typeof createColorTransform>,
) {
  const converted = new Map<string, string>()
  const convert = async (src: string) => {
    if (!converted.has(src)) converted.set(src, await convertedImageSource(src, transform))
    return converted.get(src)!
  }
  const visitLayer = async (layer: Layer) => {
    if (layer.smart) {
      for (const nested of layer.smart.layers) await visitLayer(nested)
      layer.smart.colorProfile = workingDocumentColorProfile()
    }
    if (layer.src && !layer.src.startsWith('mask-preview:')) layer.src = await convert(layer.src)
  }
  for (const layer of doc.layers) await visitLayer(layer)
  for (const pattern of patternDefinitions(doc))
    if (pattern.kind === 'image' && pattern.src) pattern.src = await convert(pattern.src)
}

/**
 * Apply a Photoshop-style open/assign decision in this editor's honest fixed
 * working space. Converting changes raster pixels and every stored #rrggbb
 * colour value; assigning/discarding changes interpretation metadata only.
 */
export async function applyDocumentColorDecision(
  input: EditorDocument,
  decision: DocumentColorDecision,
): Promise<EditorDocument> {
  const doc = structuredClone(input)
  const sourceLabel =
    decision.sourceLabel || decision.source?.name || decision.assigned?.name || undefined

  if (decision.action === 'assign-working') {
    doc.colorProfile = workingDocumentColorProfile(sourceLabel ? { assignedFrom: sourceLabel } : {})
    return doc
  }
  if (decision.action === 'discard' || decision.action === 'leave-untagged') {
    doc.colorProfile = untaggedDocumentColorProfile(
      sourceLabel ? { assignedFrom: sourceLabel } : {},
    )
    return doc
  }

  const source = decision.action === 'assign-and-convert' ? decision.assigned : decision.source
  if (!source) throw new Error('Не задан исходный цветовой профиль для преобразования')
  if (!profilesMatch(source, WORKING_RGB_PROFILE)) {
    const transform = createColorTransform(source, WORKING_RGB_PROFILE, {
      intent: decision.intent || 'relative',
      blackPointCompensation: decision.blackPointCompensation !== false,
      dither: decision.dither,
    })
    const colorTransform = createColorTransform(source, WORKING_RGB_PROFILE, {
      intent: decision.intent || 'relative',
      blackPointCompensation: decision.blackPointCompensation !== false,
      dither: false,
    })
    await convertRasterSources(doc, transform)
    convertHexColors(doc, (hex) => {
      const rgb = hexToRgbTriplet(hex)
      return rgb ? rgbTripletToHex(colorTransform.transformRgb(rgb)) : hex
    })
    for (const pattern of patternDefinitions(doc)) pattern.id = deterministicPatternId(pattern)
  }
  doc.colorProfile = workingDocumentColorProfile({ convertedFrom: source.name })
  return doc
}
