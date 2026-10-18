import { describe, expect, it } from 'vitest'
import { expandTriangle } from '../../src/engine/warpRenderer'
import type { Point } from '../../src/types'

describe('projective mesh coverage', () => {
  it('offsets every edge by a full pixel, including very shallow triangles and both windings', () => {
    const triangles: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 6 },
      ],
      [
        { x: 31, y: -8 },
        { x: 1031, y: 7 },
        { x: 1031, y: 10 },
      ],
      [
        { x: -12, y: 5 },
        { x: 0.2, y: 0.1 },
        { x: 9, y: 19 },
      ],
    ]
    for (const triangle of triangles.flatMap((p) => [p, [...p].reverse()])) {
      const expanded = expandTriangle(triangle, 1)
      const center = {
        x: triangle.reduce((n, p) => n + p.x, 0) / 3,
        y: triangle.reduce((n, p) => n + p.y, 0) / 3,
      }
      triangle.forEach((p, i) => {
        const q = triangle[(i + 1) % 3],
          dx = q.x - p.x,
          dy = q.y - p.y
        const side = Math.sign(dx * (center.y - p.y) - dy * (center.x - p.x))
        for (const point of [expanded[i], expanded[(i + 1) % 3]]) {
          const signedDistance =
            (side * (dx * (point.y - p.y) - dy * (point.x - p.x))) / Math.hypot(dx, dy)
          expect(signedDistance).toBeCloseTo(-1, 6)
        }
      })
    }
  })

  it('keeps the source triangle when the expansion is zero', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
    ]
    expandTriangle(points, 0).forEach((p, i) => {
      expect(p.x).toBeCloseTo(points[i].x, 8)
      expect(p.y).toBeCloseTo(points[i].y, 8)
    })
  })

  it('does not introduce NaN or infinite coordinates for collapsed edges', () => {
    for (const points of [
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    ])
      expect(expandTriangle(points, 1)).toEqual(points)
  })
})
