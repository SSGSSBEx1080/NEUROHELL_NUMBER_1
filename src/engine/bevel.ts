import { blendCorrection } from './adjustmentMath'
import { dissolveHash } from './blendModes'
import { buildContourAlphaLut, isLinearEffectContour } from './contours'
import { rgbFromHex } from './gradientRamp'
import type { BevelEffectStyle, BevelTechniqueKind } from '../types'

export interface RgbaPixelData {
  width: number
  height: number
  data: Uint8ClampedArray
}

const INF = 1e12
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function edt1d(f: Float32Array, d: Float32Array, n: number, v: Int32Array, z: Float32Array) {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const delta = q - v[k]
    d[q] = delta * delta + f[v[k]]
  }
}

function squaredEuclideanDistance(grid: Float32Array, width: number, height: number) {
  const maxDim = Math.max(width, height)
  const f = new Float32Array(maxDim)
  const d = new Float32Array(maxDim)
  const v = new Int32Array(maxDim)
  const z = new Float32Array(maxDim + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    edt1d(f, d, height, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]
    edt1d(f, d, width, v, z)
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]
  }
  return grid
}

function distanceSquaredTo(pixels: RgbaPixelData, zeroInside: boolean): Float32Array {
  const grid = new Float32Array(pixels.width * pixels.height)
  for (let i = 0; i < grid.length; i++) {
    const inside = pixels.data[i * 4 + 3] > 0
    grid[i] = inside === zeroInside ? 0 : INF
  }
  return squaredEuclideanDistance(grid, pixels.width, pixels.height)
}

/**
 * Signed Euclidean distance to the alpha edge in pixels: positive inside,
 * negative outside. Pixel centres next to the edge are at ±0.5.
 */
export function signedDistanceField(pixels: RgbaPixelData): Float32Array {
  const signed = new Float32Array(pixels.width * pixels.height)
  {
    const insideSquared = distanceSquaredTo(pixels, false)
    for (let i = 0; i < signed.length; i++)
      if (pixels.data[i * 4 + 3] > 0) {
        const distance = Math.sqrt(Math.min(INF, insideSquared[i]))
        signed[i] = distance >= 1e6 ? 1e6 : Math.max(0, distance - 0.5)
      }
  }
  {
    const outsideSquared = distanceSquaredTo(pixels, true)
    for (let i = 0; i < signed.length; i++)
      if (pixels.data[i * 4 + 3] === 0) {
        const distance = Math.sqrt(Math.min(INF, outsideSquared[i]))
        signed[i] = distance >= 1e6 ? -1e6 : -Math.max(0, distance - 0.5)
      }
  }
  return signed
}

function profile(t: number, technique: BevelTechniqueKind): number {
  const x = clamp01(t)
  if (technique === 'chiselHard') return x
  if (technique === 'chiselSoft') return Math.sin((x * Math.PI) / 2)
  return x * x * (3 - 2 * x)
}

/** Unsoftened bevel height (before Direction is applied), exported for tests. */
export function bevelProfileHeight(
  style: BevelEffectStyle['style'],
  signedDistance: number,
  size: number,
  technique: BevelTechniqueKind,
): number {
  if (size <= 0) return signedDistance >= 0 ? 1 : 0
  switch (style) {
    case 'outer':
      return profile((signedDistance + size) / size, technique)
    case 'emboss':
      return profile((signedDistance + size) / (2 * size), technique)
    case 'pillow':
      if (signedDistance < -size || signedDistance >= size) return 1
      return signedDistance < 0
        ? 1 - profile((signedDistance + size) / size, technique)
        : profile(signedDistance / size, technique)
    case 'inner':
    case 'stroke':
      return signedDistance <= 0 ? 0 : profile(signedDistance / size, technique)
  }
}

function boxBlurHeight(height: Float32Array, width: number, rows: number, radius: number) {
  if (radius < 1) return height
  let source = height
  let target = new Float32Array(height.length)
  const prefix = new Float32Array(Math.max(width, rows) + 1)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < rows; y++) {
      let sum = 0
      for (let x = 0; x < width; x++) {
        sum += source[y * width + x]
        prefix[x + 1] = sum
      }
      for (let x = 0; x < width; x++) {
        const lo = Math.max(0, x - radius)
        const hi = Math.min(width - 1, x + radius)
        target[y * width + x] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
      }
    }
    ;[source, target] = [target, source]
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = 0; y < rows; y++) {
        sum += source[y * width + x]
        prefix[y + 1] = sum
      }
      for (let y = 0; y < rows; y++) {
        const lo = Math.max(0, y - radius)
        const hi = Math.min(rows - 1, y + radius)
        target[y * width + x] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
      }
    }
    ;[source, target] = [target, source]
  }
  return source
}

