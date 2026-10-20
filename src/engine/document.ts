import { isBundledRaster } from './bundledAssets'
import { normalizeLayout } from './layout'
import { parseCorrection } from './adjustmentTypes'
import { localBounds } from './layerGeometry'
import { parseShapePaths, shapeNames } from './shapeGeometry'
import { hitShape } from './shapeRenderer'
import { parseDocumentTextEntries } from './textEntriesFormat'
import { parseTextFrame } from './textLayout'
import { homography, invertMatrix, project, validQuad } from './projection'
import { normalizeStyles } from './styles'
import { parseBlendIf } from './blendIf'
import { parseDocumentColorProfile, workingDocumentColorProfile } from './colorProfiles'
import { parseTextAntiAlias } from './textAntiAlias'
import { parseGlobalLight, synchronizeStylesToGlobalLight } from './globalLight'
import {
  DEFAULT_ADJUSTMENTS,
  MAX_DIMENSION,
  MAX_LAYERS,
  type EditorDocument,
  type Layer,
  type Point,
} from '../types'

export const uid = () => crypto.randomUUID()
export function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: uid(),
    name: 'Новый слой',
    kind: 'shape',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    blendMode: 'source-over',
    color: '#b8a8ff',
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    ...overrides,
  }
}
export function newDocument(
  width = 1600,
  height = 1000,
  name = 'Без названия',
  background = '#ffffff',
): EditorDocument {
  return {
    version: 1,
    id: uid(),
    name,
    width,
    height,
    background,
    dpi: 72,
    colorProfile: workingDocumentColorProfile(),
    layers: [],
  }
}
export function demoDocument(): EditorDocument {
  const doc = newDocument(1600, 1000, 'За пределами', '#18131d')
  doc.layers = [
    makeLayer({
      name: 'Дальний горизонт',
      kind: 'image',
      src: '/demo-landscape.webp',
      width: 1600,
      height: 1000,
    }),
    makeLayer({
      name: 'Выпуск 001',
      kind: 'text',
      text: '777  /  ТВОРЧЕСКАЯ СВОБОДА',
      x: 92,
      y: 72,
      width: 700,
      height: 35,
      fontFamily: 'Manrope',
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: 3,
      color: '#f6f0e8',
    }),
    makeLayer({
      name: 'ВНЕ ГРАНИЦ.',
      kind: 'text',
      text: 'ВНЕ\nГРАНИЦ.',
      x: 80,
      y: 327,
      width: 1200,
      height: 298,
      fontFamily: 'Unbounded',
      fontSize: 128,
      fontWeight: 700,
      lineHeight: 1.12,
      letterSpacing: -6,
      color: '#f6f0e8',
    }),
    makeLayer({
      name: 'Подзаголовок',
      kind: 'text',
      text: 'МЕНЬШЕ ПРАВИЛ.\nБОЛЬШЕ ТВОИХ ИДЕЙ.',
      x: 92,
      y: 733,
      width: 780,
      height: 80,
      fontFamily: 'Manrope',
      fontSize: 24,
      fontWeight: 500,
      lineHeight: 1.5,
      letterSpacing: 3,
      color: '#e0d9d6',
    }),
    makeLayer({
      name: 'Линия горизонта',
      kind: 'shape',
      shape: 'rectangle',
      x: 92,
      y: 896,
      width: 1416,
      height: 1.5,
      color: '#75666a',
      opacity: 0.6,
    }),
    makeLayer({
      name: 'Подпись',
      kind: 'text',
      text: 'НЕЗАВИСИМЫЙ ВЗГЛЯД',
      x: 92,
      y: 922,
      width: 700,
      height: 25,
      fontFamily: 'Manrope',
      fontSize: 16,
      fontWeight: 500,
      letterSpacing: 3,
      color: '#bdb3b9',
    }),
    makeLayer({
      name: 'Номер эксперимента',
      kind: 'text',
      text: 'EXPERIMENT — 001  ↗',
      x: 1100,
      y: 922,
      width: 410,
      height: 25,
      fontFamily: 'Manrope',
      fontSize: 16,
      fontWeight: 500,
      textAlign: 'right',
      letterSpacing: 2,
      color: '#bdb3b9',
    }),
  ]
  return doc
}

