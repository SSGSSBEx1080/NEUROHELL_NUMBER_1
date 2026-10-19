import { sameEmbeddedContent, sameVisual } from '../../src/engine/psdSource'
import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import {
  defaultLayout,
  normalizeLayout,
  createGuideLayout,
  transformLayout,
  nativeLayout,
  sameNativeLayout,
  layoutTargets,
  snapBounds,
  snapPoint,
} from '../../src/engine/layout'
import { arrangeLayers, arrangementBounds, type ArrangeMode } from '../../src/engine/arrange'
import { makeLayer, newDocument, parseProject } from '../../src/engine/document'
initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
describe('document guides and non-printing layout', () => {
  it('validates IDs, positions, grid budgets and 1/32 px native precision', () => {
    const layout = normalizeLayout({
      guides: [
        { id: 'a', axis: 'x', position: 10.1 },
        { id: 'a', axis: 'y', position: 50 },
        { axis: 'z', position: 8 },
        { axis: 'x', position: -1 },
      ],
      gridSize: 0,
      gridSizeY: Infinity,
      subdivisions: 100,
    })
    expect(layout.guides).toHaveLength(2)
    expect(layout.guides[0].position).toBe(10.09375)
    expect(layout.guides[0].id).not.toBe(layout.guides[1].id)
    expect(layout.gridSize).toBe(4)
    expect(layout.subdivisions).toBe(16)
    expect(
      normalizeLayout({
        guides: Array.from({ length: 201 }, (_, i) => ({ axis: 'x', position: i })),
      }).guides,
    ).toHaveLength(200)
  })
  it('generates margins, columns, rows and gutters without duplicate coincident lines', () => {
    const guides = createGuideLayout(220, 120, {
      columns: 2,
      rows: 1,
      gutter: 20,
      marginLeft: 10,
      marginRight: 10,
      marginTop: 20,
      marginBottom: 20,
    })
    expect(guides.map((g) => [g.axis, g.position])).toEqual([
      ['x', 10],
      ['x', 100],
      ['x', 120],
      ['x', 210],
      ['y', 20],
      ['y', 100],
    ])
    expect(
      createGuideLayout(300, 300, {
        columns: 3,
        rows: 0,
        gutter: 0,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
      }),
    ).toHaveLength(4)
    expect(() =>
      createGuideLayout(10, 10, {
        columns: 2,
        rows: 1,
        gutter: 20,
        marginLeft: 10,
        marginRight: 10,
        marginTop: 0,
        marginBottom: 0,
      }),
    ).toThrow()
  })
  it('maps positions when resizing/cropping, keeps visual-only switches out of native resource comparisons', () => {
    const layout = {
      ...defaultLayout(),
      guides: [
        { id: 'a', axis: 'x' as const, position: 10 },
        { id: 'b', axis: 'y' as const, position: 20 },
      ],
    }
    expect(transformLayout(layout, 2, 3, 4, 5)?.guides.map((g) => g.position)).toEqual([24, 65])
    expect(transformLayout(layout, 1, 1, -11, 0)?.guides).toHaveLength(1)
    expect(
      sameNativeLayout(layout, {
        ...layout,
        locked: true,
        showGuides: false,
        guideColor: '#ff0000',
      }),
    ).toBe(true)
    expect(sameNativeLayout(layout, { ...layout, gridSize: 32 })).toBe(false)
    const doc = newDocument(200, 120)
    doc.layout = layout
    expect(parseProject(JSON.parse(JSON.stringify(doc))).layout).toEqual(layout)
  })
  it('writes native PSD grid/guide resource, readable without XMP', () => {
    const layout = {
      ...defaultLayout(),
      gridSize: 32,
      gridSizeY: 48,
      guides: [
        { id: 'x', axis: 'x' as const, position: 12.25 },
        { id: 'y', axis: 'y' as const, position: 28.125 },
      ],
    }
    const bytes = writePsd({
      width: 2,
      height: 1,
      imageData: { width: 2, height: 1, data: new Uint8ClampedArray(8) },
      imageResources: { gridAndGuidesInformation: nativeLayout(layout) },
    })
    expect(readPsd(bytes, { useImageData: true }).imageResources?.gridAndGuidesInformation).toEqual(
      {
        grid: { horizontal: 1024, vertical: 1536 },
        guides: [
          { location: 12.25, direction: 'vertical' },
          { location: 28.125, direction: 'horizontal' },
        ],
      },
    )
  })
  it('snaps actual bounds and endpoints by screen-space tolerance, with separate grid axes', () => {
    const doc = newDocument(200, 120),
      layout = { ...defaultLayout(), guides: [{ id: 'a', axis: 'x' as const, position: 100 }] }
    expect(layoutTargets(doc, layout).x).toContain(100)
    expect(
      snapBounds({ x: 90, y: 20, width: 15, height: 10 }, { x: [100], y: [] }, 8),
    ).toMatchObject({ dx: 2.5, dy: 0, x: 100, y: null })
    expect(snapPoint({ x: 17, y: 19 }, { x: [], y: [] }, 8, { x: 16, y: 20 })).toEqual({
      x: 16,
      y: 20,
    })
    expect(snapPoint({ x: 40, y: 40 }, { x: [50], y: [] }, 8)).toEqual({ x: 40, y: 40 })
    expect(snapPoint({ x: 40, y: 40 }, { x: [50], y: [] }, 8 / 0.5)).toEqual({ x: 50, y: 40 })
  })
})
const document = () => {
  const doc = newDocument(200, 100)
  doc.layers = [
    makeLayer({ x: 10, y: 40, width: 20, height: 10 }),
    makeLayer({ x: 60, y: 10, width: 40, height: 30 }),
    makeLayer({ x: 140, y: 70, width: 20, height: 20 }),
  ]
  return doc
}
describe('atomic layer arrangement', () => {
  it.each(['left', 'center-x', 'right', 'top', 'center-y', 'bottom'] as ArrangeMode[])(
    '%s respects canvas anchors and does not mutate source geometry',
    (mode) => {
      const doc = document(),
        before = JSON.stringify(doc),
        result = arrangeLayers(
          doc,
          doc.layers.map((l) => l.id),
          mode,
          'canvas',
        )
      for (const l of result.layers) {
        if (mode === 'left') expect(l.x).toBe(0)
        if (mode === 'right') expect(l.x + l.width).toBe(200)
        if (mode === 'center-x') expect(l.x + l.width / 2).toBe(100)
        if (mode === 'top') expect(l.y).toBe(0)
        if (mode === 'bottom') expect(l.y + l.height).toBe(100)
        if (mode === 'center-y') expect(l.y + l.height / 2).toBe(50)
        expect(l.kind).toBe('shape')
      }
      expect(JSON.stringify(doc)).toBe(before)
    },
  )
  it('distributes centers and equal gaps between outer bounds', () => {
    const doc = document()
    doc.layers = [
      makeLayer({ x: 0, width: 20 }),
      makeLayer({ x: 30, width: 40 }),
      makeLayer({ x: 100, width: 10 }),
    ]
    const ids = doc.layers.map((l) => l.id)
    expect(arrangeLayers(doc, ids, 'gaps-x').layers.map((l) => l.x)).toEqual([0, 40, 100])
    expect(arrangeLayers(doc, ids, 'distribute-x').layers.map((l) => l.x + l.width / 2)).toEqual([
      10, 57.5, 105,
    ])
  })
  it('moves group+child selection only once and keeps linked masks with their actual owner', () => {
    const doc = newDocument(200, 120),
      group = makeLayer({ kind: 'group' }),
      child = makeLayer({
        parentId: group.id,
        x: 20,
        y: 10,
        width: 40,
        height: 30,
        mask: {
          src: 'mask',
          x: 20,
          y: 10,
          width: 40,
          height: 30,
          enabled: true,
          linked: true,
          density: 1,
          feather: 0,
          defaultColor: 0,
        },
      })
    doc.layers = [group, child]
    expect(arrangementBounds(doc, group)).toEqual({ x: 20, y: 10, width: 40, height: 30 })
    const result = arrangeLayers(doc, [group.id, child.id], 'right', 'canvas')
    expect(result.layers[1]).toMatchObject({ x: 160, mask: { x: 160 } })
    expect(child.x).toBe(20)
  })
  it('rejects locked subtrees, standalone adjustments and incomplete distributions without partial edits', () => {
    const doc = document(),
      ids = doc.layers.map((l) => l.id),
      before = JSON.stringify(doc)
    expect(() => arrangeLayers(doc, ids.slice(0, 2), 'gaps-x')).toThrow('трёх')
    expect(() =>
      arrangeLayers(
        { ...doc, layers: doc.layers.map((l, i) => (i ? l : { ...l, locked: true })) },
        ids,
        'left',
        'canvas',
      ),
    ).toThrow('заблок')
    expect(() =>
      arrangeLayers(
        { ...doc, layers: [{ ...doc.layers[0], kind: 'adjustment' }] },
        [ids[0]],
        'left',
        'canvas',
      ),
    ).toThrow('границ')
    expect(JSON.stringify(doc)).toBe(before)
  })
})

it('embedded metadata is semantically different even when its pixels are unchanged', () => {
  const before = newDocument(200, 120)
  before.layers = [makeLayer({ kind: 'text', text: 'Text', name: 'Original' })]
  const renamed = { ...before, layers: [{ ...before.layers[0], name: 'New native layer name' }] }
  const guides = {
    ...before,
    layout: { ...defaultLayout(), guides: [{ id: 'g', axis: 'x' as const, position: 10 }] },
  }
  expect(sameVisual(before, renamed)).toBe(true)
  expect(sameVisual(before, guides)).toBe(true)
  expect(sameEmbeddedContent(before, renamed)).toBe(false)
  expect(sameEmbeddedContent(before, guides)).toBe(false)
  expect(
    sameEmbeddedContent(before, { ...before, id: 'session-id', sourceId: 'local-cache' }),
  ).toBe(true)
})
