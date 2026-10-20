/**
 * A deliberately bounded ICC colour engine.
 *
 * It understands the profile families that can be converted honestly with a
 * matrix/TRC model: RGB display/working-space profiles with XYZ PCS colourant
 * tags and grayscale profiles with a kTRC. LUT, CMYK, Lab-PCS and named-colour
 * profiles are identified, but conversion is refused instead of approximated
 * by an unrelated desaturation or gamma trick.
 */

import type { DocumentColorProfile } from '../types'

export type ColorProfileKind = 'rgb' | 'gray'
export type RenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute'

export type BuiltinColorProfileId =
  | 'srgb-iec61966-2-1'
  | 'adobe-rgb-1998'
  | 'apple-rgb'
  | 'colormatch-rgb'
  | 'display-p3'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'sgray'
  | 'gray-gamma-1.8'
  | 'gray-gamma-2.2'

type Vec3 = [number, number, number]
type Matrix3 = [number, number, number, number, number, number, number, number, number]

export interface RgbColorProfileModel {
  kind: 'rgb'
  id: string
  name: string
  source: 'builtin' | 'icc'
  /** Linear device RGB -> XYZ in the D50 profile connection space. */
  matrix: Matrix3
  /** Optional linear RGB -> absolute XYZ (not media-relative D50). */
  absoluteMatrix?: Matrix3
  white: Vec3
  black: Vec3
  absoluteWhite?: Vec3
  decodeLuts: [Float32Array, Float32Array, Float32Array]
}

export interface GrayColorProfileModel {
  kind: 'gray'
  id: string
  name: string
  source: 'builtin' | 'icc'
  white: Vec3
  black: Vec3
  absoluteWhite?: Vec3
  decodeLut: Float32Array
}

export type ColorProfileModel = RgbColorProfileModel | GrayColorProfileModel

export interface ParsedColorProfile {
  present: true
  name: string
  size: number
  hash: string
  version: string
  deviceClass: string
  colorSpace: string
  pcs: string
  renderingIntent: RenderingIntent
  recognizedId?: BuiltinColorProfileId
  model?: ColorProfileModel
  unsupportedReason?: string
}

export interface ColorTransformOptions {
  intent?: RenderingIntent
  blackPointCompensation?: boolean
  dither?: boolean
}

export interface ColorTransform {
  sourceName: string
  destinationName: string
  effectiveIntent: 'relative' | 'absolute'
  transformRgb: (rgb: readonly [number, number, number]) => [number, number, number]
  transformPixels: (data: Uint8ClampedArray | Uint8Array, width: number, height: number) => void
}

const D50: Vec3 = [0.9642, 1, 0.8249]
const D65: Vec3 = [0.95047, 1, 1.08883]
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
const byte = (v: number) => Math.min(255, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)))

function multiplyMatrixVector(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

function multiplyMatrices(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array(9).fill(0) as Matrix3
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]
  return out
}

function invertMatrix(m: Matrix3): Matrix3 | undefined {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined
  const invDet = 1 / det
  return [
    A * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    C * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ]
}

