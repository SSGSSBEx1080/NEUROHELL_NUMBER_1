import type { DocumentLayout } from './engine/layout'
import type { Correction } from './engine/adjustmentTypes'
export type Tool =
  | 'move'
  | 'pen'
  | 'node'
  | 'add-anchor'
  | 'delete-anchor'
  | 'convert-anchor'
  | 'select'
  | 'crop'
  | 'brush'
  | 'eraser'
  | 'wand'
  | 'magic-wand'
  | 'text'
  | 'text-frame'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'eyedropper'
  | 'hand'
  | 'lasso'
  | 'polygon-lasso'
  | 'magnetic-lasso'
  | 'ellipse-select'
  | 'clone'
  | 'bucket'
  | 'gradient'
  | 'repair'
  | 'repair-box'
export type LayerKind = 'image' | 'text' | 'shape' | 'group' | 'adjustment'
export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'difference'
  | 'hard-light'
  | 'color-dodge'
  | 'color-burn'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'lighter'
export interface Adjustments {
  brightness: number
  contrast: number
  saturation: number
  blur: number
  hue: number
  grayscale: number
  sepia: number
  invert: number
}
export interface TextFrame {
  shape: 'rectangle' | 'ellipse'
  padding: number
  verticalAlign: 'top' | 'middle' | 'bottom'
  autoFit: boolean
  minFontSize: number
}
export type ShapeKind = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path'
export interface ShapePath {
  open: boolean
  operation?: 'combine' | 'subtract' | 'intersect' | 'exclude'
  fillRule: 'non-zero' | 'even-odd'
  knots: { linked: boolean; points: number[] }[]
}
export interface Layer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  blendMode: BlendMode
  adjustments: Adjustments
  correction?: Correction
  src?: string
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: number
  color: string
  shape?: ShapeKind
  shapeFill?: boolean
  cornerRadii?: [number, number, number, number]
  sides?: number
  starRatio?: number
  shapePaths?: ShapePath[]
  strokeAlign?: 'inside' | 'center' | 'outside'
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDash?: number[]
  strokeDashOffset?: number
  radius?: number
  strokeColor?: string
  strokeWidth?: number
  warp?: Quad
  blendIf?: BlendIfRanges
  textScaleX?: number
  textBaseline?: 'top' | 'alphabetic'
  textFrame?: TextFrame
  styles?: LayerStyles
  parentId?: string
  expanded?: boolean
  isolated?: boolean
  clipping?: boolean
  mask?: LayerMask
  sourcePath?: number[]
  smart?: EditorDocument
  sourceText?: string
  flipX?: boolean
  flipY?: boolean
}
export interface TextEntry {
  id: string
  source: string
  text: string
  label: string
  note: string
  status: 'draft' | 'ready' | 'checked'
  layerId?: string
}
export interface EditorDocument {
  version: 1
  id: string
  name: string
  width: number
  height: number
  background: string
  layers: Layer[]
  sourceId?: string
  dpi?: number
  layout?: DocumentLayout
  textEntries?: TextEntry[]
}
export interface Point {
  x: number
  y: number
}
export interface Rect extends Point {
  width: number
  height: number
}
export interface HistoryEntry {
  document: EditorDocument
  label: string
  time: number
  selectedId: string | null
  pixelSelection?: Selection | null
  command?: { execute(): EditorDocument; undo(): EditorDocument }
}
export interface ToolSettings {
  color: string
  secondaryColor: string
  brushSize: number
  brushOpacity: number
  tolerance: number
  autoSelect: boolean
  showGuides: boolean
  shapeFill: boolean
  brushHardness?: number
  brushSpacing?: number
  feather?: number
  selectionMode?: SelectionMode
  selectionTolerance?: number
  contiguous?: boolean
  sampleAllLayers?: boolean
  quickMask?: boolean
  editMask?: boolean
  gradientType?: 'linear' | 'radial' | 'reflected' | 'angle'
  /** Selected tool gradient; undefined means the live foreground → background ramp. */
  gradient?: import('./engine/gradientRamp').GradientDefinition
}
export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  hue: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
}
export const MAX_DIMENSION = 4096
export const MAX_LAYERS = 100

/** Gradient geometry shared by overlays and gradient-filled strokes (PSD gradient styles). */
export type StyleGradientShape = 'linear' | 'radial' | 'reflected' | 'angle' | 'diamond'
export interface StrokeEffectStyle {
  enabled: boolean
  size: number
  color: string
  /** Fill of the stroke ring: a solid color or a full gradient definition. */
  fill: 'color' | 'gradient'
  gradient?: import('./engine/gradientRamp').GradientDefinition
  gradientShape: StyleGradientShape
  gradientAngle: number
  gradientScale: number
  gradientReverse: boolean
  position: 'outside' | 'inside' | 'center'
  opacity: number
}
export interface ShadowEffectStyle {
  enabled: boolean
  color: string
  blur: number
  x: number
  y: number
  opacity: number
}
export interface GlowEffectStyle {
  enabled: boolean
  color: string
  blur: number
  opacity: number
}
export interface ColorOverlayStyle {
  enabled: boolean
  color: string
  opacity: number
}
export interface GradientOverlayStyle {
  enabled: boolean
  gradient: import('./engine/gradientRamp').GradientDefinition
  shape: StyleGradientShape
  /** Gradient scale factor: 1 = 100%, clipped to 0.1..4. */
  scale: number
  angle: number
  opacity: number
  reverse: boolean
}
/**
 * Ordered effect stack. In every list index 0 is the topmost instance:
 * rendering paints from the end of the list towards the start.
 * Fill opacity only attenuates the layer content, never the effects.
 */
export interface LayerStyles {
  fillOpacity: number
  strokes: StrokeEffectStyle[]
  shadows: ShadowEffectStyle[]
  innerShadows: ShadowEffectStyle[]
  glow: GlowEffectStyle
  innerGlow: GlowEffectStyle
  overlays: ColorOverlayStyle[]
  gradients: GradientOverlayStyle[]
}
export const MAX_STYLE_INSTANCES = 10

/**
 * One Blend If slider pair per side, in native PSD quad order:
 * [blackLow, blackHigh, whiteLow, whiteHigh], each 0..255.
 * Below blackLow the pixel is hidden, blackLow..blackHigh fades in,
 * above whiteLow it fades out towards whiteHigh. Default [0, 0, 255, 255].
 */
export type BlendIfQuad = [number, number, number, number]
export interface BlendIfChannel {
  /** Ranges of this layer's own resulting pixels. */
  source: BlendIfQuad
  /** Ranges of the composite underneath this layer. */
  under: BlendIfQuad
}
/** Advanced blending ranges ("Blend If"), stored next to styles like in PSD layer records. */
export interface BlendIfRanges {
  gray: BlendIfChannel
  red: BlendIfChannel
  green: BlendIfChannel
  blue: BlendIfChannel
}
export type BlendIfChannelKey = keyof BlendIfRanges

export type Quad = [Point, Point, Point, Point]

export interface LayerMask extends Rect {
  src: string
  enabled: boolean
  linked: boolean
  density: number
  feather: number
  defaultColor: number
}
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'
export interface SelectionRaster extends Rect {
  data: Uint8ClampedArray
}
export interface Selection extends Rect {
  raster?: SelectionRaster
  points?: Point[]
  ellipse?: boolean
  feather?: number
  inverted?: boolean
}
