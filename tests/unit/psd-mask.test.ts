import { describe, expect, it } from 'vitest'
import type { Layer as PsdLayer } from 'ag-psd'
import { psdCompositeMask } from '../../src/engine/psdMask'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'

const imageData = (width = 4, height = 2) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(255),
})
const dualMask = (): PsdLayer =>
  ({
    name: 'dual',
    left: 10,
    top: 20,
    mask: { left: 10, top: 20, right: 14, bottom: 22, defaultColor: 0, imageData: imageData() },
    realMask: {
      left: 10,
      top: 20,
      right: 14,
      bottom: 22,
      defaultColor: 0,
      imageData: imageData(),
    },
    vectorMask: {
      paths: [
        {
          open: false,
          fillRule: 'non-zero',
          knots: [{ linked: true, points: [10, 20, 10, 20, 10, 20] }],
        },
      ],
    },
  }) as PsdLayer

describe('PSD baked pixel+vector (real) mask import gate', () => {
  it('accepts a decoded channel -3 whose size matches its rectangle', () => {
    const src = dualMask()
    expect(psdCompositeMask(src)).toEqual({ data: src.realMask, enabled: true })
  })

  it('rejects a header-shaped parameter block with no decoded -3 channel', () => {
    const src = dualMask()
    delete src.realMask!.imageData
    expect(psdCompositeMask(src)).toBeUndefined()
  })

  it('rejects size mismatches and non-neutral component density/feather', () => {
    const wrongSize = dualMask()
    wrongSize.realMask!.right = 99
    expect(psdCompositeMask(wrongSize)).toBeUndefined()
    const density = dualMask()
    density.mask!.userMaskDensity = 0.5
    expect(psdCompositeMask(density)).toBeUndefined()
    const feather = dualMask()
    feather.mask!.vectorMaskFeather = 2
    expect(psdCompositeMask(feather)).toBeUndefined()
  })

  it('rejects a single disabled component but accepts both disabled as one disabled mask', () => {
    const pixelOff = dualMask()
    pixelOff.mask!.disabled = true
    expect(psdCompositeMask(pixelOff)).toBeUndefined()
    const bothOff = dualMask()
    bothOff.mask!.disabled = true
    bothOff.vectorMask!.disable = true
    expect(psdCompositeMask(bothOff)).toEqual({ data: bothOff.realMask, enabled: false })
  })

  it('never re-applies the composite to shape/fill alpha that already includes the path', () => {
    const src = dualMask()
    src.vectorFill = { type: 'color', color: { r: 255, g: 0, b: 0 } }
    expect(psdCompositeMask(src)).toBeUndefined()
  })

  it('project parsing keeps the composite provenance and leaves legacy masks unmarked', () => {
    const doc = newDocument(20, 10, 'mask provenance', 'transparent')
    const mask = {
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      x: 1,
      y: 2,
      width: 4,
      height: 2,
      enabled: true,
      linked: true,
      density: 1,
      feather: 0,
      defaultColor: 0,
    }
    doc.layers = [
      makeLayer({ kind: 'shape', mask: { ...mask, composite: true } }),
      makeLayer({ kind: 'shape', mask }),
    ]
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0].mask?.composite).toBe(true)
    expect(parsed.layers[1].mask?.composite).toBeUndefined()
  })
})
