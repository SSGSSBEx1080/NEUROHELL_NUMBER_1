import type { LayerTextData, TextStyle } from 'ag-psd'
import type { Layer } from '../types'
import { nativeFontStyle, resolveNativeFont } from './fonts'
import { getTextGeometry, clearTextGeometryCache, textBaselineShiftPx } from './textGeometry'
import { getTextLayout, textFont } from './textLayout'
import { layerPoint } from './shapeGeometry'
import { homography, validQuad } from './projection'
import { textAntiAliasFromPsd, textAntiAliasMode } from './textAntiAlias'
const px = (value: number) => ({ units: 'Pixels' as const, value })
const rgb = (color: string) => ({
  r: parseInt(color.slice(1, 3), 16),
  g: parseInt(color.slice(3, 5), 16),
  b: parseInt(color.slice(5, 7), 16),
})
export function affineText(layer: Layer) {
  const m = layer.warp && homography(layer.warp)
  return !m || Math.abs(m[6]) + Math.abs(m[7]) < 1e-9
}
/** Native point text is NOT a paragraph box. Its transform origin is an alphabetic baseline. */
export function exportNativeText(layer: Layer): LayerTextData {
  const geometry = getTextGeometry(layer),
    layout = layer.textFrame ? getTextLayout(layer) : undefined,
    baselineShift = textBaselineShiftPx(layer)
  const size = geometry.fontSize,
    pad = Math.min(
      layer.textFrame?.padding || 0,
      Math.max(0, Math.min(layer.width, layer.height) / 2 - 0.5),
    )
  const anchor = layer.textFrame
    ? { x: 0, y: 0 }
    : {
        x:
          layer.textAlign === 'center'
            ? layer.width / 2
            : layer.textAlign === 'right'
              ? layer.width
              : 0,
        y: geometry.baselineOffset,
      }
  const o = layerPoint(layer, anchor),
    x = layerPoint(layer, { x: anchor.x + 1, y: anchor.y }),
    y = layerPoint(layer, { x: anchor.x, y: anchor.y + 1 })
  const ink = geometry.ink,
    bounds = {
      left: px(ink.x - anchor.x),
      top: px(ink.y - anchor.y),
      right: px(ink.x + ink.width - anchor.x),
      bottom: px(ink.y + ink.height - anchor.y),
    }
  return {
    text:
      layout && !layout.overflow
        ? layout.lines.map((l) => l.text).join('\r')
        : (layer.text || '').replace(/\r\n?|\n/g, '\r'),
    transform: [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y],
    shapeType: layer.textFrame ? 'box' : 'point',
    ...(layer.textFrame
      ? { boxBounds: [pad, layout?.lines[0]?.y || 0, layer.width - pad, layer.height - pad] }
      : { pointBase: [0, 0] }),
    bounds,
    boundingBox: bounds,
    left: bounds.left.value,
    top: bounds.top.value,
    right: bounds.right.value,
    bottom: bounds.bottom.value,
    orientation: 'horizontal',
    antiAlias: textAntiAliasMode(layer.textAntiAlias),
    useFractionalGlyphWidths: true,
    style: {
      ...nativeFontStyle(layer.fontFamily || 'Manrope', layer.fontWeight || 500, layer.italic),
      fontSize: size,
      horizontalScale: layer.textScaleX || 1,
      fillColor: rgb(layer.color),
      leading: size * (layer.lineHeight || 1.2),
      autoLeading: false,
      tracking: ((layer.letterSpacing || 0) / size) * 1000,
      ...(layer.textUnderline ? { underline: true } : {}),
      ...(layer.textStrikethrough ? { strikethrough: true } : {}),
      ...(baselineShift !== 0 ? { baselineShift } : {}),
    },
    paragraphStyle: { justification: layer.textAlign || 'left', autoHyphenate: false },
    ...(layout && !layout.overflow
      ? {
          paragraphStyleRuns: layout.lines.map((line, i) => ({
            length: line.text.length + (i < layout.lines.length - 1 ? 1 : 0),
            style: {
              justification: layer.textAlign || 'left',
              autoHyphenate: false,
              startIndent: (layer.width - pad * 2 - line.availableWidth) / 2,
              endIndent: (layer.width - pad * 2 - line.availableWidth) / 2,
            },
          })),
        }
      : {}),
  }
}
const comparableStyle = (s: TextStyle) =>
  JSON.stringify([
    s.font?.name,
    s.fontSize,
    s.fauxBold,
    s.fauxItalic,
    s.fillColor,
    s.horizontalScale,
    s.verticalScale,
    s.tracking,
    s.leading,
    s.underline,
    s.strikethrough,
    s.baselineShift,
  ])
/** Supported horizontal, single-style type imports directly as editable text. Originals are
 * still retained byte-for-byte. Rich/vertical/path text keeps its native source plus an explicit warning.
 */