export function localPoint(layer: Layer, point: Point, undoWarp = true): Point {
  const angle = (-layer.rotation * Math.PI) / 180
  const dx = point.x - layer.x - layer.width / 2
  const dy = point.y - layer.y - layer.height / 2
  const local = {
    x: dx * Math.cos(angle) - dy * Math.sin(angle) + layer.width / 2,
    y: dx * Math.sin(angle) + dy * Math.cos(angle) + layer.height / 2,
  }
  if (layer.warp && undoWarp) {
    const p = project(
      invertMatrix(homography(layer.warp)),
      local.x / layer.width,
      local.y / layer.height,
    )
    return { x: p.x * layer.width, y: p.y * layer.height }
  }
  return local
}
export function hitTest(layer: Layer, point: Point): boolean {
  if (!layer.visible || layer.locked || layer.kind === 'adjustment') return false
  const p = localPoint(layer, point)
  if (layer.flipX) p.x = layer.width - p.x
  if (layer.flipY) p.y = layer.height - p.y
  if (layer.kind === 'shape') return hitShape(layer, p.x, p.y)
  const bounds = localBounds(layer)
  if (
    p.x < bounds.x ||
    p.y < bounds.y ||
    p.x > bounds.x + bounds.width ||
    p.y > bounds.y + bounds.height
  )
    return false
  return true
}

