import { canonicalTextPreview } from './textPreview'
import { nativeLayout, normalizeLayout, sameNativeLayout } from './layout'
import { exportAdjustment, importAdjustment } from './psdAdjustments'
import { sealProject } from './psdIntegrity'
import { gaussianSmartFilter, nativeSmartPlacement, translateNativePlacement } from './psdSmart'
import { affineText, exportNativeText, importNativeText } from './psdText'
import { exportVectorShape, importVectorShape, translateNativeVector } from './psdVector'
import { rasterBounds, rectPoints, worldBounds } from './layerGeometry'
import { layerPoint } from './shapeGeometry'
import { inspectNativeLayers, type PsdExportReport } from './psdReport'
import { DEFAULT_ADJUSTMENTS, MAX_STYLE_INSTANCES } from '../types'
import { parseGradientDefinition, type GradientDefinition } from './gradientRamp'
import {
  imageResourceData,
  preserveMergedPixels,
  preserveUnknownResources,
  withPsdIccProfile,
} from './psdBinary'
import {
  WORKING_RGB_PROFILE,
  buildIccProfile,
  builtinColorProfile,
  isSrgbProfile,
  parseIccProfile,
  profilesMatch,
  untaggedDocumentColorProfile,
  workingDocumentColorProfile,
  type ColorProfileModel,
  type ParsedColorProfile,
} from './colorProfiles'
import { applyDocumentColorDecision } from './documentColor'
import type {
  Color,
  EffectContour,
  EffectPattern,
  Layer as PsdLayer,
  LayerEffectsInfo,
  PatternInfo,
  Psd,
  PixelData,
} from 'ag-psd'
import type {
  BevelEffectStyle,
  BlendIfRanges,
  BlendMode,
  EffectContourDefinition,
  EditorDocument,
  Layer,
  LayerStyles,
  PatternDefinition,
} from '../types'
import {
  cleanPatternId,
  cleanPatternName,
  collectPatternDefinitions,
  createImagePatternDefinition,
  deterministicPatternId,
  patternContentKey,
  patternTileCanvasAsync,
  registerPatternTile,
} from './patterns'
import { isBlendIfActive, parseBlendIf } from './blendIf'
import { parseEffectContour } from './contours'
import { textAntiAliasMode } from './textAntiAlias'
import { makeLayer, newDocument, parseProject, uid } from './document'
import {
  cacheImage,
  exportCanvas,
  filterString,
  loadImage,
  prepareDocument,
  renderLayer,
} from './render'
import { STYLE_LIMITS, defaultStyles, hasStyles, parseGradientShape } from './styles'
import {
  isOriginalAppearance,
  isOriginalDocument,
  originalSource,
  registerSource,
  sameVisual,
  sameEmbeddedContent,
} from './psdSource'
import { validatePsdHeader } from './psdHeader'
export interface CompatibilityReport {
  title: string
  warnings: string[]
  layerCount: number
  format: string
  color: PsdColorProfileReport
}
export interface PsdColorProfileReport {
  mode: 'rgb' | 'grayscale'
  status: 'own' | 'matching' | 'missing' | 'mismatch' | 'unsupported' | 'mode-mismatch'
  embeddedName?: string
  embeddedKind?: string
  profile?: ParsedColorProfile
  sourceModel?: ColorProfileModel
  conversionSupported: boolean
  reason?: string
  explicitlyUntagged?: boolean
}
const toCanvas: Record<string, BlendMode> = {
  normal: 'source-over',
  'pass through': 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter',
}
const toPsd: Record<BlendMode, PsdLayer['blendMode']> = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  lighter: 'linear dodge',
}
type PsdBevel = NonNullable<LayerEffectsInfo['bevel']>
const bevelStyleFromPsd: Record<string, BevelEffectStyle['style']> = {
  'outer bevel': 'outer',
  'inner bevel': 'inner',
  emboss: 'emboss',
  'pillow emboss': 'pillow',
  'stroke emboss': 'stroke',
}
const bevelStyleToPsd: Record<BevelEffectStyle['style'], PsdBevel['style']> = {
  outer: 'outer bevel',
  inner: 'inner bevel',
  emboss: 'emboss',
  pillow: 'pillow emboss',
  stroke: 'stroke emboss',
}
const bevelTechniqueFromPsd: Record<string, BevelEffectStyle['technique']> = {
  smooth: 'smooth',
  'chisel hard': 'chiselHard',
  'chisel soft': 'chiselSoft',
}
const bevelTechniqueToPsd: Record<BevelEffectStyle['technique'], PsdBevel['technique']> = {
  smooth: 'smooth',
  chiselHard: 'chisel hard',
  chiselSoft: 'chisel soft',
}
export function runCodec<T>(job: object, transfers: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('PSD: превышено время обработки. Уменьши размер документа.'))
    }, 90000)
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = ({ data }) => {
      finish()
      if (data.error) reject(new Error(data.error))
      else resolve(data)
    }
    worker.onerror = () => {
      finish()
      reject(new Error('Не удалось обработать PSD/PSB'))
    }
    worker.postMessage(job, transfers)
  })
}
const hex = (c?: Color, fallback = '#ffffff') =>
  !c || !('r' in c)
    ? fallback
    : '#' +
      [c.r, c.g, c.b]
        .map((v) =>
          Math.max(0, Math.min(255, Math.round(v)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
const rgb = (color: string) => ({
  r: parseInt(color.slice(1, 3), 16),
  g: parseInt(color.slice(3, 5), 16),
  b: parseInt(color.slice(5, 7), 16),
})
const px = (value: number) => ({ units: 'Pixels' as const, value })
const wrapPsdAngle = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180
const contourFromPsd = (contour?: EffectContour): EffectContourDefinition =>
  parseEffectContour(contour ? { name: contour.name, points: contour.curve } : undefined)
const contourToPsd = (definition?: EffectContourDefinition): EffectContour => {
  const contour = parseEffectContour(definition)
  return {
    // Photoshop's canonical name for the identity shaping curve; every other
    // imported or user-visible curve keeps its own name byte-for-byte.
    name:
      (contour.name === 'Линейный' || contour.name === 'Linear') &&
      contour.points.every((point) => Math.abs(point.x - point.y) <= 1)
        ? 'Linear'
        : contour.name,
    curve: contour.points.map((point) => ({ ...point })),
  }
}
const glowRangeFromPsd = (value: number | undefined) =>
  Math.min(1, Math.max(0.01, Number.isFinite(value) ? (value as number) : 0.5))
function canvas(width: number, height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000)
    throw new Error('Слишком большой растровый слой PSD')
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}
function imageSource(data: PixelData) {
  const c = canvas(data.width, data.height)
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(data.data), data.width, data.height),
    0,
    0,
  )
  const src = c.toDataURL('image/png')
  cacheImage(src, c)
  return src
}
type PsdGradient = NonNullable<
  NonNullable<NonNullable<PsdLayer['effects']>['gradientOverlay']>[number]['gradient']
