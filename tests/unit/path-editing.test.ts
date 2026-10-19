import { startRecording, recordEditorEvent } from '../../src/engine/actionRecorder'
import { parseActionCommand, runAction } from '../../src/engine/actions'
import { describe, expect, it } from 'vitest'
import { makeLayer, parseProject, newDocument } from '../../src/engine/document'
import { shapePaths, layerPoint, transformedPaths } from '../../src/engine/shapeGeometry'
import {
  assertEditablePath,
  changePathComponent,
  convertToPath,
  cubicPoint,
  joinPathEnds,
  movePathHandle,
  movePathNodes,
  nearestPathSegment,
  pathNodePosition,
  reframePath,
  removePathNodes,
  reversePath,
  setPathNodeMode,
  splitPathSegment,
} from '../../src/engine/pathEditing'
import type { Layer, ShapePath } from '../../src/types'
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 7)
  expect(a.y).toBeCloseTo(b.y, 7)
}
const curve = () =>
  makeLayer({ shape: 'ellipse', x: 80, y: 50, width: 210, height: 120, rotation: 34, flipX: true })
const node = (x: number, y: number) => ({ linked: false, points: [x, y, x, y, x, y] })
const pathLayer = (paths: ShapePath[]) =>
  makeLayer({ shape: 'path', width: 200, height: 100, shapePaths: paths })
