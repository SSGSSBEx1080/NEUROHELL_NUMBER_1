import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { parseActionProperties } from '../../src/engine/actionSchema'
import { exportNativeText } from '../../src/engine/psdText'
import { textDecorationMetrics } from '../../src/engine/textDecorations'
import { measureTextGeometry, type InkMeasure } from '../../src/engine/textGeometry'

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

describe('text underline and strikethrough', () => {
  it('defines stable em-based decoration metrics with a one-pixel minimum rule', () => {
    expect(textDecorationMetrics(100)).toEqual({
      thickness: 5.5,
      underlineTopOffset: 10,
      strikethroughTopOffset: -34,
    })
    expect(textDecorationMetrics(4).thickness).toBe(1)
    expect(textDecorationMetrics(Number.NaN)).toEqual(textDecorationMetrics(48))
  })

  it('expands measured ink bounds for an underline below a shallow glyph descent', () => {
    const plain = makeLayer({ kind: 'text', text: 'Aa', fontSize: 100, width: 200, height: 100 })
    const decorated = { ...plain, textUnderline: true, textStrikethrough: true }

    expect(measureTextGeometry(plain, measure).ink).toEqual({ x: 0, y: 0, width: 120, height: 85 })
    expect(measureTextGeometry(decorated, measure).ink).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 95.5,
    })

    const alphabetic = { ...decorated, textBaseline: 'alphabetic' as const }
    expect(measureTextGeometry(alphabetic, measure).ink).toEqual({
      x: 0,
      y: -80,
      width: 120,
      height: 95.5,
    })
  })

  it('survives project parsing only on text layers and validates action booleans', () => {
    const doc = {
      ...newDocument(100, 80),
      layers: [
        makeLayer({ kind: 'text', text: 'Aa', textUnderline: true, textStrikethrough: true }),
        makeLayer({ kind: 'shape', textUnderline: true, textStrikethrough: true }),
      ],
    }
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0].textUnderline).toBe(true)
    expect(parsed.layers[0].textStrikethrough).toBe(true)
    expect(parsed.layers[1].textUnderline).toBeUndefined()
    expect(parsed.layers[1].textStrikethrough).toBeUndefined()

    expect(parseActionProperties({ textUnderline: true, textStrikethrough: false })).toEqual({
      textUnderline: true,
      textStrikethrough: false,
    })
    expect(() => parseActionProperties({ textUnderline: 'yes' })).toThrow()
  })

  it('exports both flags through a binary PSD Type layer and omits them for legacy text', () => {
    const decorated = makeLayer({
      kind: 'text',
      text: 'Native Aa',
      width: 220,
      height: 60,
      fontSize: 40,
      textUnderline: true,
      textStrikethrough: true,
    })
    const parsed = readPsd(
      writePsd({ width: 240, height: 80, children: [{ text: exportNativeText(decorated) }] }),
      { useImageData: true, skipThumbnail: true },
    )
    expect(parsed.children![0].text!.style!.underline).toBe(true)
    expect(parsed.children![0].text!.style!.strikethrough).toBe(true)

    const legacyStyle = exportNativeText(
      makeLayer({ kind: 'text', text: 'Legacy', fontSize: 32 }),
    ).style!
    expect(legacyStyle.underline).toBeUndefined()
    expect(legacyStyle.strikethrough).toBeUndefined()
  })
})
