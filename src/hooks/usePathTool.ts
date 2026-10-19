import { useEffect, useRef, useState } from 'react'
import type { Editor } from './useEditor'
import type { EditorDocument, Layer, Point, ShapePath, Tool, ToolSettings } from '../types'
import { MAX_LAYERS } from '../types'
import { effectiveLayers, hitTest, isLayerLocked, makeLayer } from '../engine/document'
import { shapePaths } from '../engine/shapeGeometry'
import {
  MAX_EDIT_NODES,
  assertEditablePath,
  changePathComponent,
  convertToPath,
  joinPathEnds,
  movePathHandle,
  movePathNodes,
  nearestPathSegment,
  nodeKey,
  pathNodePosition,
  pathTools,
  reframePath,
  removePathNodes,
  sameNode,
  setPathNodeMode,
  splitPathSegment,
  type NodeMode,
  type NodePart,
  type PathNode,
} from '../engine/pathEditing'
import { combineSelection, gestureSelectionMode } from '../engine/selection'
import { pathSelection } from '../engine/pathSelection'
interface Modifiers {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}
interface Draft {
  knots: ShapePath['knots']
  redo: ShapePath['knots']
  previousId: string | null
}
type Gesture =
  | { kind: 'pen'; documentId: string; base: Draft; before?: Draft; anchor: Point }
  | {
      kind: 'nodes'
      before: EditorDocument
      layer: Layer
      start: Point
      nodes: PathNode[]
      part: NodePart
      moved: boolean
    }
  | { kind: 'marquee'; layer: Layer; start: Point; end: Point; previous: PathNode[]; add: boolean }
