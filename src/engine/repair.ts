/** Local exemplar restoration. No model, network, or proprietary Adobe algorithm.
 * Only unmasked, permitted, opaque pixels may be donors. The input is immutable. */
export type RepairMode = 'auto' | 'smooth' | 'texture'
export interface RepairRequest {
  width: number
  height: number
  pixels: Uint8ClampedArray
  mask: Uint8Array
  donors?: Uint8Array
  mode: RepairMode
  radius: number
  search: number
  expand: number
  feather: number
}
export interface RepairResult {
  pixels: Uint8ClampedArray
  mask: Uint8Array
  mode: 'smooth' | 'texture'
  filled: number
  patches: number
  comparisons: number
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
export function expandMask(input: Uint8Array, w: number, h: number, radius: number) {
  if (!radius) return new Uint8Array(input)
  const horizontal = new Uint8Array(input.length),
    out = new Uint8Array(input.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let value = 0
      for (let d = Math.max(0, x - radius); d <= Math.min(w - 1, x + radius); d++)
        value = Math.max(value, input[y * w + d])
      horizontal[y * w + x] = value
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let value = 0
      for (let d = Math.max(0, y - radius); d <= Math.min(h - 1, y + radius); d++)
        value = Math.max(value, horizontal[d * w + x])
      out[y * w + x] = value
    }
  return out
}
/** Inward feather: never changes a pixel outside the expanded mask. */
function featherMask(mask: Uint8Array, w: number, h: number, radius: number) {
  const out = new Uint8Array(mask)
  if (!radius) return out
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!mask[p]) continue
      let distance = radius + 1
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx,
            yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx])
            distance = Math.min(distance, Math.hypot(dx, dy))
        }
      out[p] = Math.min(mask[p], Math.round((255 * distance) / (radius + 1)))
    }
  return out
}
function solve3(matrix: number[][], values: number[]) {
  const m = matrix.map((row, i) => [...row, values[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let i = col + 1; i < 3; i++) if (Math.abs(m[i][col]) > Math.abs(m[pivot][col])) pivot = i
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    if (Math.abs(m[col][col]) < 1e-9) return [values[0] / Math.max(1, matrix[0][0]), 0, 0]
    const divisor = m[col][col]
    for (let j = col; j < 4; j++) m[col][j] /= divisor
    for (let i = 0; i < 3; i++)
      if (i !== col) {
        const factor = m[i][col]
        for (let j = col; j < 4; j++) m[i][j] -= factor * m[col][j]
      }
  }
  return m.map((row) => row[3])
}
export function repairPixels(
  request: RepairRequest,
  progress: (value: number) => void = () => {},
): RepairResult {
  const { width: w, height: h, pixels, mode } = request,
    count = w * h
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 3 ||
    h < 3 ||
    w > 4096 ||
    h > 4096 ||
    count > 1048576 ||
    pixels.length !== count * 4 ||
    request.mask.length !== count ||
    (request.donors && request.donors.length !== count)
  )
    throw new Error('Восстановление: фрагмент до 1 Мп; некорректные размеры или маска')
  if (
    !['auto', 'smooth', 'texture'].includes(mode) ||
    [request.radius, request.search, request.expand, request.feather].some(
      (n) => !Number.isFinite(n),
    )
  )
    throw new Error('Некорректные параметры восстановления')
  const r = clamp(Math.round(request.radius), 2, 8),
    search = clamp(Math.round(request.search), 12, 160)
  const mask = expandMask(request.mask, w, h, clamp(Math.round(request.expand), 0, 6)),
    missing = Uint8Array.from(mask, (a) => (a > 0 ? 1 : 0)),
    originalMissing = new Uint8Array(missing)
  let total = 0
  for (let p = 0; p < count; p++)
    if (missing[p]) {
      total++
      if (pixels[p * 4 + 3] < 250)
        throw new Error('Выдели непрозрачную область изображения, не прозрачное поле')
    }
  if (!total || total > 120000)
    throw new Error('Выдели от 1 до 120 000 пикселей. Большую область разбей на несколько частей.')
  const permitted = (p: number) =>
    !originalMissing[p] && pixels[p * 4 + 3] >= 250 && (!request.donors || request.donors[p] > 127)
  const neighbors = (p: number, visit: (p: number) => void) => {
    const x = p % w
    if (x) visit(p - 1)
    if (x + 1 < w) visit(p + 1)
    if (p >= w) visit(p - w)
    if (p + w < count) visit(p + w)
  }
  const border = new Set<number>(),
    frontier = new Set<number>()
  for (let p = 0; p < count; p++)
    if (missing[p])
      neighbors(p, (q) => {
        if (permitted(q)) {
          border.add(q)
          frontier.add(p)
        }
      })
  if (border.size < 3)
    throw new Error('Не хватает разрешённого окружения. Уменьши область или увеличь зону образцов.')
  // Least-squares RGB plane reproduces flat paper and smooth lighting gradients,
  // rather than blurring text back into a supposedly cleaned speech balloon.
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]),
    sums = Array.from({ length: 3 }, () => [0, 0, 0])
  for (const p of border) {
    const v = [1, (p % w) / w - 0.5, Math.floor(p / w) / h - 0.5]
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) matrix[a][b] += v[a] * v[b]
      for (let c = 0; c < 3; c++) sums[c][a] += pixels[p * 4 + c] * v[a]
    }
  }
  const planes = sums.map((sum) => solve3(matrix, sum))
  const predicted = (p: number, c: number) =>
    clamp(
      planes[c][0] +
        planes[c][1] * ((p % w) / w - 0.5) +
        planes[c][2] * (Math.floor(p / w) / h - 0.5),
      0,
      255,
    )
  let error = 0
  for (const p of border)
    for (let c = 0; c < 3; c++) error += (pixels[p * 4 + c] - predicted(p, c)) ** 2
  const chosen = mode === 'auto' ? (error / border.size / 3 < 20 ? 'smooth' : 'texture') : mode
  const output = new Uint8ClampedArray(pixels)
  let filled = 0,
    patches = 0,
    comparisons = 0
  if (chosen === 'smooth') {
    for (let p = 0; p < count; p++)
      if (missing[p]) {
        for (let c = 0; c < 3; c++) output[p * 4 + c] = predicted(p, c)
        output[p * 4 + 3] = 255
      }
    filled = total
  } else {
    // Integral invalid-donor map: every source patch is checked in constant time.
    const stride = w + 1,
      invalid = new Uint32Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += permitted(y * w + x) ? 0 : 1
        invalid[(y + 1) * stride + x + 1] = invalid[y * stride + x + 1] + row
      }
    }
    const valid = (x: number, y: number) =>
      x >= r &&
      y >= r &&
      x + r < w &&
      y + r < h &&
      invalid[(y + r + 1) * stride + x + r + 1] -
        invalid[(y - r) * stride + x + r + 1] -
        invalid[(y + r + 1) * stride + x - r] +
        invalid[(y - r) * stride + x - r] ===
        0
    const donors: number[] = []
    for (let y = r; y < h - r; y += Math.max(2, r))
      for (let x = r; x < w - r; x += Math.max(2, r)) if (valid(x, y)) donors.push(y * w + x)
    if (!donors.length)
      throw new Error(
        'Нет чистого участка для фактуры. Уменьши размер заплатки или расширь область образцов.',
      )
    const mapping = new Int32Array(count).fill(-1)
    let random = 777
    const rand = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return random / 4294967296
    }
    while (filled < total) {
      if (!frontier.size) throw new Error('Не удалось продолжить границу восстановления')
      let target = -1,
        priority = -1,
        scanned = 0
      for (const p of frontier) {
        if (!missing[p]) {
          frontier.delete(p)
          continue
        }
        let known = 0
        const x = p % w,
          y = Math.floor(p / w)
        for (let dy = -r; dy <= r; dy += 2)
          for (let dx = -r; dx <= r; dx += 2) {
            const xx = x + dx,
              yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && !missing[yy * w + xx]) known++
          }
        if (known > priority) {
          priority = known
          target = p
        }
        if (++scanned >= 192) break
      }
      if (target < 0) throw new Error('Пустая граница восстановления')
      const tx = target % w,
        ty = Math.floor(target / w)
      const samples: { dx: number; dy: number; p: number; weight: number }[] = []
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = tx + dx,
            y = ty + dy,
            p = y * w + x
          if (x >= 0 && y >= 0 && x < w && y < h && !missing[p] && pixels[p * 4 + 3] >= 250)
            samples.push({ dx, dy, p, weight: originalMissing[p] ? 0.7 : 1 })
        }
      let best = -1,
        bestScore = Infinity
      const tried = new Set<number>()
      const consider = (sx: number, sy: number) => {
        if (!valid(sx, sy)) return
        const source = sy * w + sx
        if (tried.has(source)) return
        tried.add(source)
        let score = 0.00001 * ((sx - tx) ** 2 + (sy - ty) ** 2)
        for (const sample of samples) {
          const from = ((sy + sample.dy) * w + sx + sample.dx) * 4,
            at = sample.p * 4
          score +=
            sample.weight *
            ((pixels[from] - output[at]) ** 2 +
              (pixels[from + 1] - output[at + 1]) ** 2 +
              (pixels[from + 2] - output[at + 2]) ** 2)
          comparisons++
          if (score >= bestScore) break
        }
        if (score < bestScore) {
          bestScore = score
          best = source
        }
      }
      neighbors(target, (q) => {
        if (mapping[q] >= 0)
          consider(
            (mapping[q] % w) + tx - (q % w),
            Math.floor(mapping[q] / w) + ty - Math.floor(q / w),
          )
      })
      // Dense axial candidates preserve phase on periodic textures; deterministic global
      // candidates allow the centre of a large hole to reach original clean material.
      for (let distance = r + 1; distance <= search; distance++) {
        consider(tx - distance, ty)
        consider(tx + distance, ty)
        consider(tx, ty - distance)
        consider(tx, ty + distance)
      }
      for (let i = 0; i < 96; i++) {
        if (i < 48)
          consider(
            clamp(tx + Math.round((rand() * 2 - 1) * search), r, w - r - 1),
            clamp(ty + Math.round((rand() * 2 - 1) * search), r, h - r - 1),
          )
        else {
          const p = donors[Math.floor(rand() * donors.length)]
          consider(p % w, Math.floor(p / w))
        }
      }
      if (best < 0 || comparisons > 80000000)
        throw new Error('Слишком сложная область. Уменьши её или выбери гладкий фон.')
      const sx = best % w,
        sy = Math.floor(best / w),
        changed: number[] = []
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = tx + dx,
            y = ty + dy,
            p = y * w + x
          if (x < 0 || y < 0 || x >= w || y >= h || !missing[p]) continue
          const source = (sy + dy) * w + sx + dx
          for (let c = 0; c < 4; c++) output[p * 4 + c] = pixels[source * 4 + c]
          missing[p] = 0
          mapping[p] = source
          frontier.delete(p)
          filled++
          changed.push(p)
        }
      for (const p of changed)
        neighbors(p, (q) => {
          if (missing[q]) frontier.add(q)
        })
      patches++
      if (patches % 16 === 0) progress(filled / total)
    }
  }
  progress(1)
  return {
    pixels: output,
    mask: featherMask(mask, w, h, clamp(Math.round(request.feather), 0, 4)),
    mode: chosen,
    filled,
    patches,
    comparisons,
  }
}