>
function gradientFromPsd(g: PsdGradient | undefined): GradientDefinition | undefined {
  if (!g) return undefined
  try {
    if (g.type === 'noise')
      return parseGradientDefinition({
        name: g.name || 'Шум',
        kind: 'noise',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        noise: {
          roughness: g.roughness ?? 0.5,
          // PSD also knows HSL; it is edited here through the HSB controls (rendering differs).
          model: g.colorModel === 'lab' ? 'lab' : g.colorModel === 'rgb' ? 'rgb' : 'hsb',
          seed: g.randomSeed ?? 0,
          min: g.min,
          max: g.max,
          restrictColors: g.restrictColors === true,
          transparency: g.addTransparency === true,
        },
      })
    if (!g.colorStops?.length) return undefined
    return parseGradientDefinition({
      name: g.name || 'Градиент',
      kind: 'solid',
      stops: g.colorStops.map((stop) => ({
        position: stop.location,
        color: hex(stop.color),
        midpoint: stop.midpoint,
      })),
      opacityStops:
        g.opacityStops && g.opacityStops.length >= 2
          ? g.opacityStops.map((stop) => ({
              position: stop.location,
              opacity: stop.opacity,
              midpoint: stop.midpoint,
            }))
          : undefined,
    })
  } catch {
    return undefined
  }
}
function gradientToPsd(definition: GradientDefinition): PsdGradient {
  if (definition.kind === 'noise' && definition.noise)
    return {
      name: definition.name || 'ФШ777 ULTRA',
      type: 'noise',
      roughness: definition.noise.roughness,
      colorModel: definition.noise.model,
      randomSeed: definition.noise.seed,
      restrictColors: definition.noise.restrictColors,
      addTransparency: definition.noise.transparency,
      min: [...definition.noise.min],
      max: [...definition.noise.max],
    }
  return {
    name: definition.name || 'ФШ777 ULTRA',
    type: 'solid',
    smoothness: 1,
    colorStops: definition.stops.map((s) => ({
      color: rgb(s.color),
      location: s.position,
      midpoint: s.midpoint ?? 0.5,
    })),
    opacityStops: definition.opacityStops.map((s) => ({
      opacity: s.opacity,
      location: s.position,
      midpoint: s.midpoint ?? 0.5,
    })),
  }
}
function patternDefinitionFromPsd(info: PatternInfo): PatternDefinition | undefined {
  try {
    const width = info.bounds?.w || 0,
      height = info.bounds?.h || 0
    if (
      width < 1 ||
      height < 1 ||
      width > 2048 ||
      height > 2048 ||
      width * height > 4_194_304 ||
      !info.data ||
      info.data.length < width * height * 4
    )
      return undefined
    const c = canvas(width, height)
    c.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(info.data.slice(0, width * height * 4)), width, height),
      0,
      0,
    )
    const src = c.toDataURL('image/png')
    cacheImage(src, c)
    const definition = createImagePatternDefinition({
      name: info.name,
      src,
      width,
      height,
      id: info.id,
      psdX: info.x,
      psdY: info.y,
      boundsX: info.bounds.x,
      boundsY: info.bounds.y,
    })
    if (definition) registerPatternTile(definition, c)
    return definition
  } catch {
    return undefined
  }
}
function collectPsdPatternInfos(root: Psd): PatternInfo[] {
  const byId = new Map<string, PatternInfo>()
  const add = (info: PatternInfo) => {
    const id = cleanPatternId(info.id)
    if (id && !byId.has(id)) byId.set(id, info)
  }
  root.patterns?.forEach(add)
  const walk = (layers?: PsdLayer[]) => {
    for (const layer of layers || []) {
      layer.patterns?.forEach(add)
      walk(layer.children)
    }
  }
  walk(root.children)
  return [...byId.values()]
}
function collectPsdPatternDefinitions(root: Psd): Map<string, PatternDefinition> {
  const definitions = new Map<string, PatternDefinition>()
  for (const info of collectPsdPatternInfos(root)) {
    const definition = patternDefinitionFromPsd(info)
    if (definition) definitions.set(definition.id, definition)
  }
  return definitions
}
function resolvePsdPattern(
  ref: EffectPattern | undefined,
  definitions: Map<string, PatternDefinition> | undefined,
  warn?: (message: string) => void,
): PatternDefinition | undefined {
  if (!ref) return undefined
  const id = cleanPatternId(ref.id)
  const definition = id ? definitions?.get(id) : undefined
  if (!definition) {
    warn?.(
      `Узор «${cleanPatternName(ref.name)}» из PSD не импортирован: в файле нет поддерживаемых пикселей Patt для его идентификатора. Эффект пропущен, остальные слои сохранены.`,
    )
    return undefined
  }
  return { ...structuredClone(definition), name: cleanPatternName(ref.name, definition.name) }
}
function patternInfoFromPixels(
  definition: PatternDefinition,
  pixels: PixelData,
  ref: EffectPattern = { id: definition.id, name: definition.name },
): PatternInfo {
  return {
    name: cleanPatternName(ref.name, definition.name),
    id: cleanPatternId(ref.id) || definition.id,
    x: definition.psdX || 0,
    y: definition.psdY || 0,
    bounds: {
      x: definition.boundsX || 0,
      y: definition.boundsY || 0,
      w: pixels.width,
      h: pixels.height,
    },
    data: new Uint8Array(pixels.data as ArrayLike<number>),
  }
}
function importStyles(
  src: PsdLayer,
  patternDefinitions?: Map<string, PatternDefinition>,
  warn?: (message: string) => void,
): LayerStyles | undefined {
  const f = src.effects,
    s = defaultStyles()
  s.fillOpacity = src.fillOpacity ?? 1
  if (f && !f.disabled) {
    // PSD effect scale multiplies every size; bake it into editable parameters once.
    const scale = Math.min(10, Math.max(0.01, f.scale ?? 1))
    const strokes = (f.stroke || [])
      .filter((v) => v.enabled !== false)
      .slice(0, MAX_STYLE_INSTANCES)
      .flatMap((stroke) => {
        const gradient =
          stroke.fillType === 'gradient' ? gradientFromPsd(stroke.gradient) : undefined
        if (stroke.fillType === 'gradient' && !gradient) return []
        const pattern =
          stroke.fillType === 'pattern'
            ? resolvePsdPattern(stroke.pattern, patternDefinitions, warn)
            : undefined
        if (stroke.fillType === 'pattern' && !pattern) return []
        return [
          {
            enabled: true,
            size: Math.min(STYLE_LIMITS.strokeSize, (stroke.size?.value || 1) * scale),
            color: hex(stroke.color),
            fill: pattern
              ? ('pattern' as const)
              : gradient
                ? ('gradient' as const)
                : ('color' as const),
            gradient,
            pattern,
            gradientShape: parseGradientShape(stroke.gradient?.style, 'linear'),
            gradientAngle: -(stroke.gradient?.angle || 0),
            gradientScale: Math.min(4, Math.max(0.1, stroke.gradient?.scale ?? 1)),
            gradientReverse: stroke.gradient?.reverse === true,
            position: stroke.position || ('outside' as const),
            opacity: stroke.opacity ?? 1,
          },
        ]
      })
    if (strokes.length) s.strokes = strokes
    const shadowFrom = (shadow: NonNullable<typeof f.dropShadow>[number]) => {
      const a = ((shadow.angle || 0) * Math.PI) / 180,
        distance = (shadow.distance?.value || 0) * scale
      return {
        enabled: true,
        color: hex(shadow.color, '#000000'),
        opacity: shadow.opacity ?? 0.5,
        blur: Math.min(STYLE_LIMITS.blur, (shadow.size?.value || 0) * scale),
        x: -Math.cos(a) * distance,
        y: Math.sin(a) * distance,
        contour: contourFromPsd(shadow.contour),
        antialiased: shadow.antialiased === true,
      }
    }
    const shadows = (f.dropShadow || [])
      .filter((v) => v.enabled !== false)
      .slice(0, MAX_STYLE_INSTANCES)
      .map(shadowFrom)
    if (shadows.length) s.shadows = shadows
    const innerShadows = (f.innerShadow || [])
      .filter((v) => v.enabled !== false)
      .slice(0, MAX_STYLE_INSTANCES)
      .map(shadowFrom)
    if (innerShadows.length) s.innerShadows = innerShadows
    if (f.outerGlow?.enabled !== false && f.outerGlow)
      s.glow = {
        enabled: true,
        color: hex(f.outerGlow.color),
        blur: Math.min(STYLE_LIMITS.blur, (f.outerGlow.size?.value || 0) * scale),
        opacity: f.outerGlow.opacity ?? 0.5,
        contour: contourFromPsd(f.outerGlow.contour),
        antialiased: f.outerGlow.antialiased === true,
        range: glowRangeFromPsd(f.outerGlow.range),
      }
    if (f.innerGlow?.enabled !== false && f.innerGlow)
      s.innerGlow = {
        enabled: true,
        color: hex(f.innerGlow.color),
        blur: Math.min(STYLE_LIMITS.blur, (f.innerGlow.size?.value || 0) * scale),
        opacity: f.innerGlow.opacity ?? 0.5,
        contour: contourFromPsd(f.innerGlow.contour),
        antialiased: f.innerGlow.antialiased === true,
        range: glowRangeFromPsd(f.innerGlow.range),
      }
    const overlays = (f.solidFill || [])
      .filter((v) => v.enabled !== false)
      .slice(0, MAX_STYLE_INSTANCES)
      .map((overlay) => ({
        enabled: true,
        color: hex(overlay.color),
        opacity: overlay.opacity ?? 1,
      }))
    if (overlays.length) s.overlays = overlays
    const gradients = (f.gradientOverlay || [])
      .filter((v) => v.enabled !== false)
      .slice(0, MAX_STYLE_INSTANCES)
      .flatMap((item) => {
        const gradient = gradientFromPsd(item.gradient)
        return gradient
          ? [
              {
                enabled: true,
                gradient,
                shape: parseGradientShape(item.type, 'linear'),
                scale: Math.min(4, Math.max(0.1, item.scale ?? 1)),
                angle: -(item.angle || 0),
                opacity: item.opacity ?? 1,
                reverse: item.reverse === true,
              },
            ]
          : []
      })
    if (gradients.length) s.gradients = gradients
    const patternOverlay = f.patternOverlay
    if (patternOverlay?.enabled !== false && patternOverlay) {
      const pattern = resolvePsdPattern(patternOverlay.pattern, patternDefinitions, warn)
      if (pattern)
        s.pattern = {
          enabled: true,
          pattern,
          scale: Math.min(10, Math.max(0.05, patternOverlay.scale ?? 1)),
          opacity: patternOverlay.opacity ?? 1,
          phaseX: Math.min(10000, Math.max(-10000, patternOverlay.phase?.x || 0)),
          phaseY: Math.min(10000, Math.max(-10000, patternOverlay.phase?.y || 0)),
          align: patternOverlay.align !== false,
        }
    }
    const bevel = f.bevel?.enabled !== false ? f.bevel : undefined
    if (bevel) {
      const highlightBlendMode = bevel.highlightBlendMode
        ? toCanvas[bevel.highlightBlendMode]
        : 'screen'
      const shadowBlendMode = bevel.shadowBlendMode ? toCanvas[bevel.shadowBlendMode] : 'multiply'
      if (!highlightBlendMode || !shadowBlendMode)
        warn?.(
          'Режим смешивания блика или тени Bevel & Emboss не поддерживается рабочим движком и заменён стандартным Screen/Multiply.',
        )
      if (bevel.useTexture)
        warn?.(
          'Текстура Bevel & Emboss не импортирована: ag-psd передаёт только флаг useTexture без узора, масштаба и глубины текстуры. Основная фаска редактируется без текстуры.',
        )
      // ag-psd maps both Bevel keys into one field: TrnS is Gloss Contour,
      // while MpgS is the separate Contour element (the bevel cross-section).
      // The gloss curve can therefore be trusted only when that element is
      // off. Never reinterpret a possible cross-section as gloss.
      const canImportGlossContour = bevel.useShape !== true
      if (!canImportGlossContour)
        warn?.(
          'Элемент Contour у Bevel & Emboss (форма сечения фаски) не импортирован: ag-psd объединяет его кривую MpgS и Gloss Contour TrnS в одно поле, поэтому доступную кривую нельзя честно отнести к глянцу. Основная фаска открыта с линейным контуром глянца.',
        )
      s.bevel = {
        enabled: true,
        style: bevelStyleFromPsd[bevel.style || 'inner bevel'] || 'inner',
        technique: bevelTechniqueFromPsd[bevel.technique || 'smooth'] || 'smooth',
        depth: Math.min(10, Math.max(0.01, bevel.strength ?? 1)),
        direction: bevel.direction === 'down' ? 'down' : 'up',
        size: Math.min(STYLE_LIMITS.bevelSize, Math.max(0, (bevel.size?.value || 0) * scale)),
        soften: Math.min(STYLE_LIMITS.bevelSoften, Math.max(0, (bevel.soften?.value || 0) * scale)),
        angle: wrapPsdAngle(bevel.angle ?? 120),
        altitude: Math.min(90, Math.max(0, bevel.altitude ?? 30)),
        useGlobalLight: bevel.useGlobalLight !== false,
        highlightColor: hex(bevel.highlightColor, '#ffffff'),
        highlightBlendMode: highlightBlendMode || 'screen',
        highlightOpacity: bevel.highlightOpacity ?? 0.75,
        shadowColor: hex(bevel.shadowColor, '#000000'),
        shadowBlendMode: shadowBlendMode || 'multiply',
        shadowOpacity: bevel.shadowOpacity ?? 0.75,
        glossContour: canImportGlossContour
          ? contourFromPsd(bevel.contour)
          : contourFromPsd(undefined),
        antialiasGloss: bevel.antialiasGloss === true,
      }
    }
    const satin = f.satin?.enabled !== false ? f.satin : undefined
    if (satin) {
      const satinBlendMode = satin.blendMode ? toCanvas[satin.blendMode] : 'multiply'
      if (!satinBlendMode)
        warn?.(
          'Режим смешивания Satin не поддерживается рабочим движком и заменён стандартным Multiply.',
        )
      s.satin = {
        enabled: true,
        color: hex(satin.color, '#000000'),
        blendMode: satinBlendMode || 'multiply',
        opacity: satin.opacity ?? 0.5,
        angle: wrapPsdAngle(satin.angle ?? 19),
        distance: Math.min(
          STYLE_LIMITS.satinDistance,
          Math.max(0, (satin.distance?.value || 0) * scale),
        ),
        size: Math.min(STYLE_LIMITS.satinSize, Math.max(0, (satin.size?.value || 0) * scale)),
        invert: satin.invert !== false,
        antialiased: satin.antialiased === true,
        contour: contourFromPsd(satin.contour),
      }
    }
  }
  return hasStyles(s) ? s : undefined
}
function exportStyles(
  s: LayerStyles,
  patternRef: (definition: PatternDefinition) => EffectPattern = (definition) => ({
    id: definition.id,
    name: definition.name,
  }),
): LayerEffectsInfo {
  const effects: LayerEffectsInfo = { scale: 1 }
  const strokes = s.strokes.filter((e) => e.enabled)
  if (strokes.length)
    effects.stroke = strokes.map((stroke) =>
      stroke.fill === 'pattern' && stroke.pattern
        ? {
            enabled: true,
            position: stroke.position,
            fillType: 'pattern' as const,
            size: px(stroke.size),
            opacity: stroke.opacity,
            blendMode: 'normal' as const,
            pattern: patternRef(stroke.pattern),
          }
        : stroke.fill === 'gradient' && stroke.gradient
          ? {
              enabled: true,
              position: stroke.position,
              fillType: 'gradient' as const,
              size: px(stroke.size),
              opacity: stroke.opacity,
              blendMode: 'normal' as const,
              gradient: {
                ...gradientToPsd(stroke.gradient),
                style: stroke.gradientShape,
                angle: -stroke.gradientAngle,
                scale: stroke.gradientScale,
                reverse: stroke.gradientReverse,
              },
            }
          : {
              enabled: true,
              position: stroke.position,
              fillType: 'color' as const,
              size: px(stroke.size),
              color: rgb(stroke.color),
              opacity: stroke.opacity,
              blendMode: 'normal' as const,
            },
    )
  const shadowTo = (shadow: LayerStyles['shadows'][number]) => ({
    enabled: true,
    color: rgb(shadow.color),
    size: px(shadow.blur),
    distance: px(Math.hypot(shadow.x, shadow.y)),
    angle: (Math.atan2(shadow.y, -shadow.x) * 180) / Math.PI,
    opacity: shadow.opacity,
    blendMode: 'multiply' as const,
    useGlobalLight: false,
    antialiased: shadow.antialiased === true,
    contour: contourToPsd(shadow.contour),
  })
  const shadows = s.shadows.filter((e) => e.enabled)
  if (shadows.length) effects.dropShadow = shadows.map(shadowTo)
  const innerShadows = s.innerShadows.filter((e) => e.enabled)
  if (innerShadows.length) effects.innerShadow = innerShadows.map(shadowTo)
  if (s.glow.enabled)
    effects.outerGlow = {
      enabled: true,
      color: rgb(s.glow.color),
      size: px(s.glow.blur),
      opacity: s.glow.opacity,
      blendMode: 'screen',
      antialiased: s.glow.antialiased === true,
      contour: contourToPsd(s.glow.contour),
      range: glowRangeFromPsd(s.glow.range),
    }
  if (s.innerGlow.enabled)
    effects.innerGlow = {
      enabled: true,
      color: rgb(s.innerGlow.color),
      size: px(s.innerGlow.blur),
      opacity: s.innerGlow.opacity,
      blendMode: 'screen',
      source: 'edge',
      antialiased: s.innerGlow.antialiased === true,
      contour: contourToPsd(s.innerGlow.contour),
      range: glowRangeFromPsd(s.innerGlow.range),
    }
  const overlays = s.overlays.filter((e) => e.enabled)
  if (overlays.length)
    effects.solidFill = overlays.map((overlay) => ({
      enabled: true,
      color: rgb(overlay.color),
      opacity: overlay.opacity,
      blendMode: 'normal' as const,
    }))
  const gradients = s.gradients.filter((e) => e.enabled)
  if (gradients.length)
    effects.gradientOverlay = gradients.map((item) => ({
      enabled: true,
      type: item.shape,
      angle: -item.angle,
      opacity: item.opacity,
      blendMode: 'normal',
      scale: item.scale,
      align: true,
      reverse: item.reverse,
      gradient: gradientToPsd(item.gradient),
    }))
  if (s.pattern.enabled)
    effects.patternOverlay = {
      enabled: true,
      blendMode: 'normal',
      opacity: s.pattern.opacity,
      scale: s.pattern.scale,
      pattern: patternRef(s.pattern.pattern),
      phase: { x: s.pattern.phaseX, y: s.pattern.phaseY },
      align: s.pattern.align,
    }
  if (s.bevel.enabled)
    effects.bevel = {
      enabled: true,
      style: bevelStyleToPsd[s.bevel.style],
      technique: bevelTechniqueToPsd[s.bevel.technique],
      strength: s.bevel.depth,
      direction: s.bevel.direction,
      size: px(s.bevel.size),
      soften: px(s.bevel.soften),
      angle: s.bevel.angle,
      altitude: s.bevel.altitude,
      useGlobalLight: s.bevel.useGlobalLight,
      highlightColor: rgb(s.bevel.highlightColor),
      highlightBlendMode: toPsd[s.bevel.highlightBlendMode],
      highlightOpacity: s.bevel.highlightOpacity,
      shadowColor: rgb(s.bevel.shadowColor),
      shadowBlendMode: toPsd[s.bevel.shadowBlendMode],
      shadowOpacity: s.bevel.shadowOpacity,
      useTexture: false,
      useShape: false,
      antialiasGloss: s.bevel.antialiasGloss === true,
      // ag-psd serializes Bevel `contour` as TrnS, i.e. Gloss Contour. It is
      // not the unsupported MpgS cross-section element (hence useShape false).
      contour: contourToPsd(s.bevel.glossContour),
    }
  if (s.satin.enabled)
    effects.satin = {
      enabled: true,
      blendMode: toPsd[s.satin.blendMode],
      color: rgb(s.satin.color),
      opacity: s.satin.opacity,
      angle: s.satin.angle,
      distance: px(s.satin.distance),
      size: px(s.satin.size),
      invert: s.satin.invert,
      antialiased: s.satin.antialiased,
      contour: contourToPsd(s.satin.contour),
    }
  return effects
}
interface PsdPatternRegistry {
  patterns: PatternInfo[]
  build: (doc: EditorDocument) => Promise<void>
  ref: (definition: PatternDefinition) => EffectPattern
}
function createPsdPatternRegistry(original?: Psd): PsdPatternRegistry {
  const patterns: PatternInfo[] = []
  const byContent = new Map<string, EffectPattern>()
  const byId = new Map<string, string>()
  const originalById = new Map<string, PatternInfo>()
  if (original)
    for (const info of collectPsdPatternInfos(original)) {
      const id = cleanPatternId(info.id)
      if (!id) continue
      const clean = { ...info, id, name: cleanPatternName(info.name) }
      patterns.push(clean)
      originalById.set(id, clean)
      byId.set(id, `original:${id}`)
    }
  const contentKey = (definition: PatternDefinition) =>
    `${patternContentKey(definition)}|${cleanPatternName(definition.name)}|${definition.psdX || 0}|${definition.psdY || 0}|${definition.boundsX || 0}|${definition.boundsY || 0}`
  const sameOriginal = (definition: PatternDefinition, info: PatternInfo) =>
    definition.kind === 'image' &&
    cleanPatternName(definition.name) === cleanPatternName(info.name) &&
    definition.width === info.bounds.w &&
    definition.height === info.bounds.h &&
    (definition.psdX || 0) === info.x &&
    (definition.psdY || 0) === info.y &&
    (definition.boundsX || 0) === info.bounds.x &&
    (definition.boundsY || 0) === info.bounds.y
  const add = async (definition: PatternDefinition) => {
    const key = contentKey(definition)
    if (byContent.has(key)) return
    const originalInfo = originalById.get(definition.id)
    if (originalInfo && sameOriginal(definition, originalInfo)) {
      byContent.set(key, { id: definition.id, name: definition.name })
      byId.set(definition.id, key)
      return
    }
    const tile = await patternTileCanvasAsync(definition)
    const pixels = tile
      .getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, tile.width, tile.height)
    let id = cleanPatternId(definition.id) || deterministicPatternId(definition)
    if (byId.has(id) && byId.get(id) !== key) id = deterministicPatternId(definition)
    let suffix = 1
    while (byId.has(id) && byId.get(id) !== key)
      id = deterministicPatternId({ ...definition, seed: definition.seed + suffix++ })
    const ref = { id, name: cleanPatternName(definition.name) }
    patterns.push(patternInfoFromPixels(definition, pixels, ref))
    byContent.set(key, ref)
    byId.set(id, key)
  }
  return {
    patterns,
    async build(doc) {
      for (const definition of collectPatternDefinitions(doc)) await add(definition)
    },
    ref(definition) {
      return byContent.get(contentKey(definition)) || { id: definition.id, name: definition.name }
    },
  }
}
type PsdBlendingRanges = NonNullable<PsdLayer['blendingRanges']>
function importBlendIf(src: PsdLayer): BlendIfRanges | undefined {
  const r = src.blendingRanges
  if (!r) return undefined
  const channel = (source?: number[], under?: number[]) => ({ source, under })
  return parseBlendIf({
    gray: channel(r.compositeGrayBlendSource, r.compositeGraphBlendDestinationRange),
    red: channel(r.ranges?.[0]?.sourceRange, r.ranges?.[0]?.destRange),
    green: channel(r.ranges?.[1]?.sourceRange, r.ranges?.[1]?.destRange),
    blue: channel(r.ranges?.[2]?.sourceRange, r.ranges?.[2]?.destRange),
  })
}
function exportBlendIf(ranges: BlendIfRanges | undefined): PsdBlendingRanges | undefined {
  if (!ranges || !isBlendIfActive(ranges)) return undefined
  const pair = (key: 'red' | 'green' | 'blue') => ({
    sourceRange: [...ranges[key].source],
    destRange: [...ranges[key].under],
  })
  return {
    compositeGrayBlendSource: [...ranges.gray.source],
    compositeGraphBlendDestinationRange: [...ranges.gray.under],
    ranges: [pair('red'), pair('green'), pair('blue')],
  }
}
export const __psdStyleCodecForTests = {
  importStyles,
  exportStyles,
  gradientFromPsd,
  gradientToPsd,
  importBlendIf,
  exportBlendIf,
  patternInfoFromPixels,
}
interface EmbeddedImport {
  depth: number
  budget: { documents: number; bytes: number; pixels: number }
}
const smartDepth = (doc: EditorDocument): number =>
  Math.max(0, ...doc.layers.map((l) => (l.smart ? 1 + smartDepth(l.smart) : 0)))
