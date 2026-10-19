import { describe, expect, it } from 'vitest'
import type { Layer as PsdLayer, PlacedLayer, Warp } from 'ag-psd'
import {
  identityEnvelope,
  gaussianSmartFilter,
  nativeGaussianRadius,
  nativeSmartPlacement,
  translateNativePlacement,
} from '../../src/engine/psdSmart'
import { makeLayer } from '../../src/engine/document'
import { layerPoint } from '../../src/engine/shapeGeometry'
import { pixelBounds } from '../../src/engine/layerGeometry'
import { defaultStyles } from '../../src/engine/styles'
const placed = (transform = [7, 9, 127, 9, 127, 89, 7, 89]): PlacedLayer => ({
  id: 'placed',
  type: 'raster',
  transform,
})

describe('native PSD placed content', () => {
  it('recognizes only an unchanged regular envelope, not arbitrary Photoshop warp data', () => {
    const px = (value: number) => ({ units: 'Pixels' as const, value })
    const warp: Warp = {
      style: 'custom',
      value: 0,
      uOrder: 4,
      vOrder: 4,
      bounds: { left: px(0), top: px(0), right: px(120), bottom: px(90) },
      customEnvelopeWarp: {
        meshPoints: Array.from({ length: 16 }, (_, i) => ({
          x: (i % 4) * 40,
          y: Math.floor(i / 4) * 30,
        })),
      },
    }
    expect(identityEnvelope(warp)).toBe(true)
    expect(identityEnvelope({ ...warp, perspective: 3 })).toBe(false)
    expect(identityEnvelope({ ...warp, deformNumRows: 4 })).toBe(false)
    warp.customEnvelopeWarp!.meshPoints[5].x += 0.1
    expect(identityEnvelope(warp)).toBe(false)
    expect(identityEnvelope({ style: 'arc', value: 0 })).toBe(false)
  })
  it('maps all four document corners, including perspective and mirrored placements', () => {
    for (const transform of [
      [40, 35, 180, 20, 165, 100, 30, 95],
      [180, 20, 40, 35, 30, 95, 165, 100],
    ]) {
      const patch = nativeSmartPlacement({ placedLayer: placed(transform) }, 120, 80)!
      expect(patch).toBeTruthy()
      const layer = makeLayer({ kind: 'image', ...patch })
      for (const [i, p] of [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 80 },
        { x: 0, y: 80 },
      ].entries()) {
        const actual = layerPoint(layer, p)
        expect(actual.x).toBeCloseTo(transform[i * 2], 7)
        expect(actual.y).toBeCloseTo(transform[i * 2 + 1], 7)
      }
    }
  })
  it('does not promote unsupported masks, selected comps, filters or transformed outer FX', () => {
    const layer: PsdLayer = { placedLayer: placed() }
    expect(nativeSmartPlacement({ ...layer, mask: {} }, 120, 80)).toBeUndefined()
    expect(
      nativeSmartPlacement({ ...layer, placedLayer: { ...placed(), comp: 2 } }, 120, 80),
    ).toBeUndefined()
    expect(
      nativeSmartPlacement(
        {
          ...layer,
          placedLayer: { ...placed(), filter: { ...gaussianSmartFilter(3)!, maskEnabled: true } },
        },
        120,
        80,
      ),
    ).toBeUndefined()
    const styles = defaultStyles()
    styles.shadows[0].enabled = true
    expect(nativeSmartPlacement(layer, 120, 80, styles)).toMatchObject({
      x: 7,
      y: 9,
      warp: undefined,
    })
    expect(nativeSmartPlacement(layer, 240, 80, styles)).toBeUndefined()
  })
  it('round-trips supported Gaussian radius and rejects out-of-range or partially mixed filters', () => {
    expect(nativeGaussianRadius()).toBe(0)
    expect(nativeGaussianRadius(gaussianSmartFilter(2.5))).toBe(2.5)
    expect(nativeGaussianRadius(gaussianSmartFilter(31))).toBeUndefined()
    const filter = gaussianSmartFilter(3)!
    filter.list[0].opacity = 0.5
    expect(nativeGaussianRadius(filter)).toBeUndefined()
  })
  it('translates affine and non-affine descriptors together without mutating the original', () => {
    const original = { ...placed(), nonAffineTransform: [6, 8, 130, 9, 125, 90, 7, 88] }
    const moved = translateNativePlacement(original, 13, -4)
    expect(moved.transform).toEqual([20, 5, 140, 5, 140, 85, 20, 85])
    expect(moved.nonAffineTransform).toEqual([19, 4, 143, 5, 138, 86, 20, 84])
    expect(original.transform[0]).toBe(7)
    expect(original.nonAffineTransform[0]).toBe(6)
  })
  it('rejects collapsed, unsafe and non-finite placements rather than repairing them silently', () => {
    for (const transform of [
      [],
      Array(8).fill(0),
      [0, 0, 10, 0, NaN, 10, 0, 10],
      [40000, 0, 40010, 0, 40010, 10, 40000, 10],
    ])
      expect(nativeSmartPlacement({ placedLayer: placed(transform) }, 120, 80)).toBeUndefined()
    expect(nativeSmartPlacement({ placedLayer: placed() }, 0, 80)).toBeUndefined()
  })
  it('uses outward whole-pixel backing bounds without changing logical layer geometry', () => {
    const bounds = { x: 1.2, y: -2.3, width: 20.2, height: 7.1 }
    expect(pixelBounds(bounds)).toEqual({ x: 1, y: -3, width: 21, height: 8 })
    expect(bounds.width).toBe(20.2)
    expect(pixelBounds({ x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })
})
