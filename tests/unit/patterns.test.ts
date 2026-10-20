import { describe, expect, it } from 'vitest'
import {
  builtinPatternDefinitions,
  cleanPatternId,
  cleanPatternName,
  collectPatternDefinitions,
  defaultPatternDefinition,
  deterministicPatternId,
  parsePatternDefinition,
  withPatternPatch,
} from '../../src/engine/patterns'
import { normalizeStyles } from '../../src/engine/styles'
import type { EditorDocument } from '../../src/types'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

describe('pattern definitions', () => {
  it('creates stable deterministic PSD identities for procedural tiles', () => {
    const first = defaultPatternDefinition()
    const second = defaultPatternDefinition()
    expect(first.id).toBe(second.id)
    expect(first.id).toBe(deterministicPatternId(first))
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const changed = withPatternPatch(first, { foreground: '#00ff00' })
    expect(changed.foreground).toBe('#00ff00')
    expect(changed.id).not.toBe(first.id)
    expect(changed.id).toBe(deterministicPatternId(changed))
    expect(new Set(builtinPatternDefinitions().map((p) => p.id)).size).toBe(6)
  })

  it('accepts only bounded local PNG tiles and trusts the PNG header size', () => {
    const parsed = parsePatternDefinition({
      name: 'Пиксель\\0',
      kind: 'image',
      src: TINY_PNG,
      width: 999,
      height: 999,
      psdX: 2,
      boundsY: -3,
    })
    expect(parsed).toMatchObject({ kind: 'image', name: 'Пиксель', width: 1, height: 1, psdX: 2 })
    expect(
      parsePatternDefinition({
        kind: 'image',
        src: 'https://example.invalid/tile.png',
        width: 1,
        height: 1,
      }),
    ).toBeUndefined()
    expect(
      parsePatternDefinition({
        kind: 'image',
        src: 'data:image/png;base64,AAAA',
        width: 1,
        height: 1,
      }),
    ).toBeUndefined()
    expect(cleanPatternName('  A\u0000B\\0  ')).toBe('A B')
    expect(cleanPatternId(' abc\\0 ')).toBe('abc')
  })

  it('normalizes pattern overlay and pattern strokes through the style gateway', () => {
    const pattern = defaultPatternDefinition()
    const styles = normalizeStyles({
      pattern: {
        enabled: true,
        pattern,
        scale: 99,
        opacity: 2,
        phaseX: 123456,
        phaseY: -123456,
        align: false,
      },
      strokes: [
        { enabled: true, size: 4, fill: 'pattern', pattern },
        { enabled: true, size: 4, fill: 'pattern', pattern: { kind: 'image', src: 'bad' } },
      ],
    })!
    expect(styles.pattern).toMatchObject({
      enabled: true,
      scale: 10,
      opacity: 1,
      phaseX: 10000,
      phaseY: -10000,
      align: false,
    })
    expect(styles.pattern.pattern.id).toBe(pattern.id)
    expect(styles.strokes[0].fill).toBe('pattern')
    expect(styles.strokes[1].fill).toBe('color')
  })

  it('collects only active pattern uses for rendering and PSD resources', () => {
    const active = defaultPatternDefinition()
    const styles = normalizeStyles({
      pattern: { enabled: false, pattern: active },
      strokes: [
        { enabled: true, fill: 'pattern', pattern: active },
        { enabled: false, fill: 'pattern', pattern: active },
        { enabled: true, fill: 'color', pattern: active },
      ],
    })!
    const doc = { layers: [{ styles }] } as unknown as EditorDocument
    expect(collectPatternDefinitions(doc)).toEqual([active])
  })
})
