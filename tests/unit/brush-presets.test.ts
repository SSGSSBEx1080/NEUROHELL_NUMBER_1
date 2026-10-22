import { describe, expect, it } from 'vitest'
import {
  downscaleBrushAlpha,
  parseBrushLibrary,
  rgbaToBrushAlpha,
  sanitizeBrushPresetSettings,
  toolSettingsForBrushPreset,
} from '../../src/engine/brushPresets'
import { parseAbrBrushes } from '../../src/engine/brushAbr'

function syntheticAbr61(alpha: number[], width: number, height: number) {
  const id = new TextEncoder().encode('tip-1'),
    contentLength = 1 + id.length + 10 + 16 + 2 + 1 + alpha.length,
    paddedContentLength = Math.ceil(contentLength / 4) * 4,
    sectionSize = 4 + paddedContentLength,
    bytes = new Uint8Array(4 + 8 + 4 + sectionSize),
    view = new DataView(bytes.buffer)
  let offset = 0
  const ascii = (text: string) => {
    for (const ch of text) bytes[offset++] = ch.charCodeAt(0)
  }
  view.setInt16(offset, 6)
  offset += 2
  view.setInt16(offset, 1)
  offset += 2
  ascii('8BIM')
  ascii('samp')
  view.setUint32(offset, sectionSize)
  offset += 4
  view.setUint32(offset, contentLength)
  offset += 4
  bytes[offset++] = id.length
  bytes.set(id, offset)
  offset += id.length
  offset += 10 // ag-psd minor-1 skip
  view.setInt32(offset, 0) // top
  offset += 4
  view.setInt32(offset, 0) // left
  offset += 4
  view.setInt32(offset, height) // bottom
  offset += 4
  view.setInt32(offset, width) // right
  offset += 4
  view.setInt16(offset, 8)
  offset += 2
  bytes[offset++] = 0 // raw
  bytes.set(alpha, offset)
  return bytes
}

describe('stage 24 ABR brush import', () => {
  it('parses a synthetic ABR 6.1 sampled tip without inverting its alpha', () => {
    const result = parseAbrBrushes(syntheticAbr61([255, 0, 128, 64], 2, 2))
    expect(result.presets).toHaveLength(1)
    expect(result.presets[0].name).toBe('Наконечник 1')
    expect(result.presets[0].sample?.id).toBe('tip-1')
    expect(Array.from(result.presets[0].sample?.alpha || [])).toEqual([255, 0, 128, 64])
    expect(result.presets[0].settings).toEqual({ brushSize: 2, brushSpacing: 15 })
    expect(result.presets[0].unsupported).toContain('наконечник без связанного пресета в desc')
  })

  it('rejects legacy ABR with an explicit supported-versions message', () => {
    const legacy = new Uint8Array([0, 1, 0, 1])
    expect(() => parseAbrBrushes(legacy)).toThrow(/legacy v1\/v2/)
  })

  it('uses Photoshop image-tip polarity: black paints, white and transparency do not', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 128])
    const mask = rgbaToBrushAlpha(rgba, 4, 1)
    expect(Array.from(mask.alpha)).toEqual([255, 0, 0, 128])
  })

  it('box-averages oversized alpha masks into the local tip budget', () => {
    const scaled = downscaleBrushAlpha(new Uint8Array([0, 100, 200, 255]), 4, 1, 2, 2)
    expect([scaled.width, scaled.height]).toEqual([2, 1])
    expect(Array.from(scaled.alpha)).toEqual([50, 228])
  })

  it('sanitizes preset settings and resets absent dynamics on apply', () => {
    expect(
      sanitizeBrushPresetSettings({
        brushSize: 9999,
        brushScatterCount: 99,
        brushAngleControl: 'tilt',
        brushTip: 'not-a-setting',
      }),
    ).toEqual({ brushSize: 500, brushScatterCount: 16 })
    const applied = toolSettingsForBrushPreset(
      {
        id: 'x',
        name: 'X',
        source: 'builtin',
        settings: { brushSize: 44 },
      },
      { brushOpacity: 37, brushSmoothing: 22 },
    )
    expect(applied.brushSize).toBe(44)
    expect(applied.brushOpacity).toBe(37)
    expect(applied.brushSmoothing).toBe(22)
    expect(applied.brushSizeJitter).toBe(0)
    expect(applied.brushScatterCount).toBe(1)
    expect(applied.brushTip).toBeUndefined()
  })

  it('strictly validates persisted brush-library tips', () => {
    const valid = JSON.stringify([
      {
        id: 'one',
        name: 'One',
        source: 'library',
        settings: { brushSize: 20 },
        tip: {
          id: 'tip',
          name: 'Tip',
          width: 2,
          height: 2,
          src: 'data:image/png;base64,AAAA',
        },
      },
    ])
    expect(parseBrushLibrary(valid)).toHaveLength(1)
    expect(parseBrushLibrary(valid.replace('"width":2', '"width":9999'))).toBeNull()
    expect(parseBrushLibrary(valid.replace('image/png', 'image/jpeg'))).toBeNull()
  })
})
