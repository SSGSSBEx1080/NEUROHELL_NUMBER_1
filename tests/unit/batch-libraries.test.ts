import { describe, expect, it } from 'vitest'
import {
  batchActionTarget,
  batchOutputName,
  sanitizeSuffix,
  validateBatchAction,
} from '../../src/engine/batch'
import { builtinActions, parseActionSet } from '../../src/engine/actions'
import {
  builtinStylePresets,
  copyStyleToClipboard,
  parseGradientLibraryFile,
  parseStyleLibraryFile,
  readStyleClipboard,
  readStyleClipboardKnockout,
  serializeGradientLibrary,
  serializeStyleLibrary,
} from '../../src/engine/libraries'
import { makeLayer, newDocument } from '../../src/engine/document'
import { gradientDefinitionPresets } from '../../src/engine/gradientRamp'

describe('batch naming and targets', () => {
  it('never reuses the input filename and sanitizes the suffix', () => {
    expect(batchOutputName('photo.png', '-ultra', 'png')).toBe('photo-ultra.png')
    expect(batchOutputName('photo.png', '', 'png')).toBe('photo-ultra.png')
    expect(batchOutputName('photo-ultra.png', '-ultra', 'jpeg')).toBe('photo-ultra-ultra.jpg')
    expect(batchOutputName('C:\\pics\\a.psd', '/bad:name*', 'webp')).toBe('a_bad_name_.webp')
    expect(sanitizeSuffix('  -ok  ')).toBe('-ok')
  })

  it('starts an action from the topmost unlocked non-group layer', () => {
    const doc = newDocument(10, 10)
    doc.layers = [
      makeLayer({ name: 'bottom' }),
      makeLayer({ name: 'group', kind: 'group' }),
      makeLayer({ name: 'locked-top', locked: true }),
    ]
    expect(batchActionTarget(doc)).toBe(doc.layers[0].id)
    doc.layers[0].locked = true
    expect(batchActionTarget(doc)).toBeNull()
  })

  it('refuses to run a batch with unsupported action steps instead of faking it', () => {
    expect(() => validateBatchAction(builtinActions[0])).not.toThrow()
    const broken = {
      ...builtinActions[0],
      steps: [{ name: 'Чужой плагин', enabled: true }],
    }
    expect(() => validateBatchAction(broken)).toThrow(/неподдерживаемые шаги/)
    const empty = parseActionSet({
      version: 2,
      actions: [{ name: 'Пустая', source: 'test', steps: [] }],
    })[0]
    expect(() => validateBatchAction(empty)).toThrow(/нет включённых шагов/)
  })
})

describe('gradient and style libraries', () => {
  it('round-trips the exchange files and rejects foreign payloads', () => {
    const gradients = parseGradientLibraryFile(
      serializeGradientLibrary(gradientDefinitionPresets.slice(0, 2)),
    )
    expect(gradients.map((g) => g.name)).toEqual(
      gradientDefinitionPresets.slice(0, 2).map((g) => g.name),
    )
    const styles = parseStyleLibraryFile(serializeStyleLibrary(builtinStylePresets))
    expect(styles.map((s) => s.name)).toContain('Тройная обводка ULTRA')
    expect(() => parseGradientLibraryFile('{"kind":"other","gradients":[]}')).toThrow()
    expect(() => parseStyleLibraryFile('не json')).toThrow()
  })

  it('keeps builtin presets fully editable, including three real strokes', () => {
    const ultra = builtinStylePresets[0]
    expect(ultra.styles.strokes.filter((s) => s.enabled).map((s) => s.size)).toEqual([2, 7, 13])
  })

  it('copies a style through the internal clipboard as an independent clone', () => {
    copyStyleToClipboard(builtinStylePresets[0].styles, undefined, 'deep')
    const pasted = readStyleClipboard()!
    pasted.strokes[0].size = 99
    expect(readStyleClipboard()!.strokes[0].size).toBe(2)
    expect(readStyleClipboardKnockout()).toBe('deep')
    copyStyleToClipboard(builtinStylePresets[0].styles)
    expect(readStyleClipboardKnockout()).toBeUndefined()
  })
})
