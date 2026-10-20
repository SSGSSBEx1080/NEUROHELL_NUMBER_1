import { mulberry32, rgbFromHex } from './gradientRamp'
import { sourceDimensions } from './imageSafety'
import type { EditorDocument, LayerStyles, PatternDefinition, PatternKind } from '../types'

export const PATTERN_KINDS: PatternKind[] = [
  'checker',
  'dots',
  'stripes',
  'diagonal',
  'grid',
  'noise',
  'image',
]
export const MAX_PATTERN_IMAGE_WIDTH = 2048
export const MAX_PATTERN_IMAGE_HEIGHT = 2048
export const MAX_PATTERN_IMAGE_PIXELS = 4_194_304
const MAX_PATTERN_SRC_LENGTH = 16_000_000

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const color = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v) ? v.toLowerCase() : fallback
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown, fallback: number, min: number, max: number) =>
  finite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

/** PSD writers/readers differ on a trailing NUL (or literal "\0") in pattern names. */
export function cleanPatternName(value: unknown, fallback = 'Узор'): string {
  if (typeof value !== 'string') return fallback
  let name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  while (name.endsWith('\\0')) name = name.slice(0, -2).trim()
  return name ? name.slice(0, 120) : fallback
}
export function cleanPatternId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let id = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  while (id.endsWith('\\0')) id = id.slice(0, -2).trim()
  return id && id.length <= 128 ? id : undefined
}

function hash32(text: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h ^= h >>> 13
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  return h >>> 0
}

/** Pixel-defining fields only; name and PSD housekeeping coordinates are metadata. */
export function patternContentKey(definition: PatternDefinition): string {
  return JSON.stringify([
    definition.kind,
    definition.size,
    definition.foreground,
    definition.background,
    definition.seed,
    definition.src || '',
    definition.width || 0,
    definition.height || 0,
  ])
}

/** Stable UUID-shaped PSD identifier derived from the tile definition. */
export function deterministicPatternId(definition: PatternDefinition): string {
  const key = patternContentKey(definition)
  const hex = [0x811c9dc5, 0x01000193, 0x27d4eb2d, 0x165667b1]
    .map((seed) => hash32(key, seed).toString(16).padStart(8, '0'))
    .join('')
  const variant = '89ab'[parseInt(hex[16], 16) & 3]
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function withDeterministicId(definition: PatternDefinition): PatternDefinition {
  return { ...definition, id: deterministicPatternId(definition) }
}

export function defaultPatternDefinition(): PatternDefinition {
  return withDeterministicId({
    id: '',
    name: 'ULTRA · Клетки',
    kind: 'checker',
    size: 32,
    foreground: '#b6a3ff',
    background: '#241f38',
    seed: 777,
  })
}

export function builtinPatternDefinitions(): PatternDefinition[] {
  const raw: PatternDefinition[] = [
    {
      id: '',
      name: 'ULTRA · Клетки',
      kind: 'checker',
      size: 32,
      foreground: '#b6a3ff',
      background: '#241f38',
      seed: 777,
    },
    {
      id: '',
      name: 'ULTRA · Точки',
      kind: 'dots',
      size: 36,
      foreground: '#fcac79',
      background: '#1c2a44',
      seed: 777,
    },
    {
      id: '',
      name: 'ULTRA · Полосы',
      kind: 'stripes',
      size: 28,
      foreground: '#65f4c2',
      background: '#17251f',
      seed: 777,
    },
    {
      id: '',
      name: 'ULTRA · Диагональ',
      kind: 'diagonal',
      size: 32,
      foreground: '#ffffff',
      background: '#5b4aa5',
      seed: 777,
    },
    {
      id: '',
      name: 'ULTRA · Сетка',
      kind: 'grid',
      size: 32,
      foreground: '#d9d2ff',
      background: '#171521',
      seed: 777,
    },
    {
      id: '',
      name: 'ULTRA · Зерно',
      kind: 'noise',
      size: 64,
      foreground: '#fcac79',
      background: '#171521',
      seed: 777,
    },
  ]
  return raw.map(withDeterministicId)
}

export function parsePatternDefinition(input: unknown): PatternDefinition | undefined {
  const v = record(input)
  if (!v || !PATTERN_KINDS.includes(v.kind as PatternKind)) return undefined
  const kind = v.kind as PatternKind
  const definition: PatternDefinition = {
    id: '',
    name: cleanPatternName(v.name),
    kind,
    size: int(v.size, 32, 4, 512),
    foreground: color(v.foreground, '#b6a3ff'),
    background: color(v.background, '#241f38'),
    seed: finite(v.seed) ? Math.floor(Math.abs(v.seed)) % 4_294_967_296 : 777,
  }
  if (kind === 'image') {
    if (
      typeof v.src !== 'string' ||
      v.src.length > MAX_PATTERN_SRC_LENGTH ||
      !/^data:image\/png;base64,[a-z0-9+/=\s]+$/i.test(v.src)
    )
      return undefined
    let width = int(v.width, 0, 0, MAX_PATTERN_IMAGE_WIDTH)
    let height = int(v.height, 0, 0, MAX_PATTERN_IMAGE_HEIGHT)
    try {
      const actual = sourceDimensions(v.src)
      width = actual.width
      height = actual.height
    } catch {
      return undefined
    }
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_PATTERN_IMAGE_WIDTH ||
      height > MAX_PATTERN_IMAGE_HEIGHT ||
      width * height > MAX_PATTERN_IMAGE_PIXELS
    )
      return undefined
    definition.src = v.src
    definition.width = width
    definition.height = height
    if (finite(v.psdX)) definition.psdX = int(v.psdX, 0, -32768, 32767)
    if (finite(v.psdY)) definition.psdY = int(v.psdY, 0, -32768, 32767)
    if (finite(v.boundsX)) definition.boundsX = int(v.boundsX, 0, -32768, 32767)
    if (finite(v.boundsY)) definition.boundsY = int(v.boundsY, 0, -32768, 32767)
  }
  definition.id = cleanPatternId(v.id) || deterministicPatternId(definition)
  return definition
}

