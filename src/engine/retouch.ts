// Local retouch brushes (Dodge, Burn, Sponge, Blur, Sharpen, Smudge) as
// per-dab pixel transforms over the active raster layer's own bitmap.
// Independent RGB/8 approximations of the Photoshop tools: exposure-style
// build-up per dab, tonal-range weighting for Dodge/Burn, premultiplied
// 3x3 neighbourhoods for Blur/Sharpen, and movement-drag sampling for
// Smudge. Alpha is preserved except by Blur, which averages it like
// Photoshop's tool. No "protect tones", no sampled-all-layers mode.
export type RetouchTool = 'dodge' | 'burn' | 'sponge' | 'blur-brush' | 'sharpen-brush' | 'smudge'
export const RETOUCH_TOOLS: readonly RetouchTool[] = [
  'dodge',
  'burn',
  'sponge',
  'blur-brush',
  'sharpen-brush',
  'smudge',
]
export const isRetouchTool = (tool: string): tool is RetouchTool =>
  (RETOUCH_TOOLS as readonly string[]).includes(tool)
export const retouchNames: Record<RetouchTool, string> = {
  dodge: 'Осветление',
  burn: 'Затемнение',
  sponge: 'Губка',
  'blur-brush': 'Размытие',
  'sharpen-brush': 'Резкость',
  smudge: 'Палец',
}
export type RetouchRange = 'shadows' | 'midtones' | 'highlights'

const rangeWeight = (range: RetouchRange, luma: number) =>
  range === 'shadows'
    ? Math.max(0, 1 - luma * 2)
    : range === 'highlights'
      ? Math.max(0, luma * 2 - 1)
      : 1 - Math.abs(luma - 0.5) * 2

/** Brush coverage 0..1 at normalized distance d (matches the stamp falloff). */
const coverage = (d: number, hardness: number) => {
  if (d >= 1) return 0
  if (d <= hardness) return 1
  const t = (d - hardness) / (1 - hardness)
  return 0.5 + 0.5 * Math.cos(t * Math.PI)
}

export interface RetouchDab {
  tool: RetouchTool
  cx: number
  cy: number
  radius: number
  /** 0..1 */
  hardness: number
  /** 0..1 per-dab strength (exposure/flow); strokes build up over dabs. */
  strength: number
  range: RetouchRange
  spongeMode: 'saturate' | 'desaturate'
  /** Pointer delta since the previous dab, in the same pixel grid (Smudge). */
  moveX: number
  moveY: number
  /** Optional per-pixel 0..255 limiter, same size as the rect (selection). */
  mask?: Uint8ClampedArray
}

