import type { Selection, SelectionMode } from '../types'
export type SelectionModify = 'expand' | 'contract' | 'border' | 'smooth' | 'feather'
export type ColorRangeMode = 'sampled' | 'shadows' | 'midtones' | 'highlights'
export type SelectionRequest =
  | {
      operation: 'wand'
      width: number
      height: number
      pixels: Uint8ClampedArray
      x: number
      y: number
      tolerance: number
      contiguous: boolean
    }
  | {
      operation: 'range'
      width: number
      height: number
      pixels: Uint8ClampedArray
      colors: number[][]
      fuzziness: number
      range: number
      mode: ColorRangeMode
      invert: boolean
    }
  | {
      operation: 'modify'
      width: number
      height: number
      coverage: Uint8ClampedArray
      kind: SelectionModify
      radius: number
    }
const clamp = (value: number, min = 0, max = 255) => Math.max(min, Math.min(max, value))
export function validateSelectionSize(width: number, height: number, length: number, channels = 1) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    length !== width * height * channels
  )
    throw new Error('Выделение: до 4096 × 4096, корректный размер маски обязателен')
}
/** Empty raster selections are NOT null: they restrict painting to nothing, never silently to everything. */
export function rasterSelection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x = 0,
  y = 0,
): Selection {
  validateSelectionSize(width, height, data.length)
  let left = width,
    top = height,
    right = -1,
    bottom = -1
  for (let yy = 0; yy < height; yy++)
    for (let xx = 0; xx < width; xx++)
      if (data[yy * width + xx]) {
        left = Math.min(left, xx)
        right = Math.max(right, xx)
        top = Math.min(top, yy)
        bottom = Math.max(bottom, yy)
      }
  return {
    x: right < 0 ? 0 : x + left,
    y: bottom < 0 ? 0 : y + top,
    width: right < 0 ? 0 : right - left + 1,
    height: bottom < 0 ? 0 : bottom - top + 1,
    raster: { x, y, width, height, data },
  }
}
export function combineCoverage(a: Uint8ClampedArray, b: Uint8ClampedArray, mode: SelectionMode) {
  if (!['replace', 'add', 'subtract', 'intersect'].includes(mode))
    throw new Error('Неизвестный режим выделения')
  if (a.length !== b.length) throw new Error('Размеры выделений не совпадают')
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < out.length; i++)
    out[i] =
      mode === 'replace'
        ? b[i]
        : mode === 'add'
          ? Math.max(a[i], b[i])
          : mode === 'subtract'
            ? Math.max(0, a[i] - b[i])
            : Math.min(a[i], b[i])
  return out
}
/** Exact squared Euclidean distance transform: lower envelopes of 1D parabolas, two separable passes. */
function distanceField(data: Uint8ClampedArray, w: number, h: number, toSelected: boolean) {
  const field = new Float32Array(w * h),
    f = new Float64Array(Math.max(w, h)),
    d = new Float64Array(f.length),
    v = new Int32Array(f.length),
    z = new Float64Array(f.length + 1)
  for (let i = 0; i < field.length; i++) field[i] = data[i] >= 128 === toSelected ? 0 : 1e12
  const line = (n: number) => {
    let k = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]))
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]))
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) ** 2 + f[v[k]]
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = field[y * w + x]
    line(w)
    for (let x = 0; x < w; x++) field[y * w + x] = d[x]
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = field[y * w + x]
    line(h)
    for (let y = 0; y < h; y++) field[y * w + x] = d[y]
  }
  return field
}
function morph(data: Uint8ClampedArray, w: number, h: number, radius: number, expand: boolean) {
  const field = distanceField(data, w, h, expand),
    out = new Uint8ClampedArray(data.length),
    r2 = radius * radius
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        dist = expand
          ? field[i]
          : Math.min(field[i], (x + 1) ** 2, (y + 1) ** 2, (w - x) ** 2, (h - y) ** 2)
      out[i] = expand ? (dist <= r2 ? 255 : data[i]) : dist <= r2 ? 0 : data[i]
    }
  return out
}
function boxBlur(
  data: Float32Array,
  w: number,
  h: number,
  r: number,
  intermediate = new Float32Array(data.length),
) {
  if (!r) return data
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += data[y * w + x]
    for (let x = 0; x < w; x++) {
      intermediate[y * w + x] = sum / n
      if (x - r >= 0) sum -= data[y * w + x - r]
      if (x + r + 1 < w) sum += data[y * w + x + r + 1]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += intermediate[y * w + x]
    for (let y = 0; y < h; y++) {
      data[y * w + x] = sum / n
      if (y - r >= 0) sum -= intermediate[(y - r) * w + x]
      if (y + r + 1 < h) sum += intermediate[(y + r + 1) * w + x]
    }
  }
  return data
}
export function modifyCoverage(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  kind: SelectionModify,
  radius: number,
) {
  validateSelectionSize(w, h, data.length)
  if (!Number.isFinite(radius) || radius < 0 || radius > 100)
    throw new Error('Радиус выделения: 0–100 px')
  radius = Math.round(radius)
  if (!radius) return data.slice()
  if (kind === 'expand' || kind === 'contract') return morph(data, w, h, radius, kind === 'expand')
  if (kind === 'border')
    return combineCoverage(
      morph(data, w, h, radius, true),
      morph(data, w, h, radius, false),
      'subtract',
    )
  if (kind === 'smooth') {
    const blur = boxBlur(Float32Array.from(data), w, h, radius)
    return Uint8ClampedArray.from(blur, (v) => (v >= 128 ? 255 : 0))
  }
  if (kind !== 'feather') throw new Error('Неизвестное изменение выделения')
  // Approximate a Gaussian with three box convolutions. Bounds are transparent, no wraparound.
  let size = Math.floor(Math.sqrt(4 * radius * radius + 1))
  if (size % 2 === 0) size--
  const larger = size + 2,
    m = Math.round((12 * radius * radius - 3 * size * size - 12 * size - 9) / (-4 * size - 4))
  let result = Float32Array.from(data)
  const scratch = new Float32Array(data.length)
  for (let i = 0; i < 3; i++)
    result = boxBlur(result, w, h, Math.max(0, ((i < m ? size : larger) - 1) / 2), scratch)
  return Uint8ClampedArray.from(result)
}
const colorDistance = (pixels: Uint8ClampedArray, i: number, color: number[]) =>
  Math.sqrt(
    (pixels[i] - color[0]) ** 2 * 0.3 +
      (pixels[i + 1] - color[1]) ** 2 * 0.59 +
      (pixels[i + 2] - color[2]) ** 2 * 0.11,
  )