export function createImagePatternDefinition(input: {
  name: unknown
  src: string
  width: number
  height: number
  id?: unknown
  psdX?: number
  psdY?: number
  boundsX?: number
  boundsY?: number
}): PatternDefinition | undefined {
  return parsePatternDefinition({
    id: input.id,
    name: input.name,
    kind: 'image',
    size: 32,
    foreground: '#ffffff',
    background: '#000000',
    seed: 0,
    src: input.src,
    width: input.width,
    height: input.height,
    psdX: input.psdX,
    psdY: input.psdY,
    boundsX: input.boundsX,
    boundsY: input.boundsY,
  })
}

/** Editing a procedural tile makes it a distinct PSD resource; refresh its identity. */
export function withPatternPatch(
  definition: PatternDefinition,
  patch: Partial<PatternDefinition>,
): PatternDefinition {
  const next: PatternDefinition = { ...definition, ...patch }
  if (next.kind !== 'image') {
    delete next.src
    delete next.width
    delete next.height
    delete next.psdX
    delete next.psdY
    delete next.boundsX
    delete next.boundsY
    next.id = deterministicPatternId(next)
  }
  return parsePatternDefinition(next) || definition
}

const tiles = new Map<string, HTMLCanvasElement>()
const loading = new Map<string, Promise<HTMLCanvasElement>>()
const previewUrls = new Map<string, string>()

const tileKey = (definition: PatternDefinition) =>
  `${deterministicPatternId(definition)}:${definition.kind === 'image' ? `${definition.width || 0}x${definition.height || 0}` : definition.size}`

function rememberTile(key: string, canvas: HTMLCanvasElement) {
  tiles.delete(key)
  tiles.set(key, canvas)
  let bytes = [...tiles.values()].reduce((n, c) => n + c.width * c.height * 4, 0)
  for (const [oldKey, value] of tiles) {
    if ((bytes <= 64 * 1024 * 1024 && tiles.size <= 48) || oldKey === key) break
    bytes -= value.width * value.height * 4
    tiles.delete(oldKey)
    previewUrls.delete(oldKey)
  }
}

export function registerPatternTile(definition: PatternDefinition, canvas: HTMLCanvasElement) {
  rememberTile(tileKey(definition), canvas)
}

