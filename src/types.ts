export type Tool = 'move' | 'select' | 'crop' | 'brush' | 'eraser' | 'wand' | 'text' | 'rectangle' | 'ellipse' | 'eyedropper' | 'hand' | 'lasso' | 'polygon-lasso' | 'magnetic-lasso' | 'ellipse-select' | 'clone' | 'bucket' | 'gradient'
export type LayerKind = 'image' | 'text' | 'shape' | 'group'
export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light' | 'difference' | 'hard-light' | 'color-dodge' | 'color-burn' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'lighter'
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
  shape?: 'rectangle' | 'ellipse'
  radius?: number
  strokeColor?: string
  strokeWidth?: number
  warp?: Quad
  textScaleX?: number
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
}
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface HistoryEntry { document: EditorDocument; label: string; time: number; selectedId: string | null; command?: { execute(): EditorDocument; undo(): EditorDocument } }
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
  editMask?: boolean
  gradientType?: 'linear' | 'radial'
}
export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0, contrast: 0, saturation: 0, blur: 0, hue: 0, grayscale: 0, sepia: 0, invert: 0,
}
export const MAX_DIMENSION = 4096
export const MAX_LAYERS = 100

export interface LayerStyles {
  fillOpacity: number
  stroke: { enabled: boolean; size: number; color: string; position: 'outside' | 'inside' | 'center' }
  shadow: { enabled: boolean; color: string; blur: number; x: number; y: number; opacity: number }
  glow: { enabled: boolean; color: string; blur: number; opacity: number }
  overlay: { enabled: boolean; color: string; opacity: number }
  gradient: { enabled: boolean; from: string; to: string; angle: number; opacity: number }
}

export type Quad = [Point, Point, Point, Point]

export interface LayerMask extends Rect { src: string; enabled: boolean; linked: boolean; density: number; feather: number; defaultColor: number }
export interface Selection extends Rect { points?: Point[]; ellipse?: boolean; feather?: number; inverted?: boolean }
