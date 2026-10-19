import { describe, expect, it } from 'vitest'
import { evaluateNumericInput } from '../../src/engine/numericExpression'
import { sameProjectData } from '../../src/engine/history'
import { makeLayer, newDocument } from '../../src/engine/document'
describe('data-only numeric expressions', () => {
  it.each([
    ['100/4', 100, 25],
    ['(1920-80)/2', 100, 920],
    ['−10 + 3 × 7', 100, 11],
    ['1,5*2', 100, 3],
    ['=2*(7-1)', 100, 12],
    ['+=12', 100, 112],
    ['-=4', 100, 96],
    ['*=50%', 100, 50],
    ['/=4', 100, 25],
    ['50%', 240, 120],
    ['100*25%', 100, 25],
    ['1e3/4', 100, 250],
    ['-.5', 100, -0.5],
    ['(3+2)÷2', 100, 2.5],
  ] as const)('%s evaluates with fixed focus-time context', (text, base, result) =>
    expect(evaluateNumericInput(text, base)).toBeCloseTo(result, 10),
  )
  it('recognizes explicit same-field units and percent values without inventing conversions', () => {
    expect(evaluateNumericInput('50%', 20, '%')).toBe(50)
    expect(evaluateNumericInput('20px + 4px', 100, 'px')).toBe(24)
    expect(evaluateNumericInput('90deg / 2', 100, '°')).toBe(45)
    expect(() => evaluateNumericInput('3cm * 50%', 100, 'px')).toThrow()
  })
  it('rejects division by zero, overflow, code, invalid syntax and oversized/deep input', () => {
    for (const text of [
      '1/0',
      '/=0',
      'Infinity',
      'NaN',
      '1e99',
      'Math.max(1,2)',
      'alert(1)',
      '0x50',
      '1;2',
      '1 2',
      '2**3',
      '(1+2',
      '()',
      '',
      '9'.repeat(97),
      '('.repeat(17) + '1' + ')'.repeat(17),
    ])
      expect(() => evaluateNumericInput(text, 10)).toThrow()
  })
})
describe('no-op gesture equality', () => {
  it('recognizes restored immutable documents but never ignores names, guides or nested smart metadata', () => {
    const doc = newDocument()
    doc.layers = [makeLayer()]
    expect(sameProjectData(doc, structuredClone(doc))).toBe(true)
    expect(sameProjectData(doc, { ...doc, layout: undefined })).toBe(true)
    expect(sameProjectData(doc, { ...doc, name: 'Renamed' })).toBe(false)
    const smart = { ...doc, layers: [{ ...doc.layers[0], smart: newDocument(10, 10, 'Inside') }] }
    const renamed = structuredClone(smart)
    renamed.layers[0].smart!.name = 'Changed'
    expect(sameProjectData(smart, renamed)).toBe(false)
    expect(sameProjectData(doc, { ...doc, layers: [{ ...doc.layers[0], x: 0.000001 }] })).toBe(
      false,
    )
  })
  it('cannot mistake opaque binary/class values for unchanged data', () => {
    expect(sameProjectData(new ArrayBuffer(1), new ArrayBuffer(2))).toBe(false)
    expect(sameProjectData(new Uint8Array([1]), new Uint8Array([2]))).toBe(false)
    expect(sameProjectData(new Date(1), new Date(2))).toBe(false)
  })
})