function proceduralTile(definition: PatternDefinition): HTMLCanvasElement {
  const size = Math.max(4, Math.min(512, Math.round(definition.size || 32)))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const fg = rgbFromHex(definition.foreground)
  const bg = rgbFromHex(definition.background)
  const random = mulberry32(definition.seed ^ (size * 0x9e3779b9))
  const half = size / 2
  const line = Math.max(1, Math.round(size / 16))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let mix = 0
      switch (definition.kind) {
        case 'checker':
          mix = x >= half !== y >= half ? 1 : 0
          break
        case 'dots': {
          const dx = x + 0.5 - half
          const dy = y + 0.5 - half
          mix = dx * dx + dy * dy <= (size * 0.24) ** 2 ? 1 : 0
          break
        }
        case 'stripes':
          mix = x >= half ? 1 : 0
          break
        case 'diagonal':
          mix = (x + y) % size >= half ? 1 : 0
          break
        case 'grid':
          mix = x < line || y < line ? 1 : 0
          break
        case 'noise':
          mix = random()
          break
        default:
          mix = 0
      }
      const i = (y * size + x) * 4
      image.data[i] = Math.round((bg[0] + (fg[0] - bg[0]) * mix) * 255)
      image.data[i + 1] = Math.round((bg[1] + (fg[1] - bg[1]) * mix) * 255)
      image.data[i + 2] = Math.round((bg[2] + (fg[2] - bg[2]) * mix) * 255)
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Synchronous tile for the renderer. Image tiles must be prepared first. */
export function patternTileCanvas(definition: PatternDefinition): HTMLCanvasElement | undefined {
  const key = tileKey(definition)
  const cached = tiles.get(key)
  if (cached) {
    tiles.delete(key)
    tiles.set(key, cached)
    return cached
  }
  if (definition.kind === 'image') return undefined
  const canvas = proceduralTile(definition)
  rememberTile(key, canvas)
  return canvas
}

export async function preparePatternDefinition(definition: PatternDefinition): Promise<boolean> {
  const key = tileKey(definition)
  if (tiles.has(key)) return false
  if (definition.kind !== 'image') {
    patternTileCanvas(definition)
    return false
  }
  const pending = loading.get(key)
  if (pending) {
    await pending
    return true
  }
  const src = definition.src
  if (!src) throw new Error(`Узор «${definition.name}» не содержит изображения`)
  const actual = sourceDimensions(src)
  if (actual.width !== definition.width || actual.height !== definition.height)
    throw new Error(`Размер изображения узора «${definition.name}» не совпадает с описанием`)
  const job = new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext('2d')!.drawImage(image, 0, 0)
      rememberTile(key, canvas)
      loading.delete(key)
      resolve(canvas)
    }
    image.onerror = () => {
      loading.delete(key)
      reject(new Error(`Не удалось прочитать изображение узора «${definition.name}»`))
    }
    image.src = src
  })
  loading.set(key, job)
  await job
  return true
}

export async function patternTileCanvasAsync(
  definition: PatternDefinition,
): Promise<HTMLCanvasElement> {
  await preparePatternDefinition(definition)
  const tile = patternTileCanvas(definition)
  if (!tile) throw new Error(`Не удалось подготовить узор «${definition.name}»`)
  return tile
}

export function collectPatternDefinitions(doc: EditorDocument): PatternDefinition[] {
  const definitions: PatternDefinition[] = []
  for (const layer of doc.layers) {
    if (!layer.styles) continue
    if (layer.styles.pattern.enabled) definitions.push(layer.styles.pattern.pattern)
    for (const stroke of layer.styles.strokes)
      if (stroke.enabled && stroke.fill === 'pattern' && stroke.pattern)
        definitions.push(stroke.pattern)
  }
  return definitions
}

export function collectStylePatternDefinitions(styles: LayerStyles): PatternDefinition[] {
  return [
    styles.pattern.pattern,
    ...styles.strokes.flatMap((stroke) => (stroke.pattern ? [stroke.pattern] : [])),
  ]
}

export async function prepareDocumentPatterns(doc: EditorDocument): Promise<boolean> {
  const unique = new Map<string, PatternDefinition>()
  for (const definition of collectPatternDefinitions(doc))
    unique.set(tileKey(definition), definition)
  const loaded = await Promise.all([...unique.values()].map(preparePatternDefinition))
  return loaded.some(Boolean)
}

export async function prepareStylePatterns(styles: LayerStyles): Promise<boolean> {
  const unique = new Map<string, PatternDefinition>()
  for (const definition of collectStylePatternDefinitions(styles))
    unique.set(tileKey(definition), definition)
  const loaded = await Promise.all([...unique.values()].map(preparePatternDefinition))
  return loaded.some(Boolean)
}

export function documentPatternsReady(doc: EditorDocument): boolean {
  return collectPatternDefinitions(doc).every((definition) => !!patternTileCanvas(definition))
}

export function patternTileDataUrl(definition: PatternDefinition): string | undefined {
  if (definition.kind === 'image') return definition.src
  const key = tileKey(definition)
  const cached = previewUrls.get(key)
  if (cached) return cached
  const tile = patternTileCanvas(definition)
  if (!tile) return undefined
  const url = tile.toDataURL('image/png')
  previewUrls.set(key, url)
  return url
}

export function clearPatternCache() {
  tiles.clear()
  loading.clear()
  previewUrls.clear()
}