describe('editable native paths', () => {
  it('converts primitives without changing any transformed control coordinates', () => {
    const source = curve(),
      converted = { ...source, ...convertToPath(source) }
    expect(transformedPaths(converted)).toEqual(transformedPaths(source))
    expect(converted.shape).toBe('path')
  })
  it('subdivides cubics exactly, including the closing segment', () => {
    for (const index of [0, 3]) {
      const before = curve(),
        old = shapePaths(before)[0],
        cut = 0.37,
        after = { ...before, ...splitPathSegment(before, { path: 0, index }, cut) },
        next = shapePaths(after)[0]
      expect(next.knots).toHaveLength(5)
      for (let i = 0; i <= 40; i++) {
        const t = i / 40,
          oldP = layerPoint(before, cubicPoint(old.knots[index], old.knots[(index + 1) % 4], t))
        const a = t <= cut ? next.knots[index] : next.knots[index + 1],
          b = t <= cut ? next.knots[index + 1] : next.knots[(index + 2) % 5],
          u = t <= cut ? t / cut : (t - cut) / (1 - cut)
        near(layerPoint(after, cubicPoint(a, b, u)), oldP)
      }
    }
  })
  it('moves selected nodes in document axes, retains others, and never mutates its input', () => {
    const source = curve(),
      snapshot = JSON.stringify(source),
      refs = [
        { path: 0, index: 1 },
        { path: 0, index: 3 },
      ],
      delta = { x: 23, y: -9 }
    const changed = { ...source, ...movePathNodes(source, refs, delta) }
    for (let i = 0; i < 4; i++) {
      const old = pathNodePosition(source, { path: 0, index: i })!,
        moved = refs.some((n) => n.index === i)
      near(pathNodePosition(changed, { path: 0, index: i })!, {
        x: old.x + (moved ? 23 : 0),
        y: old.y - (moved ? 9 : 0),
      })
    }
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('preserves document-space mask corners when a rotated/reflected shape is reframed', () => {
    const source = {
      ...curve(),
      mask: {
        src: 'data:image/png;base64,AA==',
        x: 90,
        y: 60,
        width: 90,
        height: 65,
        enabled: true,
        linked: true,
        density: 0.7,
        feather: 3,
        defaultColor: 255,
      },
    }
    const after = {
      ...source,
      ...movePathNodes(source, [{ path: 0, index: 0 }], { x: -40, y: -20 }),
    }
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const a = source.mask!,
        b = after.mask!
      near(
        layerPoint(source, { x: a.x - source.x + a.width * x, y: a.y - source.y + a.height * y }),
        layerPoint(after, { x: b.x - after.x + b.width * x, y: b.y - after.y + b.height * y }),
      )
    }
    expect(after.mask?.width).toBe(source.mask.width)
    expect(after.mask?.src).toBe(source.mask.src)
  })
  it('allows thin lines to become tall curves without invalid normalized coordinates or clipping', () => {
    const l = makeLayer({ shape: 'line', x: 15, y: 20, width: 240, height: 1 })
    const next = { ...l, ...movePathNodes(l, [{ path: 0, index: 1 }], { x: 0, y: 400 }) }
    expect(next.height).toBe(400)
    expect(next.shapePaths?.[0].open).toBe(true)
    const doc = newDocument()
    doc.layers = [next]
    expect(parseProject(doc).layers[0].shapePaths).toEqual(next.shapePaths)
  })
  it('linked handles keep opposite direction and previous opposite length; Alt breaks the link', () => {
    let l = curve()
    l = { ...l, ...setPathNodeMode(l, [{ path: 0, index: 1 }], 'smooth') }
    const anchor = pathNodePosition(l, { path: 0, index: 1 })!,
      oldIn = pathNodePosition(l, { path: 0, index: 1 }, 'in')!,
      target = { x: anchor.x + 28, y: anchor.y + 44 }
    const next = { ...l, ...movePathHandle(l, { path: 0, index: 1 }, 'out', target) }
    near(pathNodePosition(next, { path: 0, index: 1 }, 'out')!, target)
    const input = pathNodePosition(next, { path: 0, index: 1 }, 'in')!
    expect(Math.hypot(input.x - anchor.x, input.y - anchor.y)).toBeCloseTo(
      Math.hypot(oldIn.x - anchor.x, oldIn.y - anchor.y),
      7,
    )
    expect((input.x - anchor.x) * 44 - (input.y - anchor.y) * 28).toBeCloseTo(0, 7)
    const free = { ...l, ...movePathHandle(l, { path: 0, index: 1 }, 'out', target, true) }
    near(pathNodePosition(free, { path: 0, index: 1 }, 'in')!, oldIn)
    expect(free.shapePaths![0].knots[1].linked).toBe(false)
  })
  it('converts smooth nodes to corners and detaches without changing geometry', () => {
    const l = curve(),
      ref = { path: 0, index: 1 },
      a = pathNodePosition(l, ref)!
    const c = { ...l, ...setPathNodeMode(l, [ref], 'corner') }
    near(pathNodePosition(c, ref, 'in')!, a)
    near(pathNodePosition(c, ref, 'out')!, a)
    const detached = { ...l, ...setPathNodeMode(l, [ref], 'independent') }
    for (const part of ['anchor', 'in', 'out'] as const)
      near(pathNodePosition(detached, ref, part)!, pathNodePosition(l, ref, part)!)
  })
  it('finds a near segment in world space and rejects distant clicks', () => {
    const l = curve(),
      p = shapePaths(l)[0],
      target = layerPoint(l, cubicPoint(p.knots[1], p.knots[2], 0.42)),
      closest = nearestPathSegment(l, target, 3)!
    expect(closest.index).toBe(1)
    expect(closest.t).toBeCloseTo(0.42, 3)
    expect(nearestPathSegment(l, { x: -4000, y: 4000 }, 3)).toBeUndefined()
  })
  it('reverses open paths with handle ownership, without moving their curve', () => {
    const p = shapePaths(curve())[0]
    p.open = true
    const q = reversePath(p)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j <= 10; j++)
        near(
          cubicPoint(p.knots[i], p.knots[i + 1], j / 10),
          cubicPoint(q.knots[2 - i], q.knots[3 - i], 1 - j / 10),
        )
    expect(reversePath(q)).toEqual(p)
  })
  it('joins selected endpoints from independent components and closes an individual open path', () => {
    const l = pathLayer([
      { open: true, fillRule: 'even-odd', knots: [node(0, 0), node(0.4, 0)] },
      { open: true, fillRule: 'even-odd', knots: [node(0.5, 0.5), node(1, 1)] },
    ])
    const result = {
        ...l,
        ...joinPathEnds(l, [
          { path: 0, index: 0 },
          { path: 1, index: 1 },
        ]),
      },
      p = shapePaths(result)[0]
    expect(result.shapePaths).toHaveLength(1)
    expect(p.knots).toHaveLength(4)
    near(pathNodePosition(result, { path: 0, index: 0 })!, { x: 80, y: 0 })
    near(pathNodePosition(result, { path: 0, index: 3 })!, { x: 100, y: 50 })
    const closed = {
      ...result,
      ...joinPathEnds(result, [
        { path: 0, index: 0 },
        { path: 0, index: 3 },
      ]),
    }
    expect(closed.shapePaths![0].open).toBe(false)
  })
  it('deletes nodes and components safely, refusing an empty layer', () => {
    const l = curve(),
      result = removePathNodes(l, [{ path: 0, index: 1 }])
    expect(result.shapePaths![0].knots).toHaveLength(3)
    expect(() =>
      removePathNodes(
        l,
        [0, 1, 2, 3].map((index) => ({ path: 0, index })),
      ),
    ).toThrow('хотя бы две')
    const more = { ...l, ...changePathComponent(l, 0, 'duplicate') }
    expect(more.shapePaths).toHaveLength(2)
    expect(changePathComponent(more, 1, 'remove').shapePaths).toHaveLength(1)
  })
  it('keeps perspective, over-budget and malformed source data untouched instead of flattening it', () => {
    const l = {
      ...curve(),
      warp: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1.1, y: 1 },
        { x: 0, y: 1 },
      ] as Layer['warp'],
    }
    expect(() => convertToPath(l)).toThrow('сбрось перспективу')
    const many = pathLayer([
      {
        open: true,
        fillRule: 'non-zero',
        knots: Array.from({ length: 2049 }, (_, i) => node(i / 2049, 0)),
      },
    ])
    expect(() => assertEditablePath(many)).toThrow('2048')
    expect(() =>
      reframePath(curve(), [
        { open: true, fillRule: 'non-zero', knots: [node(0, 0), node(NaN, 2)] },
      ]),
    ).toThrow('Координаты')
  })
})

