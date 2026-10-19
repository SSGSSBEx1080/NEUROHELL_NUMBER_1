import type { Layer, TextFrame } from '../types'

export const defaultTextFrame = (): TextFrame => ({
  shape: 'rectangle',
  padding: 10,
  verticalAlign: 'middle',
  autoFit: true,
  minFontSize: 8,
})
export function parseTextFrame(input: unknown): TextFrame | undefined {
  if (!input || typeof input !== 'object') return undefined
  const f = input as Record<string, unknown>
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback
  return {
    shape: f.shape === 'ellipse' ? 'ellipse' : 'rectangle',
    padding: number(f.padding, 10, 0, 256),
    verticalAlign:
      f.verticalAlign === 'top' || f.verticalAlign === 'bottom' ? f.verticalAlign : 'middle',
    autoFit: f.autoFit !== false,
    minFontSize: number(f.minFontSize, 8, 4, 1000),
  }
}
export interface TextLine {
  text: string
  x: number
  y: number
  width: number
  availableWidth: number
}
export interface TextLayout {
  lines: TextLine[]
  fontSize: number
  overflow: boolean
  limited: boolean
}
export type TextMeasure = (text: string, fontSize: number) => number
const MAX_LINES = 512,
  MAX_MEASURES = 24000
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (text: string) => Array.from(segmenter.segment(text), (s) => s.segment)

/** Pure, bounded wrapping. Only framed text uses it; legacy point text keeps its original renderer.
 * Measure returns document-space width, including horizontal scale and tracking. No per-frame DOM.
 */
export function layoutText(layer: Layer, measure: TextMeasure): TextLayout {
  const frame = layer.textFrame || defaultTextFrame(),
    text = (layer.text || '').replace(/\r\n?/g, '\n').slice(0, 20000)
  const pad = frame.padding,
    width = layer.width - 2 * pad,
    height = layer.height - 2 * pad
  const preferred = Math.max(4, Math.min(1000, layer.fontSize || 48)),
    minimum = Math.min(preferred, frame.minFontSize)
  if (width <= 0 || height <= 0)
    return { lines: [], fontSize: preferred, overflow: !!text, limited: false }
  // Chunk extremely long words without inserting spaces; avoids repeated measurements of a 20K suffix.
  const tokens = (text.match(/\n|[^\S\n]+|[^\s]+/gu) || ['']).flatMap((t) => {
    if (/^[^\S\n]+$/u.test(t)) return [' ']
    if (t.length <= 256) return [t]
    const g = graphemes(t),
      chunks: string[] = []
    for (let i = 0; i < g.length; i += 128) chunks.push(g.slice(i, i + 128).join(''))
    return chunks
  })
  let work = 0,
    limited = false
  const measured = new Map<string, number>()
  const length = (s: string, size: number) => {
    if (!s) return 0
    const key = `${size}|${s}`,
      cached = measured.get(key)
    if (cached !== undefined) return cached
    if (++work > MAX_MEASURES) {
      limited = true
      return Infinity
    }
    const value = Math.max(0, measure(s, size))
    measured.set(key, value)
    return value
  }
  type Wrapped = {
    values: { text: string; width: number; availableWidth: number }[]
    complete: boolean
    overflow: boolean
  }
  const wrap = (size: number, columns: (i: number) => number, max: number): Wrapped => {
    const values: Wrapped['values'] = []
    let index = 0,
      remainder = '',
      overflow = false,
      trailingBreak = text.endsWith('\n')
    while (
      (index < tokens.length || remainder || trailingBreak) &&
      values.length < max &&
      !limited
    ) {
      const availableWidth = Math.max(0, columns(values.length))
      let line = '',
        lineWidth = 0,
        explicit = false
      while ((index < tokens.length || remainder) && !limited) {
        const token = remainder || tokens[index]
        if (token === '\n') {
          index++
          explicit = true
          break
        }
        if (!line && token === ' ') {
          index++
          continue
        }
        const candidate = line + token,
          nextWidth = length(candidate.trimEnd(), size)
        if (nextWidth <= availableWidth + 0.01) {
          line = candidate
          lineWidth = nextWidth
          if (remainder) remainder = ''
          else index++
        } else {
          if (line.trim()) break
          const chars = graphemes(token)
          let lo = 0,
            hi = chars.length
          while (lo < hi && !limited) {
            const mid = Math.ceil((lo + hi) / 2)
            if (length(chars.slice(0, mid).join(''), size) <= availableWidth + 0.01) lo = mid
            else hi = mid - 1
          }
          const take = Math.max(1, lo)
          line = chars.slice(0, take).join('')
          lineWidth = length(line, size)
          overflow ||= lineWidth > availableWidth + 0.01
          if (!remainder) index++
          remainder = chars.slice(take).join('')
          break
        }
      }
      values.push({ text: line.trimEnd(), width: lineWidth, availableWidth })
      if (!explicit && index >= tokens.length && !remainder) trailingBreak = false
    }
    return { values, complete: index >= tokens.length && !remainder && !trailingBreak, overflow }
  }
  const at = (size: number): TextLayout => {
    const advance = size * (layer.lineHeight || 1.2)
    const blockHeight = (n: number) => Math.max(0, n - 1) * advance + size
    const top = (n: number) =>
      frame.verticalAlign === 'top'
        ? 0
        : Math.max(0, height - blockHeight(n)) * (frame.verticalAlign === 'middle' ? 0.5 : 1)
    let wrapped = wrap(size, () => width, MAX_LINES),
      count = wrapped.values.length
    if (frame.shape === 'ellipse' && blockHeight(count) <= height && wrapped.complete && !limited) {
      const maxLines = Math.min(MAX_LINES, Math.floor((height - size) / advance) + 1)
      // Try a line count, then its ellipse chord widths. Stable, unlike iterative reflow oscillation.
      for (let n = count; n <= maxLines && !limited; n++) {
        const y = top(n)
        const candidate = wrap(
          size,
          (row) => {
            const a = y + row * advance + size * 0.08,
              b = y + row * advance + size * 0.98
            const edge = Math.max(Math.abs(a - height / 2), Math.abs(b - height / 2)) / (height / 2)
            return width * Math.sqrt(Math.max(0, 1 - edge * edge))
          },
          n,
        )
        wrapped = candidate
        count = n
        if (candidate.complete && !candidate.overflow) break
      }
    }
    const y = pad + top(count)
    const lines = wrapped.values.map((line, i) => {
      const left = pad + (width - line.availableWidth) / 2
      const align = layer.textAlign || 'left'
      return {
        ...line,
        x:
          left +
          (align === 'center'
            ? line.availableWidth / 2
            : align === 'right'
              ? line.availableWidth
              : 0),
        y: y + i * advance,
      }
    })
    return {
      lines,
      fontSize: size,
      overflow:
        limited || !wrapped.complete || wrapped.overflow || blockHeight(count) > height + 0.01,
      limited,
    }
  }
  let result = at(preferred)
  if (!frame.autoFit || !result.overflow || minimum === preferred || limited) return result
  const lowResult = at(minimum)
  if (lowResult.overflow || limited) return lowResult
  result = lowResult
  let lo = Math.round(minimum * 4),
    hi = Math.floor(preferred * 4)
  while (lo < hi && !limited) {
    const mid = Math.ceil((lo + hi) / 2),
      candidate = at(mid / 4)
    if (candidate.overflow) hi = mid - 1
    else {
      lo = mid
      result = candidate
    }
  }
  return limited ? { ...result, overflow: true, limited: true } : result
}