const blankNode = (p: Point) => ({ linked: false, points: [p.x, p.y, p.x, p.y, p.x, p.y] })
const rect = (a: Point, b: Point) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})
export function usePathTool({
  editor,
  tool,
  setTool,
  settings,
  disabled,
  onToast,
  onActivate,
}: {
  editor: Editor
  tool: Tool
  setTool: (t: Tool) => void
  settings: ToolSettings
  disabled: boolean
  onToast: (s: string) => void
  onActivate: () => void
}) {
  const drafts = useRef(new Map<string, Draft>()),
    gesture = useRef<Gesture | undefined>(undefined),
    [revision, redraw] = useState(0),
    [hover, setHover] = useState<Point | null>(null),
    [selection, setSelection] = useState<{ layerId: string; nodes: PathNode[] }>({
      layerId: '',
      nodes: [],
    })
  const doc = editor.document,
    layer = doc.layers.find((l) => l.id === editor.selectedId),
    active = pathTools.includes(tool),
    draft = drafts.current.get(doc.id),
    paths = layer?.kind === 'shape' ? shapePaths(layer) : [],
    nodes =
      selection.layerId === layer?.id
        ? selection.nodes.filter((n) => paths[n.path]?.knots[n.index])
        : []
  const paint = () => redraw((v) => v + 1)
  const setDraft = (id: string, next: Draft | undefined) => {
    drafts.current.delete(id)
    if (next) drafts.current.set(id, next)
    while (drafts.current.size > 6) drafts.current.delete(drafts.current.keys().next().value!)
    paint()
  }
  const pick = (id: string, list: PathNode[]) => setSelection({ layerId: id, nodes: list })
  const currentLayer = () => {
    const d = editor.documentRef.current,
      l = d.layers.find((l) => l.id === editor.selectedId)
    if (!l || isLayerLocked(d, l.id) || !l.visible)
      throw new Error('Выбери видимую незаблокированную фигуру')
    assertEditablePath(l)
    return l
  }
  const attempt = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Не удалось изменить контур')
    }
  }
  const edit = (operation: (l: Layer) => Partial<Layer>, label: string, temporary = false) =>
    attempt(() => {
      if (disabled) return
      const l = currentLayer()
      editor.patchLayer(l.id, operation(l), label, temporary)
    })
  const activate = () =>
    attempt(() => {
      currentLayer()
      setTool('node')
      onActivate()
    })
  const finishDraft = (closed = false): Layer | undefined => {
    let result: Layer | undefined
    attempt(() => {
      const d = editor.documentRef.current,
        pending = drafts.current.get(d.id)
      if (!pending || pending.knots.length < 2) throw new Error('Поставь хотя бы две опорные точки')
      if (d.layers.length >= MAX_LAYERS) throw new Error('В документе уже 100 слоёв')
      const base = makeLayer({
        kind: 'shape',
        shape: 'path',
        name: `Контур ${d.layers.filter((l) => l.shape === 'path').length + 1}`,
        width: d.width,
        height: d.height,
        color: settings.color,
        shapeFill: closed && settings.shapeFill,
        strokeColor: settings.color,
        strokeWidth: closed && settings.shapeFill ? 0 : 2,
        strokeAlign: 'center',
        strokeCap: 'round',
        strokeJoin: 'round',
      })
      result = {
        ...base,
        ...reframePath(base, [
          { open: !closed, fillRule: 'non-zero', operation: 'combine', knots: pending.knots },
        ]),
      }
      const added = result
      editor.change((d) => ({ ...d, layers: [...d.layers, added] }), 'Рисование пером')
      editor.setSelectedId(added.id)
      pick(added.id, [{ path: 0, index: added.shapePaths![0].knots.length - 1 }])
      setDraft(d.id, undefined)
      gesture.current = undefined
      setHover(null)
      setTool('node')
      onActivate()
    })
    return result
  }
  const cancelDraft = () => {
    const d = editor.documentRef.current,
      pending = drafts.current.get(d.id)
    setDraft(d.id, undefined)
    gesture.current = undefined
    setHover(null)
    if (pending && d.layers.some((l) => l.id === pending.previousId))
      editor.setSelectedId(pending.previousId)
  }
  const cancelGesture = () => {
    const g = gesture.current
    if (!g) return false
    gesture.current = undefined
    if (g.kind === 'nodes' && g.moved && editor.documentRef.current.id === g.before.id)
      editor.change(() => g.before, '', true)
    if (g.kind === 'pen') setDraft(g.documentId, g.before)
    paint()
    return true
  }
  const toSelection = (mods?: Modifiers) =>
    attempt(() => {
      const l = tool === 'pen' && drafts.current.get(doc.id) ? finishDraft(false) : currentLayer()
      if (!l) return
      const d = editor.documentRef.current,
        next = pathSelection(l, d.width, d.height)
      editor.setPixelSelection(
        combineSelection(
          editor.pixelSelection,
          next,
          mods
            ? gestureSelectionMode(mods, settings.selectionMode)
            : settings.selectionMode || 'replace',
          d.width,
          d.height,
        ),
        false,
        'Контур в выделение',
      )
    })
  const selectAll = () =>
    attempt(() => {
      const l = currentLayer()
      pick(
        l.id,
        shapePaths(l).flatMap((p, path) => p.knots.map((_, index) => ({ path, index }))),
      )
    })
  const mode = (value: NodeMode) => {
    if (nodes.length) edit((l) => setPathNodeMode(l, nodes, value), 'Тип опорных точек')
  }
  const remove = () => {
    if (nodes.length) {
      edit((l) => removePathNodes(l, nodes), 'Удаление опорных точек')
      if (layer) pick(layer.id, [])
    }
  }
  const component = (index: number, operation: 'reverse' | 'toggle' | 'duplicate' | 'remove') => {
    edit((l) => changePathComponent(l, index, operation), 'Изменение компонента контура')
    if (layer) pick(layer.id, [])
  }
  const down = (point: Point, e: Modifiers & { target: EventTarget | null }, scale: number) => {
    if (!active || disabled) return false
    attempt(() => {
      if (tool === 'pen') {
        const previous = drafts.current.get(doc.id),
          first = previous?.knots[0],
          last = previous?.knots.at(-1)
        if (
          first &&
          previous!.knots.length >= 2 &&
          Math.hypot(point.x - first.points[2], point.y - first.points[3]) < 8 / scale
        ) {
          finishDraft(true)
          return
        }
        if (last && Math.hypot(point.x - last.points[2], point.y - last.points[3]) < 1 / scale)
          return
        if ((previous?.knots.length || 0) >= MAX_EDIT_NODES)
          throw new Error(`До ${MAX_EDIT_NODES} точек в контуре`)
        let p = point
        if (last && e.shiftKey) {
          const dx = p.x - last.points[2],
            dy = p.y - last.points[3],
            a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
            r = Math.hypot(dx, dy)
          p = { x: last.points[2] + Math.cos(a) * r, y: last.points[3] + Math.sin(a) * r }
        }
        const next: Draft = {
          knots: [...(previous?.knots || []), blankNode(p)],
          redo: [],
          previousId: previous?.previousId ?? editor.selectedId,
        }
        setDraft(doc.id, next)
        editor.setSelectedId(null)
        gesture.current = {
          kind: 'pen',
          documentId: doc.id,
          base: next,
          before: previous,
          anchor: p,
        }
        return
      }
      let l = layer
      const el = e.target instanceof Element ? e.target.closest('[data-node-index]') : null
      if (!el) {
        const hit = [...effectiveLayers(doc)]
          .reverse()
          .find((v) => v.kind === 'shape' && hitTest(v, point))
        if (hit && hit.id !== l?.id) {
          l = hit
          editor.setSelectedId(hit.id)
          pick(hit.id, [])
          onActivate()
        }
      }
      if (!l || l.kind !== 'shape') {
        onToast('Выбери фигуру в слоях или создай контур пером P')
        return
      }
      if (isLayerLocked(doc, l.id) || !l.visible)
        throw new Error('Фигура или её группа заблокирована либо скрыта')
      assertEditablePath(l)
      const ref: PathNode | undefined = el
          ? {
              path: Number(el.getAttribute('data-node-path')),
              index: Number(el.getAttribute('data-node-index')),
            }
          : undefined,
        part = (el?.getAttribute('data-node-part') || 'anchor') as NodePart,
        current = selection.layerId === l.id ? selection.nodes : []
      if (ref && shapePaths(l)[ref.path]?.knots[ref.index]) {
        if (tool === 'delete-anchor' || ((e.ctrlKey || e.metaKey) && part === 'anchor')) {
          editor.patchLayer(l.id, removePathNodes(l, [ref]), 'Удаление опорной точки')
          pick(l.id, [])
          return
        }
        if (tool === 'convert-anchor' || (e.altKey && part === 'anchor')) {
          const k = shapePaths(l)[ref.path].knots[ref.index],
            curved =
              k.points[0] !== k.points[2] ||
              k.points[1] !== k.points[3] ||
              k.points[4] !== k.points[2] ||
              k.points[5] !== k.points[3]
          editor.patchLayer(
            l.id,
            setPathNodeMode(l, [ref], curved ? 'corner' : 'smooth'),
            'Тип опорной точки',
          )
          pick(l.id, [ref])
          return
        }
        const list =
          e.shiftKey && part === 'anchor'
            ? current.some((n) => sameNode(n, ref))
              ? current.filter((n) => !sameNode(n, ref))
              : [...current, ref]
            : part === 'anchor' && current.some((n) => sameNode(n, ref))
              ? current
              : [ref]
        pick(l.id, list)
        if (list.length)
          gesture.current = {
            kind: 'nodes',
            before: doc,
            layer: l,
            start: point,
            nodes: list,
            part,
            moved: false,
          }
        return
      }
      const segment = nearestPathSegment(l, point, 8 / scale)
      if (segment && (tool === 'add-anchor' || e.ctrlKey || e.metaKey)) {
        editor.patchLayer(l.id, splitPathSegment(l, segment, segment.t), 'Добавление опорной точки')
        pick(l.id, [{ path: segment.path, index: segment.index + 1 }])
        return
      }
      if (segment && tool === 'node') {
        const size = shapePaths(l)[segment.path].knots.length,
          list = [
            { path: segment.path, index: segment.index },
            { path: segment.path, index: (segment.index + 1) % size },
          ]
        pick(l.id, list)
        gesture.current = {
          kind: 'nodes',
          before: doc,
          layer: l,
          start: point,
          nodes: list,
          part: 'anchor',
          moved: false,
        }
        return
      }
      if (tool === 'node') {
        gesture.current = {
          kind: 'marquee',
          layer: l,
          start: point,
          end: point,
          previous: current,
          add: e.shiftKey,
        }
        paint()
      } else onToast(tool === 'add-anchor' ? 'Нажми на сегмент контура' : 'Нажми на опорную точку')
    })
    return true
  }
  const move = (point: Point, e: Modifiers) => {
    const g = gesture.current
    if (!g) {
      if (tool === 'pen' && draft) setHover(point)
      return false
    }
    if (disabled) return true
    attempt(() => {
      if (g.kind === 'pen') {
        if (editor.documentRef.current.id !== g.documentId) return
        let dx = point.x - g.anchor.x,
          dy = point.y - g.anchor.y
        if (e.shiftKey) {
          const a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
            r = Math.hypot(dx, dy)
          dx = Math.cos(a) * r
          dy = Math.sin(a) * r
        }
        const knots = g.base.knots.map((k, i) =>
          i === g.base.knots.length - 1
            ? {
                linked: !e.altKey,
                points: [
                  g.anchor.x - (e.altKey ? 0 : dx),
                  g.anchor.y - (e.altKey ? 0 : dy),
                  g.anchor.x,
                  g.anchor.y,
                  g.anchor.x + dx,
                  g.anchor.y + dy,
                ],
              }
            : k,
        )
        setDraft(g.documentId, { ...g.base, knots })
        return
      }
      if (g.kind === 'marquee') {
        g.end = point
        paint()
        return
      }
      if (editor.documentRef.current.id !== g.before.id) return
      const delta = { x: point.x - g.start.x, y: point.y - g.start.y }
      if (Math.hypot(delta.x, delta.y) < 0.01 && !g.moved) return
      if (e.shiftKey && g.part === 'anchor') {
        if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0
        else delta.x = 0
      }
      const patch =
        g.part === 'anchor'
          ? movePathNodes(g.layer, g.nodes, delta)
          : movePathHandle(g.layer, g.nodes[0], g.part, point, e.altKey)
      editor.patchLayer(g.layer.id, patch, '', true)
      g.moved = true
    })
    return true
  }
  const up = () => {
    const g = gesture.current
    gesture.current = undefined
    if (!g) return false
    if (g.kind === 'nodes' && g.moved && editor.documentRef.current.id === g.before.id)
      editor.finish(g.part === 'anchor' ? 'Перемещение узлов' : 'Направляющие Безье')
    if (g.kind === 'marquee') {
      const b = rect(g.start, g.end),
        found = shapePaths(g.layer)
          .flatMap((p, path) => p.knots.map((_, index) => ({ path, index })))
          .filter((n) => {
            const q = pathNodePosition(g.layer, n)!
            return q.x >= b.x && q.y >= b.y && q.x <= b.x + b.width && q.y <= b.y + b.height
          })
      const unique = new Map(
        (g.add ? [...g.previous, ...found] : found).map((n) => [nodeKey(n), n]),
      )
      pick(g.layer.id, [...unique.values()])
    }
    paint()
    return true
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !active ||
        disabled ||
        (e.target instanceof Element &&
          e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))
      )
        return
      const mod = e.ctrlKey || e.metaKey,
        pending = drafts.current.get(editor.documentRef.current.id)
      const stop = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === 'Escape') {
        if (gesture.current) {
          stop()
          cancelGesture()
          return
        }
        if (pending && tool === 'pen') {
          stop()
          cancelDraft()
          return
        }
        if (nodes.length && layer) {
          stop()
          pick(layer.id, [])
          return
        }
      }
      if (gesture.current) {
        if (mod) {
          stop()
          onToast('Заверши жест или нажми Escape')
        }
        return
      }
      if (pending && tool === 'pen') {
        if (mod && e.code === 'KeyZ') {
          stop()
          const knots = [...pending.knots],
            redo = [...pending.redo]
          if (e.shiftKey) {
            const next = redo.pop()
            if (next) knots.push(next)
          } else {
            const previous = knots.pop()
            if (previous) redo.push(previous)
          }
          setDraft(doc.id, { ...pending, knots, redo })
          return
        }
        if (e.code === 'Enter' && !(e.target instanceof Element && e.target.closest('button'))) {
          stop()
          if (mod) toSelection(e)
          else finishDraft(e.shiftKey)
          return
        }
        if (mod && !['Digit0', 'Digit1', 'Equal', 'Minus'].includes(e.code)) {
          stop()
          onToast('Заверши контур: Enter — открытый, Shift+Enter — замкнутый; Escape — отменить')
          return
        }
      }
      if (mod && e.code === 'Enter') {
        stop()
        toSelection(e)
        return
      }
      if (mod && e.code === 'KeyA') {
        stop()
        selectAll()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && nodes.length) {
        stop()
        remove()
        return
      }
      if (
        e.key.startsWith('Arrow') &&
        nodes.length &&
        !(e.target instanceof Element && e.target.closest('button,.panel-dock'))
      ) {
        stop()
        const n = e.shiftKey ? 10 : 1
        edit(
          (l) =>
            movePathNodes(l, nodes, {
              x: e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0,
              y: e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0,
            }),
          'Перемещение узлов',
        )
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some((d) => d.knots.length)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])
  useEffect(() => {
    gesture.current = undefined
    setHover(null)
  }, [doc.id])
  return {
    active,
    tool,
    layer,
    nodes,
    paths,
    draft: tool === 'pen' ? draft : undefined,
    hover,
    revision,
    editable:
      !!layer &&
      layer.kind === 'shape' &&
      !layer.warp &&
      paths.reduce((n, p) => n + p.knots.length, 0) <= MAX_EDIT_NODES,
    marquee:
      gesture.current?.kind === 'marquee' ? rect(gesture.current.start, gesture.current.end) : null,
    down,
    move,
    up,
    cancelGesture,
    finishDraft,
    cancelDraft,
    activate,
    toSelection,
    selectAll,
    mode,
    remove,
    component,
    convert: () => {
      edit(convertToPath, 'Преобразование в контур')
      activate()
    },
    join: () => {
      edit((l) => joinPathEnds(l, nodes), 'Соединение концов контура')
      if (layer) pick(layer.id, [])
    },
    split: (path: number, index: number) => {
      edit((l) => splitPathSegment(l, { path, index }), 'Разделение сегмента')
      if (layer) pick(layer.id, [{ path, index: index + 1 }])
    },
    setFillRule: (rule: ShapePath['fillRule']) =>
      edit(
        (l) => ({
          shape: 'path',
          shapePaths: (l.shape === 'path' ? l.shapePaths! : convertToPath(l).shapePaths!).map(
            (p) => ({ ...p, fillRule: rule }),
          ),
        }),
        'Правило заливки контура',
      ),
    setPosition: (axis: 'x' | 'y', value: number) => {
      if (nodes.length === 1)
        edit(
          (l) => {
            const p = pathNodePosition(l, nodes[0])!
            return movePathNodes(l, nodes, {
              x: axis === 'x' ? value - p.x : 0,
              y: axis === 'y' ? value - p.y : 0,
            })
          },
          'Узел контура',
          true,
        )
    },
    finish: () => editor.finish('Свойства контура'),
  }
}
export type PathController = ReturnType<typeof usePathTool>