function determinant(m: Matrix3): number {
  const [a, b, c, d, e, f, g, h, i] = m
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

function xyToXyz(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

function Bradford(from: Vec3, to: Vec3): Matrix3 {
  const cone: Matrix3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
  const inverse = invertMatrix(cone)!
  const source = multiplyMatrixVector(cone, from)
  const destination = multiplyMatrixVector(cone, to)
  const scale: Matrix3 = [
    destination[0] / source[0],
    0,
    0,
    0,
    destination[1] / source[1],
    0,
    0,
    0,
    destination[2] / source[2],
  ]
  return multiplyMatrices(inverse, multiplyMatrices(scale, cone))
}

function makeDecodeLut(fn: (encoded: number) => number): Float32Array {
  const out = new Float32Array(256)
  let previous = 0
  for (let i = 0; i < 256; i++) {
    const value = clamp01(fn(i / 255))
    previous = Math.max(previous, value)
    out[i] = previous
  }
  out[0] = 0
  if (out[255] > 0) {
    const scale = 1 / out[255]
    for (let i = 0; i < 256; i++) out[i] = clamp01(out[i] * scale)
  }
  return out
}

function makeEncodeLut(decode: Float32Array): Float32Array {
  const samples = 4096
  const out = new Float32Array(samples + 1)
  let index = 0
  for (let i = 0; i <= samples; i++) {
    const linear = i / samples
    while (index < 255 && decode[index + 1] < linear) index++
    if (linear <= decode[0]) out[i] = 0
    else if (linear >= decode[255]) out[i] = 255
    else {
      const low = decode[index]
      const high = decode[index + 1]
      out[i] = high > low ? index + (linear - low) / (high - low) : index
    }
  }
  return out
}

function sampleEncode(lut: Float32Array, linear: number): number {
  const scaled = clamp01(linear) * (lut.length - 1)
  const index = Math.floor(scaled)
  const fraction = scaled - index
  return lut[index] * (1 - fraction) + lut[Math.min(lut.length - 1, index + 1)] * fraction
}

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const gammaDecode = (gamma: number) => (v: number) => Math.pow(Math.max(0, v), gamma)
const prophotoDecode = (v: number) => (v <= 1 / 32 ? v / 16 : Math.pow(Math.max(0, v), 1.8))
const rec2020Decode = (v: number) => {
  const alpha = 1.0993
  const beta = 0.0181
  return v < beta * 4.5 ? v / 4.5 : Math.pow((v + alpha - 1) / alpha, 1 / 0.45)
}

function rgbBuiltin(
  id: BuiltinColorProfileId,
  name: string,
  primaries: readonly (readonly [number, number])[],
  whiteXy: readonly [number, number],
  transfer: (encoded: number) => number,
): RgbColorProfileModel {
  const white = xyToXyz(whiteXy[0], whiteXy[1])
  const columns = primaries.map(([x, y]) => xyToXyz(x, y))
  const unscaled: Matrix3 = [
    columns[0][0],
    columns[1][0],
    columns[2][0],
    columns[0][1],
    columns[1][1],
    columns[2][1],
    columns[0][2],
    columns[1][2],
    columns[2][2],
  ]
  const scales = multiplyMatrixVector(invertMatrix(unscaled)!, white)
  const absoluteMatrix: Matrix3 = [
    columns[0][0] * scales[0],
    columns[1][0] * scales[1],
    columns[2][0] * scales[2],
    columns[0][1] * scales[0],
    columns[1][1] * scales[1],
    columns[2][1] * scales[2],
    columns[0][2] * scales[0],
    columns[1][2] * scales[1],
    columns[2][2] * scales[2],
  ]
  const adaptation = Bradford(white, D50)
  const matrix = multiplyMatrices(adaptation, absoluteMatrix)
  const lut = makeDecodeLut(transfer)
  return {
    kind: 'rgb',
    id,
    name,
    source: 'builtin',
    matrix,
    absoluteMatrix,
    white: multiplyMatrixVector(adaptation, white),
    black: [0, 0, 0],
    absoluteWhite: white,
    decodeLuts: [lut, lut, lut],
  }
}

function grayBuiltin(
  id: BuiltinColorProfileId,
  name: string,
  transfer: (encoded: number) => number,
): GrayColorProfileModel {
  return {
    kind: 'gray',
    id,
    name,
    source: 'builtin',
    white: multiplyMatrixVector(Bradford(D65, D50), D65),
    black: [0, 0, 0],
    absoluteWhite: D65,
    decodeLut: makeDecodeLut(transfer),
  }
}

const BUILTINS = new Map<BuiltinColorProfileId, ColorProfileModel>([
  [
    'srgb-iec61966-2-1',
    rgbBuiltin(
      'srgb-iec61966-2-1',
      'sRGB IEC61966-2.1',
      [
        [0.64, 0.33],
        [0.3, 0.6],
        [0.15, 0.06],
      ],
      [0.3127, 0.329],
      srgbDecode,
    ),
  ],
  [
    'adobe-rgb-1998',
    rgbBuiltin(
      'adobe-rgb-1998',
      'Adobe RGB (1998)',
      [
        [0.64, 0.33],
        [0.21, 0.71],
        [0.15, 0.06],
      ],
      [0.3127, 0.329],
      gammaDecode(2.2),
    ),
  ],
  [
    'apple-rgb',
    rgbBuiltin(
      'apple-rgb',
      'Apple RGB',
      [
        [0.625, 0.34],
        [0.28, 0.595],
        [0.155, 0.07],
      ],
      [0.3127, 0.329],
      gammaDecode(1.8),
    ),
  ],
  [
    'colormatch-rgb',
    rgbBuiltin(
      'colormatch-rgb',
      'ColorMatch RGB',
      [
        [0.63, 0.34],
        [0.295, 0.605],
        [0.15, 0.075],
      ],
      [0.3457, 0.3585],
      gammaDecode(1.8),
    ),
  ],
  [
    'display-p3',
    rgbBuiltin(
      'display-p3',
      'Display P3',
      [
        [0.68, 0.32],
        [0.265, 0.69],
        [0.15, 0.06],
      ],
      [0.3127, 0.329],
      srgbDecode,
    ),
  ],
  [
    'prophoto-rgb',
    rgbBuiltin(
      'prophoto-rgb',
      'ProPhoto RGB',
      [
        [0.7347, 0.2653],
        [0.1596, 0.8404],
        [0.0366, 0.0001],
      ],
      [0.3457, 0.3585],
      prophotoDecode,
    ),
  ],
  [
    'rec2020',
    rgbBuiltin(
      'rec2020',
      'ITU-R BT.2020',
      [
        [0.708, 0.292],
        [0.17, 0.797],
        [0.131, 0.046],
      ],
      [0.3127, 0.329],
      rec2020Decode,
    ),
  ],
  ['sgray', grayBuiltin('sgray', 'sGray', srgbDecode)],
  ['gray-gamma-1.8', grayBuiltin('gray-gamma-1.8', 'Gray Gamma 1.8', gammaDecode(1.8))],
  ['gray-gamma-2.2', grayBuiltin('gray-gamma-2.2', 'Gray Gamma 2.2', gammaDecode(2.2))],
])

export const SRGB_PROFILE_ID: BuiltinColorProfileId = 'srgb-iec61966-2-1'
export const WORKING_RGB_PROFILE = BUILTINS.get(SRGB_PROFILE_ID) as RgbColorProfileModel

export function builtinColorProfile(id: string): ColorProfileModel | undefined {
  return BUILTINS.get(id as BuiltinColorProfileId)
}

export function builtinColorProfiles(kind?: ColorProfileKind): ColorProfileModel[] {
  return [...BUILTINS.values()].filter((profile) => !kind || profile.kind === kind)
}

function normalizeProfileName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
}

export function recognizedBuiltinProfileId(name: string): BuiltinColorProfileId | undefined {
  const normalized = normalizeProfileName(name)
  const compact = normalized.replace(/[^a-z0-9.]/g, '')
  if (/(^| )srgb( |$)/.test(normalized) || compact.includes('srgbiec61966')) return SRGB_PROFILE_ID
  if (compact.includes('adobergb')) return 'adobe-rgb-1998'
  if (compact.includes('displayp3')) return 'display-p3'
  if (compact.includes('prophotorgb') || compact.includes('rommrgb')) return 'prophoto-rgb'
  if (compact.includes('applergb')) return 'apple-rgb'
  if (compact.includes('colormatchrgb')) return 'colormatch-rgb'
  if (compact.includes('rec2020') || compact.includes('bt2020')) return 'rec2020'
  if (compact === 'sgray' || compact.includes('sgray')) return 'sgray'
  if ((compact.includes('graygamma') || compact.includes('greygamma')) && compact.includes('1.8'))
    return 'gray-gamma-1.8'
  if ((compact.includes('graygamma') || compact.includes('greygamma')) && compact.includes('2.2'))
    return 'gray-gamma-2.2'
  return undefined
}

function profileHash(bytes: Uint8Array): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    a ^= bytes[i]
    a = Math.imul(a, 0x01000193)
    b = Math.imul(b ^ bytes[i], 0x85ebca6b)
    b ^= b >>> 13
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] || 0)
  return out
}

