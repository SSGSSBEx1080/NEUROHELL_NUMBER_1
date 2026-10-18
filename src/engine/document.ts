import { homography, invertMatrix, project, validQuad } from './projection'
import { normalizeStyles } from './styles'
import { DEFAULT_ADJUSTMENTS, MAX_DIMENSION, MAX_LAYERS, type EditorDocument, type Layer, type Point } from '../types'

export const uid = () => crypto.randomUUID()
export function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: uid(), name: 'Новый слой', kind: 'shape', visible: true, locked: false,
    x: 0, y: 0, width: 200, height: 200, rotation: 0, opacity: 1,
    blendMode: 'source-over', color: '#b8a8ff', adjustments: { ...DEFAULT_ADJUSTMENTS },
    ...overrides,
  }
}
export function newDocument(width = 1600, height = 1000, name = 'Без названия', background = '#ffffff'): EditorDocument {
  return { version: 1, id: uid(), name, width, height, background, layers: [] }
}
export function demoDocument(): EditorDocument {
  const doc = newDocument(1600, 1000, 'За пределами', '#18131d')
  doc.layers = [
    makeLayer({ name: 'Дальний горизонт', kind: 'image', src: '/demo-landscape.webp', width: 1600, height: 1000 }),
    makeLayer({ name: 'Выпуск 001', kind: 'text', text: '777  /  ТВОРЧЕСКАЯ СВОБОДА', x: 92, y: 72, width: 700, height: 35, fontFamily: 'Manrope', fontSize: 20, fontWeight: 600, letterSpacing: 3, color: '#f6f0e8' }),
    makeLayer({ name: 'ВНЕ ГРАНИЦ.', kind: 'text', text: 'ВНЕ\nГРАНИЦ.', x: 80, y: 327, width: 1200, height: 298, fontFamily: 'Unbounded', fontSize: 128, fontWeight: 700, lineHeight: 1.12, letterSpacing: -6, color: '#f6f0e8' }),
    makeLayer({ name: 'Подзаголовок', kind: 'text', text: 'МЕНЬШЕ ПРАВИЛ.\nБОЛЬШЕ ТВОИХ ИДЕЙ.', x: 92, y: 733, width: 780, height: 80, fontFamily: 'Manrope', fontSize: 24, fontWeight: 500, lineHeight: 1.5, letterSpacing: 3, color: '#e0d9d6' }),
    makeLayer({ name: 'Линия горизонта', kind: 'shape', shape: 'rectangle', x: 92, y: 896, width: 1416, height: 1.5, color: '#75666a', opacity: 0.6 }),
    makeLayer({ name: 'Подпись', kind: 'text', text: 'НЕЗАВИСИМЫЙ ВЗГЛЯД', x: 92, y: 922, width: 700, height: 25, fontFamily: 'Manrope', fontSize: 16, fontWeight: 500, letterSpacing: 3, color: '#bdb3b9' }),
    makeLayer({ name: 'Номер эксперимента', kind: 'text', text: 'EXPERIMENT — 001  ↗', x: 1100, y: 922, width: 410, height: 25, fontFamily: 'Manrope', fontSize: 16, fontWeight: 500, textAlign: 'right', letterSpacing: 2, color: '#bdb3b9' }),
  ]
  return doc
}

export function localPoint(layer: Layer, point: Point, undoWarp = true): Point {
  const angle = -layer.rotation * Math.PI / 180
  const dx = point.x - layer.x - layer.width / 2
  const dy = point.y - layer.y - layer.height / 2
  const local = { x: dx * Math.cos(angle) - dy * Math.sin(angle) + layer.width / 2, y: dx * Math.sin(angle) + dy * Math.cos(angle) + layer.height / 2 }
  if (layer.warp && undoWarp) { const p = project(invertMatrix(homography(layer.warp)), local.x / layer.width, local.y / layer.height); return { x: p.x * layer.width, y: p.y * layer.height } }
  return local
}
export function hitTest(layer: Layer, point: Point): boolean {
  if (!layer.visible || layer.locked) return false
  const p = localPoint(layer, point)
  if (p.x < 0 || p.y < 0 || p.x > layer.width || p.y > layer.height) return false
  if (layer.shape === 'ellipse') return ((p.x - layer.width / 2) / (layer.width / 2)) ** 2 + ((p.y - layer.height / 2) / (layer.height / 2)) ** 2 <= 1
  return true
}

