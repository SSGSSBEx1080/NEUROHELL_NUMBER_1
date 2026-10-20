import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { normalizeStyles } from '../../src/engine/styles'
import {
  consistentGlobalLight,
  countLinkedGlobalLightEffects,
  effectiveGlobalLight,
  globalLightFromPsdResources,
  hasConflictingLinkedGlobalLight,
  normalizeGlobalLight,
  normalizeLightAngle,
  parseGlobalLight,
  psdGlobalAltitudeResource,
  psdGlobalAngleResource,
  shadowDistance,
  shadowLightAngle,
  shadowOffsetForLightAngle,
  synchronizeDocumentGlobalLight,
  synchronizeStylesToGlobalLight,
} from '../../src/engine/globalLight'
import { __psdStyleCodecForTests } from '../../src/engine/psd'
import { recordEditorEvent, startRecording } from '../../src/engine/actionRecorder'
import { actionBlockers, runAction, type StudioAction } from '../../src/engine/actions'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

const linkedStyles = () =>
  normalizeStyles({
    shadows: [
      { enabled: true, color: '#000000', blur: 0, x: 0, y: 20, opacity: 1, useGlobalLight: true },
      { enabled: true, color: '#123456', blur: 0, x: 3, y: 4, opacity: 1 },
    ],
    innerShadows: [
      { enabled: false, color: '#000000', blur: 0, x: -10, y: 0, opacity: 1, useGlobalLight: true },
    ],
    bevel: { enabled: true, angle: 90, altitude: 30, useGlobalLight: true },
    satin: { enabled: true, angle: 19, distance: 11, size: 14 },
  })!