function cleanProfileName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

interface IccTag {
  offset: number
  size: number
}

function within(bytes: Uint8Array, offset: number, size: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(size) &&
    offset >= 0 &&
    size >= 0 &&
    offset <= bytes.length &&
    size <= bytes.length - offset
  )
}

function parseXyzTag(bytes: Uint8Array, view: DataView, tag?: IccTag): Vec3 | undefined {
  if (!tag || tag.size < 20 || !within(bytes, tag.offset, tag.size)) return undefined
  if (ascii(bytes, tag.offset, 4) !== 'XYZ ') return undefined
  const values = [0, 1, 2].map((i) => view.getInt32(tag.offset + 8 + i * 4) / 65536) as Vec3
  return values.every((v) => Number.isFinite(v) && v >= -0.25 && v <= 4) ? values : undefined
}

function parseSf32Tag(bytes: Uint8Array, view: DataView, tag?: IccTag): Matrix3 | undefined {
  if (!tag || tag.size < 44 || !within(bytes, tag.offset, tag.size)) return undefined
  if (ascii(bytes, tag.offset, 4) !== 'sf32') return undefined
  const values = Array.from(
    { length: 9 },
    (_, i) => view.getInt32(tag.offset + 8 + i * 4) / 65536,
  ) as Matrix3
  return values.every((v) => Number.isFinite(v) && Math.abs(v) <= 16) ? values : undefined
}