function nearestInsideIndices(
  base: RgbaPixelData,
  signed: Float32Array,
  maxOutsideDistance: number,
): Int32Array {
  const { width, height } = base
  const count = width * height
  const source = new Int32Array(count).fill(-1)
  const queue = new Int32Array(count)
  const boundaries = new Int32Array(count)
  let boundaryCount = 0
  let head = 0
  let tail = 0
  const alpha = (i: number) => base.data[i * 4 + 3]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const value = alpha(i)
      if (!value) continue
      let minNeighbor = 255
      minNeighbor = Math.min(minNeighbor, x === 0 ? 0 : alpha(i - 1))
      minNeighbor = Math.min(minNeighbor, x === width - 1 ? 0 : alpha(i + 1))
      minNeighbor = Math.min(minNeighbor, y === 0 ? 0 : alpha(i - width))
      minNeighbor = Math.min(minNeighbor, y === height - 1 ? 0 : alpha(i + width))
      if (minNeighbor === 0 || (value >= 128 && minNeighbor < 128)) boundaries[boundaryCount++] = i
    }
  }
  const seed = (i: number) => {
    if (source[i] < 0) {
      source[i] = i
      queue[tail++] = i
    }
  }
  const propagate = () => {
    while (head < tail) {
      const i = queue[head++]
      const x = i % width
      const y = Math.floor(i / width)
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (alpha(ni) >= 128 || source[ni] >= 0 || signed[ni] < -maxOutsideDistance - 1) continue
          source[ni] = source[i]
          queue[tail++] = ni
        }
      }
    }
  }
  // Prefer substantially opaque boundary pixels as colour/alpha sources;
  // one faint anti-aliased fringe pixel should not make the whole rim faint.
  for (let i = 0; i < boundaryCount; i++) {
    const boundary = boundaries[i]
    if (base.data[boundary * 4 + 3] >= 128) seed(boundary)
  }
  propagate()
  for (let i = 0; i < boundaryCount; i++) seed(boundaries[i])
  propagate()
  return source
}

/**
 * Own distance-field bevel: a height profile is built from the signed alpha
 * distance, normals are derived from it and lit by the PSD angle/altitude.
 * The gloss contour remaps the signed shadow↔highlight response (left/bottom
 * is shadow, right/top is highlight, as in a shaping curve). This remains an
 * independent approximation of the documented controls, not a reproduction
 * of Adobe's proprietary rasteriser.
 */
