import { reflectPosition } from './gradientRamp'
import type { StyleGradientShape } from '../types'

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const positiveScale = (value: number) =>
  Math.max(0.0001, Number.isFinite(value) && value > 0 ? value : 1)

/**
 * Converts a continuous 0..1 channel to an 8-bit value with deterministic
 * 4×4 ordered dithering. Exact 0, exact 1 and exact 8-bit levels stay stable;
 * fractional levels are distributed over neighbouring pixels instead of
 * forming a single visible quantization band.
 */
export function orderedDitherByte(value: number, x: number, y: number): number {
  const level = clamp01(value) * 255
  const threshold = (BAYER_4[Math.abs(Math.trunc(y)) & 3][Math.abs(Math.trunc(x)) & 3] + 0.5) / 16
  return Math.max(0, Math.min(255, Math.floor(level + threshold)))
}

/**
 * Returns the gradient coordinate used by `paintGradientShape` at a pixel
 * centre, before reverse is applied by the caller. The formulas intentionally
 * mirror the Canvas geometry in styles.ts so enabling PSD Dither changes
 * quantization, not where the gradient is placed.
 */
export function gradientShapePosition(
  shape: StyleGradientShape,
  width: number,
  height: number,
  pixelX: number,
  pixelY: number,
  angleDeg: number,
  scale = 1,
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0
  const cx = width / 2
  const cy = height / 2
  const x = pixelX + 0.5
  const y = pixelY + 0.5
  const dx = x - cx
  const dy = y - cy
  const angle = ((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180
  const gradientScale = positiveScale(scale)

  if (shape === 'radial') {
    const radius = (Math.hypot(width, height) / 2) * gradientScale
    return clamp01(Math.hypot(dx, dy) / Math.max(0.0001, radius))
  }

  if (shape === 'angle') {
    if (dx === 0 && dy === 0) return 0
    const start = angle + Math.PI / 2
    const turned = (Math.atan2(dy, dx) - start) / (Math.PI * 2)
    return turned - Math.floor(turned)
  }

  if (shape === 'diamond') {
    const nx = dx / Math.max(1, cx)
    const ny = dy / Math.max(1, cy)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rx = nx * cos + ny * sin
    const ry = -nx * sin + ny * cos
    return clamp01((Math.abs(rx) + Math.abs(ry)) / gradientScale)
  }

  const projectedExtent =
    (Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))) * gradientScale
  const linear =
    0.5 + (dx * Math.cos(angle) + dy * Math.sin(angle)) / Math.max(0.0001, projectedExtent)
  return shape === 'reflected' ? reflectPosition(linear) : clamp01(linear)
}