function parametricValue(type: number, p: number[], x: number): number {
  const [g = 1, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p
  const power = (value: number) => (value <= 0 ? 0 : Math.pow(value, g))
  switch (type) {
    case 0:
      return power(x)
    case 1:
      return a === 0 ? 0 : x >= -b / a ? power(a * x + b) : 0
    case 2:
      return a === 0 ? c : x >= -b / a ? power(a * x + b) + c : c
    case 3:
      return x >= d ? power(a * x + b) : c * x
    case 4:
      return x >= d ? power(a * x + b) + e : c * x + f
    default:
      return Number.NaN
  }
}

function parseCurveTag(bytes: Uint8Array, view: DataView, tag?: IccTag): Float32Array | undefined {
  if (!tag || tag.size < 12 || !within(bytes, tag.offset, tag.size)) return undefined
  const type = ascii(bytes, tag.offset, 4)
  if (type === 'curv') {
    const count = view.getUint32(tag.offset + 8)
    if (count === 0) return makeDecodeLut((v) => v)
    if (count === 1) {
      if (tag.size < 14) return undefined
      const gamma = view.getUint16(tag.offset + 12) / 256
      return gamma > 0 && gamma <= 10 ? makeDecodeLut(gammaDecode(gamma)) : undefined
    }
    if (count > 65536 || tag.size < 12 + count * 2) return undefined
    const samples = new Float32Array(count)
    for (let i = 0; i < count; i++) samples[i] = view.getUint16(tag.offset + 12 + i * 2) / 65535
    const out = new Float32Array(256)
    let previous = 0
    for (let i = 0; i < 256; i++) {
      const position = (i / 255) * (count - 1)
      const low = Math.floor(position)
      const high = Math.min(count - 1, low + 1)
      const fraction = position - low
      const value = samples[low] * (1 - fraction) + samples[high] * fraction
      previous = Math.max(previous, clamp01(value))
      out[i] = previous
    }
    return out[255] >= 0.8 ? out : undefined
  }
  if (type === 'para') {
    const functionType = view.getUint16(tag.offset + 8)
    const counts = [1, 3, 4, 5, 7]
    const count = counts[functionType]
    if (!count || tag.size < 12 + count * 4) return undefined
    const parameters = Array.from(
      { length: count },
      (_, i) => view.getInt32(tag.offset + 12 + i * 4) / 65536,
    )
    if (!parameters.every(Number.isFinite)) return undefined
    const out = makeDecodeLut((value) => parametricValue(functionType, parameters, value))
    return out[255] >= 0.8 ? out : undefined
  }
  return undefined
}

function parseDescription(bytes: Uint8Array, view: DataView, tag?: IccTag): string | undefined {
  if (!tag || tag.size < 8 || !within(bytes, tag.offset, tag.size)) return undefined
  const type = ascii(bytes, tag.offset, 4)
  if (type === 'desc' && tag.size >= 12) {
    const count = view.getUint32(tag.offset + 8)
    if (count > 0 && count <= tag.size - 12) {
      const text = cleanProfileName(ascii(bytes, tag.offset + 12, count).replace(/\0.*$/s, ''))
      if (text) return text
    }
  }
  if (type === 'mluc' && tag.size >= 16) {
    const count = view.getUint32(tag.offset + 8)
    const recordSize = view.getUint32(tag.offset + 12)
    if (count > 0 && count <= 64 && recordSize >= 12 && tag.size >= 16 + count * recordSize) {
      const records = Array.from({ length: count }, (_, i) => {
        const at = tag.offset + 16 + i * recordSize
        return {
          language: ascii(bytes, at, 4),
          length: view.getUint32(at + 4),
          offset: view.getUint32(at + 8),
        }
      }).sort((a, b) => {
        const score = (record: (typeof records)[number]) =>
          record.language.startsWith('en') ? 0 : record.language.startsWith('ru') ? 1 : 2
        return score(a) - score(b)
      })
      for (const record of records) {
        if (
          record.length < 2 ||
          record.length > 4096 ||
          record.offset > tag.size ||
          record.length > tag.size - record.offset
        )
          continue
        let text = ''
        for (let i = 0; i + 1 < record.length; i += 2)
          text += String.fromCharCode(view.getUint16(tag.offset + record.offset + i))
        text = cleanProfileName(text)
        if (text) return text
      }
    }
  }
  if (type === 'text' && tag.size > 8) {
    const text = cleanProfileName(
      ascii(bytes, tag.offset + 8, Math.min(tag.size - 8, 512)).replace(/\0.*$/s, ''),
    )
    if (text) return text
  }
  return undefined
}

function sameCurve(a: Float32Array, b: Float32Array, tolerance: number): boolean {
  for (let i = 0; i < 256; i++) if (Math.abs(a[i] - b[i]) > tolerance) return false
  return true
}

function matchBuiltinModel(model: ColorProfileModel): BuiltinColorProfileId | undefined {
  for (const candidate of BUILTINS.values()) {
    if (candidate.kind !== model.kind) continue
    if (candidate.kind === 'gray' && model.kind === 'gray') {
      if (sameCurve(model.decodeLut, candidate.decodeLut, 0.02))
        return candidate.id as BuiltinColorProfileId
      continue
    }
    if (candidate.kind !== 'rgb' || model.kind !== 'rgb') continue
    let matches = candidate.matrix.every((v, i) => Math.abs(v - model.matrix[i]) <= 0.02)
    if (matches)
      matches = candidate.decodeLuts.every((lut, i) => sameCurve(lut, model.decodeLuts[i], 0.025))
    if (matches) return candidate.id as BuiltinColorProfileId
  }
  return undefined
}

/** Parse an ICC profile without throwing on malformed third-party data. */
export function parseIccProfile(input: Uint8Array | ArrayBuffer): ParsedColorProfile | undefined {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length < 132 || bytes.length > 32 * 1024 * 1024) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (ascii(bytes, 36, 4) !== 'acsp') return undefined
  const declaredSize = view.getUint32(0)
  if (declaredSize < 132 || declaredSize > bytes.length) return undefined
  const colorSpace = ascii(bytes, 16, 4).trim()
  const pcs = ascii(bytes, 20, 4).trim()
  const deviceClass = ascii(bytes, 12, 4).trim()
  const versionByte = bytes[8]
  const minorByte = bytes[9]
  const version = `${versionByte >> 4}.${versionByte & 15}.${minorByte >> 4}`
  const intentIndex = view.getUint32(64)
  const renderingIntent =
    (['perceptual', 'relative', 'saturation', 'absolute'] as RenderingIntent[])[intentIndex] ||
    'relative'

  const tags = new Map<string, IccTag>()
  const tagCount = view.getUint32(128)
  if (tagCount <= 256 && within(bytes, 132, tagCount * 12)) {
    for (let i = 0; i < tagCount; i++) {
      const at = 132 + i * 12
      const signature = ascii(bytes, at, 4)
      const tag = { offset: view.getUint32(at + 4), size: view.getUint32(at + 8) }
      if (!tags.has(signature) && within(bytes, tag.offset, tag.size)) tags.set(signature, tag)
    }
  }

  const fallbackName =
    colorSpace === 'RGB'
      ? 'ICC RGB (без названия)'
      : colorSpace === 'GRAY'
        ? 'ICC Gray (без названия)'
        : `ICC ${colorSpace || 'unknown'} (без названия)`
  const name = parseDescription(bytes, view, tags.get('desc')) || fallbackName
  const result: ParsedColorProfile = {
    present: true,
    name,
    size: declaredSize,
    hash: profileHash(bytes.subarray(0, declaredSize)),
    version,
    deviceClass,
    colorSpace,
    pcs,
    renderingIntent,
  }
  result.recognizedId = recognizedBuiltinProfileId(name)

  const white = parseXyzTag(bytes, view, tags.get('wtpt'))
  const black = parseXyzTag(bytes, view, tags.get('bkpt')) || [0, 0, 0]
  const chad = parseSf32Tag(bytes, view, tags.get('chad'))
  const inverseChad = chad ? invertMatrix(chad) : undefined

  if (pcs !== 'XYZ') {
    result.unsupportedReason =
      'Профиль использует Lab PCS или табличное преобразование; матричная/TRC-конверсия для него недоступна.'
    return result
  }

  if (colorSpace === 'RGB') {
    const red = parseXyzTag(bytes, view, tags.get('rXYZ'))
    const green = parseXyzTag(bytes, view, tags.get('gXYZ'))
    const blue = parseXyzTag(bytes, view, tags.get('bXYZ'))
    const redCurve = parseCurveTag(bytes, view, tags.get('rTRC'))
    const greenCurve = parseCurveTag(bytes, view, tags.get('gTRC'))
    const blueCurve = parseCurveTag(bytes, view, tags.get('bTRC'))
    if (!white || !red || !green || !blue || !redCurve || !greenCurve || !blueCurve) {
      result.unsupportedReason =
        tags.has('A2B0') || tags.has('B2A0')
          ? 'Это LUT-профиль (A2B/B2A). Табличные ICC-преобразования пока не поддерживаются.'
          : 'В RGB-профиле нет полного набора матричных тегов rXYZ/gXYZ/bXYZ и кривых rTRC/gTRC/bTRC.'
      return result
    }
    const matrix: Matrix3 = [
      red[0],
      green[0],
      blue[0],
      red[1],
      green[1],
      blue[1],
      red[2],
      green[2],
      blue[2],
    ]
    if (Math.abs(determinant(matrix)) < 1e-7 || white[1] <= 0.1 || white[1] > 2) {
      result.unsupportedReason =
        'Матрица RGB-профиля вырождена или точка белого вне допустимого диапазона.'
      return result
    }
    const model: RgbColorProfileModel = {
      kind: 'rgb',
      id: result.recognizedId || `icc-${result.hash}`,
      name,
      source: 'icc',
      matrix,
      absoluteMatrix: inverseChad ? multiplyMatrices(inverseChad, matrix) : undefined,
      white,
      black,
      absoluteWhite: inverseChad ? multiplyMatrixVector(inverseChad, white) : undefined,
      decodeLuts: [redCurve, greenCurve, blueCurve],
    }
    result.model = model
    result.recognizedId ||= matchBuiltinModel(model)
    if (result.recognizedId) model.id = result.recognizedId
    return result
  }

  if (colorSpace === 'GRAY') {
    const curve = parseCurveTag(bytes, view, tags.get('kTRC'))
    if (!white || !curve) {
      result.unsupportedReason =
        tags.has('A2B0') || tags.has('B2A0')
          ? 'Это LUT-профиль серого. Табличные ICC-преобразования пока не поддерживаются.'
          : 'В профиле серого нет кривой kTRC или точки белого wtpt.'
      return result
    }
    const model: GrayColorProfileModel = {
      kind: 'gray',
      id: result.recognizedId || `icc-${result.hash}`,
      name,
      source: 'icc',
      white,
      black,
      absoluteWhite: inverseChad ? multiplyMatrixVector(inverseChad, white) : undefined,
      decodeLut: curve,
    }
    result.model = model
    result.recognizedId ||= matchBuiltinModel(model)
    if (result.recognizedId) model.id = result.recognizedId
    return result
  }

  result.unsupportedReason =
    colorSpace === 'CMYK'
      ? 'CMYK-профили и режим CMYK в этом ядре RGB/8 не преобразуются.'
      : `Цветовое пространство профиля ${colorSpace || 'unknown'} не поддерживается для преобразования.`
  return result
}

