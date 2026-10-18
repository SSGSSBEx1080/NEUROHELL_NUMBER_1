import { describe, expect, it } from 'vitest'
import {
  defaultPanelLayout,
  normalizePanelLayout,
  panelPreset,
  visiblePanelLayout,
} from '../../src/engine/panelLayout'
import { insertRepairLayer, repairPlacement } from '../../src/engine/repairPlacement'
import { makeLayer, newDocument } from '../../src/engine/document'
describe('Workspace geometry and explicit layout layer placement', () => {
  it('validates saved layouts, supports real presets and clamps windows to a smaller monitor', () => {
    expect(
      normalizePanelLayout({
        width: Infinity,
        split: -10,
        height: 100000,
        side: 'bad',
        tab: 'eval',
      }),
    ).toMatchObject({ width: 300, split: 0.25, height: 1600, side: 'right', tab: 'properties' })
    expect(panelPreset('layout')).toMatchObject({ tab: 'translation', width: 360, split: 0.66 })
    expect(panelPreset('type').split).toBeGreaterThan(panelPreset('retouch').split)
    const small = visiblePanelLayout(
      { ...defaultPanelLayout, floating: true, x: 10000, y: 10000 },
      { width: 1024, height: 600 },
    )
    expect(small.x + small.width).toBeLessThanOrEqual(1024)
    expect(small.y + small.height).toBeLessThanOrEqual(600)
  })
  it('places cleaning below only the trailing root type stack, with matching sampling', () => {
    const scan = makeLayer(),
      first = makeLayer({ kind: 'text' }),
      second = makeLayer({ kind: 'text' }),
      repair = makeLayer()
    const doc = { ...newDocument(), layers: [scan, first, second] }
    const { index, source } = repairPlacement(doc, true)
    expect(index).toBe(1)
    expect(source.layers).toEqual([scan])
    expect(insertRepairLayer(doc, repair, true).layers).toEqual([scan, repair, first, second])
    expect(insertRepairLayer(doc, repair, false).layers).toEqual([scan, first, second, repair])
    expect(doc.layers).toHaveLength(3)
  })
  it('never splits groups or silently moves an intermediate text layer', () => {
    const group = makeLayer({ kind: 'group' }),
      text = makeLayer({ kind: 'text', parentId: group.id }),
      scan = makeLayer(),
      oldText = makeLayer({ kind: 'text' })
    const doc = { ...newDocument(), layers: [oldText, scan, group, text] }
    expect(repairPlacement(doc, true).source).toBe(doc)
    expect(repairPlacement(doc, true).index).toBe(doc.layers.length)
    const clipped = makeLayer({ kind: 'text', clipping: true }),
      base = makeLayer({ kind: 'text' }),
      top = makeLayer({ kind: 'text', clipping: true })
    const bound = { ...newDocument(), layers: [scan, clipped] }
    expect(repairPlacement(bound, true).source).toBe(bound)
    expect(insertRepairLayer(bound, group, true).layers).toEqual([scan, clipped, group])
    const chained = { ...bound, layers: [scan, clipped, base, top] }
    expect(repairPlacement(chained, true).source.layers).toEqual([scan, clipped])
    expect(insertRepairLayer(chained, group, true).layers).toEqual([
      scan,
      clipped,
      group,
      base,
      top,
    ])
  })
})
