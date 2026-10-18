import { describe, expect, it } from 'vitest'
import { demoDocument, hitTest, localPoint, makeLayer, newDocument, parseProject } from '../../src/engine/document'
import { processPixels } from '../../src/engine/pixels'
import { defaultStyles, normalizeStyles } from '../../src/engine/styles'
import { actionBlockers, builtinActions, parseActionSet, runAction } from '../../src/engine/actions'
import { parseAtn } from '../../src/engine/atn'
import { validatePsdHeader } from '../../src/engine/psdHeader'
import { atnFixture, psdHeaderFixture } from '../fixtures'

describe('Versioned document format', () => {
  it('roundtrips the demo, styles and native text', () => { const d = demoDocument(); d.layers[2].styles = defaultStyles(); const parsed = parseProject(JSON.parse(JSON.stringify(d))); expect(parsed).toMatchObject(d); expect(parseProject(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed) })
  it('blocks remote images, SVG, huge dimensions and malformed versions', () => {
    for (const src of ['https://example.com/tracker.png', 'data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', 'file:///secret']) expect(() => parseProject({ ...newDocument(), layers: [makeLayer({ kind: 'image', src })] })).toThrow()
    expect(() => parseProject({ ...newDocument(), width: 999999 })).toThrow()
    expect(() => parseProject({ ...newDocument(), version: 2 })).toThrow()
    expect(() => parseProject({ ...newDocument(), width: 1.5 })).toThrow()
  })
  it('assigns unique IDs and sanitizes editable values', () => {
    const layer = makeLayer({ id: 'same', rotation: Infinity, opacity: -100, fontSize: 99999 })
    const d = parseProject({ ...newDocument(), layers: [layer, layer] })
    expect(d.layers[0].id).not.toBe(d.layers[1].id); expect(d.layers[0].opacity).toBe(0); expect(d.layers[0].rotation).toBe(0); expect(d.layers[0].fontSize).toBe(1000)
  })
})
describe('Selection geometry', () => {
  it('maps rotated coordinates and ignores locked/hidden layers', () => { const l = makeLayer({ x: 10, y: 20, width: 100, height: 50, rotation: 90 }); expect(localPoint(l, { x: 60, y: 45 })).toEqual({ x: 50, y: 25 }); expect(hitTest(l, { x: 60, y: 85 })).toBe(true); expect(hitTest(l, { x: 15, y: 45 })).toBe(false); expect(hitTest({ ...l, locked: true }, { x: 60, y: 45 })).toBe(false) })
  it('hit tests ellipses rather than their bounding boxes', () => { const l = makeLayer({ shape: 'ellipse', width: 100, height: 100 }); expect(hitTest(l, { x: 1, y: 1 })).toBe(false); expect(hitTest(l, { x: 50, y: 50 })).toBe(true) })
})
const sample = (w: number, h: number, color = [255, 255, 255, 255]) => new Uint8ClampedArray(Array.from({ length: w * h }, () => color).flat())
describe('Local pixel operations', () => {
  it('removes connected white background and preserves a red subject', () => {
    const pixels = sample(7, 7); pixels.set([255, 0, 0, 255], (3 * 7 + 3) * 4)
    const output = processPixels({ operation: 'background', width: 7, height: 7, pixels, tolerance: 10 })
    expect(output[3]).toBe(0); expect([...output.slice(96, 100)]).toEqual([255, 0, 0, 255]); expect(pixels[3]).toBe(255)
  })
  it('magic erase only visits a connected region', () => { const pixels = sample(5, 5); for (let y = 0; y < 5; y++) pixels.set([0, 0, 0, 255], (y * 5 + 2) * 4); const out = processPixels({ operation: 'wand', width: 5, height: 5, pixels, x: 0, y: 2, tolerance: 0 }); expect(out[3]).toBe(0); expect(out[4 * 4 + 3]).toBe(255) })
  it('does not erase an isolated subject with all-transparent corners', () => { const pixels = sample(5, 5, [0, 0, 0, 0]); pixels.set([255, 0, 0, 255], 12 * 4); expect(processPixels({ operation: 'background', width: 5, height: 5, pixels })[51]).toBe(255) })
  it('clips rectangular erasing to valid pixels', () => { const out = processPixels({ operation: 'erase', width: 4, height: 4, pixels: sample(4, 4), rect: { x: -1, y: -1, width: 3, height: 3 } }); expect(out[3]).toBe(0); expect(out[(3 * 4 + 3) * 4 + 3]).toBe(255) })
  it('fills from the boundary and refuses a full-image fill', () => { const pixels = sample(5, 5, [42, 90, 120, 255]); pixels.set([255, 0, 0, 255], 12 * 4); const out = processPixels({ operation: 'fill', width: 5, height: 5, pixels, rect: { x: 2, y: 2, width: 1, height: 1 } }); expect([...out.slice(48, 52)]).toEqual([42, 90, 120, 255]); expect(() => processPixels({ operation: 'fill', width: 5, height: 5, pixels, rect: { x: 0, y: 0, width: 5, height: 5 } })).toThrow() })
  it('rejects malformed pixel buffers', () => { expect(() => processPixels({ operation: 'background', width: 5, height: 5, pixels: sample(1, 1) })).toThrow() })
})
describe('Layer styles', () => {
  it('bounds blur, stroke and opacity while rejecting CSS injection', () => { const s = normalizeStyles({ fillOpacity: -10, stroke: { size: 99999, color: 'url(https://tracking)', position: 'somewhere', enabled: true }, shadow: { blur: Infinity, opacity: 999 }, overlay: { color: '#abcdef' } })!; expect(s.stroke.size).toBe(80); expect(s.stroke.color).toBe('#ffffff'); expect(s.stroke.position).toBe('outside'); expect(s.shadow.blur).toBe(20); expect(s.shadow.opacity).toBe(1); expect(s.fillOpacity).toBe(0); expect(s.overlay.color).toBe('#abcdef') })
})
describe('Actions and ATN', () => {
  it('reads a v16 set with supported and blocked operations', () => { const actions = parseAtn(atnFixture()); expect(actions).toHaveLength(2); expect(actions[0].name).toBe('Безопасный негатив'); expect(actions[0].steps[0].command).toEqual({ type: 'invert' }); expect(actionBlockers(actions[1])).toHaveLength(1) })
  it('never partially runs an action with unsupported steps', () => { const d = demoDocument(), before = JSON.stringify(d); expect(() => runAction(d, d.layers[0].id, parseAtn(atnFixture())[1])).toThrow(/не будет запущена/); expect(JSON.stringify(d)).toBe(before) })
  it('applies an operation atomically without mutating the source', () => { const d = demoDocument(), before = JSON.stringify(d); const r = runAction(d, d.layers[0].id, builtinActions[0]); expect(r.document.layers[0].adjustments.grayscale).toBe(100); expect(JSON.stringify(d)).toBe(before) })
  it('duplicates and flips while preserving the original', () => { const d = demoDocument(); const out = runAction(d, d.layers[0].id, builtinActions[5]); expect(out.document.layers).toHaveLength(8); expect(out.document.layers.find(l => l.id === out.selectedId)?.flipX).toBe(true); expect(d.layers[0].flipX).toBeUndefined() })
  it('rejects locked layers, malformed and truncated action files', () => { const d = demoDocument(); d.layers[0].locked = true; expect(() => runAction(d, d.layers[0].id, builtinActions[0])).toThrow(); expect(() => parseAtn(atnFixture().slice(0, 20))).toThrow(); expect(() => parseAtn(new ArrayBuffer(8))).toThrow(); expect(() => parseActionSet({ version: 2, actions: [] })).toThrow() })
  it('does not turn an imported script into executable code', () => { const a = parseActionSet({ version: 1, actions: [{ name: 'Unsafe', steps: [{ name: 'Run', command: { type: 'eval', code: 'alert(1)' } }] }] }); expect(actionBlockers(a[0])).toHaveLength(1) })
  it('roundtrips its own exported action set', () => { const actions = parseActionSet(JSON.parse(JSON.stringify({ version: 1, actions: builtinActions }))); expect(actions[0].steps).toEqual(builtinActions[0].steps); expect(actions[0].shortcut).toEqual(builtinActions[0].shortcut) })
})
describe('PSD/PSB resource guard', () => {
  it('recognizes both headers', () => { expect(validatePsdHeader(psdHeaderFixture(1)).psb).toBe(false); expect(validatePsdHeader(psdHeaderFixture(2)).psb).toBe(true) })
  it('rejects oversized documents, unsupported color and bit depth before decoding', () => { expect(() => validatePsdHeader(psdHeaderFixture(2, 60000))).toThrow(/4096/); expect(() => validatePsdHeader(psdHeaderFixture(1, 300, 16))).toThrow(/8 бит/); expect(() => validatePsdHeader(psdHeaderFixture(1, 300, 8, 4))).toThrow(/CMYK/); expect(() => validatePsdHeader(new ArrayBuffer(10))).toThrow() })
})
