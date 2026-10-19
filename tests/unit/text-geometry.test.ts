import { describe, it, expect } from 'vitest'
import { makeLayer } from '../../src/engine/document'
import {
  getTextGeometry,
  measureTextGeometry,
  type InkMeasure,
} from '../../src/engine/textGeometry'
import {
  localBounds,
  resizePointText,
  rotateVisual,
  visualCenter,
  selectionQuad,
  distortVisual,
} from '../../src/engine/layerGeometry'
import { layerPoint } from '../../src/engine/shapeGeometry'
import { exportNativeText, affineText } from '../../src/engine/psdText'
const measure: InkMeasure = (text, size, baseline, align) => {
  const width = text.length * size * 0.6,
    offset = align === 'center' ? width / 2 : align === 'right' ? width : 0
  return {
    width,
    actualBoundingBoxLeft: offset + size * 0.1,
    actualBoundingBoxRight: width - offset + size * 0.05,
    actualBoundingBoxAscent: baseline === 'alphabetic' ? size * 0.8 : -size * 0.2,
    actualBoundingBoxDescent: baseline === 'alphabetic' ? size * 0.2 : size * 1.2,
  }
}
describe('Point-text ink geometry and native baseline', () => {
  it('measures overhang, descent, multiline spacing and horizontal scaling without trusting stored dimensions', () => {
    const layer = makeLayer({
      kind: 'text',
      width: 10,
      height: 8,
      text: 'AB\nC',
      fontSize: 20,
      lineHeight: 1.5,
      textScaleX: 2,
    })
    const g = measureTextGeometry(layer, measure)
    expect(g.bounds).toEqual({ x: -4, y: 4, width: 54, height: 50 })
    expect(g.baselineOffset).toBe(20)
    expect(g.lines.map((l) => l.y)).toEqual([0, 30])
    expect(layer.width).toBe(10)
  })
  it('accounts for text alignment and preserves intentional paragraph-frame dimensions', () => {
    const l = makeLayer({
      kind: 'text',
      width: 100,
      height: 80,
      text: 'AB',
      fontSize: 20,
      textAlign: 'right',
    })
    expect(measureTextGeometry(l, measure).bounds.x).toBe(74)
    const framed = {
      ...l,
      textFrame: {
        shape: 'rectangle' as const,
        padding: 10,
        verticalAlign: 'top' as const,
        autoFit: false,
        minFontSize: 4,
      },
    }
    expect(measureTextGeometry(framed, measure).bounds).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
  })
  it('empty and whitespace-only text remains selectable with finite caret geometry', () => {
    for (const text of ['', '   ', '\n', ' \n ']) {
      const g = measureTextGeometry(makeLayer({ kind: 'text', text }), measure)
      expect(Object.values(g.bounds).every(Number.isFinite)).toBe(true)
      expect(g.bounds.width).toBeGreaterThan(0)
      expect(g.bounds.height).toBeGreaterThan(0)
    }
  })
  it('rescales glyphs around the actual fixed handle, including rotated and reflected point text', () => {
    const l = makeLayer({
      kind: 'text',
      text: 'Bounds',
      fontSize: 40,
      width: 12,
      height: 5,
      x: 100,
      y: 80,
      rotation: 25,
      flipX: true,
    })
    const b = localBounds(l, true),
      before = layerPoint(l, { x: b.x, y: b.y }, false)
    const next = { ...l, ...resizePointText(l, { ...b, width: b.width * 2, height: b.height * 2 }) }
    const q = localBounds(next, true),
      after = layerPoint(next, { x: q.x, y: q.y }, false)
    expect(after.x).toBeCloseTo(before.x, 7)
    expect(after.y).toBeCloseTo(before.y, 7)
    expect(q.width).toBeCloseTo(b.width * 2, 7)
    const center = visualCenter(next),
      rotated = { ...next, ...rotateVisual(next, 90) }
    expect(visualCenter(rotated).x).toBeCloseTo(center.x, 7)
    expect(visualCenter(rotated).y).toBeCloseTo(center.y, 7)
  })
  it('distorts the selected glyph corner, not the obsolete 10px width', () => {
    const l = makeLayer({ kind: 'text', text: 'Text bounds', width: 10, height: 10, fontSize: 30 })
    const before = selectionQuad(l),
      next = { ...l, warp: distortVisual(l, 'se', 5, 10) },
      after = selectionQuad(next)
    expect(after[0].x).toBeCloseTo(before[0].x, 6)
    expect(after[2].x).toBeCloseTo(before[2].x + 5, 6)
    expect(after[2].y).toBeCloseTo(before[2].y + 10, 6)
  })
  it('exports point shapeType with an alphabetic baseline and an affine reflected transform', () => {
    const l = makeLayer({
      kind: 'text',
      text: 'Native point',
      width: 10,
      height: 10,
      fontSize: 40,
      x: 80,
      y: 90,
      flipX: true,
    })
    const t = exportNativeText(l),
      g = getTextGeometry(l)
    expect(t.shapeType).toBe('point')
    expect(t.boxBounds).toBeUndefined()
    expect(t.transform![0]).toBeCloseTo(-1)
    expect(t.transform![5]).toBeCloseTo(l.y + g.baselineOffset)
    expect(t.bounds!.right.value - t.bounds!.left.value).toBeGreaterThan(l.width * 10)
    expect(
      affineText({
        ...l,
        warp: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1.2, y: 1 },
          { x: 0.2, y: 1 },
        ],
      }),
    ).toBe(true)
    expect(
      affineText({
        ...l,
        warp: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1.2, y: 1 },
          { x: 0, y: 1 },
        ],
      }),
    ).toBe(false)
  })
})
