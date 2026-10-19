export interface CubeLut {
  title: string
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** CUBE order: red changes fastest, then green, then blue; RGB triples. */
  values: number[]
}
export const MAX_CUBE_BYTES = 2 * 1024 * 1024
export const MAX_CUBE_SIZE = 33
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 16
const triple = (v: unknown): v is CubeLut['domainMin'] =>
  Array.isArray(v) && v.length === 3 && v.every(finite)
export function parseCubeLut(value: unknown): CubeLut {
  if (!value || typeof value !== 'object') throw new Error('Нет данных 3D LUT')
  const v = value as Record<string, unknown>,
    size = v.size
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > MAX_CUBE_SIZE)
    throw new Error(`3D LUT: размер сетки от 2 до ${MAX_CUBE_SIZE}`)
  if (
    !triple(v.domainMin) ||
    !triple(v.domainMax) ||
    v.domainMin.some((n, i) => n >= (v.domainMax as number[])[i])
  )
    throw new Error('3D LUT: некорректный DOMAIN_MIN / DOMAIN_MAX')
  if (!Array.isArray(v.values) || v.values.length !== size ** 3 * 3 || !v.values.every(finite))
    throw new Error('3D LUT: неверное число RGB-значений или нечисловые данные')
  return {
    title:
      typeof v.title === 'string'
        ? v.title
            .replace(/["\\\x00-\x1f]/g, ' ')
            .trim()
            .slice(0, 100) || '3D LUT'
        : '3D LUT',
    size,
    domainMin: [...v.domainMin],
    domainMax: [...v.domainMax],
    values: [...v.values],
  }
}
export function identityCube(size = 2): CubeLut {
  if (!Number.isInteger(size) || size < 2 || size > MAX_CUBE_SIZE)
    throw new Error('Некорректная сетка LUT')
  const values: number[] = []
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) values.push(r / (size - 1), g / (size - 1), b / (size - 1))
  return { title: 'Identity', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values }
}
/** Strict data-only parser: unknown headers/1D shapers are rejected, not silently ignored. */
export function parseCubeFile(text: string, fallbackTitle = '3D LUT'): CubeLut {
  if (text.length > MAX_CUBE_BYTES || new TextEncoder().encode(text).byteLength > MAX_CUBE_BYTES)
    throw new Error('Файл CUBE должен быть до 2 МиБ')
  let size: number | undefined,
    title = fallbackTitle
  let min: number[] = [0, 0, 0],
    max: number[] = [1, 1, 1]
  const values: number[] = [],
    seen = new Set<string>()
  for (const [index, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^TITLE\s/.test(line)) {
      if (seen.has('TITLE')) throw new Error('Повторный TITLE в CUBE')
      const match = /^TITLE\s+"([^"\\\x00-\x1f]{0,100})"\s*(?:#.*)?$/.exec(line)
      if (!match) throw new Error('Некорректный TITLE в CUBE')
      title = match[1]
      seen.add('TITLE')
      continue
    }
    line = line.replace(/\s+#.*$/, '')
    const parts = line.split(/\s+/),
      header = parts[0]
    if (['LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX'].includes(header)) {
      if (seen.has(header) || values.length) throw new Error('Повторный или поздний заголовок CUBE')
      seen.add(header)
      if (header === 'LUT_3D_SIZE') {
        if (parts.length !== 2 || !/^\d+$/.test(parts[1]))
          throw new Error('Некорректный LUT_3D_SIZE')
        size = Number(parts[1])
        if (size < 2 || size > MAX_CUBE_SIZE)
          throw new Error(`Поддерживается 3D CUBE от 2 до ${MAX_CUBE_SIZE}`)
      } else {
        const t = parts.slice(1).map(Number)
        if (!triple(t)) throw new Error(`Некорректный ${header}`)
        if (header === 'DOMAIN_MIN') min = t
        else max = t
      }
      continue
    }
    if (
      !size ||
      parts.length !== 3 ||
      !parts.every((s) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))
    )
      throw new Error(
        `Строка ${index + 1}: ожидается RGB-тройка; 1D LUT, shaper и неизвестные команды не поддержаны`,
      )
    const row = parts.map(Number)
    if (!row.every(finite))
      throw new Error('CUBE: RGB-значения должны быть конечными, в диапазоне −16…16')
    values.push(...row)
    if (values.length > size ** 3 * 3) throw new Error('Лишние строки данных CUBE')
  }
  return parseCubeLut({ title, size, domainMin: min, domainMax: max, values })
}
export function serializeCube(lut: CubeLut): string {
  const v = parseCubeLut(lut),
    f = (n: number) => Number(n.toFixed(9)).toString()
  const lines = [
    `TITLE "${v.title}"`,
    `LUT_3D_SIZE ${v.size}`,
    `DOMAIN_MIN ${v.domainMin.map(f).join(' ')}`,
    `DOMAIN_MAX ${v.domainMax.map(f).join(' ')}`,
  ]
  for (let i = 0; i < v.values.length; i += 3)
    lines.push(
      v.values
        .slice(i, i + 3)
        .map(f)
        .join(' '),
    )
  const text = lines.join('\n') + '\n'
  if (new TextEncoder().encode(text).byteLength > MAX_CUBE_BYTES)
    throw new Error('Экспорт CUBE превышает 2 МиБ')
  return text
}
export function sampleCube(lut: CubeLut, r: number, g: number, b: number, out: number[]) {
  const n = lut.size,
    last = n - 1,
    d = lut.values,
    x =
      Math.max(0, Math.min(1, (r - lut.domainMin[0]) / (lut.domainMax[0] - lut.domainMin[0]))) *
      last,
    y =
      Math.max(0, Math.min(1, (g - lut.domainMin[1]) / (lut.domainMax[1] - lut.domainMin[1]))) *
      last,
    z =
      Math.max(0, Math.min(1, (b - lut.domainMin[2]) / (lut.domainMax[2] - lut.domainMin[2]))) *
      last,
    x0 = Math.min(last - 1, Math.floor(x)),
    y0 = Math.min(last - 1, Math.floor(y)),
    z0 = Math.min(last - 1, Math.floor(z)),
    tx = x - x0,
    ty = y - y0,
    tz = z - z0,
    at = ((z0 * n + y0) * n + x0) * 3,
    sx = 3,
    sy = n * 3,
    sz = n * n * 3
  for (let c = 0; c < 3; c++) {
    const a = d[at + c] * (1 - tx) + d[at + sx + c] * tx,
      b0 = d[at + sy + c] * (1 - tx) + d[at + sy + sx + c] * tx,
      c0 = d[at + sz + c] * (1 - tx) + d[at + sz + sx + c] * tx,
      e = d[at + sz + sy + c] * (1 - tx) + d[at + sz + sy + sx + c] * tx
    out[c] = (a * (1 - ty) + b0 * ty) * (1 - tz) + (c0 * (1 - ty) + e * ty) * tz
  }
}
