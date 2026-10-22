// Displacement-map warp on an explicit raster copy.
//
// The map's first channel controls horizontal displacement and the second
// controls vertical displacement. In screen coordinates a channel value v
// moves content by (128 - v) * scale / 100 pixels: black moves right/down,
// white moves left/up, and 128 is neutral. Grayscale maps therefore move both
// axes. The blue channel is ignored. Semi-transparent map pixels are first
// composited over white, so fully transparent map pixels behave like white.
//
// This is a local inverse-bilinear warp, not an Adobe Smart Filter. The caller
// keeps the original layer and inserts the returned pixels as a new layer.
export const MAX_DISPLACE_PIXELS = 8_388_608
export const MAX_DISPLACEMENT_MAP_PIXELS = 8_388_608

export type DisplaceFit = 'stretch' | 'tile'
export type DisplaceEdges = 'repeat' | 'wrap'

export interface DisplaceOptions {
  horizontalScale: number
  verticalScale: number
  fit: DisplaceFit
  edges: DisplaceEdges
}

export interface DisplaceFitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplaceRequest {
  width: number
  height: number
  pixels: Uint8ClampedArray
  mapWidth: number
  mapHeight: number
  mapPixels: Uint8ClampedArray
  mask?: Uint8ClampedArray
  fitRect?: DisplaceFitRect
  options: DisplaceOptions
}

export interface DisplaceResult {
  pixels: Uint8ClampedArray
  maxDisplacement: number
}

export const defaultDisplaceOptions: DisplaceOptions = {
  horizontalScale: 10,
  verticalScale: 10,
  fit: 'stretch',
  edges: 'repeat',
}

const scaleValue = (value: unknown, fallback: number, label: string) => {
  const next = value === undefined ? fallback : value
  if (typeof next !== 'number' || !Number.isFinite(next) || next < -999 || next > 999)
    throw new Error(`${label}: от -999 до 999`)
  return next
}

export function parseDisplaceOptions(input: unknown): DisplaceOptions {
  if (!input || typeof input !== 'object') throw new Error('Некорректные параметры смещения')
  const v = input as Record<string, unknown>
  const fit = v.fit === undefined ? defaultDisplaceOptions.fit : v.fit,
    edges = v.edges === undefined ? defaultDisplaceOptions.edges : v.edges
  if (fit !== 'stretch' && fit !== 'tile') throw new Error('Неизвестный способ размещения карты')
  if (edges !== 'repeat' && edges !== 'wrap') throw new Error('Неизвестный режим краёв смещения')
  return {
    horizontalScale: scaleValue(
      v.horizontalScale,
      defaultDisplaceOptions.horizontalScale,
      'Горизонтальный масштаб смещения',
    ),
    verticalScale: scaleValue(
      v.verticalScale,
      defaultDisplaceOptions.verticalScale,
      'Вертикальный масштаб смещения',
    ),
    fit,
    edges,
  }
}

function parseFitRect(
  input: DisplaceFitRect | undefined,
  width: number,
  height: number,
): DisplaceFitRect {
  if (!input) return { x: 0, y: 0, width, height }
  const { x, y, width: w, height: h } = input
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    x < 0 ||
    y < 0 ||
    w < 1 ||
    h < 1 ||
    x + w > width ||
    y + h > height
  )
    throw new Error('Некорректная область размещения карты смещения')
  return { x, y, width: w, height: h }
}