describe('native path action safety', () => {
  it('records and replays actual contour edits, not a raster preview', () => {
    const doc = newDocument(),
      source = curve()
    doc.layers = [source]
    const after = {
      ...doc,
      layers: [{ ...source, ...movePathNodes(source, [{ path: 0, index: 1 }], { x: 12, y: 8 }) }],
    }
    const recording = recordEditorEvent(startRecording(doc, source.id, 'Контур'), {
      type: 'commit',
      before: doc,
      after,
      label: 'Узел',
      selectedId: source.id,
    })
    expect(recording.steps.every((s) => !!s.command)).toBe(true)
    const replay = runAction(doc, source.id, {
      id: 'path-test',
      name: 'Contour',
      source: 'test',
      steps: recording.steps,
    }).document.layers[0]
    expect(replay.shape).toBe('path')
    const expected = transformedPaths(after.layers[0]),
      actual = transformedPaths(replay)
    for (let i = 0; i < expected[0].knots.length; i++)
      for (let j = 0; j < 6; j++)
        expect(actual[0].knots[i].points[j]).toBeCloseTo(expected[0].knots[i].points[j], 6)
  })
  it('rejects malformed or oversized action paths and prevents applying them to text', () => {
    expect(() =>
      parseActionCommand({ type: 'properties', values: { shape: 'path', shapePaths: [] } }),
    ).toThrow()
    expect(() =>
      parseActionCommand({
        type: 'properties',
        values: {
          shapePaths: [
            {
              open: true,
              fillRule: 'non-zero',
              knots: Array.from({ length: 2049 }, () => node(0, 0)),
            },
          ],
        },
      }),
    ).toThrow('2048')
    const command = parseActionCommand({ type: 'properties', values: convertToPath(curve()) })!
    const doc = newDocument(),
      text = makeLayer({ kind: 'text', text: 'Unchanged' })
    doc.layers = [text]
    expect(() =>
      runAction(doc, text.id, {
        id: 'type-test',
        name: 'Guard',
        source: 'test',
        steps: [{ name: 'Path', enabled: true, command }],
      }),
    ).toThrow('векторный слой')
  })
})