export function applyBevelToPixels(
  output: RgbaPixelData,
  base: RgbaPixelData,
  content: RgbaPixelData,
  effect: BevelEffectStyle,
  renderScale = 1,
  target: 'content' | 'stroke' = 'content',
) {
  if (
    !effect.enabled ||
    effect.size <= 0 ||
    output.width !== base.width ||
    output.height !== base.height ||
    output.width !== content.width ||
    output.height !== content.height
  )
    return
  const width = output.width
  const height = output.height
  const count = width * height
  if (!count) return
  const scale = Math.max(0.0001, Number.isFinite(renderScale) ? renderScale : 1)
  const size = Math.max(0.001, effect.size * scale)
  const soften = Math.max(0, effect.soften * scale)
  const signed = signedDistanceField(base)
  let heightField = new Float32Array(count)
  const style = target === 'stroke' ? 'stroke' : effect.style
  for (let i = 0; i < count; i++) {
    let value = bevelProfileHeight(style, signed[i], size, effect.technique)
    if (effect.direction === 'down') value = 1 - value
    heightField[i] = value
  }
  if (soften >= 0.5) heightField = boxBlurHeight(heightField, width, height, Math.round(soften))

  const expandsOutside =
    target === 'content' &&
    (effect.style === 'outer' || effect.style === 'emboss' || effect.style === 'pillow')
  const nearest = expandsOutside ? nearestInsideIndices(base, signed, size + soften) : undefined
  const angle = (effect.angle * Math.PI) / 180
  const altitude = (Math.max(0, Math.min(90, effect.altitude)) * Math.PI) / 180
  const horizontal = Math.cos(altitude)
  const lightX = Math.cos(angle) * horizontal
  const lightY = -Math.sin(angle) * horizontal
  const lightZ = Math.sin(altitude)
  const slope = Math.max(0.001, effect.depth) * size
  const gain = 1.75
  const glossLut = isLinearEffectContour(effect.glossContour)
    ? undefined
    : buildContourAlphaLut(effect.glossContour, effect.antialiasGloss)
  const highlight = rgbFromHex(effect.highlightColor)
  const shadow = rgbFromHex(effect.shadowColor)
  const blended = [0, 0, 0]
  const reach = size + Math.max(1, soften * 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const inside = base.data[i * 4 + 3] > 0
      const d = signed[i]
      let inBand = false
      if (target === 'stroke' || effect.style === 'inner') inBand = inside && d <= reach
      else if (effect.style === 'outer') inBand = d >= -reach && d <= Math.max(1, soften)
      else inBand = d >= -reach && d <= reach
      if (!inBand) continue

      const left = heightField[y * width + Math.max(0, x - 1)]
      const right = heightField[y * width + Math.min(width - 1, x + 1)]
      const top = heightField[Math.max(0, y - 1) * width + x]
      const bottom = heightField[Math.min(height - 1, y + 1) * width + x]
      const gx = (right - left) / (Math.min(width - 1, x + 1) - Math.max(0, x - 1) || 1)
      const gy = (bottom - top) / (Math.min(height - 1, y + 1) - Math.max(0, y - 1) || 1)
      const nx = -gx * slope
      const ny = -gy * slope
      const inverse = 1 / Math.hypot(nx, ny, 1)
      const diffuse = (nx * lightX + ny * lightY + lightZ) * inverse
      const delta = diffuse - lightZ
      let highlightAmount = clamp01(delta * gain) * clamp01(effect.highlightOpacity)
      let shadowAmount = clamp01(-delta * gain) * clamp01(effect.shadowOpacity)
      if (glossLut) {
        const response = Math.max(-1, Math.min(1, delta * gain))
        const shaped = glossLut[Math.round(((response + 1) / 2) * 255)] / 255
        highlightAmount = clamp01(shaped * 2 - 1) * clamp01(effect.highlightOpacity)
        shadowAmount = clamp01(1 - shaped * 2) * clamp01(effect.shadowOpacity)
      }
      if (effect.highlightBlendMode === 'dissolve')
        highlightAmount = dissolveHash(x, y) < highlightAmount ? 1 : 0
      if (effect.shadowBlendMode === 'dissolve')
        shadowAmount = dissolveHash(x, y) < shadowAmount ? 1 : 0
      const sourceIndex = inside ? i : (nearest?.[i] ?? -1)
      if (sourceIndex < 0) continue
      if (inside && highlightAmount <= 0.0001 && shadowAmount <= 0.0001) continue

      const outOffset = i * 4
      const contentOffset = sourceIndex * 4
      const outputAlpha = output.data[outOffset + 3] / 255
      let r: number, g: number, b: number
      if (output.data[contentOffset + 3] > 0) {
        // Prefer the styled surface colour at the source pixel (including
        // overlays/strokes); fall back to pre-Fill content below.
        r = output.data[contentOffset] / 255
        g = output.data[contentOffset + 1] / 255
        b = output.data[contentOffset + 2] / 255
      } else {
        r = content.data[contentOffset] / 255
        g = content.data[contentOffset + 1] / 255
        b = content.data[contentOffset + 2] / 255
      }
      if (highlightAmount > 0) {
        blended[0] = highlight[0]
        blended[1] = highlight[1]
        blended[2] = highlight[2]
        blendCorrection(effect.highlightBlendMode, r, g, b, blended)
        r += (clamp01(blended[0]) - r) * highlightAmount
        g += (clamp01(blended[1]) - g) * highlightAmount
        b += (clamp01(blended[2]) - b) * highlightAmount
      }
      if (shadowAmount > 0) {
        blended[0] = shadow[0]
        blended[1] = shadow[1]
        blended[2] = shadow[2]
        blendCorrection(effect.shadowBlendMode, r, g, b, blended)
        r += (clamp01(blended[0]) - r) * shadowAmount
        g += (clamp01(blended[1]) - g) * shadowAmount
        b += (clamp01(blended[2]) - b) * shadowAmount
      }

      if (inside) {
        const baseAlpha = base.data[outOffset + 3] / 255
        const createdAlpha = baseAlpha * Math.max(highlightAmount, shadowAmount)
        output.data[outOffset] = Math.round(clamp01(r) * 255)
        output.data[outOffset + 1] = Math.round(clamp01(g) * 255)
        output.data[outOffset + 2] = Math.round(clamp01(b) * 255)
        output.data[outOffset + 3] = Math.round(Math.max(outputAlpha, createdAlpha) * 255)
      } else {
        const sourceAlpha = base.data[contentOffset + 3] / 255
        const bevelAlpha = sourceAlpha * clamp01(size + d + 0.5)
        if (bevelAlpha <= 0) continue
        const oldR = output.data[outOffset] / 255
        const oldG = output.data[outOffset + 1] / 255
        const oldB = output.data[outOffset + 2] / 255
        const nextAlpha = bevelAlpha + outputAlpha * (1 - bevelAlpha)
        if (nextAlpha <= 0) continue
        const oldWeight = (outputAlpha * (1 - bevelAlpha)) / nextAlpha
        const newWeight = bevelAlpha / nextAlpha
        output.data[outOffset] = Math.round(clamp01(r * newWeight + oldR * oldWeight) * 255)
        output.data[outOffset + 1] = Math.round(clamp01(g * newWeight + oldG * oldWeight) * 255)
        output.data[outOffset + 2] = Math.round(clamp01(b * newWeight + oldB * oldWeight) * 255)
        output.data[outOffset + 3] = Math.round(nextAlpha * 255)
      }
    }
  }
}