export function isSrgbProfile(parsed: ParsedColorProfile | undefined): boolean {
  if (!parsed?.model || parsed.model.kind !== 'rgb') return false
  return profilesMatch(parsed.model, WORKING_RGB_PROFILE)
}

export function profilesMatch(a: ColorProfileModel, b: ColorProfileModel): boolean {
  if (a.kind !== b.kind) return false
  if (
    a.source === 'builtin' &&
    b.source === 'builtin' &&
    a.id === b.id &&
    BUILTINS.has(a.id as BuiltinColorProfileId)
  )
    return true
  if (a.kind === 'gray' && b.kind === 'gray') return sameCurve(a.decodeLut, b.decodeLut, 0.02)
  if (a.kind !== 'rgb' || b.kind !== 'rgb') return false
  return (
    a.matrix.every((v, i) => Math.abs(v - b.matrix[i]) <= 0.02) &&
    a.decodeLuts.every((lut, i) => sameCurve(lut, b.decodeLuts[i], 0.025))
  )
}

function profileWhite(model: ColorProfileModel, absolute: boolean): Vec3 {
  return absolute && model.absoluteWhite ? model.absoluteWhite : model.white
}

function profileBlack(model: ColorProfileModel): Vec3 {
  return model.black
}

function xyzFromEncoded(
  model: ColorProfileModel,
  rgb: readonly [number, number, number],
  absolute: boolean,
): Vec3 {
  if (model.kind === 'gray') {
    const linear = model.decodeLut[byte(rgb[0])]
    const white = profileWhite(model, absolute)
    const scale = white[1] > 0 ? linear / white[1] : 0
    return [white[0] * scale, white[1] * scale, white[2] * scale]
  }
  const linear: Vec3 = [
    model.decodeLuts[0][byte(rgb[0])],
    model.decodeLuts[1][byte(rgb[1])],
    model.decodeLuts[2][byte(rgb[2])],
  ]
  return multiplyMatrixVector(
    absolute && model.absoluteMatrix ? model.absoluteMatrix : model.matrix,
    linear,
  )
}