export async function importNativeText(
  text: LayerTextData,
  base: Layer,
  warn: (message: string) => void,
): Promise<Partial<Layer> | undefined> {
  const t = text.transform || [1, 0, 0, 1, 0, 0],
    style = { ...text.style, ...text.styleRuns?.[0]?.style }
  if (
    text.orientation === 'vertical' ||
    (text.warp?.style && text.warp.style !== 'none') ||
    text.textPath?.data.type === 0 ||
    style.fillFlag === false ||
    style.strokeFlag ||
    t.length !== 6 ||
    t.some((v) => !Number.isFinite(v)) ||
    text.styleRuns?.some(
      (r) => comparableStyle({ ...text.style, ...r.style }) !== comparableStyle(style),
    )
  )
    return
  const [a, b, c, d, tx, ty] = t,
    sx = Math.hypot(a, b),
    sy = (a * d - b * c) / sx
  if (sx < 1e-6 || !Number.isFinite(sy) || Math.abs(sy) < 1e-6) return
  const font = resolveNativeFont(style.font?.name || ''),
    vertical = style.verticalScale || 1
  const size = (style.fontSize || 48) * Math.abs(sy) * vertical,
    horizontal = ((style.horizontalScale || 1) * sx) / (Math.abs(sy) * vertical)
  if (size < 4 || size > 1000 || horizontal < 0.01 || horizontal > 100) return
  const rawBaselineShift = style.baselineShift ?? 0
  if (typeof rawBaselineShift !== 'number' || !Number.isFinite(rawBaselineShift)) return
  // PSD stores this as an absolute Type-object distance: the layer matrix
  // scales it, but character VerticalScale does not (16 stays 16 at 150%).
  const baselineShift = rawBaselineShift * Math.abs(sy)
  if (Math.abs(baselineShift) > 1000) return
  const color = style.fillColor
  if (color && !('r' in color)) return
  const align =
    text.paragraphStyle?.justification ||
    text.paragraphStyleRuns?.[0]?.style.justification ||
    'left'
  if (!['left', 'center', 'right'].includes(align)) return
  if (
    text.paragraphStyleRuns?.some((r) => r.style.justification && r.style.justification !== align)
  )
    return
  if (font.substituted)
    warn(
      `Шрифт «${style.font?.name || 'не указан'}» не найден в каталоге редактора. Рабочий текст использует Manrope; исходный PSD без правок остаётся неизменным. Установи нужный шрифт перед редактированием.`,
    )
  const antiAlias = textAntiAliasFromPsd(text.antiAlias)
  if (antiAlias.warning) warn(antiAlias.warning)
  const nativeSize = style.fontSize || 48,
    leading =
      style.autoLeading !== false
        ? (text.paragraphStyle?.autoLeading || 1.2) * nativeSize
        : style.leading || nativeSize * 1.2
  const layer: Layer = {
    ...base,
    kind: 'text',
    text: text.text.replace(/\r\n?/g, '\n'),
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    fontFamily: font.family,
    fontWeight: style.fauxBold ? Math.max(700, font.weight) : font.weight,
    italic: style.fauxItalic || font.italic,
    textUnderline: style.underline === true ? true : undefined,
    textStrikethrough: style.strikethrough === true ? true : undefined,
    textBaselineShift: baselineShift !== 0 ? baselineShift : undefined,
    fontSize: size,
    textScaleX: horizontal,
    textAlign: align as Layer['textAlign'],
    lineHeight: leading / (nativeSize * vertical),
    letterSpacing: ((style.tracking || 0) * size) / 1000,
    textAntiAlias: antiAlias.mode,
    textBaseline: text.shapeType === 'box' ? 'top' : 'alphabetic',
    color:
      color && 'r' in color
        ? '#' +
          [color.r, color.g, color.b]
            .map((n) =>
              Math.round(Math.max(0, Math.min(255, n)))
                .toString(16)
                .padStart(2, '0'),
            )
            .join('')
        : '#000000',
    flipX: false,
    flipY: sy < 0,
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
  }
  if (
    Math.abs(layer.letterSpacing || 0) > 100 ||
    (layer.letterSpacing || 0) < -30 ||
    layer.lineHeight! < 0.5 ||
    layer.lineHeight! > 4
  )
    return
  await document.fonts.load(textFont(layer), (layer.text || 'AaБб').slice(0, 256))
  clearTextGeometryCache()
  let targetX = tx,
    targetY = ty
  if (text.shapeType === 'box' && text.boxBounds) {
    const [left, top, right, bottom] = text.boxBounds
    layer.width = (right - left) * sx
    layer.height = (bottom - top) * Math.abs(sy)
    layer.textFrame = {
      shape: 'rectangle',
      padding: 0,
      verticalAlign: 'top',
      autoFit: false,
      minFontSize: 4,
    }
    targetX += a * left + c * top
    targetY += b * left + d * top
  } else {
    const measured = getTextGeometry(layer)
    layer.width = Math.max(1, measured.advance)
    layer.height = Math.max(1, measured.bounds.height)
    const p = text.pointBase || [0, 0]
    targetX += a * p[0] + c * p[1]
    targetY += b * p[0] + d * p[1]
  }
  if (layer.width < 1 || layer.height < 1 || layer.width > 16384 || layer.height > 16384) return
  const shear = (a * c + b * d) / sx / sy,
    skew = (shear * layer.height) / layer.width
  if (Math.abs(skew) > 1e-9) {
    const q = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1 + skew, y: 1 },
      { x: skew, y: 1 },
    ]
    if (!validQuad(q)) return
    layer.warp = q
  } else layer.warp = undefined
  const anchor = layer.textFrame
    ? { x: 0, y: 0 }
    : { x: align === 'center' ? layer.width / 2 : align === 'right' ? layer.width : 0, y: 0 }
  const origin = layerPoint(layer, anchor)
  layer.x = targetX - origin.x
  layer.y = targetY - origin.y
  return layer
}
