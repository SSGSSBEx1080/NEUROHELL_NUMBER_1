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
  | 'repair-brush'
  | 'repair'
  | 'repair-box'
  | 'dodge'
  | 'burn'
  | 'sponge'
  | 'blur-brush'
  | 'sharpen-brush'
  | 'smudge'
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
  // Photoshop modes Canvas2D cannot express; composited per pixel (blendModes.ts).
  | 'dissolve'
  | 'linear-burn'
  | 'darker-color'
  | 'lighter-color'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'subtract'
  | 'divide'
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
/** Photoshop's grayscale type anti-aliasing modes; LCD/platform modes are not faked. */
export type TextAntiAliasMode = 'none' | 'sharp' | 'crisp' | 'strong' | 'smooth'
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
  /** Undefined keeps legacy undecorated text objects unchanged. */
  textUnderline?: boolean
  /** Undefined keeps legacy undecorated text objects unchanged. */
  textStrikethrough?: boolean
  /** Uniform baseline shift in layer pixels; positive raises glyphs. Undefined means zero. */
  textBaselineShift?: number
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: number
  /** Undefined is the legacy/default Smooth rendering, preserving old projects byte-for-byte. */
  textAntiAlias?: TextAntiAliasMode
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
export interface DocumentColorProfile {
  /** Stable profile id. The editable core is sRGB or explicitly untagged. */
  id: string
  name: string
  kind: 'rgb' | 'gray'
  status: 'working' | 'untagged'
  /** Human-readable source profile when pixels were converted to working sRGB. */
  convertedFrom?: string
  /** Human-readable discarded/retagged source when colour numbers did not change. */
  assignedFrom?: string
}
export interface GlobalLightSettings {
  /** PSD light angle in degrees: 0° right, 90° top, 120° top-left. */
  angle: number
  /** Light altitude in degrees, 0..90. Only Bevel & Emboss consumes it. */
  altitude: number
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
  colorProfile?: DocumentColorProfile
  /** Explicit document master light. Absence preserves legacy per-effect angles. */
  globalLight?: GlobalLightSettings
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
  /** Pulled-string stroke smoothing 0..100 (paint tools). */
  brushSmoothing?: number
  /** Pen pressure drives brush size (default on) / opacity (default off). */
  pressureSize?: boolean
  pressureOpacity?: boolean
  /** Dodge/burn/sponge/blur/sharpen/smudge brushes (retouch.ts). */
  retouchStrength?: number
  retouchRange?: 'shadows' | 'midtones' | 'highlights'
  spongeMode?: 'saturate' | 'desaturate'
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
export type PatternKind = 'checker' | 'dots' | 'stripes' | 'diagonal' | 'grid' | 'noise' | 'image'
/**
 * Serializable repeating tile. Procedural kinds are generated from the two
 * colors/size/seed; `image` carries a PNG data URL (PSD pattern resources and
 * user uploads are re-encoded to PNG). `id` is the native PSD pattern id.
 */
export interface PatternDefinition {
  id: string
  name: string
  kind: PatternKind
  /** Procedural square tile size in pixels. */
  size: number
  foreground: string
  background: string
  seed: number
  src?: string
  width?: number
  height?: number
  /** Opaque PSD pattern point/bounds preserved for imported resources. */
  psdX?: number
  psdY?: number
  boundsX?: number
  boundsY?: number
}
export interface StrokeEffectStyle {
  enabled: boolean
  size: number
  color: string
  /** Fill of the stroke ring: a solid color, a full gradient or a pattern tile. */
  fill: 'color' | 'gradient' | 'pattern'
  gradient?: import('./engine/gradientRamp').GradientDefinition
  pattern?: PatternDefinition
  gradientShape: StyleGradientShape
  gradientAngle: number
  gradientScale: number
  gradientReverse: boolean
  /** Undefined keeps legacy no-dither rendering and serialized objects. */
  gradientDither?: boolean
  position: 'outside' | 'inside' | 'center'
  opacity: number
}
export interface EffectContourPoint {
  /** PSD shaping-curve coordinates, 0..255 on both axes. */
  x: number
  y: number
}
export interface EffectContourDefinition {
  name: string
  points: EffectContourPoint[]
}
export interface ShadowEffectStyle {
  enabled: boolean
  color: string
  blur: number
  x: number
  y: number
  opacity: number
  contour?: EffectContourDefinition
  antialiased?: boolean
  /** Undefined/false is a local offset; true follows the document Global Light angle. */
  useGlobalLight?: boolean
}
export interface GlowEffectStyle {
  enabled: boolean
  color: string
  blur: number
  opacity: number
  contour?: EffectContourDefinition
  antialiased?: boolean
  /** Contour domain fraction: 0.5 is the neutral PSD default in this engine. */
  range?: number
}
export interface ColorOverlayStyle {
  enabled: boolean
  color: string
  opacity: number
  /** Undefined keeps legacy Normal without changing old project objects. */
  blendMode?: BlendMode
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
  /** Undefined keeps legacy no-dither rendering and serialized objects. */
  dither?: boolean
  /** Undefined keeps legacy Normal without changing old project objects. */
  blendMode?: BlendMode
}
export type BevelStyleKind = 'outer' | 'inner' | 'emboss' | 'pillow' | 'stroke'
export type BevelTechniqueKind = 'smooth' | 'chiselHard' | 'chiselSoft'
export interface BevelEffectStyle {
  enabled: boolean
  style: BevelStyleKind
  technique: BevelTechniqueKind
  /** Depth as a fraction: 1 = 100%. */
  depth: number
  direction: 'up' | 'down'
  size: number
  soften: number
  /** PSD light angle in degrees: 0° right, 90° top, 120° top-left. */
  angle: number
  altitude: number
  useGlobalLight: boolean
  highlightColor: string
  highlightBlendMode: BlendMode
  highlightOpacity: number
  shadowColor: string
  shadowBlendMode: BlendMode
  shadowOpacity: number
  glossContour?: EffectContourDefinition
  antialiasGloss?: boolean
}
export interface SatinEffectStyle {
  enabled: boolean
  color: string
  blendMode: BlendMode
  opacity: number
  /** PSD offset axis in degrees: 0° horizontal, 90° vertical. */
  angle: number
  distance: number
  size: number
  invert: boolean
  antialiased: boolean
  contour?: EffectContourDefinition
}
export interface PatternOverlayStyle {
  enabled: boolean
  pattern: PatternDefinition
  /** Tile scale factor: 1 = 100%. */
  scale: number
  opacity: number
  /** Undefined keeps legacy Normal without changing old project objects. */
  blendMode?: BlendMode
  /** Tile offset in layer/document pixels, depending on `align`. */
  phaseX: number
  phaseY: number
  /** True: tile origin moves with the layer. False: origin stays in document space. */
  align: boolean
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
  pattern: PatternOverlayStyle
  bevel: BevelEffectStyle
  satin: SatinEffectStyle
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
  /**
   * This raster is a PSD baked pixel+vector composite (channel -3), not the
   * native pixel-mask component alone. Export uses it to keep or drop the
   * native vector/real-mask pair consistently.
   */
  composite?: boolean
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