export function createColorTransform(
  source: ColorProfileModel,
  destination: ColorProfileModel,
  options: ColorTransformOptions = {},
): ColorTransform {
  const absolute =
    options.intent === 'absolute' &&
    !!source.absoluteWhite &&
    !!destination.absoluteWhite &&
    (source.kind === 'gray' || !!source.absoluteMatrix) &&
    (destination.kind === 'gray' || !!destination.absoluteMatrix)
  const sourceWhite = profileWhite(source, absolute)
  const destinationWhite = profileWhite(destination, absolute)
  const sourceBlack = profileBlack(source)
  const destinationBlack = profileBlack(destination)
  const useBpc =
    options.blackPointCompensation !== false &&
    sourceBlack.some((v) => Math.abs(v) > 1e-9) &&
    [0, 1, 2].every(
      (i) =>
        sourceWhite[i] - sourceBlack[i] > 1e-9 && destinationWhite[i] - destinationBlack[i] > 1e-9,
    )
  const destinationInverse =
    destination.kind === 'rgb'
      ? invertMatrix(
          absolute && destination.absoluteMatrix ? destination.absoluteMatrix : destination.matrix,
        )
      : undefined
  if (destination.kind === 'rgb' && !destinationInverse)
    throw new Error(`Матрица профиля «${destination.name}» необратима`)

  const encodeLuts =
    destination.kind === 'rgb'
      ? destination.decodeLuts.map(makeEncodeLut)
      : [makeEncodeLut(destination.decodeLut)]

  const xyzToDestinationFloat = (input: Vec3): [number, number, number] => {
    let xyz = input
    if (useBpc) {
      xyz = [0, 1, 2].map((i) => {
        const scale =
          (destinationWhite[i] - destinationBlack[i]) / (sourceWhite[i] - sourceBlack[i])
        return (input[i] - sourceBlack[i]) * scale + destinationBlack[i]
      }) as Vec3
    }
    if (destination.kind === 'gray') {
      const y = destinationWhite[1] > 0 ? xyz[1] / destinationWhite[1] : 0
      const value = sampleEncode(encodeLuts[0], y)
      return [value, value, value]
    }
    const linear = multiplyMatrixVector(destinationInverse!, xyz)
    return [
      sampleEncode(encodeLuts[0], linear[0]),
      sampleEncode(encodeLuts[1], linear[1]),
      sampleEncode(encodeLuts[2], linear[2]),
    ]
  }

  const transformOne = (
    rgb: readonly [number, number, number],
    x = 0,
    y = 0,
  ): [number, number, number] => {
    const values = xyzToDestinationFloat(xyzFromEncoded(source, rgb, absolute))
    return values.map((value, channel) => {
      const noise = options.dither ? BAYER_4[(y & 3) * 4 + ((x + channel * 2) & 3)] / 16 - 0.5 : 0
      return byte(value + noise)
    }) as [number, number, number]
  }

  return {
    sourceName: source.name,
    destinationName: destination.name,
    effectiveIntent: absolute ? 'absolute' : 'relative',
    transformRgb: (rgb) => transformOne(rgb),
    transformPixels: (data, width, height) => {
      const pixelCount = Math.min(width * height, Math.floor(data.length / 4))
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        const at = pixel * 4
        const [r, g, b] = transformOne(
          [data[at], data[at + 1], data[at + 2]],
          width > 0 ? pixel % width : 0,
          width > 0 ? Math.floor(pixel / width) : 0,
        )
        data[at] = r
        data[at + 1] = g
        data[at + 2] = b
      }
    },
  }
}

