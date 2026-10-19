import { expect, it } from 'vitest'
import { canonicalTextPreview } from '../../src/engine/textPreview'
it('native monochrome type caches keep their true paint and exact alpha', () => {
  const data = new Uint8ClampedArray([20, 20, 20, 224, 0, 0, 0, 1, 21, 21, 21, 255, 98, 65, 44, 0])
  canonicalTextPreview({ width: 4, height: 1, data }, '#151515')
  expect([...data]).toEqual([21, 21, 21, 224, 21, 21, 21, 1, 21, 21, 21, 255, 98, 65, 44, 0])
})
it('never recolors a non-monochrome glyph cache or an invalid paint', () => {
  for (const color of ['#151515', 'invalid']) {
    const data = new Uint8ClampedArray([20, 20, 20, 224, 230, 70, 20, 255]),
      before = data.slice()
    canonicalTextPreview({ width: 2, height: 1, data }, color)
    expect(data).toEqual(before)
  }
})