export const textFont = (layer: Layer, size = layer.fontSize || 48) =>
  `${layer.italic ? 'italic ' : ''}${layer.fontWeight || 500} ${size}px "${layer.fontFamily || 'Manrope'}"`
const cache = new Map<string, TextLayout>()
let measureCanvas: HTMLCanvasElement | undefined
export const clearTextLayoutCache = () => cache.clear()
/** Shared by canvas, the overflow inspector and PSD export. Cache excludes x/y/color/opacity. */
export function getTextLayout(layer: Layer): TextLayout {
  const key = JSON.stringify([
    layer.text,
    layer.width,
    layer.height,
    layer.fontFamily,
    layer.fontSize,
    layer.fontWeight,
    layer.italic,
    layer.textScaleX,
    layer.textAlign,
    layer.lineHeight,
    layer.letterSpacing,
    layer.textFrame,
  ])
  const existing = cache.get(key)
  if (existing) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }
  measureCanvas ||= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')!
  const result = layoutText(layer, (text, size) => {
    ctx.canvas.style.fontSynthesis = 'weight style'
    ctx.font = textFont(layer, size)
    ctx.letterSpacing = `${layer.letterSpacing || 0}px`
    return ctx.measureText(text).width * (layer.textScaleX || 1)
  })
  cache.set(key, result)
  if (cache.size > 128) cache.delete(cache.keys().next().value!)
  return result
}

export const textPresets: { name: string; values: Partial<Layer> }[] = [
  {
    name: 'Центрированный',
    values: {
      fontFamily: 'Manrope',
      fontWeight: 600,
      italic: false,
      textAlign: 'center',
      lineHeight: 1.15,
      letterSpacing: 0,
      textScaleX: 1,
      color: '#151515',
      textFrame: defaultTextFrame(),
    },
  },
  {
    name: 'Подпись',
    values: {
      fontFamily: 'Manrope',
      fontWeight: 500,
      italic: false,
      textAlign: 'left',
      lineHeight: 1.3,
      letterSpacing: 0,
      textScaleX: 1,
      color: '#151515',
      textFrame: { ...defaultTextFrame(), verticalAlign: 'top' },
    },
  },
  {
    name: 'Курсив',
    values: {
      fontFamily: 'Manrope',
      fontWeight: 500,
      italic: true,
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      textScaleX: 1,
      color: '#151515',
      textFrame: defaultTextFrame(),
    },
  },
  {
    name: 'Заголовок',
    values: {
      fontFamily: 'Unbounded',
      fontWeight: 800,
      italic: false,
      textAlign: 'center',
      lineHeight: 1.05,
      letterSpacing: -1,
      textScaleX: 1,
      color: '#151515',
      textFrame: defaultTextFrame(),
    },
  },
]