describe('document Global Light', () => {
  it('normalizes angles and PSD resources without inventing a legacy master', () => {
    expect(normalizeLightAngle(540)).toBe(-180)
    expect(normalizeLightAngle(-181)).toBe(179)
    expect(normalizeLightAngle('bad', 30)).toBe(30)
    expect(normalizeGlobalLight({ angle: 450, altitude: 120 })).toEqual({ angle: 90, altitude: 90 })
    expect(parseGlobalLight(undefined)).toBeUndefined()
    expect(parseGlobalLight({ angle: 390, altitude: -10 })).toEqual({ angle: 30, altitude: 0 })
    expect(globalLightFromPsdResources({})).toBeUndefined()
    expect(globalLightFromPsdResources({ globalAngle: 132 })).toEqual({ angle: 132, altitude: 30 })
    expect(globalLightFromPsdResources({ globalAltitude: 44 })).toEqual({ angle: 30, altitude: 44 })
    expect(psdGlobalAngleResource(-30)).toBe(330)
    expect(psdGlobalAngleResource(359.6)).toBe(0)
    expect(psdGlobalAltitudeResource(120)).toBe(90)
    expect(newDocument().globalLight).toBeUndefined()
  })

  it('uses the PSD shadow sign convention and preserves distance within the local axis limit', () => {
    expect(shadowOffsetForLightAngle(20, 30)).toEqual({
      x: expect.closeTo(-17.3205, 4),
      y: expect.closeTo(10, 4),
    })
    expect(shadowOffsetForLightAngle(20, 120)).toEqual({
      x: expect.closeTo(10, 4),
      y: expect.closeTo(17.3205, 4),
    })
    const effect = { x: 10, y: 17.320508075688775 }
    expect(shadowDistance(effect)).toBeCloseTo(20)
    expect(shadowLightAngle(effect)).toBeCloseTo(120)
    expect(shadowOffsetForLightAngle(1000, 0)).toEqual({ x: -180, y: 0 })
    const diagonal = shadowOffsetForLightAngle(1000, 45)
    expect(Math.abs(diagonal.x)).toBeCloseTo(180)
    expect(Math.abs(diagonal.y)).toBeCloseTo(180)
  })

  it('synchronizes linked shadows and Bevel by copy, including disabled settings, but not Satin', () => {
    const styles = linkedStyles()
    const synced = synchronizeStylesToGlobalLight(styles, { angle: 0, altitude: 55 })!
    expect(synced.shadows[0]).toMatchObject({ x: -20, y: 0, useGlobalLight: true })
    expect(synced.shadows[1]).toBe(styles.shadows[1])
    expect(synced.innerShadows[0]).toMatchObject({ x: -10, y: 0, enabled: false })
    expect(synced.bevel).toMatchObject({ angle: 0, altitude: 55, useGlobalLight: true })
    expect(synced.satin).toBe(styles.satin)

    const unlinked = normalizeStyles({
      shadows: [{ enabled: true, x: 2, y: 3 }],
      bevel: { enabled: true, angle: 44, altitude: 12, useGlobalLight: false },
    })!
    expect(synchronizeStylesToGlobalLight(unlinked, { angle: 0, altitude: 55 })).toBe(unlinked)
  })

  it('applies one document master to top-level locked layers without entering smart contents', () => {
    const inner = { ...newDocument(10, 10, 'inner'), globalLight: { angle: 77, altitude: 22 } }
    inner.layers = [makeLayer({ name: 'inner layer', styles: linkedStyles() })]
    const locked = makeLayer({ name: 'locked', locked: true, styles: linkedStyles() })
    const smart = makeLayer({ name: 'smart', smart: inner })
    const doc = { ...newDocument(100, 100), layers: [locked, smart] }
    const synced = synchronizeDocumentGlobalLight(doc, { angle: 180, altitude: 10 })
    expect(synced.globalLight).toEqual({ angle: -180, altitude: 10 })
    expect(synced.layers[0].styles?.shadows[0]).toMatchObject({ x: 20, y: expect.closeTo(0, 9) })
    expect(synced.layers[0].styles?.bevel).toMatchObject({ angle: -180, altitude: 10 })
    expect(synced.layers[1].smart).toBe(inner)
    expect(synced.layers[1].smart?.globalLight).toEqual({ angle: 77, altitude: 22 })

    const again = synchronizeDocumentGlobalLight(synced, synced.globalLight!)
    expect(again).toBe(synced)
  })

  it('parses legacy absence without relighting and synchronizes only an explicit project master', () => {
    const layer = makeLayer({ styles: linkedStyles() })
    const legacy = { ...newDocument(), layers: [layer] }
    const parsedLegacy = parseProject(JSON.parse(JSON.stringify(legacy)))
    expect(parsedLegacy.globalLight).toBeUndefined()
    expect(parsedLegacy.layers[0].styles?.shadows[0]).toMatchObject({ x: 0, y: 20 })
    expect(parsedLegacy.layers[0].styles?.bevel.angle).toBe(90)

    const explicit = { ...legacy, globalLight: { angle: 0, altitude: 15 } }
    const parsedExplicit = parseProject(JSON.parse(JSON.stringify(explicit)))
    expect(parsedExplicit.globalLight).toEqual({ angle: 0, altitude: 15 })
    expect(parsedExplicit.layers[0].styles?.shadows[0]).toMatchObject({ x: -20, y: 0 })
    expect(parsedExplicit.layers[0].styles?.bevel).toMatchObject({ angle: 0, altitude: 15 })
  })

  it('derives legacy UI/export values from enabled linked effects and reports real conflicts', () => {
    const strokeOnly = normalizeStyles({
      strokes: [{ enabled: true, size: 2, color: '#ffffff', position: 'outside', opacity: 1 }],
    })!
    const first = makeLayer({ name: 'stroke only', styles: strokeOnly })
    const bevelOnly = normalizeStyles({
      bevel: { enabled: true, angle: 0, altitude: 22, useGlobalLight: true },
    })!
    const second = makeLayer({ name: 'bevel', styles: bevelOnly })
    const doc = { ...newDocument(), layers: [first, second] }
    // The disabled default Bevel settings inside the stroke-only style must not
    // mask the first actually enabled linked effect.
    expect(effectiveGlobalLight(doc)).toEqual({ angle: 0, altitude: 22 })
    expect(consistentGlobalLight(doc)).toEqual({ angle: 0, altitude: 22 })
    expect(hasConflictingLinkedGlobalLight(doc)).toBe(false)
    expect(countLinkedGlobalLightEffects(doc, true)).toBe(1)
    expect(countLinkedGlobalLightEffects(doc)).toBeGreaterThan(1) // latent linked Bevel settings also sync

    const conflictStyles = normalizeStyles({
      shadows: [{ enabled: true, x: 0, y: 10, useGlobalLight: true }],
    })!
    const conflict = { ...doc, layers: [...doc.layers, makeLayer({ styles: conflictStyles })] }
    expect(consistentGlobalLight(conflict)).toBeUndefined()
    expect(hasConflictingLinkedGlobalLight(conflict)).toBe(true)
  })

  it('keeps the style parser strict: only boolean true links a shadow', () => {
    expect(
      normalizeStyles({ shadows: [{ enabled: true, useGlobalLight: true }] })?.shadows[0]
        .useGlobalLight,
    ).toBe(true)
    expect(
      normalizeStyles({ shadows: [{ enabled: true, useGlobalLight: 'true' }] })?.shadows[0]
        .useGlobalLight,
    ).toBeUndefined()
    expect(
      normalizeStyles({ innerShadows: [{ enabled: true, useGlobalLight: 1 }] })?.innerShadows[0]
        .useGlobalLight,
    ).toBeUndefined()
  })

  it('synchronizes an action-applied linked style to the target document master', () => {
    const layer = makeLayer({ kind: 'text', text: 'Свет' })
    const doc = { ...newDocument(), globalLight: { angle: 0, altitude: 20 }, layers: [layer] }
    const incoming = normalizeStyles({
      shadows: [{ enabled: true, x: 0, y: 12, useGlobalLight: true }],
      bevel: { enabled: true, angle: 90, altitude: 44, useGlobalLight: true },
    })!
    const action: StudioAction = {
      id: 'global-light-style',
      name: 'Linked style',
      source: 'test',
      steps: [
        {
          name: 'style',
          enabled: true,
          command: { type: 'properties', values: { styles: incoming } },
        },
      ],
    }
    const result = runAction(doc, layer.id, action)
    expect(result.document.layers[0].styles?.shadows[0]).toMatchObject({ x: -12, y: 0 })
    expect(result.document.layers[0].styles?.bevel).toMatchObject({ angle: 0, altitude: 20 })
  })

  it('records a Global Light document change as an explicit unsupported action step', () => {
    const layer = makeLayer({ styles: linkedStyles() })
    const before = { ...newDocument(), layers: [layer] }
    const after = synchronizeDocumentGlobalLight(before, { angle: 0, altitude: 30 })
    const recording = recordEditorEvent(startRecording(before, layer.id, 'Свет'), {
      type: 'commit',
      before,
      after,
      label: 'Глобальный свет',
      selectedId: layer.id,
    })
    expect(recording.steps[0].unsupported).toMatch(/глобального света/)
    const action: StudioAction = {
      id: 'rec',
      name: recording.name,
      source: 'test',
      steps: recording.steps,
    }
    expect(actionBlockers(action)).toHaveLength(1)
  })

  it('exports linked shadow/Bevel flags and native PSD global resources', () => {
    const styles = normalizeStyles({
      shadows: [{ enabled: true, x: -20, y: 0, useGlobalLight: true }],
      innerShadows: [{ enabled: true, x: 0, y: 8 }],
      bevel: { enabled: true, angle: 0, altitude: 20, useGlobalLight: true },
    })!
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    expect(effects.dropShadow?.[0].useGlobalLight).toBe(true)
    expect(effects.innerShadow?.[0].useGlobalLight).toBe(false)
    expect(effects.bevel?.useGlobalLight).toBe(true)
    const psd = readPsd(
      writePsd({
        width: 4,
        height: 4,
        children: [{ name: 'fx', effects }],
        imageResources: {
          globalAngle: psdGlobalAngleResource(0),
          globalAltitude: psdGlobalAltitudeResource(20),
        },
      }),
      { useImageData: true },
    )
    expect(psd.imageResources?.globalAngle).toBe(0)
    expect(psd.imageResources?.globalAltitude).toBe(20)
    expect(psd.children?.[0].effects?.dropShadow?.[0].useGlobalLight).toBe(true)
  })

  it('lets PSD resources win over inconsistent linked descriptors on import', () => {
    const styles = normalizeStyles({
      shadows: [{ enabled: true, x: 10, y: 17.320508075688775, useGlobalLight: true }],
      bevel: { enabled: true, angle: 120, altitude: 30, useGlobalLight: true },
    })!
    const layer = readPsd(
      writePsd({
        width: 4,
        height: 4,
        children: [{ name: 'fx', effects: __psdStyleCodecForTests.exportStyles(styles) }],
        imageResources: { globalAngle: 132, globalAltitude: 44 },
      }),
      { useImageData: true },
    ).children![0]
    const warnings: string[] = []
    const back = __psdStyleCodecForTests.importStyles(
      layer,
      undefined,
      (message) => warnings.push(message),
      { angle: 132, altitude: 44 },
    )!
    expect(shadowLightAngle(back.shadows[0])).toBeCloseTo(132, 0)
    expect(shadowDistance(back.shadows[0])).toBeCloseTo(20, 0)
    expect(back.bevel).toMatchObject({ angle: 132, altitude: 44, useGlobalLight: true })
    expect(warnings.join(' ')).toMatch(/Глобальн/)
  })

  it('uses the real effects.psd global 132/30 over stored linked 120° descriptors', () => {
    const psd = readPsd(readFileSync('tests/fixtures/psd/effects.psd'), { useImageData: true })
    const master = globalLightFromPsdResources(psd.imageResources)
    expect(master).toEqual({ angle: 132, altitude: 30 })
    const byName = new Map((psd.children || []).map((layer) => [layer.name, layer]))
    const drop = byName.get('drop shadow')!
    const bevel = byName.get('bevel')!
    const inner = byName.get('inner shadow')!
    expect(drop.effects?.dropShadow?.[0]).toMatchObject({ useGlobalLight: true, angle: 120 })
    expect(bevel.effects?.bevel).toMatchObject({ useGlobalLight: true, angle: 120, altitude: 30 })
    expect(inner.effects?.innerShadow?.[0]).toMatchObject({ useGlobalLight: false, angle: 61 })

    const warnings: string[] = []
    const warn = (message: string) => warnings.push(message)
    const dropBack = __psdStyleCodecForTests.importStyles(drop, undefined, warn, master)!
    const bevelBack = __psdStyleCodecForTests.importStyles(bevel, undefined, warn, master)!
    const innerBack = __psdStyleCodecForTests.importStyles(inner, undefined, warn, master)!
    expect(dropBack.shadows[0].useGlobalLight).toBe(true)
    expect(shadowLightAngle(dropBack.shadows[0])).toBeCloseTo(132, 0)
    expect(shadowDistance(dropBack.shadows[0])).toBeCloseTo(5, 1)
    expect(bevelBack.bevel).toMatchObject({ angle: 132, altitude: 30, useGlobalLight: true })
    expect(innerBack.innerShadows[0].useGlobalLight).toBeUndefined()
    expect(shadowLightAngle(innerBack.innerShadows[0])).toBeCloseTo(61, 0)
    expect(warnings.join(' ')).toMatch(/Глобальн/)
  })
})