const blends = new Set([
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
])
const validFont = (value: unknown) =>
  typeof value === 'string' && value.length <= 160 && !/[\x00-\x1f\";{}<>]/.test(value)
const isColor = (s: unknown): s is string => typeof s === 'string' && /^#[a-f0-9]{6}$/i.test(s)
function finite(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
/** Only our versioned format, raster data URLs and bundled assets are accepted. No remote resources or executable SVG. */
export function parseProject(input: unknown, depth = 0): EditorDocument {
  if (depth > 3) throw new Error('Слишком глубокая вложенность смарт-объектов')
  if (!input || typeof input !== 'object') throw new Error('Это не проект ФШ 777')
  const d = input as Record<string, unknown>
  if (
    d.version !== 1 ||
    typeof d.width !== 'number' ||
    typeof d.height !== 'number' ||
    !Number.isInteger(d.width) ||
    !Number.isInteger(d.height) ||
    d.width < 1 ||
    d.height < 1 ||
    d.width > MAX_DIMENSION ||
    d.height > MAX_DIMENSION ||
    !Array.isArray(d.layers) ||
    d.layers.length > MAX_LAYERS
  )
    throw new Error('Некорректный проект: холст до 4096 × 4096 и до 100 слоёв')
  const layers = d.layers.map((value: unknown): Layer => {
    if (!value || typeof value !== 'object') throw new Error('Повреждённый слой')
    const l = value as Record<string, unknown>
    if (!['image', 'text', 'shape', 'group', 'adjustment'].includes(String(l.kind)))
      throw new Error('Неизвестный тип слоя')
    const a = (l.adjustments || {}) as Record<string, unknown>
    if (
      l.kind === 'image' &&
      (typeof l.src !== 'string' ||
        !(
          /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(l.src) ||
          isBundledRaster(l.src)
        ))
    )
      throw new Error('Разрешены только встроенные PNG, JPEG и WebP')
    return makeLayer({
      id: typeof l.id === 'string' && l.id.length < 100 ? l.id : uid(),
      name: typeof l.name === 'string' ? l.name.slice(0, 100) : 'Слой',
      kind: l.kind as Layer['kind'],
      correction: l.kind === 'adjustment' ? parseCorrection(l.correction) : undefined,
      visible: l.visible !== false,
      locked: l.locked === true,
      x: l.kind === 'adjustment' ? 0 : finite(l.x, -16384, 16384, 0),
      y: l.kind === 'adjustment' ? 0 : finite(l.y, -16384, 16384, 0),
      width: l.kind === 'adjustment' ? (d.width as number) : finite(l.width, 1, 16384, 100),
      height: l.kind === 'adjustment' ? (d.height as number) : finite(l.height, 1, 16384, 100),
      rotation: l.kind === 'adjustment' ? 0 : finite(l.rotation, -360, 360, 0),
      opacity: finite(l.opacity, 0, 1, 1),
      blendMode: blends.has(String(l.blendMode))
        ? (l.blendMode as Layer['blendMode'])
        : 'source-over',
      warp: l.kind !== 'adjustment' && validQuad(l.warp) ? l.warp : undefined,
      textScaleX: finite(l.textScaleX, 0.01, 100, 1),
      textBaseline: l.textBaseline === 'alphabetic' ? 'alphabetic' : 'top',
      textFrame: l.kind === 'text' ? parseTextFrame(l.textFrame) : undefined,
      styles: l.kind === 'adjustment' ? undefined : normalizeStyles(l.styles),
      blendIf: parseBlendIf(l.blendIf),
      sourceText: typeof l.sourceText === 'string' ? l.sourceText.slice(0, 20000) : undefined,
      color: isColor(l.color) ? l.color : '#ffffff',
      src: typeof l.src === 'string' ? l.src : undefined,
      text: typeof l.text === 'string' ? l.text.slice(0, 20000) : undefined,
      fontFamily: validFont(l.fontFamily) ? String(l.fontFamily) : 'Manrope',
      fontSize: finite(l.fontSize, 4, 1000, 48),
      fontWeight: finite(l.fontWeight, 100, 900, 500),
      italic: l.italic === true,
      textUnderline: l.kind === 'text' && l.textUnderline === true ? true : undefined,
      textStrikethrough: l.kind === 'text' && l.textStrikethrough === true ? true : undefined,
      textBaselineShift:
        l.kind === 'text' && finite(l.textBaselineShift, -1000, 1000, 0) !== 0
          ? finite(l.textBaselineShift, -1000, 1000, 0)
          : undefined,
      textAlign: ['left', 'center', 'right'].includes(String(l.textAlign))
        ? (l.textAlign as Layer['textAlign'])
        : 'left',
      lineHeight: finite(l.lineHeight, 0.5, 4, 1.2),
      letterSpacing: finite(l.letterSpacing, -30, 100, 0),
      textAntiAlias: l.kind === 'text' ? parseTextAntiAlias(l.textAntiAlias) : undefined,
      shape: Object.hasOwn(shapeNames, String(l.shape)) ? (l.shape as Layer['shape']) : 'rectangle',
      shapeFill: l.shapeFill !== false,
      cornerRadii:
        Array.isArray(l.cornerRadii) && l.cornerRadii.length === 4
          ? (l.cornerRadii.map((v) => finite(v, 0, 2000, 0)) as Layer['cornerRadii'])
          : undefined,
      sides: Math.round(finite(l.sides, 3, 64, 5)),
      starRatio: finite(l.starRatio, 0.02, 0.98, 0.45),
      shapePaths: parseShapePaths(l.shapePaths),
      strokeAlign: ['inside', 'center', 'outside'].includes(String(l.strokeAlign))
        ? (l.strokeAlign as Layer['strokeAlign'])
        : 'center',
      strokeCap: ['butt', 'round', 'square'].includes(String(l.strokeCap))
        ? (l.strokeCap as Layer['strokeCap'])
        : 'butt',
      strokeJoin: ['miter', 'round', 'bevel'].includes(String(l.strokeJoin))
        ? (l.strokeJoin as Layer['strokeJoin'])
        : 'miter',
      strokeMiterLimit: finite(l.strokeMiterLimit, 1, 20, 4),
      strokeDash:
        Array.isArray(l.strokeDash) && l.strokeDash.length <= 16
          ? l.strokeDash.map((v) => finite(v, 0, 2000, 0))
          : [],
      strokeDashOffset: finite(l.strokeDashOffset, -2000, 2000, 0),
      radius: finite(l.radius, 0, 2000, 0),
      strokeColor: isColor(l.strokeColor) ? l.strokeColor : undefined,
      strokeWidth: finite(l.strokeWidth, 0, 200, 0),
      flipX: l.kind !== 'adjustment' && l.flipX === true,
      flipY: l.kind !== 'adjustment' && l.flipY === true,
      parentId: typeof l.parentId === 'string' ? l.parentId.slice(0, 100) : undefined,
      expanded: l.expanded !== false,
      isolated: l.isolated !== false,
      clipping: l.clipping === true,
      sourcePath:
        Array.isArray(l.sourcePath) &&
        l.sourcePath.length <= 32 &&
        l.sourcePath.every((n) => Number.isInteger(n) && n >= 0 && n < 1000)
          ? (l.sourcePath as number[])
          : undefined,
      mask: parseMask(l.mask),
      smart: l.smart ? parseProject(l.smart, depth + 1) : undefined,
      adjustments:
        l.kind === 'adjustment'
          ? { ...DEFAULT_ADJUSTMENTS }
          : {
              brightness: finite(a.brightness, -100, 100, 0),
              contrast: finite(a.contrast, -100, 100, 0),
              saturation: finite(a.saturation, -100, 100, 0),
              blur: finite(a.blur, 0, 30, 0),
              hue: finite(a.hue, -180, 180, 0),
              grayscale: finite(a.grayscale, 0, 100, 0),
              sepia: finite(a.sepia, 0, 100, 0),
              invert: finite(a.invert, 0, 100, 0),
            },
    })
  })
  const globalLight = parseGlobalLight(d.globalLight)
  if (globalLight)
    for (const layer of layers)
      if (layer.styles) layer.styles = synchronizeStylesToGlobalLight(layer.styles, globalLight)
  const ids = new Set<string>()
  for (const l of layers) {
    if (ids.has(l.id)) l.id = uid()
    ids.add(l.id)
  }
  for (const l of layers) {
    const visited = new Set([l.id])
    let parent = l.parentId
    while (parent) {
      if (visited.has(parent)) throw new Error('Циклическая группа слоёв')
      visited.add(parent)
      const p = layers.find((v) => v.id === parent)
      if (!p || p.kind !== 'group') {
        l.parentId = undefined
        break
      }
      parent = p.parentId
    }
  }
  return {
    layout: d.layout ? normalizeLayout(d.layout) : undefined,
    textEntries: parseDocumentTextEntries(d)?.map((entry) => ({
      ...entry,
      layerId: layers.some((l) => l.id === entry.layerId && l.kind === 'text')
        ? entry.layerId
        : undefined,
    })),
    sourceId: typeof d.sourceId === 'string' ? d.sourceId.slice(0, 100) : undefined,
    colorProfile: parseDocumentColorProfile(d.colorProfile),
    globalLight,
    dpi: finite(d.dpi, 1, 1200, 72),
    version: 1,
    id: typeof d.id === 'string' ? d.id.slice(0, 100) : uid(),
    name: typeof d.name === 'string' ? d.name.slice(0, 100) : 'Без названия',
    width: d.width,
    height: d.height,
    background:
      d.background === 'transparent'
        ? 'transparent'
        : isColor(d.background)
          ? d.background
          : '#ffffff',
    layers,
  }
}

function parseMask(input: unknown): Layer['mask'] {
  if (!input || typeof input !== 'object') return undefined
  const m = input as Record<string, unknown>
  if (typeof m.src !== 'string' || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(m.src))
    throw new Error('Повреждённая маска слоя')
  return {
    src: m.src,
    x: finite(m.x, -16384, 16384, 0),
    y: finite(m.y, -16384, 16384, 0),
    width: finite(m.width, 1, 8192, 1),
    height: finite(m.height, 1, 8192, 1),
    enabled: m.enabled !== false,
    linked: m.linked !== false,
    density: finite(m.density, 0, 1, 1),
    feather: finite(m.feather, 0, 100, 0),
    defaultColor: finite(m.defaultColor, 0, 255, 0),
  }
}
export function descendants(doc: EditorDocument, id: string): Set<string> {
  const result = new Set([id])
  let size = 0
  while (size !== result.size) {
    size = result.size
    for (const l of doc.layers) if (l.parentId && result.has(l.parentId)) result.add(l.id)
  }
  return result
}
export function effectiveLayers(doc: EditorDocument): Layer[] {
  return doc.layers.filter((l) => {
    let p: Layer | undefined = l
    const seen = new Set<string>()
    while (p) {
      if (!p.visible || p.locked || seen.has(p.id)) return false
      seen.add(p.id)
      p = doc.layers.find((v) => v.id === p!.parentId)
    }
    return l.kind !== 'group'
  })
}

export function isLayerLocked(doc: EditorDocument, id: string) {
  let layer = doc.layers.find((l) => l.id === id)
  const seen = new Set<string>()
  while (layer) {
    if (layer.locked || seen.has(layer.id)) return true
    seen.add(layer.id)
    layer = doc.layers.find((l) => l.id === layer!.parentId)
  }
  return false
}