export async function importPsd(
  buffer: ArrayBuffer,
  name: string,
  nested: EmbeddedImport = { depth: 0, budget: { documents: 0, bytes: 0, pixels: 0 } },
): Promise<{ document: EditorDocument; report: CompatibilityReport }> {
  const header = validatePsdHeader(buffer),
    original = buffer.slice(0)
  let embeddedProfile: ParsedColorProfile | undefined
  let embeddedProfileInvalid = false
  let explicitlyUntagged = false
  let resourceWarning: string | undefined
  try {
    const icc = imageResourceData(original, 1039)
    const untagged = imageResourceData(original, 1041)
    explicitlyUntagged = untagged?.[0] === 1
    if (icc) {
      embeddedProfile = parseIccProfile(icc)
      embeddedProfileInvalid = !embeddedProfile
    }
  } catch {
    resourceWarning =
      'Секция image resources PSD повреждена: встроенный ICC-профиль прочитать не удалось.'
  }
  const { psd, messages, project } = await runCodec<{
    psd: Psd
    messages: string[]
    project?: unknown
  }>({ operation: 'read', buffer }, [buffer])
  const warnings = new Set<string>()
  if (resourceWarning) warnings.add(resourceWarning)
  if (messages.includes('FSH777_STALE_XMP'))
    warnings.add(
      'Файл изменён после сохранения ФШ777. Устаревший внутренний проект проигнорирован: читаются настоящие слои PSD, включая внешние изменения текста и фигур.',
    )
  if (messages.includes('FSH777_INVALID_XMP'))
    warnings.add(
      'Внутренние метаданные проекта повреждены или превышают лимит. Читаются настоящие слои PSD; исходный файл сохранён отдельно.',
    )
  if (messages.includes('FSH777_LEGACY_XMP'))
    warnings.add(
      'Это старый PSD ФШ777 без проверки целостности XMP. Для защиты от устаревших внутренних данных сохрани новую копию в текущей версии.',
    )
  let doc = newDocument(psd.width, psd.height, name.replace(/\.(psd|psb)$/i, ''), 'transparent')
  if (project) {
    const own = parseProject(project)
    if (own.width !== psd.width || own.height !== psd.height)
      throw new Error('Размеры встроенного проекта не совпадают с PSD')
    doc = { ...own, name: doc.name, sourceId: undefined }
    warnings.add(
      'Восстановлены редактируемые данные ФШ777 из стандартного XMP-блока. Файл также содержит обычные PSD-слои и объединённое изображение.',
    )
  } else {
    const patternDefinitions = collectPsdPatternDefinitions(psd)
    const visit = async (items: PsdLayer[], parentId?: string, path: number[] = []) => {
      for (const [index, src] of items.entries()) {
        if (doc.layers.length >= 100 || path.length > 12)
          throw new Error('До 100 слоёв и 12 уровней групп')
        const sourcePath = [...path, index],
          group = !!src.children
        const layer = makeLayer({
          kind: group ? 'group' : 'image',
          name: src.name || 'Слой',
          parentId,
          sourcePath,
          x: src.left ?? 0,
          y: src.top ?? 0,
          width: group ? doc.width : src.imageData?.width || 1,
          height: group ? doc.height : src.imageData?.height || 1,
          opacity: src.opacity ?? 1,
          visible: !src.hidden,
          locked: !!(src.protected?.composite || src.protected?.position),
          blendMode: toCanvas[src.blendMode || 'normal'] || 'source-over',
          expanded: src.opened !== false,
          isolated: src.blendMode !== 'pass through',
          clipping: src.clipping,
          sourceText: src.text?.text?.replace(/\r\n?/g, '\n'),
          styles: importStyles(src, patternDefinitions, (message) => warnings.add(message)),
          blendIf: importBlendIf(src),
        })
        const correction =
          !group && !src.vectorMask && !src.realMask && !src.effects
            ? importAdjustment(src.adjustment)
            : undefined
        if (correction)
          Object.assign(layer, {
            kind: 'adjustment',
            correction,
            x: 0,
            y: 0,
            width: doc.width,
            height: doc.height,
            styles: undefined,
          })
        if (src.adjustment && !correction)
          warnings.add(
            'Неподдерживаемый вариант корректирующего слоя сохранён с исходными данными. После правок его перерасчёт не гарантируется.',
          )
        if (correction)
          warnings.add(
            'Нативные корректирующие слои доступны для правки. Перерасчёт использует RGB/8 алгоритмы ФШ777 и может отличаться от Adobe; неизменённый оригинал сохраняется побайтно.',
          )
        if (!group && !correction) {
          if (src.imageData?.width && src.imageData.height) layer.src = imageSource(src.imageData)
          else {
            layer.src = canvas(1, 1).toDataURL()
            warnings.add(
              'Нерастровые/корректирующие слои без пикселей сохранены в структуре PSD, но не вычисляются рабочим рендерером.',
            )
          }
        }
        const editableShape = !group ? importVectorShape(src) : undefined
        const editableText = src.text
          ? await importNativeText(src.text, layer, (s) => warnings.add(s))
          : undefined
        if (editableText) Object.assign(layer, editableText)
        if (editableShape) Object.assign(layer, editableShape)
        if (src.placedLayer) {
          try {
            const linked = psd.linkedFiles?.find((f) => f.id === src.placedLayer!.id)
            const data = linked?.data
            if (!data?.byteLength) throw new Error('внешняя связь или нет встроенных данных')
            const bytes = data.slice().buffer as ArrayBuffer
            const embeddedHeader = validatePsdHeader(bytes)
            const placement = nativeSmartPlacement(
              src,
              embeddedHeader.width,
              embeddedHeader.height,
              layer.styles,
            )
            if (!placement)
              throw new Error(
                'неподдерживаемая внешняя маска, деформация, композиция, FX или smart filter',
              )
            const budget = nested.budget
            if (
              nested.depth >= 3 ||
              budget.documents >= 8 ||
              budget.bytes + bytes.byteLength > 32 * 1024 * 1024 ||
              budget.pixels + embeddedHeader.width * embeddedHeader.height > 32_000_000
            )
              throw new Error('достигнут бюджет раскрытия: 3 уровня, 8 PSD, 32 МиБ / 32 Мп')
            budget.documents++
            budget.bytes += bytes.byteLength
            budget.pixels += embeddedHeader.width * embeddedHeader.height
            let contents = await importPsd(bytes, linked?.name || layer.name + '.psd', {
              depth: nested.depth + 1,
              budget,
            })
            if (
              contents.report.color.status === 'mismatch' &&
              contents.report.color.conversionSupported &&
              contents.report.color.sourceModel
            ) {
              contents = {
                ...contents,
                document: await applyDocumentColorDecision(contents.document, {
                  action: 'convert',
                  source: contents.report.color.sourceModel,
                }),
              }
              warnings.add(
                `Вложенный PSD «${layer.name.slice(0, 100)}»: встроенный профиль ${contents.report.color.embeddedName || ''} автоматически преобразован в рабочее sRGB без отдельного вопроса.`,
              )
            } else if (
              contents.report.color.status === 'unsupported' ||
              contents.report.color.status === 'mode-mismatch'
            )
              warnings.add(
                `Вложенный PSD «${layer.name.slice(0, 100)}»: собственный ICC-профиль не преобразован (${contents.report.color.reason || 'неподдерживаемый тип'}); предпросмотр вложенного содержимого считается как sRGB, исходные байты смарт-объекта сохраняются до правки.`,
              )
            if (nested.depth + 1 + smartDepth(contents.document) > 3)
              throw new Error('более трёх уровней содержимого')
            const smart = { ...contents.document, id: uid() },
              pixels = await exportCanvas(smart),
              preview = pixels.toDataURL('image/png')
            cacheImage(preview, pixels)
            Object.assign(layer, placement, { kind: 'image', smart, src: preview })
            warnings.add(
              'Встроенные поддерживаемые PSD открываются как редактируемое смарт-содержимое без собственного XMP. После изменения предпросмотр и поддерживаемый Gaussian Blur пересчитываются движком ФШ777.',
            )
            for (const warning of contents.report.warnings)
              warnings.add(`Вложенный PSD «${layer.name.slice(0, 100)}»: ${warning}`)
          } catch (error) {
            warnings.add(
              `Смарт-объект «${layer.name.slice(0, 100)}» оставлен исходным с растровым предпросмотром: ${error instanceof Error ? error.message : 'не удалось раскрыть PSD'}. Native-данные сохраняются, пока содержимое не заменено.`,
            )
          }
        }
        if (!editableShape && src.vectorFill && src.vectorMask)
          warnings.add(
            'Часть векторных фигур использует неподдерживаемую заливку или логические операции контуров: исходная структура сохраняется, предпросмотр растровый.',
          )
        if (src.mask?.imageData && !(editableShape && src.mask.fromVectorData)) {
          const m = src.mask,
            data = m.imageData!
          layer.mask = {
            src: imageSource(data),
            x: (m.left || 0) + (m.positionRelativeToLayer ? src.left || 0 : 0),
            y: (m.top || 0) + (m.positionRelativeToLayer ? src.top || 0 : 0),
            width: data.width,
            height: data.height,
            enabled: !m.disabled,
            linked: true,
            defaultColor: m.defaultColor ?? 255,
            density: m.userMaskDensity ?? 1,
            feather: m.userMaskFeather || 0,
          }
        }
        doc.layers.push(layer)
        if (group) await visit(src.children!, layer.id, sourcePath)
        if (src.effects)
          warnings.add(
            'Исходные эффекты сохраняются для неизменённого содержимого слоёв. Их рабочий предпросмотр может отличаться; до первого изменения показывается исходный композит.',
          )
        if (src.text && !editableText)
          warnings.add(
            'Сложный, вертикальный или неоднородно оформленный текст сохранён с исходными native-данными и пиксельным предпросмотром. «Извлечь текст» создаст редактируемую упрощённую копию; оригинал остаётся в PSD.',
          )
        if (
          (src.vectorMask && !editableShape) ||
          src.realMask ||
          !toCanvas[src.blendMode || 'normal']
        )
          warnings.add(
            'Сложные маски или режимы смешивания не полностью воспроизводятся после редактирования; не перезаписывай единственный оригинал.',
          )
      }
    }
    await visit(psd.children || [])
    if (!doc.layers.length && psd.imageData)
      doc.layers.push(
        makeLayer({
          kind: 'image',
          name: 'Объединённое изображение',
          width: doc.width,
          height: doc.height,
          src: imageSource(psd.imageData),
        }),
      )
    if (messages.length)
      warnings.add(
        'Декодер сообщил о неподдерживаемых метаданных. Неизменённый оригинал сохраняется целиком; после правок неизвестные блоки могут быть потеряны.',
      )
  }
  if (!doc.layout && psd.imageResources?.gridAndGuidesInformation) {
    const information = psd.imageResources.gridAndGuidesInformation
    doc.layout = normalizeLayout({
      guides: information.guides?.map((g) => ({
        id: uid(),
        axis: g.direction === 'vertical' ? 'x' : 'y',
        position: g.location,
      })),
      gridSize: (information.grid?.horizontal || 2048) / 32,
      gridSizeY: (information.grid?.vertical || 2048) / 32,
    })
    if ((information.guides?.length || 0) !== doc.layout.guides.length)
      warnings.add(
        'Часть направляющих вне поддерживаемого бюджета (200 / 16384 px) не показана. Пока макет направляющих не изменён, исходный ресурс PSD сохраняется.',
      )
  }
  const colorMode = header.mode === 1 ? 'grayscale' : 'rgb'
  let color: PsdColorProfileReport
  if (project) {
    color = {
      mode: colorMode,
      status: 'own',
      embeddedName: embeddedProfile?.name,
      embeddedKind: embeddedProfile?.colorSpace,
      profile: embeddedProfile,
      sourceModel: embeddedProfile?.model,
      conversionSupported: !!embeddedProfile?.model && !embeddedProfile.unsupportedReason,
      reason: embeddedProfile?.unsupportedReason,
      explicitlyUntagged,
    }
  } else if (embeddedProfileInvalid) {
    const reason =
      'Ресурс ICC 1039 есть, но это не корректный ICC-профиль (нет подписи acsp или размер обрезан).'
    color = {
      mode: colorMode,
      status: 'unsupported',
      conversionSupported: false,
      reason,
      explicitlyUntagged,
    }
    doc.colorProfile = untaggedDocumentColorProfile()
    warnings.add(`Цветовой профиль PSD: ${reason}`)
  } else if (!embeddedProfile) {
    color = {
      mode: colorMode,
      status: 'missing',
      conversionSupported: false,
      explicitlyUntagged,
    }
    doc.colorProfile = untaggedDocumentColorProfile()
    warnings.add('PSD не содержит встроенного ICC-профиля (ресурс 1039).')
  } else if (!embeddedProfile.model || embeddedProfile.unsupportedReason) {
    const reason = embeddedProfile.unsupportedReason || 'Тип ICC-профиля не поддерживается.'
    color = {
      mode: colorMode,
      status: 'unsupported',
      embeddedName: embeddedProfile.name,
      embeddedKind: embeddedProfile.colorSpace,
      profile: embeddedProfile,
      conversionSupported: false,
      reason,
      explicitlyUntagged,
    }
    doc.colorProfile = untaggedDocumentColorProfile()
    warnings.add(
      `Встроенный профиль «${embeddedProfile.name}» распознан, но не преобразован: ${reason}`,
    )
  } else if (
    (colorMode === 'rgb' && embeddedProfile.model.kind !== 'rgb') ||
    (colorMode === 'grayscale' && embeddedProfile.model.kind !== 'gray')
  ) {
    const reason =
      colorMode === 'rgb'
        ? 'Профиль серого нельзя применить к RGB-документу.'
        : 'RGB-профиль нельзя применить к документу в оттенках серого.'
    color = {
      mode: colorMode,
      status: 'mode-mismatch',
      embeddedName: embeddedProfile.name,
      embeddedKind: embeddedProfile.colorSpace,
      profile: embeddedProfile,
      sourceModel: embeddedProfile.model,
      conversionSupported: false,
      reason,
      explicitlyUntagged,
    }
    doc.colorProfile = untaggedDocumentColorProfile()
    warnings.add(
      `Встроенный профиль «${embeddedProfile.name}» не соответствует режиму PSD: ${reason}`,
    )
  } else if (
    (colorMode === 'rgb' && isSrgbProfile(embeddedProfile)) ||
    (colorMode === 'grayscale' &&
      profilesMatch(embeddedProfile.model, builtinColorProfile('sgray')!))
  ) {
    color = {
      mode: colorMode,
      status: 'matching',
      embeddedName: embeddedProfile.name,
      embeddedKind: embeddedProfile.colorSpace,
      profile: embeddedProfile,
      sourceModel: embeddedProfile.model,
      conversionSupported: true,
      explicitlyUntagged,
    }
    doc.colorProfile = workingDocumentColorProfile(
      colorMode === 'grayscale' ? { convertedFrom: embeddedProfile.name } : {},
    )
    warnings.add(
      colorMode === 'grayscale'
        ? `Цветовой профиль: ${embeddedProfile.name}. Его кривая совпадает с sRGB, поэтому оттенки серого открыты в рабочей RGB-модели без изменения кодов.`
        : `Цветовой профиль: ${embeddedProfile.name} — совпадает с рабочим пространством sRGB IEC61966-2.1.`,
    )
  } else {
    color = {
      mode: colorMode,
      status: 'mismatch',
      embeddedName: embeddedProfile.name,
      embeddedKind: embeddedProfile.colorSpace,
      profile: embeddedProfile,
      sourceModel: embeddedProfile.model,
      conversionSupported: true,
      explicitlyUntagged,
    }
    // Provisional only: the UI/batch caller must apply the profile decision
    // before opening. Untagged describes the fallback preview interpretation.
    doc.colorProfile = untaggedDocumentColorProfile()
    warnings.add(
      `Встроенный цветовой профиль «${embeddedProfile.name}» отличается от рабочего пространства sRGB IEC61966-2.1.`,
    )
  }
  doc = parseProject({
    ...doc,
    dpi: psd.imageResources?.resolutionInfo?.horizontalResolution || doc.dpi || 72,
    sourceId: uid(),
  })
  const composite = psd.imageData ? imageSource(psd.imageData) : undefined
  if (
    !(await registerSource({
      id: doc.sourceId!,
      bytes: original,
      baseline: doc,
      composite,
      psb: header.psb,
    }))
  )
    warnings.add(
      'Исходные байты PSD не записаны в локальное хранилище. Сохрани отдельный файл; после перезапуска побайтное восстановление оригинала не гарантируется.',
    )
  return {
    document: doc,
    report: {
      title: name,
      format: header.psb ? 'PSB' : 'PSD',
      warnings: [...warnings],
      layerCount: doc.layers.length,
      color,
    },
  }
}
function layerAt(psd: Psd | undefined, path?: number[]): PsdLayer | undefined {
  let children = psd?.children,
    layer: PsdLayer | undefined
  for (const index of path || []) {
    layer = children?.[index]
    children = layer?.children
  }
  return layer
}
function unchangedContent(a: Layer, b?: Layer) {
  if (!b || !sameEmbeddedContent(a.smart, b.smart)) return false
  // Translation and compositing can be updated without rasterizing native type/masks/effects.
  const clean = (l: Layer) => ({
    ...l,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    parentId: undefined,
    blendMode: 'source-over',
    mask: undefined,
    styles: undefined,
    clipping: false,
  })
  return sameVisual(clean(a), clean(b))
}
/** Bake scalar colour adjustments into editable paint, never into the layer type. */
function nativePaint(layer: Layer): Layer {
  const adjusted = Object.entries(layer.adjustments).some(
    ([key, value]) => key !== 'blur' && value !== 0,
  )
  if (!adjusted) return { ...layer, adjustments: { ...DEFAULT_ADJUSTMENTS } }
  const c = canvas(3, 3),
    ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = filterString({ ...layer, adjustments: { ...layer.adjustments, blur: 0 } })
  const color = (value: string) => {
    ctx.clearRect(0, 0, 3, 3)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 3, 3)
    const p = ctx.getImageData(1, 1, 1, 1).data
    return '#' + [...p.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')
  }
  return {
    ...layer,
    color: color(layer.color),
    strokeColor: layer.strokeColor ? color(layer.strokeColor) : undefined,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  }
}
export async function exportPsd(
  doc: EditorDocument,
  psb = false,
  depth = 0,
  report?: (summary: PsdExportReport) => void,
): Promise<Blob> {
  if (depth > 3) throw new Error('Слишком глубокий смарт-объект')
  await prepareDocument(doc)
  const source = originalSource(doc)
  if (source && source.psb === psb && isOriginalDocument(doc)) {
    report?.({
      ...inspectNativeLayers({ width: doc.width, height: doc.height }, []),
      original: true,
    })
    return new Blob([source.bytes], { type: 'image/vnd.adobe.photoshop' })
  }
  let original: Psd | undefined
  if (source) {
    const copy = source.bytes.slice(0)
    original = (await runCodec<{ psd: Psd }>({ operation: 'read', buffer: copy }, [copy])).psd
  }
  const appearanceUnchanged = !!source && isOriginalAppearance(doc)
  const imageData =
    original?.imageData && appearanceUnchanged
      ? original.imageData
      : (await exportCanvas(doc)).getContext('2d')!.getImageData(0, 0, doc.width, doc.height)
  let budget = doc.width * doc.height * 4
  const allocate = (width: number, height: number) => {
    budget += width * height * 4
    if (budget > 192 * 1024 * 1024)
      throw new Error('PSD: более 192 МиБ растров. Объедини часть слоёв.')
    return canvas(width, height)
  }
  const rasterPreview = (layer: Layer, embeddedAppearance = false): PsdLayer => {
    const bounds = worldBounds(layer, true, embeddedAppearance)
    const left = Math.floor(bounds.x),
      top = Math.floor(bounds.y)
    const right = Math.ceil(bounds.x + bounds.width),
      bottom = Math.ceil(bounds.y + bounds.height)
    const c = allocate(right - left, bottom - top),
      ctx = c.getContext('2d')!
    ctx.translate(-left, -top)
    renderLayer(ctx, {
      ...layer,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      styles: embeddedAppearance ? layer.styles : undefined,
      mask: embeddedAppearance ? layer.mask : undefined,
    })
    const preview = ctx.getImageData(0, 0, c.width, c.height)
    if (
      layer.kind === 'text' &&
      !layer.warp &&
      !layer.mask &&
      !hasStyles(layer.styles) &&
      Object.values(layer.adjustments).every((v) => v === 0)
    )
      canonicalTextPreview(preview, layer.color)
    return { left, top, right, bottom, imageData: preview }
  }
  const notes: string[] = []
  let editableContents = 0
  const paths = new Map<string, number[]>(),
    linkedFiles = [...(original?.linkedFiles || [])]
  const patternRegistry = createPsdPatternRegistry(original)
  await patternRegistry.build(doc)
  if (collectPatternDefinitions(doc).length)
    notes.push(
      'Узоры записаны как нативные PSD Patt-ресурсы и ссылки Pattern Overlay/обводки. Процедурные параметры плиток ФШ777 дополнительно хранятся в XMP; другой редактор получит готовую плитку и сможет менять масштаб/фазу эффекта.',
    )
  const build = async (
    parentId?: string,
    parentPath: number[] = [],
    rootOffset = 0,
  ): Promise<PsdLayer[]> => {
    const output: PsdLayer[] = []
    for (const layer of doc.layers.filter((l) => l.parentId === parentId)) {
      const path = [...parentPath, output.length + rootOffset]
      paths.set(layer.id, path)
      const before = source?.baseline.layers.find((l) => l.id === layer.id),
        raw = layerAt(original, layer.sourcePath)
      const preserved = raw && unchangedContent(layer, before)
      // The working renderer transforms local effects together with the source. Native
      // outer FX would instead redraw them in document space. Keep those effects AND
      // their source mask inside the editable placed contents, not flattened or doubled.
      const embeddedAppearance =
        !preserved &&
        (layer.kind === 'text' || layer.kind === 'shape') &&
        !!layer.warp &&
        hasStyles(layer.styles)
      let out: PsdLayer = {}
      if (preserved) {
        out = { ...raw }
        const dx = Math.round(layer.x - before!.x),
          dy = Math.round(layer.y - before!.y)
        for (const key of ['left', 'right'] as const) if (out[key] !== undefined) out[key] += dx
        for (const key of ['top', 'bottom'] as const) if (out[key] !== undefined) out[key] += dy
        if (dx || dy) Object.assign(out, translateNativeVector(out, dx, dy))
        if (out.text && (dx || dy)) {
          const transform = [...(out.text.transform || [1, 0, 0, 1, 0, 0])]
          transform[4] += dx
          transform[5] += dy
          out.text = { ...out.text, transform }
        }
        if (out.placedLayer && (dx || dy))
          out.placedLayer = translateNativePlacement(out.placedLayer, dx, dy)
        // Once the document has visual edits, native cached previews must match
        // the working renderer as well as the merged image. Keep the original
        // placement/linked PSD/metadata; refresh pixels only, never flatten contents.
        if (layer.smart && !appearanceUnchanged) Object.assign(out, rasterPreview(layer))
      } else if (layer.kind === 'adjustment' && layer.correction) {
        out.adjustment = exportAdjustment(layer.correction)
        notes.push(
          'Корректирующие слои записаны как native adjustment layers с масками/opacity/clipping, не растрированы. Merged использует RGB/8 движок ФШ777; перерасчёт Adobe может отличаться, особенно в curves/HSL/vibrance/балансе цвета.',
        )
      } else if (layer.kind !== 'group') {
        out = rasterPreview(layer, embeddedAppearance)
        if (layer.kind === 'shape' || layer.kind === 'text') {
          const native = nativePaint(layer)
          if (Object.entries(layer.adjustments).some(([k, v]) => k !== 'blur' && v !== 0))
            notes.push(
              'Цветокоррекции текста и однотонных фигур пересчитаны в цвет редактируемой заливки/обводки. Исходные ползунки ФШ777 дополнительно хранятся в XMP.',
            )
          const warpedStroke =
            layer.kind === 'shape' && !!layer.warp && !!layer.strokeColor && !!layer.strokeWidth
          const embedded =
            embeddedAppearance ||
            warpedStroke ||
            !!layer.adjustments.blur ||
            (layer.kind === 'text' && !affineText(layer))
          if (!embedded) {
            if (layer.kind === 'shape') Object.assign(out, exportVectorShape(native, doc.dpi || 72))
            else out.text = exportNativeText(native)
          } else {
            const contents = {
              ...native,
              // Blur stays at the same stage relative to local FX. The nested export
              // supplies another editable smart filter instead of blurring the FX too.
              adjustments: {
                ...native.adjustments,
                blur: embeddedAppearance ? layer.adjustments.blur : 0,
              },
            }
            const bounds = rasterBounds(
              { ...contents, flipX: false, flipY: false },
              embeddedAppearance,
            )
            const inner = newDocument(
              Math.ceil(bounds.width),
              Math.ceil(bounds.height),
              layer.name,
              'transparent',
            )
            if (inner.width > 4096 || inner.height > 4096)
              throw new Error(
                'Редактируемый вложенный слой превышает 4096 px. Уменьши размер текста/фигуры перед экспортом сложного преобразования.',
              )
            inner.dpi = doc.dpi || 72
            inner.layers = [
              {
                ...contents,
                id: uid(),
                x: -bounds.x,
                y: -bounds.y,
                rotation: 0,
                warp: undefined,
                flipX: false,
                flipY: false,
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'source-over',
                clipping: false,
                parentId: undefined,
                styles: embeddedAppearance ? native.styles : undefined,
                mask:
                  embeddedAppearance && layer.mask
                    ? {
                        ...layer.mask,
                        x: layer.mask.x - layer.x - bounds.x,
                        y: layer.mask.y - layer.y - bounds.y,
                      }
                    : undefined,
                sourcePath: undefined,
                src: undefined,
                smart: undefined,
              },
            ]
            const nested = await exportPsd(inner, false, depth + 1),
              id = uid()
            linkedFiles.push({
              id,
              name: `${layer.name}.psd`,
              type: '8BPS',
              creator: '8BIM',
              data: new Uint8Array(await nested.arrayBuffer()),
            })
            const corners = rectPoints({
              ...bounds,
              width: inner.width,
              height: inner.height,
            }).flatMap((p) => {
              const q = layerPoint(layer, p)
              return [q.x, q.y]
            })
            out.placedLayer = {
              id,
              type: 'raster',
              width: inner.width,
              height: inner.height,
              transform: corners,
              nonAffineTransform: corners,
              resolution: { units: 'Density', value: inner.dpi },
              filter: gaussianSmartFilter(embeddedAppearance ? 0 : layer.adjustments.blur),
            }
            editableContents++
            notes.push(
              'Размытие, проективный текст или деформированная обводка/эффекты сохранены в стандартном смарт-объекте с вложенным редактируемым PSD, а не сведены в единственную картинку. Локальные эффекты и их маски находятся внутри, если это необходимо для порядка преобразований. Открой содержимое для правки текста/контуров; перерасчёт фильтра в другом редакторе может отличаться.',
            )
          }
        }
      }
      if (layer.kind === 'group') {
        out.children = await build(layer.id, path)
        out.opened = layer.expanded !== false
        out.blendMode = layer.isolated ? toPsd[layer.blendMode] : 'pass through'
      } else
        out.blendMode =
          preserved && before!.blendMode === layer.blendMode
            ? raw!.blendMode
            : toPsd[layer.blendMode]
      out.name = layer.name
      out.opacity = layer.opacity
      out.hidden = !layer.visible
      out.clipping = layer.clipping
      out.protected = { ...out.protected, composite: layer.locked, position: layer.locked }
      if (!preserved || !sameVisual(layer.styles, before?.styles)) {
        out.effects =
          !embeddedAppearance && layer.styles
            ? exportStyles(layer.styles, patternRegistry.ref)
            : undefined
        out.fillOpacity = embeddedAppearance ? 1 : (layer.styles?.fillOpacity ?? 1)
      }
      if (!preserved || !sameVisual(layer.blendIf, before?.blendIf))
        out.blendingRanges = exportBlendIf(layer.blendIf)
      if (layer.mask && !embeddedAppearance) {
        const m = layer.mask,
          old = before?.mask
        const unchangedMask =
          preserved &&
          raw?.mask &&
          old &&
          sameVisual({ ...m, x: 0, y: 0, enabled: true }, { ...old, x: 0, y: 0, enabled: true }) &&
          Math.abs(m.x - old.x - (layer.x - before!.x)) < 0.001 &&
          Math.abs(m.y - old.y - (layer.y - before!.y)) < 0.001
        if (unchangedMask) {
          const sourceMask = raw!.mask!,
            dx = m.x - old!.x + (sourceMask.positionRelativeToLayer ? before!.x : 0),
            dy = m.y - old!.y + (sourceMask.positionRelativeToLayer ? before!.y : 0)
          out.mask = {
            ...sourceMask,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            left: (sourceMask.left || 0) + dx,
            top: (sourceMask.top || 0) + dy,
            right: (sourceMask.right || 0) + dx,
            bottom: (sourceMask.bottom || 0) + dy,
          }
        } else if (out.imageData && (layer.rotation || layer.warp || layer.flipX || layer.flipY)) {
          // PSD raster masks live in document coordinates, unlike our editable local
          // transform. Derive coverage from the same rendered pixels, not an unrotated
          // mask rectangle. Keep hidden source pixels and an independent native mask.
          // Density/feather are baked into this transformed mask; XMP retains the controls.
          const data = out.imageData,
            c = allocate(data.width, data.height),
            x = c.getContext('2d')!
          x.translate(-(out.left || 0), -(out.top || 0))
          renderLayer(x, {
            ...layer,
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            styles: undefined,
            mask: { ...m, enabled: true },
          })
          const masked = x.getImageData(0, 0, c.width, c.height),
            maskPixels = new Uint8ClampedArray(masked.data.length)
          for (let i = 0; i < maskPixels.length; i += 4) {
            const alpha = m.enabled
              ? Math.max(data.data[i + 3], masked.data[i + 3])
              : data.data[i + 3]
            if (m.enabled && masked.data[i + 3]) {
              data.data[i] = masked.data[i]
              data.data[i + 1] = masked.data[i + 1]
              data.data[i + 2] = masked.data[i + 2]
            }
            data.data[i + 3] = alpha
            const coverage = alpha ? Math.round((masked.data[i + 3] * 255) / alpha) : 0
            maskPixels[i] = maskPixels[i + 1] = maskPixels[i + 2] = coverage
            maskPixels[i + 3] = 255
          }
          out.mask = {
            left: out.left,
            top: out.top,
            right: out.right,
            bottom: out.bottom,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            defaultColor: 0,
            userMaskDensity: 1,
            userMaskFeather: 0,
            imageData: { width: c.width, height: c.height, data: maskPixels },
          }
        } else {
          const img = await loadImage(m.src),
            c = allocate(Math.max(1, Math.round(m.width)), Math.max(1, Math.round(m.height)))
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
          out.mask = {
            ...out.mask,
            left: Math.round(m.x),
            top: Math.round(m.y),
            right: Math.round(m.x) + c.width,
            bottom: Math.round(m.y) + c.height,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            defaultColor: m.defaultColor,
            userMaskDensity: m.density,
            userMaskFeather: m.feather,
            imageData: c.getContext('2d')!.getImageData(0, 0, c.width, c.height),
          }
        }
      } else out.mask = undefined
      if (layer.smart && !preserved) {
        const nested = await exportPsd(layer.smart, false, depth + 1),
          id = uid()
        linkedFiles.push({
          id,
          name: `${layer.name}.psd`,
          type: '8BPS',
          creator: '8BIM',
          data: new Uint8Array(await nested.arrayBuffer()),
        })
        const a = (layer.rotation * Math.PI) / 180,
          cx = layer.x + layer.width / 2,
          cy = layer.y + layer.height / 2
        const quad = layer.warp || [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ]
        const order =
          layer.flipX && layer.flipY
            ? [2, 3, 0, 1]
            : layer.flipX
              ? [1, 0, 3, 2]
              : layer.flipY
                ? [3, 2, 1, 0]
                : [0, 1, 2, 3]
        const corners = order
          .map((i) => quad[i])
          .flatMap((p) => {
            const x = (p.x - 0.5) * layer.width,
              y = (p.y - 0.5) * layer.height
            return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]
          })
        out.placedLayer = {
          id,
          type: 'raster',
          width: layer.smart.width,
          height: layer.smart.height,
          transform: corners,
          nonAffineTransform: corners,
          resolution: { units: 'Density', value: layer.smart.dpi || 72 },
          filter: gaussianSmartFilter(layer.adjustments.blur),
        }
      }
      output.push(out)
    }
    return output
  }
  const children: PsdLayer[] = []
  if (doc.background !== 'transparent') {
    const c = allocate(doc.width, doc.height),
      ctx = c.getContext('2d')!
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, c.width, c.height)
    children.push({
      name: 'Фон холста',
      imageData: ctx.getImageData(0, 0, c.width, c.height),
      left: 0,
      top: 0,
    })
  }
  children.push(...(await build(undefined, [], children.length)))
  const portable = {
    ...doc,
    sourceId: undefined,
    layers: await Promise.all(
      doc.layers.map(async (l) => {
        let src = l.src
        if (src?.startsWith('/')) {
          const img = await loadImage(src),
            c = canvas(img.width, img.height)
          c.getContext('2d')!.drawImage(img, 0, 0)
          src = c.toDataURL('image/png')
        }
        return { ...l, src, sourcePath: paths.get(l.id) }
      }),
    ),
  }
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    children,
    imageData,
    linkedFiles,
    patterns: patternRegistry.patterns.length ? patternRegistry.patterns : undefined,
    imageResources: {
      ...original?.imageResources,
      versionInfo: {
        hasRealMergedData: true,
        writerName: 'ФШ777',
        readerName: 'ФШ777',
        fileVersion: 1,
      },
      resolutionInfo: {
        horizontalResolution: doc.dpi || 72,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: doc.dpi || 72,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches',
      },
      iccUntaggedProfile: doc.colorProfile?.status === 'untagged',
    },
  }
  if (doc.layout && (!original || !sameNativeLayout(doc.layout, source?.baseline.layout))) {
    psd.imageResources!.gridAndGuidesInformation = nativeLayout(doc.layout)
    if (
      (original?.imageResources?.gridAndGuidesInformation?.guides?.length || 0) >
      (source?.baseline.layout?.guides.length || 0)
    )
      notes.push(
        'Макет направляющих изменён. Неподдерживаемые исходные направляющие вне отображённого набора не перенесены; исходный файл не перезаписывай без резервной копии.',
      )
  }
  if (doc.colorProfile?.status === 'untagged')
    notes.push(
      'Документ помечен как без цветового профиля: пересобранный PSD записан без ICC (ресурс 1041 = untagged). Другие программы будут интерпретировать числа по своему рабочему пространству.',
    )
  else if (doc.colorProfile?.convertedFrom)
    notes.push(
      `Цвета документа ранее преобразованы из «${doc.colorProfile.convertedFrom}» в рабочее sRGB IEC61966-2.1; пересобранный PSD содержит встроенный sRGB ICC.`,
    )
  const summary = inspectNativeLayers(psd, notes, editableContents)
  if (summary.text || summary.editableContents)
    summary.warnings.push(
      'PSD не встраивает шрифты. Для одинаковой типографики они должны быть доступны принимающему редактору. Некоторые редакторы могут предложить обновить текстовый движок.',
    )
  const hasShapedText = (d: EditorDocument): boolean =>
    d.layers.some(
      (l) =>
        (l.kind === 'text' && textAntiAliasMode(l.textAntiAlias) !== 'smooth') ||
        (l.smart ? hasShapedText(l.smart) : false),
    )
  if (hasShapedText(doc))
    summary.warnings.push(
      'Режим сглаживания текста записан нативно в PSD, а merged/Type-кеш пересчитан собственной alpha-моделью ФШ777. Другой редактор может перерисовать края по-своему; хинтинг Adobe не обещается.',
    )
  const { buffer } = await runCodec<{ buffer: ArrayBuffer }>({
    operation: 'write',
    psd,
    psb,
    project: portable,
  })
  let bytes =
    source && appearanceUnchanged
      ? preserveMergedPixels(source.bytes, preserveUnknownResources(source.bytes, buffer))
      : buffer
  if (!(source && appearanceUnchanged))
    bytes = withPsdIccProfile(
      bytes,
      doc.colorProfile?.status === 'untagged' ? undefined : buildIccProfile(WORKING_RGB_PROFILE),
    )
  if (bytes.byteLength > 80 * 1024 * 1024)
    throw new Error(
      'PSD превышает 80 МБ — лимит повторного открытия. Уменьши изображения или объедини слои.',
    )
  await sealProject(bytes)
  report?.(summary)
  return new Blob([bytes], { type: 'image/vnd.adobe.photoshop' })
}
