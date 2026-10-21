import { blendColor, isPixelBlendMode } from './blendModes'
import { sampleCube } from './colorLut'
import { gradientColor, rgbFromHex } from './gradientRamp'
import type { BlendMode } from '../types'
import type { Correction, CurvePoint, LevelRange, MixerRow } from './adjustmentTypes'
export const unit = (x: number) => Math.min(1, Math.max(0, x))
const lum = (r: number, g: number, b: number) => r * 0.3 + g * 0.59 + b * 0.11
const curveDerivatives = new WeakMap<CurvePoint[], Float64Array>()
/** Natural cubic spline: zero second derivatives at the endpoints, as used by native RGB curve readers. */
export function curveValue(points: CurvePoint[], value: number): number {
  if (value <= points[0].input) return points[0].output
  const last = points.length - 1
  if (value >= points[last].input) return points[last].output
  let derivatives = curveDerivatives.get(points)
  if (!derivatives) {
    derivatives = new Float64Array(points.length)
    const upper = new Float64Array(points.length),
      rhs = new Float64Array(points.length)
    for (let i = 1; i < last; i++) {
      const before = points[i].input - points[i - 1].input,
        after = points[i + 1].input - points[i].input
      const slope =
        6 *
        ((points[i + 1].output - points[i].output) / after -
          (points[i].output - points[i - 1].output) / before)
      const denominator = 2 * (before + after) - before * upper[i - 1]
      upper[i] = after / denominator
      rhs[i] = (slope - before * rhs[i - 1]) / denominator
    }
    for (let i = last - 1; i > 0; i--) derivatives[i] = rhs[i] - upper[i] * derivatives[i + 1]
    curveDerivatives.set(points, derivatives)
  }
  const i = points.findIndex((p) => p.input > value) - 1,
    a = points[i],
    b = points[i + 1],
    h = b.input - a.input,
    u = (b.input - value) / h,
    v = (value - a.input) / h
  return (
    255 *
    unit(
      (u * a.output +
        v * b.output +
        (((u * u * u - u) * derivatives[i] + (v * v * v - v) * derivatives[i + 1]) * h * h) / 6) /
        255,
    )
  )
}
const levelValue = (c: LevelRange, value: number) =>
  c.outBlack +
  (c.outWhite - c.outBlack) * Math.pow(unit((value - c.black) / (c.white - c.black)), 1 / c.gamma)
