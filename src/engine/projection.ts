import type { Point, Quad } from '../types'
export const rectangleQuad = (): Quad => [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]
export function validQuad(value: unknown): value is Quad {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some(
      (p) =>
        !p ||
        typeof p.x !== 'number' ||
        typeof p.y !== 'number' ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 5 ||
        Math.abs(p.y) > 5,
    )
  )
    return false
  return value.every((a, i) => {
    const b = value[(i + 1) % 4],
      c = value[(i + 2) % 4]
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0.00001
  })
}
export function homography(q: Quad): number[] {
  const [p0, p1, p2, p3] = q,
    dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x,
    dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0,
    h = 0
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-10) {
    const d = dx1 * dy2 - dx2 * dy1
    if (Math.abs(d) < 1e-12) throw new Error('Вырожденная перспектива')
    g = (dx3 * dy2 - dx2 * dy3) / d
    h = (dx1 * dy3 - dx3 * dy1) / d
  }
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ]
}
export function project(m: number[], x: number, y: number): Point {
  const d = m[6] * x + m[7] * y + m[8]
  return Math.abs(d) < 1e-10
    ? { x: 1e8, y: 1e8 }
    : { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d }
}
export function invertMatrix(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const out = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ]
  const det = a * out[0] + b * out[3] + c * out[6]
  if (Math.abs(det) < 1e-12) throw new Error('Необратимая трансформация')
  return out.map((v) => v / det)
}