export function convertRgbTriplet(
  rgb: readonly [number, number, number],
  source: ColorProfileModel,
  destination: ColorProfileModel,
  options: ColorTransformOptions = {},
): [number, number, number] {
  return createColorTransform(source, destination, options).transformRgb(rgb)
}

function s15Fixed16(view: DataView, offset: number, value: number) {
  view.setInt32(offset, Math.round(value * 65536))
}

function tagHeader(signature: string, bodyLength: number): Uint8Array {
  const bytes = new Uint8Array(8 + bodyLength)
  bytes.set(
    [...signature].map((char) => char.charCodeAt(0)),
    0,
  )
  return bytes
}

function xyzTag(value: Vec3): Uint8Array {
  const bytes = tagHeader('XYZ ', 12)
  const view = new DataView(bytes.buffer)
  value.forEach((v, i) => s15Fixed16(view, 8 + i * 4, v))
  return bytes
}

function curveTag(decode: Float32Array): Uint8Array {
  const bytes = tagHeader('curv', 4 + 256 * 2)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 256)
  for (let i = 0; i < 256; i++) view.setUint16(12 + i * 2, Math.round(clamp01(decode[i]) * 65535))
  return bytes
}

function sf32Tag(matrix: Matrix3): Uint8Array {
  const bytes = tagHeader('sf32', 36)
  const view = new DataView(bytes.buffer)
  matrix.forEach((v, i) => s15Fixed16(view, 8 + i * 4, v))
  return bytes
}

function descriptionTag(name: string): Uint8Array {
  const asciiName = name.replace(/[^\x20-\x7e]/g, '?')
  const total = 8 + 4 + asciiName.length + 1 + 4 + 4 + 2 + 1 + 67
  const bytes = tagHeader('desc', total - 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, asciiName.length + 1)
  bytes.set(
    [...asciiName].map((char) => char.charCodeAt(0)),
    12,
  )
  return bytes
}

function textTag(text: string): Uint8Array {
  const value = text.replace(/[^\x20-\x7e]/g, '?')
  const bytes = tagHeader('text', value.length + 1)
  bytes.set(
    [...value].map((char) => char.charCodeAt(0)),
    8,
  )
  return bytes
}

function padded4(length: number): number {
  return Math.ceil(length / 4) * 4
}