function hsl(r: number, g: number, b: number, out: number[]) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2
  let h = 0
  if (d)
    h =
      ((max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) /
        6) %
      1
  out[0] = h
  out[1] = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  out[2] = l
}
function fromHsl(h: number, s: number, l: number, out: number[]) {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  out[0] = f(0)
  out[1] = f(8)
  out[2] = f(4)
}
function setLum(out: number[], value: number) {
  const d = value - lum(out[0], out[1], out[2])
  for (let c = 0; c < 3; c++) out[c] += d
  const min = Math.min(...out),
    max = Math.max(...out)
  if (min < 0)
    for (let c = 0; c < 3; c++) out[c] = value + ((out[c] - value) * value) / (value - min || 1)
  if (max > 1)
    for (let c = 0; c < 3; c++)
      out[c] = value + ((out[c] - value) * (1 - value)) / (max - value || 1)
}
function setSat(out: number[], saturation: number) {
  const min = Math.min(...out),
    max = Math.max(...out)
  for (let c = 0; c < 3; c++) out[c] = max > min ? ((out[c] - min) * saturation) / (max - min) : 0
}
type Transform = (r: number, g: number, b: number, out: number[]) => void
const compiled = new WeakMap<Correction, Transform>()
export function compileCorrection(a: Correction): Transform {
  const cached = compiled.get(a)
  if (cached) return cached
  let fn: Transform
  if (a.type === 'levels' || a.type === 'curves') {
    const tables = (['red', 'green', 'blue'] as const).map((channel) =>
      Float64Array.from({ length: 256 }, (_, i) => {
        const value =
          a.type === 'levels'
            ? levelValue(a.channels.rgb, Math.floor(levelValue(a.channels[channel], i) + 1e-7))
            : curveValue(a.channels.rgb, Math.floor(curveValue(a.channels[channel], i) + 1e-7))
        return unit(value / 255)
      }),
    )
    fn = (r, g, b, out) => {
      out[0] = tables[0][Math.round(r * 255)]
      out[1] = tables[1][Math.round(g * 255)]
      out[2] = tables[2][Math.round(b * 255)]
    }
  } else if (a.type === 'brightness/contrast') {
    const offset = a.brightness / 255,
      contrast = a.contrast >= 0 ? 1 / (1 - a.contrast / 101) : 1 + a.contrast / 100
    fn = (r, g, b, out) => {
      out[0] = unit((r + offset - 0.5) * contrast + 0.5)
      out[1] = unit((g + offset - 0.5) * contrast + 0.5)
      out[2] = unit((b + offset - 0.5) * contrast + 0.5)
    }
  } else if (a.type === 'exposure') {
    // EV acts on approximately linear light, not directly on gamma-encoded bytes.
    // RGB/8 TRC approximation 2.2; no arbitrary ICC transform is claimed here.
    const table = Float64Array.from({ length: 256 }, (_, i) =>
      Math.pow(unit(Math.pow(i / 255, 2.2) * 2 ** a.exposure + a.offset), 1 / (a.gamma * 2.2)),
    )
    fn = (r, g, b, out) => {
      out[0] = table[Math.round(r * 255)]
      out[1] = table[Math.round(g * 255)]
      out[2] = table[Math.round(b * 255)]
    }
  } else if (a.type === 'hue/saturation' || a.type === 'vibrance') {
    const scratch = [0, 0, 0]
    fn = (r, g, b, out) => {
      hsl(r, g, b, scratch)
      let [h, s, l] = scratch
      if (a.type === 'hue/saturation') {
        h = (h + a.hue / 360 + 1) % 1
        s = unit(s * (1 + a.saturation / 100))
        l = a.lightness >= 0 ? l + ((1 - l) * a.lightness) / 100 : l * (1 + a.lightness / 100)
      } else s = unit(s * (1 + a.saturation / 100) * (1 + (a.vibrance / 100) * (1 - s)))
      fromHsl(h, s, l, out)
    }
  } else if (a.type === 'color balance') {
    fn = (r, g, b, out) => {
      const l = lum(r, g, b),
        s = (1 - l) ** 2,
        h = l * l,
        m = 1 - s - h
      out[0] = unit(r + (a.shadows.red * s + a.midtones.red * m + a.highlights.red * h) / 255)
      out[1] = unit(g + (a.shadows.green * s + a.midtones.green * m + a.highlights.green * h) / 255)
      out[2] = unit(b + (a.shadows.blue * s + a.midtones.blue * m + a.highlights.blue * h) / 255)
      if (a.preserveLuminosity) setLum(out, l)
    }
  } else if (a.type === 'black & white') {
    const weights = [a.reds, a.yellows, a.greens, a.cyans, a.blues, a.magentas],
      scratch = [0, 0, 0]
    fn = (r, g, b, out) => {
      hsl(r, g, b, scratch)
      const pos = scratch[0] * 6,
        at = Math.floor(pos) % 6,
        f = pos - Math.floor(pos),
        min = Math.min(r, g, b),
        max = Math.max(r, g, b)
      const y = unit(
        min + ((max - min) * (weights[at] * (1 - f) + weights[(at + 1) % 6] * f)) / 100,
      )
      out[0] = out[1] = out[2] = y
    }
  } else if (a.type === 'channel mixer') {
    const mix = (row: MixerRow, r: number, g: number, b: number) =>
      unit((row.red * r + row.green * g + row.blue * b + row.constant) / 100)
    fn = (r, g, b, out) => {
      if (a.monochrome) out[0] = out[1] = out[2] = mix(a.gray, r, g, b)
      else {
        out[0] = mix(a.red, r, g, b)
        out[1] = mix(a.green, r, g, b)
        out[2] = mix(a.blue, r, g, b)
      }
    }
  } else if (a.type === 'photo filter') {
    const color = rgbFromHex(a.color),
      density = a.density / 100
    fn = (r, g, b, out) => {
      out[0] = r * (1 - density + color[0] * density)
      out[1] = g * (1 - density + color[1] * density)
      out[2] = b * (1 - density + color[2] * density)
      if (a.preserveLuminosity) setLum(out, lum(r, g, b))
    }
  } else if (a.type === 'gradient map') {
    fn = (r, g, b, out) => gradientColor(a.stops, a.reverse ? 1 - lum(r, g, b) : lum(r, g, b), out)
  } else if (a.type === 'color lookup') {
    fn = (r, g, b, out) => sampleCube(a.lut, r, g, b, out)
  } else if (a.type === 'invert')
    fn = (r, g, b, out) => {
      out[0] = 1 - r
      out[1] = 1 - g
      out[2] = 1 - b
    }
  else if (a.type === 'posterize') {
    const n = a.levels - 1
    fn = (r, g, b, out) => {
      out[0] = Math.floor((r * 255 * a.levels) / 256) / n
      out[1] = Math.floor((g * 255 * a.levels) / 256) / n
      out[2] = Math.floor((b * 255 * a.levels) / 256) / n
    }
  } else
    fn = (r, g, b, out) => {
      out[0] = out[1] = out[2] = lum(r, g, b) * 255 >= a.level ? 1 : 0
    }
  compiled.set(a, fn)
  return fn
}
/** W3C compositing blend functions, used without increasing the backdrop alpha. */
export function blendCorrection(mode: BlendMode, r: number, g: number, b: number, out: number[]) {
  if (mode === 'source-over') return
  if (isPixelBlendMode(mode)) {
    // Dissolve on a correction has no per-pixel coordinates here; it degrades
    // to the normal opacity mix instead of speckle. Layer rendering dissolves.
    if (mode === 'dissolve') return
    blendColor(mode, [r, g, b], out, out)
    return
  }
  if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity') {
    const l = lum(r, g, b),
      saturation = Math.max(r, g, b) - Math.min(r, g, b)
    if (mode === 'hue') {
      setSat(out, saturation)
      setLum(out, l)
    } else if (mode === 'color') setLum(out, l)
    else if (mode === 'saturation') {
      const s = Math.max(...out) - Math.min(...out)
      out[0] = r
      out[1] = g
      out[2] = b
      setSat(out, s)
      setLum(out, l)
    } else {
      const sourceLum = lum(out[0], out[1], out[2])
      out[0] = r
      out[1] = g
      out[2] = b
      setLum(out, sourceLum)
    }
    return
  }
  for (let c = 0; c < 3; c++) {
    const d = c === 0 ? r : c === 1 ? g : b,
      s = out[c]
    switch (mode) {
      case 'multiply':
        out[c] = d * s
        break
      case 'screen':
        out[c] = d + s - d * s
        break
      case 'overlay':
        out[c] = d <= 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s)
        break
      case 'hard-light':
        out[c] = s <= 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s)
        break
      case 'soft-light':
        out[c] =
          s <= 0.5
            ? d - (1 - 2 * s) * d * (1 - d)
            : d + (2 * s - 1) * ((d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d)) - d)
        break
      case 'darken':
        out[c] = Math.min(d, s)
        break
      case 'lighten':
        out[c] = Math.max(d, s)
        break
      case 'difference':
        out[c] = Math.abs(d - s)
        break
      case 'exclusion':
        out[c] = d + s - 2 * d * s
        break
      case 'color-dodge':
        out[c] = d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s))
        break
      case 'color-burn':
        out[c] = d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s)
        break
      case 'lighter':
        out[c] = Math.min(1, d + s)
        break
    }
  }
}
function applyCorrectionTo(
  result: Uint8ClampedArray,
  pixels: Uint8ClampedArray,
  correction: Correction,
  opacity: number,
  mask?: Uint8ClampedArray,
  mode: BlendMode = 'source-over',
) {
  if (pixels.length % 4 || (mask && mask.length !== pixels.length / 4) || !Number.isFinite(opacity))
    throw new Error('Некорректные пиксели корректирующего слоя')
  const transform = compileCorrection(correction),
    out = [0, 0, 0],
    strength = unit(opacity)
  if (!mask && mode === 'source-over') {
    // Fast path: identical arithmetic, but amount is loop-invariant and
    // blendCorrection('source-over') is a no-op, so neither is recomputed.
    const amount = strength
    if (!amount) return result
    for (let i = 0; i < pixels.length; i += 4) {
      if (!pixels[i + 3]) continue
      const r = pixels[i] / 255,
        g = pixels[i + 1] / 255,
        b = pixels[i + 2] / 255
      transform(r, g, b, out)
      result[i] = Math.round(pixels[i] + (unit(out[0]) * 255 - pixels[i]) * amount)
      result[i + 1] = Math.round(pixels[i + 1] + (unit(out[1]) * 255 - pixels[i + 1]) * amount)
      result[i + 2] = Math.round(pixels[i + 2] + (unit(out[2]) * 255 - pixels[i + 2]) * amount)
    }
    return result
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const amount = strength * (mask ? mask[i / 4] / 255 : 1)
    if (!pixels[i + 3] || !amount) continue
    const r = pixels[i] / 255,
      g = pixels[i + 1] / 255,
      b = pixels[i + 2] / 255
    transform(r, g, b, out)
    blendCorrection(mode, r, g, b, out)
    result[i] = Math.round(pixels[i] + (unit(out[0]) * 255 - pixels[i]) * amount)
    result[i + 1] = Math.round(pixels[i + 1] + (unit(out[1]) * 255 - pixels[i + 1]) * amount)
    result[i + 2] = Math.round(pixels[i + 2] + (unit(out[2]) * 255 - pixels[i + 2]) * amount)
  }
  return result
}
export function applyCorrection(
  pixels: Uint8ClampedArray,
  correction: Correction,
  opacity = 1,
  mask?: Uint8ClampedArray,
  mode: BlendMode = 'source-over',
) {
  return applyCorrectionTo(new Uint8ClampedArray(pixels), pixels, correction, opacity, mask, mode)
}
/**
 * In-place variant: each output pixel depends only on the same input pixel,
 * read before it is written, so the result is byte-identical to
 * applyCorrection without its two full-buffer copies on the render path.
 */
export function applyCorrectionInPlace(
  pixels: Uint8ClampedArray,
  correction: Correction,
  opacity = 1,
  mask?: Uint8ClampedArray,
  mode: BlendMode = 'source-over',
) {
  return applyCorrectionTo(pixels, pixels, correction, opacity, mask, mode)
}
export interface HistogramData {
  red: number[]
  green: number[]
  blue: number[]
  rgb: number[]
  pixels: number
}
export function histogram(pixels: Uint8ClampedArray): HistogramData {
  const bins = () => Array<number>(256).fill(0),
    h: HistogramData = { red: bins(), green: bins(), blue: bins(), rgb: bins(), pixels: 0 }
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255
    if (!a) continue
    h.red[pixels[i]] += a
    h.green[pixels[i + 1]] += a
    h.blue[pixels[i + 2]] += a
    h.rgb[Math.round(lum(pixels[i], pixels[i + 1], pixels[i + 2]))] += a
    h.pixels += a
  }
  return h
}
