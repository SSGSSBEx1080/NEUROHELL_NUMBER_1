// Liquify as an explicit-copy pixel warp: brushes accumulate a per-pixel
// displacement field over the layer's own bitmap, and the result is rendered
// by inverse bilinear sampling. This is an honest local subset of
// Photoshop's Liquify (forward warp, pucker, bloat, twirl, reconstruct) —
// no freeze masks, no mesh files, no face-aware or Smart Filter behaviour.
export type LiquifyBrush = 'push' | 'pucker' | 'bloat' | 'twirl' | 'restore'
export const liquifyBrushNames: Record<LiquifyBrush, string> = {
  push: 'Деформация',
  pucker: 'Стягивание',
  bloat: 'Вздутие',
  twirl: 'Скручивание',
  restore: 'Реконструкция',
}
export const MAX_LIQUIFY_PIXELS = 4_194_304

export interface LiquifyField {
  width: number
  height: number
  dx: Float32Array
  dy: Float32Array
}

export function createLiquifyField(width: number, height: number): LiquifyField {
  return {
    width,
    height,
    dx: new Float32Array(width * height),
    dy: new Float32Array(width * height),
  }
}

export function displacementMax(field: LiquifyField): number {
  let max = 0
  for (let i = 0; i < field.dx.length; i++) {
    const d = Math.abs(field.dx[i]) + Math.abs(field.dy[i])
    if (d > max) max = d
  }
  return max
}

const falloff = (t: number) => {
  const c = Math.cos(t * Math.PI * 0.5)
  return c * c
}

/**
 * One brush stamp. `moveX/moveY` is the pointer delta in image pixels (used
 * by forward warp); the radial brushes ignore it and act around the centre.
 * `strength` is 0..1 (density/rate).
 */
export function applyLiquifyBrush(
  field: LiquifyField,
  brush: LiquifyBrush,
  cx: number,
  cy: number,
  radius: number,
  moveX: number,
  moveY: number,
  strength: number,
) {
  const { width, height, dx, dy } = field
  const r = Math.max(1, radius),
    x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(width - 1, Math.ceil(cx + r)),
    y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(height - 1, Math.ceil(cy + r))
  const radialStep = strength * r * 0.12
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const relX = x - cx,
        relY = y - cy,
        dist = Math.hypot(relX, relY)
      if (dist >= r) continue
      const w = falloff(dist / r),
        i = y * width + x
      if (brush === 'push') {
        dx[i] += moveX * w * strength
        dy[i] += moveY * w * strength
      } else if (brush === 'restore') {
        const keep = 1 - w * Math.min(1, strength * 1.5)
        dx[i] *= keep
        dy[i] *= keep
      } else if (dist > 0.001) {
        const ux = relX / dist,
          uy = relY / dist
        if (brush === 'pucker') {
          const step = Math.min(radialStep * w, dist * 0.6)
          dx[i] -= ux * step
          dy[i] -= uy * step
        } else if (brush === 'bloat') {
          dx[i] += ux * radialStep * w
          dy[i] += uy * radialStep * w
        } else {
          // Twirl clockwise around the centre.
          dx[i] += -uy * radialStep * w
          dy[i] += ux * radialStep * w
        }
      }
    }
}

/**
 * Renders the warped image. Content pushed by +d appears at p+d, so each
 * output pixel samples the source at p−d (bilinear, edges clamped). An
 * optional 0..255 mask scales the displacement (the selection limits the
 * warp the same way it limits the raster filters).
 */
export function applyLiquify(
  pixels: Uint8ClampedArray,
  field: LiquifyField,
  mask?: Uint8ClampedArray,
): Uint8ClampedArray {
  const { width, height, dx, dy } = field
  const out = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        o = i * 4,
        scale = mask ? mask[i] / 255 : 1
      if (scale === 0 || (dx[i] === 0 && dy[i] === 0)) {
        out[o] = pixels[o]
        out[o + 1] = pixels[o + 1]
        out[o + 2] = pixels[o + 2]
        out[o + 3] = pixels[o + 3]
        continue
      }
      const sx = Math.min(width - 1, Math.max(0, x - dx[i] * scale)),
        sy = Math.min(height - 1, Math.max(0, y - dy[i] * scale)),
        x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        x1 = Math.min(width - 1, x0 + 1),
        y1 = Math.min(height - 1, y0 + 1),
        fx = sx - x0,
        fy = sy - y0
      for (let c = 0; c < 4; c++) {
        const top =
            pixels[(y0 * width + x0) * 4 + c] * (1 - fx) + pixels[(y0 * width + x1) * 4 + c] * fx,
          bottom =
            pixels[(y1 * width + x0) * 4 + c] * (1 - fx) + pixels[(y1 * width + x1) * 4 + c] * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  return out
}
