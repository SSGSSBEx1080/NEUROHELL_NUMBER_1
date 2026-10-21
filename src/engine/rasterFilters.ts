export type RasterFilter =
  | { type: 'unsharp'; radius: number; amount: number; threshold: number }
  | { type: 'highpass'; radius: number }
  | { type: 'median'; radius: number }
  | {
      type: 'noise'
      amount: number
      distribution: 'uniform' | 'gaussian'
      monochrome: boolean
      seed: number
    }
  | { type: 'mosaic'; size: number }
  | { type: 'edges'; strength: number }
  | { type: 'gaussian'; radius: number }
  | { type: 'motion'; angle: number; distance: number }
  | { type: 'threshold'; level: number }
  | { type: 'emboss'; angle: number; amount: number }
  | {
      type: 'radial'
      method: 'spin' | 'zoom'
      amount: number
      centerX: number
      centerY: number
    }
export type RasterFilterKind = RasterFilter['type']
export const rasterFilterNames: Record<RasterFilterKind, string> = {
  unsharp: 'Контурная резкость',
  highpass: 'Цветовой контраст (High Pass)',
  median: 'Медиана',
  noise: 'Добавить шум',
  mosaic: 'Мозаика',
  edges: 'Контуры (Собель)',
  gaussian: 'Гауссово размытие',
  motion: 'Размытие в движении',
  threshold: 'Порог',
  emboss: 'Тиснение',
  radial: 'Радиальное размытие',
}
export const MAX_FILTER_PIXELS = 8_388_608
export interface RasterFilterRequest {
  width: number
  height: number
  pixels: Uint8ClampedArray
  filter: RasterFilter
  mask?: Uint8ClampedArray
}
export function defaultRasterFilter(type: RasterFilterKind): RasterFilter {
  switch (type) {
    case 'unsharp':
      return { type, radius: 2, amount: 100, threshold: 3 }
    case 'highpass':
      return { type, radius: 3 }
    case 'median':
      return { type, radius: 1 }
    case 'noise':
      return { type, amount: 8, distribution: 'uniform', monochrome: true, seed: 777 }
    case 'mosaic':
      return { type, size: 12 }
    case 'edges':
      return { type, strength: 1 }
    case 'gaussian':
      return { type, radius: 5 }
    case 'motion':
      return { type, angle: 0, distance: 20 }
    case 'threshold':
      return { type, level: 128 }
    case 'emboss':
      return { type, angle: 135, amount: 100 }
    case 'radial':
      return { type, method: 'spin', amount: 10, centerX: 50, centerY: 50 }
  }
}
const clamp = (v: number, min = 0, max = 255) => Math.max(min, Math.min(max, v))
export function parseRasterFilter(input: unknown): RasterFilter {
  if (!input || typeof input !== 'object') throw new Error('Некорректный фильтр')
  const v = input as Record<string, unknown>
  if (typeof v.type !== 'string' || !Object.hasOwn(rasterFilterNames, v.type))
    throw new Error('Неизвестный растровый фильтр')
  const out: Record<string, unknown> = { ...defaultRasterFilter(v.type as RasterFilterKind) }
  for (const key of Object.keys(out)) {
    if (key === 'type') continue
    const value = v[key] ?? out[key]
    if (key === 'monochrome') {
      out[key] = value !== false
      continue
    }
    if (key === 'distribution') {
      if (!['uniform', 'gaussian'].includes(String(value)))
        throw new Error('Неизвестное распределение шума')
      out[key] = value
      continue
    }
    if (key === 'method') {
      if (value !== 'spin' && value !== 'zoom')
        throw new Error('Неизвестный метод радиального размытия')
      out[key] = value
      continue
    }
    const min =
        key === 'angle'
          ? -180
          : key === 'radius'
            ? v.type === 'median'
              ? 1
              : 0.1
            : key === 'size' || key === 'seed' || key === 'distance' || key === 'level'
              ? 1
              : 0,
      max =
        key === 'centerX' || key === 'centerY'
          ? 100
          : key === 'angle'
            ? 180
            : key === 'distance'
              ? 200
              : key === 'radius'
                ? v.type === 'median'
                  ? 5
                  : v.type === 'gaussian'
                    ? 100
                    : 30
                : key === 'amount'
                  ? v.type === 'unsharp' || v.type === 'emboss'
                    ? 500
                    : 100
                  : key === 'size'
                    ? 128
                    : key === 'strength'
                      ? 5
                      : key === 'seed'
                        ? 2147483647
                        : 255
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`Параметр фильтра ${key}: ${min}–${max}`)
    out[key] =
      key === 'size' ||
      key === 'seed' ||
      key === 'distance' ||
      key === 'level' ||
      (key === 'radius' && v.type === 'median')
        ? Math.round(value)
        : value
  }
  return out as RasterFilter
}
/** Reuse two float planes; process RGB channels one at a time, keeping worker memory bounded. */
function blurPlane(data: Float32Array, temp: Float32Array, w: number, h: number, r: number) {
  if (!r) return
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) sum += data[y * w + clamp(x, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / n
      sum += data[y * w + clamp(x + r + 1, 0, w - 1)] - data[y * w + clamp(x - r, 0, w - 1)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += temp[clamp(y, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      data[y * w + x] = sum / n
      sum += temp[clamp(y + r + 1, 0, h - 1) * w + x] - temp[clamp(y - r, 0, h - 1) * w + x]
    }
  }
}
function gaussianRadii(sigma: number) {
  let small = Math.floor(Math.sqrt(4 * sigma * sigma + 1))
  if (small % 2 === 0) small--
  const m = Math.round((12 * sigma * sigma - 3 * small * small - 12 * small - 9) / (-4 * small - 4))
  return Array.from({ length: 3 }, (_, i) => Math.max(0, ((i < m ? small : small + 2) - 1) / 2))
}
function frequency(
  p: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  f: Extract<RasterFilter, { type: 'unsharp' | 'highpass' }>,
) {
  const work = new Float32Array(w * h),
    temp = new Float32Array(w * h),
    radii = gaussianRadii(f.radius)
  const blur = () => {
    for (const r of radii) blurPlane(work, temp, w, h, r)
  }
  for (let i = 0; i < work.length; i++) work[i] = p[i * 4 + 3] / 255
  blur()
  const alpha = work.slice()
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < work.length; i++) work[i] = (p[i * 4 + c] * p[i * 4 + 3]) / 255
    blur()
    for (let i = 0; i < work.length; i++)
      if (p[i * 4 + 3]) {
        const original = p[i * 4 + c],
          low = alpha[i] > 1e-7 ? work[i] / alpha[i] : original,
          delta = original - low
        out[i * 4 + c] =
          f.type === 'highpass'
            ? clamp(128 + delta)
            : Math.abs(delta) >= f.threshold
              ? clamp(original + (delta * f.amount) / 100)
              : original
      }
  }
}
/** Premultiplied gaussian low-pass; alpha channel of `out` stays original. */
function gaussian(
  p: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
) {
  const work = new Float32Array(w * h),
    temp = new Float32Array(w * h),
    radii = gaussianRadii(radius)
  const blur = () => {
    for (const r of radii) blurPlane(work, temp, w, h, r)
  }
  for (let i = 0; i < work.length; i++) work[i] = p[i * 4 + 3] / 255
  blur()
  const alpha = work.slice()
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < work.length; i++) work[i] = (p[i * 4 + c] * p[i * 4 + 3]) / 255
    blur()
    for (let i = 0; i < work.length; i++)
      if (p[i * 4 + 3]) out[i * 4 + c] = clamp(alpha[i] > 1e-7 ? work[i] / alpha[i] : p[i * 4 + c])
  }
}
function motion(
  p: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  angle: number,
  distance: number,
) {
  const rad = (angle * Math.PI) / 180,
    ux = Math.cos(rad),
    uy = Math.sin(rad),
    offsets: [number, number][] = []
  const seen = new Set<string>()
  for (let t = -distance / 2; t <= distance / 2; t++) {
    const dx = Math.round(ux * t),
      dy = Math.round(uy * t),
      key = dx + ',' + dy
    if (!seen.has(key)) {
      seen.add(key)
      offsets.push([dx, dy])
    }
  }
  if (w * h * offsets.length > 3e8)
    throw new Error('Слишком большая дистанция для этого слоя. Уменьши дистанцию или слой.')
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (!p[o + 3]) continue
      let pr = 0,
        pg = 0,
        pb = 0,
        pa = 0
      for (const [dx, dy] of offsets) {
        const i = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4,
          a = p[i + 3] / 255
        pr += p[i] * a
        pg += p[i + 1] * a
        pb += p[i + 2] * a
        pa += p[i + 3]
      }
      const mean = pa / offsets.length
      if (mean > 0) {
        const denom = (mean / 255) * offsets.length
        out[o] = clamp(pr / denom)
        out[o + 1] = clamp(pg / denom)
        out[o + 2] = clamp(pb / denom)
      }
    }
}
function radialBlur(
  p: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  f: Extract<RasterFilter, { type: 'radial' }>,
) {
  if (f.amount <= 0) return
  const cx = (f.centerX / 100) * (w - 1),
    cy = (f.centerY / 100) * (h - 1),
    // Keep the full-size worker responsive: roughly one sample per pixel of
    // travel, but never an unbounded fan-out on an 8 MP layer. Photoshop
    // does not publish an exact Amount mapping; Spin is treated as total
    // degrees and Zoom as ±25% of the centre distance at Amount 100.
    maxSteps = Math.max(1, Math.min(48, Math.floor(160_000_000 / Math.max(1, w * h)))),
    totalAngle = (f.amount * Math.PI) / 180,
    zoomSpan = f.amount / 200,
    cosStart = Math.cos(-totalAngle / 2),
    sinStart = Math.sin(-totalAngle / 2)
  const samplePremultiplied = (sx: number, sy: number, acc: Float64Array) => {
    const x = clamp(sx, 0, w - 1),
      y = clamp(sy, 0, h - 1),
      x0 = Math.floor(x),
      y0 = Math.floor(y),
      x1 = Math.min(w - 1, x0 + 1),
      y1 = Math.min(h - 1, y0 + 1),
      fx = x - x0,
      fy = y - y0
    const w00 = (1 - fx) * (1 - fy),
      w10 = fx * (1 - fy),
      w01 = (1 - fx) * fy,
      w11 = fx * fy
    if (w00) {
      const i = (y0 * w + x0) * 4,
        a = p[i + 3] * w00
      acc[0] += p[i] * a
      acc[1] += p[i + 1] * a
      acc[2] += p[i + 2] * a
      acc[3] += a
    }
    if (w10) {
      const i = (y0 * w + x1) * 4,
        a = p[i + 3] * w10
      acc[0] += p[i] * a
      acc[1] += p[i + 1] * a
      acc[2] += p[i + 2] * a
      acc[3] += a
    }
    if (w01) {
      const i = (y1 * w + x0) * 4,
        a = p[i + 3] * w01
      acc[0] += p[i] * a
      acc[1] += p[i + 1] * a
      acc[2] += p[i + 2] * a
      acc[3] += a
    }
    if (w11) {
      const i = (y1 * w + x1) * 4,
        a = p[i + 3] * w11
      acc[0] += p[i] * a
      acc[1] += p[i + 1] * a
      acc[2] += p[i + 2] * a
      acc[3] += a
    }
  }
  const acc = new Float64Array(4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (!p[o + 3]) continue
      const dx = x - cx,
        dy = y - cy,
        radius = Math.hypot(dx, dy)
      acc.fill(0)
      if (radius < 0.001) {
        samplePremultiplied(x, y, acc)
      } else if (f.method === 'spin') {
        const steps = Math.max(1, Math.min(maxSteps, Math.ceil(radius * totalAngle))),
          stepAngle = steps > 1 ? totalAngle / (steps - 1) : 0,
          cosStep = Math.cos(stepAngle),
          sinStep = Math.sin(stepAngle)
        let vx = dx * cosStart - dy * sinStart,
          vy = dx * sinStart + dy * cosStart
        for (let i = 0; i < steps; i++) {
          samplePremultiplied(cx + vx, cy + vy, acc)
          const nextX = vx * cosStep - vy * sinStep
          vy = vx * sinStep + vy * cosStep
          vx = nextX
        }
      } else {
        const steps = Math.max(1, Math.min(maxSteps, Math.ceil(radius * zoomSpan))),
          startScale = 1 - zoomSpan / 2,
          stepScale = steps > 1 ? zoomSpan / (steps - 1) : 0
        for (let i = 0; i < steps; i++) {
          const scale = startScale + stepScale * i
          samplePremultiplied(cx + dx * scale, cy + dy * scale, acc)
        }
      }
      if (acc[3] > 0) {
        out[o] = clamp(acc[0] / acc[3])
        out[o + 1] = clamp(acc[1] / acc[3])
        out[o + 2] = clamp(acc[2] / acc[3])
      }
    }
}
function median(p: Uint8ClampedArray, out: Uint8ClampedArray, w: number, h: number, r: number) {
  for (let y = 0; y < h; y++) {
    const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)],
      mid = [0, 0, 0],
      below = [0, 0, 0]
    let total = 0
    const column = (xx: number, sign: number) => {
      const x = clamp(xx, 0, w - 1)
      for (let dy = -r; dy <= r; dy++) {
        const i = (clamp(y + dy, 0, h - 1) * w + x) * 4,
          a = p[i + 3] * sign
        total += a
        for (let c = 0; c < 3; c++) {
          hist[c][p[i + c]] += a
          if (p[i + c] < mid[c]) below[c] += a
        }
      }
    }
    for (let x = -r; x <= r; x++) column(x, 1)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (total && p[i + 3])
        for (let c = 0; c < 3; c++) {
          const half = total / 2
          while (mid[c] > 0 && below[c] > half) {
            mid[c]--
            below[c] -= hist[c][mid[c]]
          }
          while (mid[c] < 255 && below[c] + hist[c][mid[c]] <= half) {
            below[c] += hist[c][mid[c]]
            mid[c]++
          }
          out[i + c] = mid[c]
        }
      column(x - r, -1)
      column(x + r + 1, 1)
    }
  }
}
export function processRasterFilter(request: RasterFilterRequest): Uint8ClampedArray {
  const { width: w, height: h, pixels: p, mask } = request,
    f = parseRasterFilter(request.filter)
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 4096 ||
    h > 4096 ||
    w * h > MAX_FILTER_PIXELS ||
    p.length !== w * h * 4 ||
    (mask && mask.length !== w * h)
  )
    throw new Error(
      'Растровые фильтры: до 8 Мп и 4096 px по стороне. Уменьши слой перед обработкой.',
    )
  const out = new Uint8ClampedArray(p)
  if (f.type === 'unsharp' || f.type === 'highpass') frequency(p, out, w, h, f)
  else if (f.type === 'median') median(p, out, w, h, f.radius)
  else if (f.type === 'mosaic') {
    for (let y = 0; y < h; y += f.size)
      for (let x = 0; x < w; x += f.size) {
        const x2 = Math.min(w, x + f.size),
          y2 = Math.min(h, y + f.size),
          sum = [0, 0, 0]
        let alpha = 0
        for (let yy = y; yy < y2; yy++)
          for (let xx = x; xx < x2; xx++) {
            const i = (yy * w + xx) * 4
            alpha += p[i + 3]
            for (let c = 0; c < 3; c++) sum[c] += p[i + c] * p[i + 3]
          }
        if (alpha)
          for (let yy = y; yy < y2; yy++)
            for (let xx = x; xx < x2; xx++) {
              const i = (yy * w + xx) * 4
              if (p[i + 3]) for (let c = 0; c < 3; c++) out[i + c] = Math.round(sum[c] / alpha)
            }
      }
  } else if (f.type === 'noise') {
    let seed = f.seed | 0
    const random = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return ((seed >>> 0) + 0.5) / 4294967296
    }
    const noise = () =>
      f.amount *
      2.55 *
      (f.distribution === 'uniform'
        ? random() * 2 - 1
        : (Math.sqrt(-2 * Math.log(Math.max(1e-10, random()))) * Math.cos(2 * Math.PI * random())) /
          3)
    for (let i = 0; i < p.length; i += 4)
      if (p[i + 3]) {
        const mono = f.monochrome ? noise() : 0
        for (let c = 0; c < 3; c++) out[i + c] = clamp(p[i + c] + (f.monochrome ? mono : noise()))
      }
  } else if (f.type === 'gaussian') gaussian(p, out, w, h, f.radius)
  else if (f.type === 'motion') motion(p, out, w, h, f.angle, f.distance)
  else if (f.type === 'radial') radialBlur(p, out, w, h, f)
  else if (f.type === 'threshold') {
    for (let i = 0; i < p.length; i += 4)
      if (p[i + 3]) {
        const v = p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722 >= f.level ? 255 : 0
        out[i] = out[i + 1] = out[i + 2] = v
      }
  } else if (f.type === 'emboss') {
    const rad = (f.angle * Math.PI) / 180,
      dx = Math.round(Math.cos(rad)),
      dy = Math.round(Math.sin(rad)),
      lumaAt = (x: number, y: number) => {
        const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4
        return p[i + 3] ? p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722 : 128
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (!p[i + 3]) continue
        const v = clamp(128 + ((lumaAt(x + dx, y + dy) - lumaAt(x - dx, y - dy)) * f.amount) / 100)
        out[i] = out[i + 1] = out[i + 2] = v
      }
  } else {
    const luminance = (x: number, y: number, fallback: number) => {
      const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4
      return p[i + 3] ? p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11 : fallback
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (!p[i + 3]) continue
        const center = luminance(x, y, 0),
          a = luminance(x - 1, y - 1, center),
          b = luminance(x, y - 1, center),
          c = luminance(x + 1, y - 1, center),
          d = luminance(x - 1, y, center),
          e = luminance(x + 1, y, center),
          g = luminance(x - 1, y + 1, center),
          j = luminance(x, y + 1, center),
          k = luminance(x + 1, y + 1, center)
        const edge =
          255 -
          clamp(
            Math.hypot(-a + c - 2 * d + 2 * e - g + k, -a - 2 * b - c + g + 2 * j + k) * f.strength,
          )
        out[i] = out[i + 1] = out[i + 2] = edge
      }
  }
  if (mask)
    for (let i = 0; i < p.length; i += 4)
      for (let c = 0; c < 3; c++)
        out[i + c] = Math.round(p[i + c] + ((out[i + c] - p[i + c]) * mask[i / 4]) / 255)
  return out
}

/**
 * High-frequency layer for frequency separation: 128 + (original − low)/2.
 * Composited over the low layer with Linear Light it reconstructs the
 * original exactly (Linear Light doubles the stored half-scale delta),
 * matching Photoshop's Apply Image scale 2 / offset 128 recipe.
 */
export function frequencyDetail(p: Uint8ClampedArray, low: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(p)
  for (let i = 0; i < p.length; i += 4)
    if (p[i + 3]) for (let c = 0; c < 3; c++) out[i + c] = clamp(128 + (p[i + c] - low[i + c]) / 2)
  return out
}
