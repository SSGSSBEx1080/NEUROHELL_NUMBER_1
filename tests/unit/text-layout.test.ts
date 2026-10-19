import { describe, expect, it } from 'vitest'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { defaultTextFrame, layoutText } from '../../src/engine/textLayout'
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const measure = (text: string, size: number) =>
  Array.from(segments.segment(text)).length * size * 0.5
const layer = (patch = {}) =>
  makeLayer({
    kind: 'text',
    width: 120,
    height: 100,
    text: 'Один образец внутри рамки.',
    fontSize: 20,
    lineHeight: 1.2,
    textAlign: 'center',
    textFrame: { ...defaultTextFrame(), autoFit: false },
    ...patch,
  })
describe('Bounded layout text layout', () => {
  it('wraps words, honors hard line breaks, blank lines, padding and vertical alignment', () => {
    const l = layer({ text: 'Один образец\n\nДа!', width: 140 })
    const result = layoutText(l, measure)
    expect(result.lines.map((r) => r.text)).toEqual(['Один образец', '', 'Да!'])
    expect(result.overflow).toBe(false)
    expect(result.lines[0]).toMatchObject({ x: 70, y: 16 })
    const top = layoutText({ ...l, textFrame: { ...l.textFrame!, verticalAlign: 'top' } }, measure)
    expect(top.lines[0].y).toBe(10)
    const bottom = layoutText(
      { ...l, textFrame: { ...l.textFrame!, verticalAlign: 'bottom' } },
      measure,
    )
    expect(bottom.lines.at(-1)!.y + result.fontSize).toBe(90)
  })
  it('shrinks only as much as needed; too small frames report overflow without changing text', () => {
    const l = layer({ height: 60, textFrame: defaultTextFrame() })
    const result = layoutText(l, measure)
    expect(result.fontSize).toBeLessThan(20)
    expect(result.fontSize).toBeGreaterThanOrEqual(8)
    expect(result.overflow).toBe(false)
    expect(
      result.lines
        .map((line) => line.text)
        .join('')
        .replaceAll(' ', ''),
    ).toBe(l.text!.replaceAll(' ', ''))
    expect(layoutText({ ...l, width: 21, height: 21 }, measure).overflow).toBe(true)
    expect(l.fontSize).toBe(20)
  })
  it('fits ellipse chord widths and produces stable centered rows', () => {
    const l = layer({
      width: 200,
      height: 140,
      text: 'Это текстовый образец. Он должен поместиться в рамке.',
      textFrame: { ...defaultTextFrame(), shape: 'ellipse' },
    })
    const result = layoutText(l, measure)
    expect(result.overflow).toBe(false)
    expect(result.lines.length).toBeGreaterThan(2)
    expect(result.lines[0].availableWidth).toBeLessThan(
      result.lines[Math.floor(result.lines.length / 2)].availableWidth,
    )
    for (const line of result.lines) {
      expect(line.width).toBeLessThanOrEqual(line.availableWidth + 0.01)
      expect(line.x).toBe(100)
      expect(line.y).toBeGreaterThanOrEqual(10)
    }
    expect(layoutText(l, measure)).toEqual(result)
  })
  it('never splits combining marks, surrogate pairs or ZWJ sequences during long-word wrapping', () => {
    const text = 'e\u0301👩‍💻你好🙂'.repeat(8)
    const result = layoutText(layer({ text, width: 60, height: 900 }), measure)
    expect(result.overflow).toBe(false)
    expect(result.lines.map((l) => l.text).join('')).toBe(text)
    for (const line of result.lines) {
      expect(line.text).not.toMatch(/^[\u0300-\u036f\u200d\uDC00-\uDFFF]/u)
      expect(line.text).not.toMatch(/\u200d$/u)
    }
  })
  it('bounds large-input work and preserves only validated frame metadata on import', () => {
    let work = 0
    const l = layer({
      text: 'абв'.repeat(7000),
      width: 30,
      height: 30,
      textFrame: defaultTextFrame(),
    })
    const result = layoutText(l, (s, n) => {
      work++
      return measure(s, n)
    })
    expect(result.overflow).toBe(true)
    expect(result.lines.length).toBeLessThanOrEqual(512)
    expect(work).toBeLessThanOrEqual(24000)
    const doc = parseProject({
      ...newDocument(),
      layers: [
        {
          ...l,
          textFrame: {
            shape: 'bad',
            padding: Infinity,
            minFontSize: -5,
            autoFit: false,
            verticalAlign: 'bad',
          },
        },
      ],
    })
    expect(doc.layers[0].textFrame).toEqual({
      ...defaultTextFrame(),
      autoFit: false,
      minFontSize: 4,
    })
    expect(
      parseProject({ ...newDocument(), layers: [makeLayer({ kind: 'text' })] }).layers[0].textFrame,
    ).toBeUndefined()
  })
})
