import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  applyTextAntiAliasToPixels,
  parseTextAntiAlias,
  textAntiAliasAlphaLut,
  textAntiAliasFromPsd,
  textAntiAliasMode,
} from '../../src/engine/textAntiAlias'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { parseActionProperties } from '../../src/engine/actionSchema'
import { exportNativeText } from '../../src/engine/psdText'
import type { TextAntiAliasMode } from '../../src/types'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

const modes: TextAntiAliasMode[] = ['none', 'sharp', 'crisp', 'strong', 'smooth']
const sum = (mode: TextAntiAliasMode) => [...textAntiAliasAlphaLut(mode)].reduce((a, b) => a + b, 0)
const partialCount = (mode: TextAntiAliasMode) =>
  [...textAntiAliasAlphaLut(mode)].filter((value) => value > 0 && value < 255).length

describe('text anti-aliasing alpha model', () => {
  it('keeps Smooth as the identity legacy path and every curve endpoint-safe and monotonic', () => {
    expect([...textAntiAliasAlphaLut('smooth')]).toEqual(
      Array.from({ length: 256 }, (_, value) => value),
    )
    for (const mode of modes) {
      const lut = textAntiAliasAlphaLut(mode)
      expect(lut[0]).toBe(0)
      expect(lut[255]).toBe(255)
      for (let value = 1; value < lut.length; value++)
        expect(lut[value]).toBeGreaterThanOrEqual(lut[value - 1])
    }
  })

  it('makes None binary, Sharp narrower than Crisp, and Strong heavier in total coverage', () => {
    expect(textAntiAliasAlphaLut('none')[127]).toBe(0)
    expect(textAntiAliasAlphaLut('none')[128]).toBe(255)
    expect(partialCount('none')).toBe(0)
    expect(partialCount('sharp')).toBeLessThan(partialCount('crisp'))
    expect(partialCount('crisp')).toBeLessThan(partialCount('smooth'))
    expect(sum('strong')).toBeGreaterThan(sum('smooth'))
    expect(textAntiAliasAlphaLut('strong')[128]).toBeGreaterThan(200)
    expect(textAntiAliasAlphaLut('sharp')[64]).toBe(0)
    expect(textAntiAliasAlphaLut('sharp')[192]).toBe(255)
  })

  it('changes alpha only, preserving any genuinely multicolour glyph RGB', () => {
    const data = new Uint8ClampedArray([250, 10, 5, 64, 1, 2, 3, 128, 9, 8, 7, 0])
    applyTextAntiAliasToPixels(data, 'strong')
    expect([...data.slice(0, 3)]).toEqual([250, 10, 5])
    expect(data[3]).toBeGreaterThan(64)
    expect([...data.slice(4, 7)]).toEqual([1, 2, 3])
    expect(data[7]).toBeGreaterThan(200)
    expect(data[11]).toBe(0)

    const smooth = new Uint8ClampedArray(data)
    applyTextAntiAliasToPixels(smooth, 'smooth')
    expect(smooth).toEqual(data)
  })
})

describe('text anti-aliasing data boundaries', () => {
  it('parses only renderable grayscale modes; absent values mean Smooth', () => {
    for (const mode of modes) expect(parseTextAntiAlias(mode)).toBe(mode)
    for (const value of [undefined, null, 'platformLCD', 'LCD', 3, {}])
      expect(parseTextAntiAlias(value)).toBeUndefined()
    expect(textAntiAliasMode(undefined)).toBe('smooth')
    expect(textAntiAliasMode('bogus')).toBe('smooth')
  })

  it('does not counterfeit PSD platform or LCD subpixel modes', () => {
    expect(textAntiAliasFromPsd('sharp')).toEqual({ mode: 'sharp' })
    expect(textAntiAliasFromPsd(undefined)).toEqual({})
    const platform = textAntiAliasFromPsd('platform')
    expect(platform.mode).toBe('smooth')
    expect(platform.warning).toContain('хинтинг другой операционной системы')
    const lcd = textAntiAliasFromPsd('platformLCD')
    expect(lcd.mode).toBe('smooth')
    expect(lcd.warning).toContain('не создаёт поддельные цветные субпиксели')
  })

  it('survives project parsing only on text layers and is a validated action property', () => {
    const doc = {
      ...newDocument(100, 80),
      layers: [
        makeLayer({ kind: 'text', text: 'Aa', textAntiAlias: 'crisp' }),
        makeLayer({ kind: 'shape', textAntiAlias: 'none' }),
      ],
    }
    const parsed = parseProject(JSON.parse(JSON.stringify(doc)))
    expect(parsed.layers[0].textAntiAlias).toBe('crisp')
    expect(parsed.layers[1].textAntiAlias).toBeUndefined()

    expect(parseActionProperties({ textAntiAlias: 'strong' })).toEqual({
      textAntiAlias: 'strong',
    })
    expect(() => parseActionProperties({ textAntiAlias: 'platformLCD' })).toThrow()
  })

  it('exports every mode—and the legacy absent value as Smooth—through a binary PSD Type layer', () => {
    for (const mode of modes) {
      const layer = makeLayer({
        kind: 'text',
        text: 'Native Aa',
        width: 220,
        height: 60,
        fontSize: 40,
        textAntiAlias: mode,
      })
      const parsed = readPsd(
        writePsd({ width: 240, height: 80, children: [{ text: exportNativeText(layer) }] }),
        { useImageData: true, skipThumbnail: true },
      )
      expect(parsed.children![0].text!.antiAlias).toBe(mode)
    }
    const legacy = makeLayer({ kind: 'text', text: 'Legacy', fontSize: 32 })
    expect(exportNativeText(legacy).antiAlias).toBe('smooth')
  })
})