/** Generate a compact, deterministic ICC v2 profile for a supported model. */
export function buildIccProfile(model: ColorProfileModel): Uint8Array {
  const tags: { signature: string; data: Uint8Array }[] = [
    { signature: 'desc', data: descriptionTag(model.name) },
    {
      signature: 'cprt',
      data: textTag('FSH777 ULTRA generated working-space profile. Public domain.'),
    },
    { signature: 'wtpt', data: xyzTag(model.white) },
    { signature: 'bkpt', data: xyzTag(model.black) },
  ]
  if (model.kind === 'rgb') {
    tags.push(
      { signature: 'rXYZ', data: xyzTag([model.matrix[0], model.matrix[3], model.matrix[6]]) },
      { signature: 'gXYZ', data: xyzTag([model.matrix[1], model.matrix[4], model.matrix[7]]) },
      { signature: 'bXYZ', data: xyzTag([model.matrix[2], model.matrix[5], model.matrix[8]]) },
    )
    const curves = model.decodeLuts.map(curveTag)
    const sameCurves = curves.every((curve) => curve.every((v, i) => v === curves[0][i]))
    tags.push(
      { signature: 'rTRC', data: curves[0] },
      { signature: 'gTRC', data: sameCurves ? curves[0] : curves[1] },
      { signature: 'bTRC', data: sameCurves ? curves[0] : curves[2] },
    )
  } else {
    tags.push({ signature: 'kTRC', data: curveTag(model.decodeLut) })
  }
  if (model.absoluteWhite) {
    tags.push({ signature: 'chad', data: sf32Tag(Bradford(model.absoluteWhite, D50)) })
  }

  const tableEnd = 128 + 4 + tags.length * 12
  const uniqueData: Uint8Array[] = []
  const offsets = new Map<Uint8Array, number>()
  let cursor = tableEnd
  for (const tag of tags) {
    if (!offsets.has(tag.data)) {
      offsets.set(tag.data, cursor)
      uniqueData.push(tag.data)
      cursor += padded4(tag.data.length)
    }
  }
  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length)
  out.set(
    [...'FSH7'].map((c) => c.charCodeAt(0)),
    4,
  )
  view.setUint32(8, 0x02100000)
  out.set(
    [...'mntr'].map((c) => c.charCodeAt(0)),
    12,
  )
  out.set(
    [...(model.kind === 'rgb' ? 'RGB ' : 'GRAY')].map((c) => c.charCodeAt(0)),
    16,
  )
  out.set(
    [...'XYZ '].map((c) => c.charCodeAt(0)),
    20,
  )
  const date = [2026, 1, 1, 0, 0, 0]
  date.forEach((value, i) => view.setUint16(24 + i * 2, value))
  out.set(
    [...'acsp'].map((c) => c.charCodeAt(0)),
    36,
  )
  out.set(
    [...'FSH7'].map((c) => c.charCodeAt(0)),
    48,
  )
  view.setUint32(64, 1)
  D50.forEach((value, i) => s15Fixed16(view, 68 + i * 4, value))
  out.set(
    [...'FSH7'].map((c) => c.charCodeAt(0)),
    80,
  )
  view.setUint32(128, tags.length)
  tags.forEach((tag, i) => {
    const at = 132 + i * 12
    out.set(
      [...tag.signature].map((c) => c.charCodeAt(0)),
      at,
    )
    view.setUint32(at + 4, offsets.get(tag.data)!)
    view.setUint32(at + 8, tag.data.length)
  })
  for (const data of uniqueData) out.set(data, offsets.get(data)!)
  return out
}

export function hexToRgbTriplet(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return undefined
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function rgbTripletToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`
}

export function workingDocumentColorProfile(
  extra: Partial<DocumentColorProfile> = {},
): DocumentColorProfile {
  return {
    id: SRGB_PROFILE_ID,
    name: WORKING_RGB_PROFILE.name,
    kind: 'rgb',
    status: 'working',
    ...extra,
  }
}

export function untaggedDocumentColorProfile(
  extra: Partial<DocumentColorProfile> = {},
): DocumentColorProfile {
  return {
    id: 'untagged',
    name: 'Без профиля',
    kind: 'rgb',
    status: 'untagged',
    ...extra,
  }
}

/** Projects may only claim states the editable sRGB core can actually honour. */
export function parseDocumentColorProfile(input: unknown): DocumentColorProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return workingDocumentColorProfile()
  const value = input as Record<string, unknown>
  const clean = (v: unknown) =>
    typeof v === 'string' ? cleanProfileName(v).slice(0, 160) || undefined : undefined
  if (value.status === 'untagged' || value.id === 'untagged')
    return untaggedDocumentColorProfile({
      convertedFrom: clean(value.convertedFrom),
      assignedFrom: clean(value.assignedFrom),
    })
  return workingDocumentColorProfile({
    convertedFrom: clean(value.convertedFrom),
    assignedFrom: clean(value.assignedFrom),
  })
}

export function documentColorProfileLabel(doc: { colorProfile?: DocumentColorProfile }): string {
  return doc.colorProfile?.status === 'untagged'
    ? 'Без профиля · предпросмотр sRGB'
    : doc.colorProfile?.name || WORKING_RGB_PROFILE.name
}