export function processDisplace(request: DisplaceRequest): DisplaceResult {
  const {
      width: w,
      height: h,
      pixels: p,
      mapWidth: mw,
      mapHeight: mh,
      mapPixels: map,
      mask,
    } = request,
    options = parseDisplaceOptions(request.options)
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 4096 ||
    h > 4096 ||
    w * h > MAX_DISPLACE_PIXELS ||
    p.length !== w * h * 4 ||
    (mask && mask.length !== w * h)
  )
    throw new Error('Смещение по карте: исходный слой до 8 Мп и 4096 px по стороне.')
  if (
    !Number.isInteger(mw) ||
    !Number.isInteger(mh) ||
    mw < 1 ||
    mh < 1 ||
    mw > 4096 ||
    mh > 4096 ||
    mw * mh > MAX_DISPLACEMENT_MAP_PIXELS ||
    map.length !== mw * mh * 4
  )
    throw new Error('Карта смещения: до 8 Мп и 4096 px по стороне.')

  const fit = parseFitRect(request.fitRect, w, h),
    out = new Uint8ClampedArray(p.length),
    channels = new Float64Array(2)
  let maxDisplacement = 0

  const sampleMap = (mx: number, my: number) => {
    let x0: number, y0: number, x1: number, y1: number, fx: number, fy: number
    if (options.fit === 'tile') {
      const nx = ((mx % mw) + mw) % mw,
        ny = ((my % mh) + mh) % mh
      x0 = Math.floor(nx)
      y0 = Math.floor(ny)
      x1 = x0 + 1 === mw ? 0 : x0 + 1
      y1 = y0 + 1 === mh ? 0 : y0 + 1
      fx = nx - x0
      fy = ny - y0
    } else {
      const nx = Math.max(0, Math.min(mw - 1, mx)),
        ny = Math.max(0, Math.min(mh - 1, my))
      x0 = Math.floor(nx)
      y0 = Math.floor(ny)
      x1 = Math.min(mw - 1, x0 + 1)
      y1 = Math.min(mh - 1, y0 + 1)
      fx = nx - x0
      fy = ny - y0
    }
    const w00 = (1 - fx) * (1 - fy),
      w10 = fx * (1 - fy),
      w01 = (1 - fx) * fy,
      w11 = fx * fy
    let r = 0,
      g = 0
    if (w00) {
      const i = (y0 * mw + x0) * 4,
        a = map[i + 3],
        white = 255 * (255 - a)
      r += ((map[i] * a + white) / 255) * w00
      g += ((map[i + 1] * a + white) / 255) * w00
    }
    if (w10) {
      const i = (y0 * mw + x1) * 4,
        a = map[i + 3],
        white = 255 * (255 - a)
      r += ((map[i] * a + white) / 255) * w10
      g += ((map[i + 1] * a + white) / 255) * w10
    }
    if (w01) {
      const i = (y1 * mw + x0) * 4,
        a = map[i + 3],
        white = 255 * (255 - a)
      r += ((map[i] * a + white) / 255) * w01
      g += ((map[i + 1] * a + white) / 255) * w01
    }
    if (w11) {
      const i = (y1 * mw + x1) * 4,
        a = map[i + 3],
        white = 255 * (255 - a)
      r += ((map[i] * a + white) / 255) * w11
      g += ((map[i + 1] * a + white) / 255) * w11
    }
    channels[0] = r
    channels[1] = g
  }

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const index = y * w + x,
        o = index * 4,
        maskScale = mask ? mask[index] / 255 : 1
      if (!maskScale) {
        out[o] = p[o]
        out[o + 1] = p[o + 1]
        out[o + 2] = p[o + 2]
        out[o + 3] = p[o + 3]
        continue
      }
      const mx = options.fit === 'stretch' ? ((x - fit.x + 0.5) * mw) / fit.width - 0.5 : x - fit.x,
        my = options.fit === 'stretch' ? ((y - fit.y + 0.5) * mh) / fit.height - 0.5 : y - fit.y
      sampleMap(mx, my)
      const dx = ((128 - channels[0]) * options.horizontalScale * maskScale) / 100,
        dy = ((128 - channels[1]) * options.verticalScale * maskScale) / 100,
        displacement = Math.hypot(dx, dy)
      if (displacement > maxDisplacement) maxDisplacement = displacement
      if (!dx && !dy) {
        out[o] = p[o]
        out[o + 1] = p[o + 1]
        out[o + 2] = p[o + 2]
        out[o + 3] = p[o + 3]
        continue
      }

      // Content moves by +d, so an output pixel samples the source at p-d.
      let sx = x - dx,
        sy = y - dy,
        x0: number,
        y0: number,
        x1: number,
        y1: number
      if (options.edges === 'wrap') {
        sx = ((sx % w) + w) % w
        sy = ((sy % h) + h) % h
        x0 = Math.floor(sx)
        y0 = Math.floor(sy)
        x1 = x0 + 1 === w ? 0 : x0 + 1
        y1 = y0 + 1 === h ? 0 : y0 + 1
      } else {
        sx = Math.max(0, Math.min(w - 1, sx))
        sy = Math.max(0, Math.min(h - 1, sy))
        x0 = Math.floor(sx)
        y0 = Math.floor(sy)
        x1 = Math.min(w - 1, x0 + 1)
        y1 = Math.min(h - 1, y0 + 1)
      }
      const fx = sx - x0,
        fy = sy - y0,
        w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy,
        i00 = (y0 * w + x0) * 4,
        i10 = (y0 * w + x1) * 4,
        i01 = (y1 * w + x0) * 4,
        i11 = (y1 * w + x1) * 4
      for (let c = 0; c < 4; c++)
        out[o + c] = p[i00 + c] * w00 + p[i10 + c] * w10 + p[i01 + c] * w01 + p[i11 + c] * w11
    }
  return { pixels: out, maxDisplacement }
}

export function applyDisplace(request: DisplaceRequest): Uint8ClampedArray {
  return processDisplace(request).pixels
}