const blends = new Set(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'difference'])
const fonts = new Set(['Manrope', 'Unbounded', 'Arial', 'Georgia', 'monospace'])
const isColor = (s: unknown): s is string => typeof s === 'string' && /^#[a-f0-9]{6}$/i.test(s)
function finite(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}
/** Only our versioned format, raster data URLs and bundled assets are accepted. No remote resources or executable SVG. */
export function parseProject(input: unknown): EditorDocument {
  if (!input || typeof input !== 'object') throw new Error('Это не проект ФШ 777')
  const d = input as Record<string, unknown>
  if (d.version !== 1 || typeof d.width !== 'number' || typeof d.height !== 'number' || !Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 1 || d.height < 1 || d.width > MAX_DIMENSION || d.height > MAX_DIMENSION || !Array.isArray(d.layers) || d.layers.length > MAX_LAYERS) throw new Error('Некорректный проект: холст до 4096 × 4096 и до 100 слоёв')
  const layers = d.layers.map((value: unknown): Layer => {
    if (!value || typeof value !== 'object') throw new Error('Повреждённый слой')
    const l = value as Record<string, unknown>
    if (!['image', 'text', 'shape'].includes(String(l.kind))) throw new Error('Неизвестный тип слоя')
    const a = (l.adjustments || {}) as Record<string, unknown>
    if (l.kind === 'image' && (typeof l.src !== 'string' || !(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(l.src) || l.src === '/demo-landscape.webp'))) throw new Error('Разрешены только встроенные PNG, JPEG и WebP')
    return makeLayer({
      id: typeof l.id === 'string' && l.id.length < 100 ? l.id : uid(),
      name: typeof l.name === 'string' ? l.name.slice(0, 100) : 'Слой', kind: l.kind as Layer['kind'],
      visible: l.visible !== false, locked: l.locked === true,
      x: finite(l.x, -16384, 16384, 0), y: finite(l.y, -16384, 16384, 0),
      width: finite(l.width, 1, 16384, 100), height: finite(l.height, 1, 16384, 100),
      rotation: finite(l.rotation, -360, 360, 0), opacity: finite(l.opacity, 0, 1, 1),
      blendMode: blends.has(String(l.blendMode)) ? l.blendMode as Layer['blendMode'] : 'source-over',
      warp: validQuad(l.warp) ? l.warp : undefined, textScaleX: finite(l.textScaleX, 0.01, 100, 1), styles: normalizeStyles(l.styles), sourceText: typeof l.sourceText === 'string' ? l.sourceText.slice(0, 20000) : undefined,
      color: isColor(l.color) ? l.color : '#ffffff', src: typeof l.src === 'string' ? l.src : undefined,
      text: typeof l.text === 'string' ? l.text.slice(0, 20000) : undefined,
      fontFamily: fonts.has(String(l.fontFamily)) ? String(l.fontFamily) : 'Manrope',
      fontSize: finite(l.fontSize, 4, 1000, 48), fontWeight: finite(l.fontWeight, 100, 900, 500), italic: l.italic === true,
      textAlign: ['left', 'center', 'right'].includes(String(l.textAlign)) ? l.textAlign as Layer['textAlign'] : 'left',
      lineHeight: finite(l.lineHeight, 0.5, 4, 1.2), letterSpacing: finite(l.letterSpacing, -30, 100, 0),
      shape: l.shape === 'ellipse' ? 'ellipse' : 'rectangle', radius: finite(l.radius, 0, 2000, 0),
      strokeColor: isColor(l.strokeColor) ? l.strokeColor : undefined, strokeWidth: finite(l.strokeWidth, 0, 200, 0),
      flipX: l.flipX === true, flipY: l.flipY === true,
      adjustments: {
        brightness: finite(a.brightness, -100, 100, 0), contrast: finite(a.contrast, -100, 100, 0),
        saturation: finite(a.saturation, -100, 100, 0), blur: finite(a.blur, 0, 30, 0),
        hue: finite(a.hue, -180, 180, 0), grayscale: finite(a.grayscale, 0, 100, 0), sepia: finite(a.sepia, 0, 100, 0), invert: finite(a.invert, 0, 100, 0),
      },
    })
  })
  const ids = new Set<string>()
  for (const l of layers) { if (ids.has(l.id)) l.id = uid(); ids.add(l.id) }
  return { version: 1, id: typeof d.id === 'string' ? d.id.slice(0, 100) : uid(), name: typeof d.name === 'string' ? d.name.slice(0, 100) : 'Без названия', width: d.width, height: d.height, background: d.background === 'transparent' ? 'transparent' : isColor(d.background) ? d.background : '#ffffff', layers }
}
