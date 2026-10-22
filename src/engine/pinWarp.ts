// Pin (puppet-style) warp as an explicit-copy deformation.
//
// Pins are authored in source-image coordinates. Each pin carries a
// translation and an optional local rotation; locked pins are zero-motion
// anchors. A compact-support Shepard interpolation turns those sparse pin
// motions into a smooth forward displacement field. Rendering needs the
// inverse field (source coordinate for every output pixel), so the builder
// runs a few fixed-point iterations against a coarse forward grid. This is
// an independent local model, not Photoshop's mesh Puppet Warp: there is no
// triangular mesh, rigidity solver, pin depth ordering, or Smart Filter.
import { createLiquifyField, type LiquifyField } from './liquify'

export interface WarpPin {
  x: number
  y: number
  dx: number
  dy: number
  /** Degrees, clockwise in image coordinates. */
  rotation?: number
  locked?: boolean
}

export const MAX_WARP_PINS = 32
export const MAX_PIN_WARP_PIXELS = 4_194_304

const pinMotion = (pin: WarpPin, x: number, y: number, out: { x: number; y: number }) => {
  if (pin.locked) {
    out.x = 0
    out.y = 0
    return out
  }
  const angle = ((pin.rotation || 0) * Math.PI) / 180,
    relX = x - pin.x,
    relY = y - pin.y
  if (!angle) {
    out.x = pin.dx
    out.y = pin.dy
    return out
  }
  const c = Math.cos(angle),
    s = Math.sin(angle)
  out.x = pin.dx + relX * c - relY * s - relX
  out.y = pin.dy + relX * s + relY * c - relY
  return out
}

/** Smooth forward displacement (source point -> output offset) at one point. */
export function pinWarpForwardAt(
  x: number,
  y: number,
  pins: readonly WarpPin[],
  radius: number,
): { x: number; y: number } {
  const r = Math.max(1, radius),
    motion = { x: 0, y: 0 }
  let sumW = 0,
    sumX = 0,
    sumY = 0
  for (const pin of pins) {
    const dist = Math.hypot(x - pin.x, y - pin.y)
    if (dist < 0.75) return pinMotion(pin, x, y, motion)
    if (dist >= r) continue
    const base = (r - dist) / r,
      w = (base * base) / (dist * dist + 1)
    pinMotion(pin, x, y, motion)
    sumW += w
    sumX += motion.x * w
    sumY += motion.y * w
  }
  return sumW ? { x: sumX / sumW, y: sumY / sumW } : { x: 0, y: 0 }
}

const axisNodes = (size: number, step: number) => {
  if (size <= 1) return [0]
  const nodes: number[] = []
  for (let v = 0; v < size - 1; v += step) nodes.push(v)
  nodes.push(size - 1)
  return nodes
}

const axisSpan = (nodes: number[], value: number) => {
  if (nodes.length === 1) return { i: 0, j: 0, t: 0 }
  let lo = 0,
    hi = nodes.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (nodes[mid] <= value) lo = mid
    else hi = mid
  }
  const span = nodes[hi] - nodes[lo]
  return { i: lo, j: hi, t: span ? Math.min(1, Math.max(0, (value - nodes[lo]) / span)) : 0 }
}

/**
 * Builds the inverse displacement field consumed by `applyLiquify`: for an
 * output pixel p, field d means "sample the source at p-d". The forward pin
 * field F maps source s to s+F(s); d is found by fixed-point iteration
 * s <- p-F(s), which keeps moved pins close to their authored targets.
 */
export function buildPinWarpField(
  width: number,
  height: number,
  pins: readonly WarpPin[],
  radius: number,
): LiquifyField {
  const field = createLiquifyField(width, height)
  if (!pins.length || width < 1 || height < 1) return field

  // Evaluate the expensive pin interpolation on a bounded coarse grid, then
  // bilinearly sample it during the per-pixel inverse solve.
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 262_144))),
    xs = axisNodes(width, step),
    ys = axisNodes(height, step),
    gw = xs.length,
    gridX = new Float32Array(gw * ys.length),
    gridY = new Float32Array(gw * ys.length)
  for (let gy = 0; gy < ys.length; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const d = pinWarpForwardAt(xs[gx], ys[gy], pins, radius),
        i = gy * gw + gx
      gridX[i] = d.x
      gridY[i] = d.y
    }
  const forward = (x: number, y: number, out: { x: number; y: number }) => {
    const sx = axisSpan(xs, Math.min(width - 1, Math.max(0, x))),
      sy = axisSpan(ys, Math.min(height - 1, Math.max(0, y))),
      a = sy.i * gw + sx.i,
      b = sy.i * gw + sx.j,
      c = sy.j * gw + sx.i,
      d = sy.j * gw + sx.j
    out.x =
      (gridX[a] * (1 - sx.t) + gridX[b] * sx.t) * (1 - sy.t) +
      (gridX[c] * (1 - sx.t) + gridX[d] * sx.t) * sy.t
    out.y =
      (gridY[a] * (1 - sx.t) + gridY[b] * sx.t) * (1 - sy.t) +
      (gridY[c] * (1 - sx.t) + gridY[d] * sx.t) * sy.t
    return out
  }

  const f = { x: 0, y: 0 }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sx = x,
        sy = y
      for (let iteration = 0; iteration < 3; iteration++) {
        forward(sx, sy, f)
        sx = x - f.x
        sy = y - f.y
      }
      const i = y * width + x,
        maxShift = Math.max(width, height)
      field.dx[i] = Math.max(-maxShift, Math.min(maxShift, x - sx))
      field.dy[i] = Math.max(-maxShift, Math.min(maxShift, y - sy))
    }
  return field
}

export function hasPinWarpMotion(pins: readonly WarpPin[]): boolean {
  return pins.some(
    (pin) =>
      !pin.locked &&
      (Math.abs(pin.dx) > 0.01 || Math.abs(pin.dy) > 0.01 || Math.abs(pin.rotation || 0) > 0.01),
  )
}
