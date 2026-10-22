import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { knockoutPunchFactor, parseKnockout, punchKnockoutPixels } from '../../src/engine/knockout'
import { parsePsdLayerRecords, patchPsdDeepKnockout } from '../../src/engine/psdLayerRecords'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

const pixels = (r: number, g: number, b: number, a = 255) => ({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([r, g, b, a, r, g, b, a, r, g, b, a, r, g, b, a]),
})

describe('Knockout pixel model', () => {
  it('accepts only Photoshop’s two stored depths', () => {
    expect(parseKnockout('shallow')).toBe('shallow')
    expect(parseKnockout('deep')).toBe('deep')
    expect(parseKnockout('none')).toBeUndefined()
    expect(parseKnockout(2)).toBeUndefined()
    expect(parseKnockout({})).toBeUndefined()
  })

  it('keeps Fill separate from the shape and overall opacity as knockout strength', () => {
    const normal = { normalBlend: true, opacity: 1, fillOpacity: 1 }
    expect(knockoutPunchFactor(255, normal)).toBe(0)
    expect(knockoutPunchFactor(255, { ...normal, fillOpacity: 0 })).toBe(1)
    expect(knockoutPunchFactor(255, { ...normal, fillOpacity: 0.5 })).toBe(1)
    expect(knockoutPunchFactor(128, { ...normal, fillOpacity: 0.5 })).toBeCloseTo(
      128 / 255 / 2 / (1 - 128 / 255 / 2),
    )
    expect(knockoutPunchFactor(255, { ...normal, fillOpacity: 0, opacity: 0.25 })).toBe(0.25)
    // A real blend mode is evaluated against the knocked-out backdrop even
    // when Fill is still 100%; that is how changing only the mode reveals it.
    expect(knockoutPunchFactor(255, { normalBlend: false, opacity: 1, fillOpacity: 1 })).toBe(1)
  })

  it('round-trips the project fields and allows only one bottom Background stopper', () => {
    const src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII='
    const doc = newDocument(4, 4, 'Knockout', 'transparent')
    doc.layers = [
      makeLayer({ kind: 'image', name: 'Background', src, background: true, knockout: 'deep' }),
      makeLayer({ kind: 'shape', name: 'Punch', knockout: 'deep' }),
      makeLayer({ kind: 'image', name: 'False background', src, background: true }),
      makeLayer({
        kind: 'adjustment',
        name: 'No shape',
        correction: { type: 'invert' },
        knockout: 'shallow',
      }),
    ]
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0]).toMatchObject({ background: true })
    expect(parsed.layers[0].knockout).toBeUndefined()
    expect(parsed.layers[1].knockout).toBe('deep')
    expect(parsed.layers[2].background).toBeUndefined()
    expect(parsed.layers[3].knockout).toBeUndefined()
  })

  it('mixes straight-alpha pixels in premultiplied space', () => {
    const current = new Uint8ClampedArray([255, 0, 0, 128])
    const boundary = new Uint8ClampedArray([0, 0, 255, 255])
    const shape = new Uint8ClampedArray([0, 0, 0, 255])
    punchKnockoutPixels(current, boundary, shape, {
      normalBlend: true,
      opacity: 1,
      fillOpacity: 0,
    })
    expect([...current]).toEqual([0, 0, 255, 255])

    const partial = new Uint8ClampedArray([200, 0, 0, 255])
    punchKnockoutPixels(partial, boundary, shape, {
      normalBlend: true,
      opacity: 0.5,
      fillOpacity: 0,
    })
    expect([...partial]).toEqual([100, 0, 128, 255])
  })
})

describe('raw PSD layer-record Knockout bytes', () => {
  it('finds ids, group records, Background channels and patches only Deep by id', () => {
    const buffer = writePsd(
      {
        width: 2,
        height: 2,
        imageData: pixels(10, 20, 30),
        children: [
          {
            id: 101,
            name: 'Background',
            left: 0,
            top: 0,
            right: 2,
            bottom: 2,
            imageData: pixels(10, 20, 30),
          },
          {
            id: 102,
            name: 'Shallow',
            left: 0,
            top: 0,
            right: 2,
            bottom: 2,
            knockout: true,
            imageData: pixels(200, 0, 0),
          },
          {
            id: 103,
            name: 'Deep group',
            knockout: true,
            children: [
              {
                id: 104,
                name: 'Inside',
                left: 0,
                top: 0,
                right: 2,
                bottom: 2,
                imageData: pixels(0, 200, 0),
              },
            ],
          },
        ],
      },
      { generateThumbnail: false },
    )
    const records = parsePsdLayerRecords(buffer)
    expect(records).toHaveLength(5) // includes the synthetic group-end record
    expect(records[0]).toMatchObject({ id: 101, name: 'Background', hasTransparencyChannel: false })
    expect(records[1]).toMatchObject({ id: 102, knockoutByte: 1, hasTransparencyChannel: true })
    expect(records[2].sectionDividerType).toBe(3)
    expect(records[3]).toMatchObject({ id: 104, name: 'Inside' })
    expect(records[4]).toMatchObject({ id: 103, knockoutByte: 1 })
    expect([1, 2]).toContain(records[4].sectionDividerType)

    const patched = patchPsdDeepKnockout(buffer, [103])
    const after = parsePsdLayerRecords(patched)
    expect(after.find((r) => r.id === 102)?.knockoutByte).toBe(1)
    expect(after.find((r) => r.id === 103)?.knockoutByte).toBe(2)
    // ag-psd still truthfully reports a boolean layer; only the raw byte
    // carries the depth that our importer reads separately.
    expect(readPsd(patched, { useImageData: true }).children?.at(-1)?.knockout).toBe(true)
    expect(() => patchPsdDeepKnockout(buffer, [999])).toThrow(/Deep Knockout/)
  })

  it('uses the PSB 64-bit section/channel lengths', () => {
    const buffer = writePsd(
      {
        width: 2,
        height: 2,
        children: [
          {
            id: 777,
            name: 'PSB knockout',
            left: 0,
            top: 0,
            right: 2,
            bottom: 2,
            knockout: true,
            imageData: pixels(0, 0, 200),
          },
        ],
      },
      { generateThumbnail: false, psb: true, noBackground: true },
    )
    expect(parsePsdLayerRecords(buffer)).toMatchObject([
      { id: 777, name: 'PSB knockout', knockoutByte: 1 },
    ])
    expect(parsePsdLayerRecords(patchPsdDeepKnockout(buffer, [777]))[0].knockoutByte).toBe(2)
  })

  it('rejects truncated files instead of returning a guessed record location', () => {
    const buffer = writePsd(
      { width: 1, height: 1, children: [{ name: 'x', imageData: pixels(1, 2, 3) }] },
      { generateThumbnail: false },
    )
    expect(() => parsePsdLayerRecords(buffer.slice(0, 40))).toThrow()
  })
})