export function selectWand(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean,
) {
  validateSelectionSize(w, h, pixels.length, 4)
  if (![x, y, tolerance].every(Number.isFinite)) throw new Error('Некорректные параметры палочки')
  x = clamp(Math.floor(x), 0, w - 1)
  y = clamp(Math.floor(y), 0, h - 1)
  tolerance = clamp(tolerance)
  const seed = y * w + x,
    at = seed * 4,
    color = [pixels[at], pixels[at + 1], pixels[at + 2]],
    alpha = pixels[at + 3],
    out = new Uint8ClampedArray(w * h)
  const matches = (p: number) =>
    Math.abs(pixels[p * 4 + 3] - alpha) <= tolerance &&
    (alpha === 0 || colorDistance(pixels, p * 4, color) <= tolerance)
  if (!contiguous) {
    for (let p = 0; p < out.length; p++) if (matches(p)) out[p] = 255
    return out
  }
  const visited = new Uint8Array(w * h),
    queue = new Uint32Array(w * h)
  let head = 0,
    tail = 0
  const enqueue = (p: number) => {
    if (visited[p]) return
    visited[p] = 1
    if (matches(p)) {
      queue[tail++] = p
      out[p] = 255
    }
  }
  enqueue(seed)
  while (head < tail) {
    const p = queue[head++],
      xx = p % w,
      yy = Math.floor(p / w)
    if (xx > 0) enqueue(p - 1)
    if (xx < w - 1) enqueue(p + 1)
    if (yy > 0) enqueue(p - w)
    if (yy < h - 1) enqueue(p + w)
  }
  return out
}
export function selectColorRange(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  colors: number[][],
  fuzziness: number,
  mode: ColorRangeMode,
  range: number,
  invert = false,
) {
  validateSelectionSize(w, h, pixels.length, 4)
  if (
    !Number.isFinite(fuzziness) ||
    !Number.isFinite(range) ||
    !['sampled', 'shadows', 'midtones', 'highlights'].includes(mode) ||
    !Array.isArray(colors) ||
    colors.length > 8 ||
    colors.some((c) => c.length !== 3 || c.some((v) => !Number.isFinite(v) || v < 0 || v > 255))
  )
    throw new Error('Некорректный цветовой диапазон')
  const f = clamp(fuzziness),
    r = clamp(range),
    out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < pixels.length; i += 4) {
    let amount = 0
    if (mode === 'sampled') {
      let d = Infinity
      for (const color of colors) d = Math.min(d, colorDistance(pixels, i, color))
      amount = f === 0 ? (d === 0 ? 1 : 0) : clamp(1 - d / f, 0, 1)
    } else {
      const l = pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11
      if (mode === 'shadows') amount = clamp((r + f - l) / Math.max(1, f), 0, 1)
      else if (mode === 'highlights') amount = clamp((l - r + f) / Math.max(1, f), 0, 1)
      else amount = clamp(1 - Math.abs(l - r) / Math.max(1, f), 0, 1)
    }
    const coverage = Math.round(amount * pixels[i + 3])
    out[i / 4] = invert ? 255 - coverage : coverage
  }
  return out
}
export function processSelection(request: SelectionRequest) {
  if (request.operation === 'modify')
    return modifyCoverage(
      request.coverage,
      request.width,
      request.height,
      request.kind,
      request.radius,
    )
  if (request.operation === 'wand')
    return selectWand(
      request.pixels,
      request.width,
      request.height,
      request.x,
      request.y,
      request.tolerance,
      request.contiguous,
    )
  if (request.operation === 'range')
    return selectColorRange(
      request.pixels,
      request.width,
      request.height,
      request.colors,
      request.fuzziness,
      request.mode,
      request.range,
      request.invert,
    )
  throw new Error('Неизвестная операция выделения')
}
