import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import {
  cornerRadii,
  layerPoint,
  parseShapePaths,
  pathBounds,
  shapePaths,
  transformedPaths,
} from '../../src/engine/shapeGeometry'
import {
  exportVectorShape,
  importVectorShape,
  translateNativeVector,
} from '../../src/engine/psdVector'
import { parseActionProperties } from '../../src/engine/actionSchema'
initializeCanvas(
  () => {
    throw new Error('No browser canvas in structural tests')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
describe('Shared cubic geometry and native PSD shape layers', () => {
  it('normalizes all four corner radii together and retains requested values', () => {
    const l = makeLayer({ width: 100, height: 60, cornerRadii: [60, 40, 20, 0] })
    expect(cornerRadii(l)).toEqual([60, 40, 20, 0])
    expect(cornerRadii({ ...l, width: 50 })).toEqual([30, 20, 10, 0])
    expect(l.cornerRadii).toEqual([60, 40, 20, 0])
    const paths = shapePaths(l)
    expect(paths[0].knots).toHaveLength(8)
    expect(pathBounds(paths)).toEqual({ x: 0, y: 0, width: 100, height: 60 })
  })
  it('uses exact cubic extrema, including overhanging controls, and produces real polygons/stars/open lines', () => {
    const p = [
      {
        open: true,
        fillRule: 'non-zero' as const,
        knots: [
          { linked: false, points: [0, 0, 0, 0, 0, 100] },
          { linked: false, points: [100, 100, 100, 0, 100, 0] },
        ],
      },
    ]
    expect(pathBounds(p)).toEqual({ x: 0, y: 0, width: 100, height: 75 })
    expect(shapePaths(makeLayer({ shape: 'polygon', sides: 7 }))[0].knots).toHaveLength(7)
    expect(shapePaths(makeLayer({ shape: 'star', sides: 8 }))[0].knots).toHaveLength(16)
    expect(shapePaths(makeLayer({ shape: 'line' }))[0]).toMatchObject({ open: true })
  })
  it('writes vectorFill, vectorMask, vectorStroke and four live corner radii independently of XMP', () => {
    const l = makeLayer({
      x: 20,
      y: 30,
      width: 140,
      height: 80,
      cornerRadii: [2, 7, 13, 20],
      shapeFill: false,
      color: '#123456',
      strokeColor: '#fedcba',
      strokeWidth: 6,
      strokeAlign: 'outside',
      strokeCap: 'round',
      strokeJoin: 'bevel',
      strokeDash: [12, 6],
      strokeDashOffset: 3,
    })
    const psd = readPsd(
      writePsd({
        width: 220,
        height: 160,
        children: [{ name: 'Native shape', ...exportVectorShape(l) }],
      }),
      { useImageData: true, skipThumbnail: true },
    )
    const native = psd.children![0]
    expect(psd.imageResources?.xmpMetadata).toBeUndefined()
    expect(native.vectorMask!.paths[0].knots).toHaveLength(8)
    expect(native.vectorStroke).toMatchObject({
      fillEnabled: false,
      lineWidth: { value: 6 },
      lineAlignment: 'outside',
      lineDashSet: [{ value: 12 }, { value: 6 }],
    })
    expect(importVectorShape(native)).toMatchObject({
      kind: 'shape',
      shape: 'rectangle',
      cornerRadii: [2, 7, 13, 20],
      color: '#123456',
      shapeFill: false,
      strokeColor: '#fedcba',
      strokeWidth: 6,
      strokeDash: [12, 6],
      x: 20,
      y: 30,
      width: 140,
      height: 80,
    })
  })
  it('imports externally authored primitive shapes as editable vectors without application metadata', () => {
    const psd = readPsd(readFileSync('tests/fixtures/psd/native-shapes.psd'), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    })
    const imported = psd.children!.map(importVectorShape).filter(Boolean)
    expect(imported.slice(0, 4).map((l) => l!.shape)).toEqual([
      'rectangle',
      'rectangle',
      'ellipse',
      'ellipse',
    ])
    expect(imported[1]).toMatchObject({ cornerRadii: [10, 10, 10, 10], width: 157, height: 86 })
  })
  it('maps affine Bezier controls exactly and preserves perspective as bounded editable paths', () => {
    const l = makeLayer({
      shape: 'ellipse',
      rotation: 30,
      flipX: true,
      x: 80,
      y: 30,
      width: 180,
      height: 90,
    })
    const base = shapePaths(l)[0].knots[0].points,
      out = transformedPaths(l)[0].knots[0].points
    expect(out.slice(2, 4)).toEqual(Object.values(layerPoint(l, { x: base[2], y: base[3] })))
    const perspective = {
      ...l,
      warp: [
        { x: -0.1, y: 0 },
        { x: 0.8, y: 0.05 },
        { x: 1, y: 0.95 },
        { x: 0.1, y: 1 },
      ] as LayerQuad,
    }
    const knots = transformedPaths(perspective)[0].knots
    expect(knots.length).toBeGreaterThan(20)
    expect(knots.length).toBeLessThan(2048)
    expect(knots.flatMap((k) => k.points).every(Number.isFinite)).toBe(true)
  })
  it('moves native paths and origin bounds along with cached raster data', () => {
    const l = makeLayer({ x: 10, y: 20, width: 100, height: 60, shape: 'ellipse' }),
      raw = exportVectorShape(l)
    const moved = translateNativeVector(raw, 31, -8)
    expect(moved.vectorMask!.paths[0].knots[0].points[2]).toBe(91)
    expect(moved.vectorMask!.paths[0].knots[0].points[3]).toBe(12)
    expect(
      moved.vectorOrigination!.keyDescriptorList[0].keyOriginShapeBoundingBox!.left.value,
    ).toBe(41)
    expect(raw.vectorMask!.paths[0].knots[0].points[2]).toBe(60)
  })
  it('validates bounded vectors, malicious coordinates, Boolean operations and recorded shape settings', () => {
    expect(() =>
      parseShapePaths([
        {
          open: false,
          fillRule: 'non-zero',
          operation: 'subtract',
          knots: [{ points: [0, 0, 0, 0, 0, 0] }, { points: [1, 1, 1, 1, 1, 1] }],
        },
      ]),
    ).toThrow()
    expect(() =>
      parseShapePaths([
        {
          open: false,
          fillRule: 'non-zero',
          knots: [{ points: [0, 0, Infinity, 0, 0, 0] }, { points: [1, 1, 1, 1, 1, 1] }],
        },
      ]),
    ).toThrow()
    const l = makeLayer({
      shape: 'star',
      sides: 8,
      cornerRadii: [2, 4, 6, 8],
      strokeDash: [4, 2],
      strokeAlign: 'inside',
    })
    expect(parseProject({ ...newDocument(), layers: [l] }).layers[0]).toMatchObject({
      shape: 'star',
      sides: 8,
      cornerRadii: [2, 4, 6, 8],
      strokeDash: [4, 2],
      strokeAlign: 'inside',
    })
    expect(
      parseActionProperties({
        shape: 'star',
        sides: 8,
        cornerRadii: [2, 4, 6, 8],
        strokeDash: [4, 2],
        strokeAlign: 'inside',
      }),
    ).toMatchObject({ shape: 'star', strokeAlign: 'inside' })
    expect(() => parseActionProperties({ strokeDash: Array(17).fill(1) })).toThrow()
  })
})
type LayerQuad = NonNullable<ReturnType<typeof makeLayer>['warp']>
