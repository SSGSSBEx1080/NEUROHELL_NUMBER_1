import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { parseActionProperties } from '../../src/engine/actionSchema'
import { exportNativeText } from '../../src/engine/psdText'
import {
  measureTextGeometry,
  textBaselineShiftPx,
  type InkMeasure,
} from '../../src/engine/textGeometry'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

const measure: InkMeasure = (text, size, baseline, align) => {
  const width = text.length * size * 0.6
  const offset = align === 'center' ? width / 2 : align === 'right' ? width : 0
  return {
    width,
    actualBoundingBoxLeft: offset,
    actualBoundingBoxRight: width - offset,
    actualBoundingBoxAscent: baseline === 'alphabetic' ? size * 0.8 : 0,
    actualBoundingBoxDescent: baseline === 'alphabetic' ? size * 0.05 : size * 0.85,
  }
}

describe('uniform text baseline shift', () => {
  it('normalizes the local pixel value without turning invalid values into motion', () => {
    expect(textBaselineShiftPx(makeLayer({ kind: 'text', textBaselineShift: 12.5 }))).toBe(12.5)
    expect(textBaselineShiftPx(makeLayer({ kind: 'text', textBaselineShift: 5000 }))).toBe(1000)
    expect(textBaselineShiftPx(makeLayer({ kind: 'text', textBaselineShift: -5000 }))).toBe(-1000)
    expect(textBaselineShiftPx(makeLayer({ kind: 'text', textBaselineShift: Number.NaN }))).toBe(0)
    expect(textBaselineShiftPx(makeLayer({ kind: 'text' }))).toBe(0)
  })

  it('moves measured glyphs and their decorations while preserving ink height', () => {
    const plain = makeLayer({
      kind: 'text',
      text: 'Aa',
      fontSize: 100,
      width: 200,
      height: 100,
      textUnderline: true,
    })
    expect(measureTextGeometry(plain, measure).ink).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 95.5,
    })
    expect(measureTextGeometry({ ...plain, textBaselineShift: 20 }, measure).ink).toEqual({
      x: 0,
      y: -20,
      width: 120,
      height: 95.5,
    })
    expect(measureTextGeometry({ ...plain, textBaselineShift: -10 }, measure).ink).toEqual({
      x: 0,
      y: 10,
      width: 120,
      height: 95.5,
    })
  })

  it('survives project parsing only on text layers and validates action numbers', () => {
    const doc = {
      ...newDocument(100, 80),
      layers: [
        makeLayer({ kind: 'text', text: 'Aa', textBaselineShift: 2000 }),
        makeLayer({ kind: 'text', text: 'Bb', textBaselineShift: 0 }),
        makeLayer({ kind: 'shape', textBaselineShift: 20 }),
      ],
    }
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0].textBaselineShift).toBe(1000)
    expect(parsed.layers[1].textBaselineShift).toBeUndefined()
    expect(parsed.layers[2].textBaselineShift).toBeUndefined()

    expect(parseActionProperties({ textBaselineShift: -12.5 })).toEqual({
      textBaselineShift: -12.5,
    })
    expect(() => parseActionProperties({ textBaselineShift: 1001 })).toThrow()
    expect(() => parseActionProperties({ textBaselineShift: '12' })).toThrow()
  })

  it('exports a nonzero shift through a binary PSD Type layer and omits zero for legacy text', () => {
    const shifted = makeLayer({
      kind: 'text',
      text: 'Native Aa',
      width: 220,
      height: 60,
      fontSize: 40,
      textBaselineShift: 18.5,
    })
    const parsed = readPsd(
      writePsd({ width: 240, height: 80, children: [{ text: exportNativeText(shifted) }] }),
      { useImageData: true, skipThumbnail: true },
    )
    expect(parsed.children![0].text!.style!.baselineShift).toBe(18.5)

    const legacyStyle = exportNativeText(
      makeLayer({ kind: 'text', text: 'Legacy', fontSize: 32 }),
    ).style!
    expect(legacyStyle.baselineShift).toBeUndefined()
    const zeroStyle = exportNativeText(
      makeLayer({ kind: 'text', text: 'Zero', fontSize: 32, textBaselineShift: 0 }),
    ).style!
    expect(zeroStyle.baselineShift).toBeUndefined()
  })
})
