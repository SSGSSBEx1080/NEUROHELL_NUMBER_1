import type { Layer, Rect } from '../types'
import { getTextLayout, textFont, type TextLine } from './textLayout'
import { textDecorationMetrics } from './textDecorations'
export interface InkMetrics {
  width: number
  actualBoundingBoxLeft: number
  actualBoundingBoxRight: number
  actualBoundingBoxAscent: number
  actualBoundingBoxDescent: number
}
export interface TextGeometry {
  bounds: Rect
  ink: Rect
  lines: TextLine[]
  fontSize: number
  baselineOffset: number
  advance: number
}
export type InkMeasure = (
  text: string,
  size: number,
  baseline: CanvasTextBaseline,
  align: CanvasTextAlign,
) => InkMetrics
const cache = new Map<string, TextGeometry>()
let context: CanvasRenderingContext2D | undefined
export const clearTextGeometryCache = () => cache.clear()
/** Positive values raise glyphs above their line baseline, matching PSD's sign. */
export const textBaselineShiftPx = (layer: Layer): number =>
  typeof layer.textBaselineShift === 'number' && Number.isFinite(layer.textBaselineShift)
    ? Math.max(-1000, Math.min(1000, layer.textBaselineShift))
    : 0
/** Pure geometry from actual glyph ink, not a guessed string-length rectangle. */
export function measureTextGeometry(
  layer: Layer,
  measure: InkMeasure,
  framed?: ReturnType<typeof getTextLayout>,
): TextGeometry {
  const size = framed?.fontSize || layer.fontSize || 48,
    scale = layer.textScaleX || 1,
    baseline = layer.textBaseline || 'top',
    align = layer.textAlign || 'left'
  const sample = measure('MgЙд', size, baseline, 'left'),
    alphabetic = measure('MgЙд', size, 'alphabetic', 'left')
  const baselineOffset = alphabetic.actualBoundingBoxAscent - sample.actualBoundingBoxAscent
  const baselineDy = -textBaselineShiftPx(layer)
  const anchor = align === 'center' ? layer.width / 2 : align === 'right' ? layer.width : 0
  const lines =
    framed?.lines ||
    (layer.text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((text, i) => ({
        text,
        x: anchor,
        y: i * size * (layer.lineHeight || 1.2),
        width: 0,
        availableWidth: Infinity,
      }))
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity,
    advance = 0
  for (const line of lines) {
    const m = measure(line.text, size, baseline, align),
      width = Math.max(0, m.width * scale)
    advance = Math.max(advance, width)
    // Empty lines/whitespace keep a small caret area without inflating non-empty glyph bounds.
    const empty = !line.text.trim(),
      offset = align === 'center' ? width / 2 : align === 'right' ? width : 0
    const x1 = empty ? line.x - offset : line.x - m.actualBoundingBoxLeft * scale
    const x2 = empty
      ? line.x - offset + Math.max(width, size * 0.2)
      : line.x + m.actualBoundingBoxRight * scale
    let y1 =
      line.y + baselineDy - (empty ? sample.actualBoundingBoxAscent : m.actualBoundingBoxAscent)
    let y2 =
      line.y + baselineDy + (empty ? sample.actualBoundingBoxDescent : m.actualBoundingBoxDescent)
    if (!empty && (layer.textUnderline || layer.textStrikethrough)) {
      const decoration = textDecorationMetrics(size)
      const alphabeticY =
        (baseline === 'alphabetic' ? line.y : line.y + baselineOffset) + baselineDy
      if (layer.textUnderline)
        y2 = Math.max(y2, alphabeticY + decoration.underlineTopOffset + decoration.thickness)
      if (layer.textStrikethrough) {
        y1 = Math.min(y1, alphabeticY + decoration.strikethroughTopOffset)
        y2 = Math.max(y2, alphabeticY + decoration.strikethroughTopOffset + decoration.thickness)
      }
    }
    left = Math.min(left, x1)
    top = Math.min(top, y1)
    right = Math.max(right, x2)
    bottom = Math.max(bottom, y2)
  }
  if (!Number.isFinite(left)) {
    left = top = 0
    right = size * 0.2
    bottom = size
  }
  const ink = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
  return {
    bounds: layer.textFrame ? { x: 0, y: 0, width: layer.width, height: layer.height } : ink,
    ink,
    lines,
    fontSize: size,
    baselineOffset,
    advance,
  }
}
export function getTextGeometry(layer: Layer): TextGeometry {
  const key = JSON.stringify([
    layer.text,
    layer.width,
    layer.height,
    layer.fontFamily,
    layer.fontSize,
    layer.fontWeight,
    layer.italic,
    layer.textUnderline,
    layer.textStrikethrough,
    layer.textBaselineShift,
    layer.textScaleX,
    layer.textAlign,
    layer.lineHeight,
    layer.letterSpacing,
    layer.textBaseline,
    layer.textFrame,
  ])
  const found = cache.get(key)
  if (found) {
    cache.delete(key)
    cache.set(key, found)
    return found
  }
  const measure: InkMeasure = (text, size, baseline, align) => {
    if (typeof document === 'undefined') {
      const width = text.length * size * 0.6,
        offset = align === 'center' ? width / 2 : align === 'right' ? width : 0
      return {
        width,
        actualBoundingBoxLeft: offset,
        actualBoundingBoxRight: width - offset,
        actualBoundingBoxAscent: baseline === 'alphabetic' ? size * 0.8 : 0,
        actualBoundingBoxDescent: baseline === 'alphabetic' ? size * 0.2 : size,
      }
    }
    context ||= document.createElement('canvas').getContext('2d')!
    context.canvas.style.fontSynthesis = 'weight style'
    context.font = textFont(layer, size)
    context.textBaseline = baseline
    context.textAlign = align
    context.letterSpacing = `${layer.letterSpacing || 0}px`
    return context.measureText(text)
  }
  const result = measureTextGeometry(
    layer,
    measure,
    layer.textFrame && typeof document !== 'undefined' ? getTextLayout(layer) : undefined,
  )
  cache.set(key, result)
  if (cache.size > 128) cache.delete(cache.keys().next().value!)
  return result
}