/** Mutates `data` (RGBA rect w*h) in place for one brush dab. */
export function applyRetouchDab(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  dab: RetouchDab,
) {
  const r = Math.max(0.5, dab.radius),
    x0 = Math.max(0, Math.floor(dab.cx - r)),
    x1 = Math.min(width - 1, Math.ceil(dab.cx + r)),
    y0 = Math.max(0, Math.floor(dab.cy - r)),
    y1 = Math.min(height - 1, Math.ceil(dab.cy + r))
  if (x1 < x0 || y1 < y0) return
  const needCopy =
    dab.tool === 'blur-brush' || dab.tool === 'sharpen-brush' || dab.tool === 'smudge'
  const src = needCopy ? new Uint8ClampedArray(data) : data
  const sample = (x: number, y: number, out: number[]) => {
    // Bilinear straight-RGBA sample from the snapshot.
    const sx = Math.min(width - 1, Math.max(0, x)),
      sy = Math.min(height - 1, Math.max(0, y)),
      ix = Math.floor(sx),
      iy = Math.floor(sy),
      jx = Math.min(width - 1, ix + 1),
      jy = Math.min(height - 1, iy + 1),
      fx = sx - ix,
      fy = sy - iy
    for (let c = 0; c < 4; c++) {
      const top = src[(iy * width + ix) * 4 + c] * (1 - fx) + src[(iy * width + jx) * 4 + c] * fx,
        bot = src[(jy * width + ix) * 4 + c] * (1 - fx) + src[(jy * width + jx) * 4 + c] * fx
      out[c] = top * (1 - fy) + bot * fy
    }
  }
  const neighbor = (x: number, y: number, out: number[]) => {
    // Premultiplied 3x3 average: transparent RGB cannot darken the result.
    let pr = 0,
      pg = 0,
      pb = 0,
      pa = 0
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
        const o = (yy * width + xx) * 4,
          a = src[o + 3] / 255
        pr += src[o] * a
        pg += src[o + 1] * a
        pb += src[o + 2] * a
        pa += src[o + 3]
      }
    const count =
      (Math.min(height - 1, y + 1) - Math.max(0, y - 1) + 1) *
      (Math.min(width - 1, x + 1) - Math.max(0, x - 1) + 1)
    pa /= count
    const denom = pa > 0 ? (pa / 255) * count : 0
    out[0] = denom ? pr / denom : 0
    out[1] = denom ? pg / denom : 0
    out[2] = denom ? pb / denom : 0
    out[3] = pa
  }
  const tmp = [0, 0, 0, 0]
  // Dabs overlap (spacing << diameter): scale point tools down so a stroke
  // builds up gradually instead of clipping on the first dab.
  const pointScale = 0.35
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x - dab.cx, y - dab.cy) / r
      let w = coverage(dist, Math.min(1, Math.max(0, dab.hardness)))
      if (w <= 0) continue
      const i = y * width + x,
        o = i * 4
      if (dab.mask) w *= dab.mask[i] / 255
      if (w <= 0) continue
      // Point tools leave fully transparent pixels alone (their RGB is not
      // meaningful); Blur and Smudge may pull neighbouring alpha in.
      if (src[o + 3] === 0 && dab.tool !== 'blur-brush' && dab.tool !== 'smudge') continue
      const R = src[o],
        G = src[o + 1],
        B = src[o + 2]
      if (dab.tool === 'dodge' || dab.tool === 'burn') {
        const luma = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255
        const k = dab.strength * w * rangeWeight(dab.range, luma) * pointScale
        if (dab.tool === 'dodge') {
          data[o] = 255 - (255 - R) * (1 - k)
          data[o + 1] = 255 - (255 - G) * (1 - k)
          data[o + 2] = 255 - (255 - B) * (1 - k)
        } else {
          data[o] = R * (1 - k)
          data[o + 1] = G * (1 - k)
          data[o + 2] = B * (1 - k)
        }
      } else if (dab.tool === 'sponge') {
        const gray = 0.2126 * R + 0.7152 * G + 0.0722 * B
        const f =
          dab.spongeMode === 'saturate'
            ? 1 + dab.strength * w * pointScale * 2
            : 1 - dab.strength * w * pointScale * 2
        data[o] = gray + (R - gray) * f
        data[o + 1] = gray + (G - gray) * f
        data[o + 2] = gray + (B - gray) * f
      } else if (dab.tool === 'blur-brush') {
        neighbor(x, y, tmp)
        const k = dab.strength * w
        data[o] = R + (tmp[0] - R) * k
        data[o + 1] = G + (tmp[1] - G) * k
        data[o + 2] = B + (tmp[2] - B) * k
        data[o + 3] = src[o + 3] + (tmp[3] - src[o + 3]) * k
      } else if (dab.tool === 'sharpen-brush') {
        neighbor(x, y, tmp)
        const k = dab.strength * w * 1.6
        data[o] = R + (R - tmp[0]) * k
        data[o + 1] = G + (G - tmp[1]) * k
        data[o + 2] = B + (B - tmp[2]) * k
      } else {
        // Smudge: drag colour from one dab-step behind the pointer.
        if (dab.moveX === 0 && dab.moveY === 0) continue
        sample(x - dab.moveX, y - dab.moveY, tmp)
        const k = dab.strength * w
        data[o] = R + (tmp[0] - R) * k
        data[o + 1] = G + (tmp[1] - G) * k
        data[o + 2] = B + (tmp[2] - B) * k
        data[o + 3] = src[o + 3] + (tmp[3] - src[o + 3]) * k
      }
    }
}
