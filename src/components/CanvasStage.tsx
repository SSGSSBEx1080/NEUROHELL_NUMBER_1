import { shapeNames, shapeTools } from '../engine/shapeGeometry'
import { defaultTextFrame } from '../engine/textLayout'
import { duplicateLayers, subtree } from '../engine/layerOperations'
import { FrameScheduler, SceneRenderer } from '../engine/scene'
import { magneticPoint, polygonSelection, selectionMask, selectionPath } from '../engine/selection'
import { brushStamp, strokeStamps } from '../engine/brush'
import { selectionTools } from './ToolRail'
import { rectangleQuad, validQuad } from '../engine/projection'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Crosshair, Eraser, ScanLine, Sparkles, X } from 'lucide-react'
import type { Editor } from '../hooks/useEditor'
import {
  type EditorDocument,
  type Layer,
  type Point,
  type Quad,
  type Rect,
  type Selection,
  type Tool,
  type ToolSettings,
  MAX_LAYERS,
} from '../types'
import { hitTest, localPoint, makeLayer, effectiveLayers, isLayerLocked } from '../engine/document'
import {
  encodeBitmap,
  prepareDocument,
  isPrepared,
  rasterizeLayer,
  loadImage,
  clearRenderCaches,
  cacheImage,
  validateRasterBudget,
} from '../engine/render'

interface Props {
  editor: Editor
  selectedId: string | null
  onSelect: (id: string | null) => void
  tool: Tool
  setTool: (tool: Tool) => void
  settings: ToolSettings
  setColor: (color: string) => void
  zoom: number | null
  setZoom: (zoom: number | null) => void
  onEffectiveZoom: (zoom: number) => void
  pan: Point
  setPan: (p: Point) => void
  selection: Selection | null
  setSelection: (r: Selection | null) => void
  onCrop: () => void
  onRepair: (selection: Selection) => void
  onEditText: () => void
  onPixelAction: (operation: 'wand' | 'erase' | 'fill' | 'bucket', point?: Point) => void
  onToast: (message: string) => void
  onBusy: (message: string | null) => void
  smooth: boolean
  showPerformance: boolean
  rulers: boolean
  busy: boolean
  onOpenSmart: (id: string) => void
}
type Drag =
  | { type: 'pan'; client: Point; pan: Point }
  | {
      type: 'move' | 'resize' | 'rotate' | 'distort'
      start: Point
      layer: Layer
      handle?: string
      before: EditorDocument
      duplicatedFrom?: string
    }
  | { type: 'region'; start: Point; repair?: boolean; textFrame?: boolean }
  | { type: 'lasso'; points: Point[]; repair?: boolean }
  | {
      type: 'gradient'
      start: Point
      id: string
      canvas: HTMLCanvasElement
      before: EditorDocument
    }
  | { type: 'shape'; start: Point; id: string; before: EditorDocument }
  | {
      type: 'paint'
      layer: Layer
      canvas: HTMLCanvasElement
      last: Point
      before: EditorDocument
      tool: Tool
      stamp: HTMLCanvasElement
      selection?: HTMLCanvasElement
      clone?: { canvas: HTMLCanvasElement; offset: Point }
      mask?: Layer['mask']
    }

const getRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})
const isInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')

export function CanvasStage({
  editor,
  selectedId,
  onSelect,
  tool,
  setTool,
  settings,
  setColor,
  zoom,
  setZoom,
  onEffectiveZoom,
  pan,
  setPan,
  selection,
  setSelection,
  onCrop,
  onRepair,
  onEditText,
  onPixelAction,
  onToast,
  onBusy,
  smooth,
  showPerformance,
  rulers,
  busy,
  onOpenSmart,
}: Props) {
  const doc = editor.document
  const viewport = useRef<HTMLDivElement>(null)
  const artboard = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const activePointer = useRef<number | null>(null)
  const overrides = useRef(new Map<string, HTMLCanvasElement>())
  const [size, setSize] = useState({ width: 900, height: 700 })
  const [revision, setRevision] = useState(0)
  const [spaceDown, setSpaceDown] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [guides, setGuides] = useState({ x: false, y: false })
  const paintScheduler = useRef(new FrameScheduler()),
    scheduler = useRef(new FrameScheduler()),
    renderer = useRef(new SceneRenderer())
  const polygon = useRef<Point[]>([]),
    [outline, setOutline] = useState<Point[]>([])
  const magnetic = useRef<ImageData | null>(null)
  const clone = useRef<{
    id: string
    point: Point
    canvas: HTMLCanvasElement
    offset?: Point
  } | null>(null)
  const renderError = useRef('')
  const [frameTime, setFrameTime] = useState(0)
  const fit = Math.max(
    0.05,
    Math.min(
      (size.width - (size.width < 600 ? 56 : 112)) / doc.width,
      (size.height - 138) / doc.height,
      1,
    ),
  )
  const scale = zoom ?? fit
  const left = (size.width - doc.width * scale) / 2 + pan.x
  const top = (size.height - doc.height * scale) / 2 + pan.y - 6
  const selected = doc.layers.find((l) => l.id === selectedId)
  const showTransform =
    selected &&
    selected.visible &&
    !isLayerLocked(doc, selected.id) &&
    tool === 'move' &&
    selected.kind !== 'group'

  useLayoutEffect(() => {
    if (!viewport.current) return
    const initial = viewport.current.getBoundingClientRect()
    setSize({ width: initial.width, height: initial.height })
    const resize = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    resize.observe(viewport.current)
    return () => resize.disconnect()
  }, [])
  useEffect(() => {
    const changed = () => {
      clearRenderCaches()
      renderer.current.clear()
      setRevision((v) => v + 1)
    }
    window.addEventListener('fsh777-fonts-changed', changed)
    document.fonts.addEventListener('loadingdone', changed)
    return () => {
      window.removeEventListener('fsh777-fonts-changed', changed)
      document.fonts.removeEventListener('loadingdone', changed)
    }
  }, [])
  useEffect(() => {
    polygon.current = []
    setOutline([])
  }, [tool])
  useEffect(() => onEffectiveZoom(scale), [scale, onEffectiveZoom])
  useEffect(() => {
    overrides.current.clear()
    renderer.current.clear()
    polygon.current = []
    setOutline([])
    clone.current = null
  }, [doc.id])
  useEffect(() => {
    let disposed = false
    const paint = () => {
      const el = canvas.current
      if (!el || disposed) return
      const resolution = Math.min(
        scale * Math.min(window.devicePixelRatio || 1, 2),
        2,
        4096 / doc.width,
        4096 / doc.height,
      )
      const width = Math.max(1, Math.round(doc.width * resolution)),
        height = Math.max(1, Math.round(doc.height * resolution))
      if (el.width !== width || el.height !== height) {
        el.width = width
        el.height = height
      }
      const ctx = el.getContext('2d')!
      ctx.setTransform(width / doc.width, 0, 0, height / doc.height, 0, 0)
      ctx.imageSmoothingEnabled = smooth
      ctx.imageSmoothingQuality = 'high'
      const start = performance.now()
      try {
        renderer.current.draw(ctx, doc, overrides.current, selectedId || undefined)
        renderError.current = ''
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка отрисовки'
        if (renderError.current !== message) onToast(message)
        renderError.current = message
        return
      }
      if (showPerformance) setFrameTime(performance.now() - start)
    }
    if (isPrepared(doc)) scheduler.current.request(paint)
    else
      prepareDocument(doc)
        .then(() => {
          if (!disposed) scheduler.current.request(paint)
        })
        .catch(() => {
          if (!disposed) onToast('Не удалось загрузить один из слоёв')
        })
    return () => {
      disposed = true
      scheduler.current.cancel()
    }
  }, [doc, scale, revision, selectedId, onToast, smooth, showPerformance])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isInput(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    const blur = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    const el = viewport.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const next = Math.min(4, Math.max(0.05, scale * Math.exp(-e.deltaY * 0.003)))
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left - size.width / 2,
          my = e.clientY - rect.top - size.height / 2 + 6
        setPan({ x: mx - ((mx - pan.x) * next) / scale, y: my - ((my - pan.y) * next) / scale })
        setZoom(next)
      } else
        setPan({
          x: pan.x - e.deltaX - (e.shiftKey ? e.deltaY : 0),
          y: pan.y - (e.shiftKey ? 0 : e.deltaY),
        })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [scale, setZoom, pan, setPan, size])

  const pointFrom = (e: { clientX: number; clientY: number }): Point => {
    const rect = artboard.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
  }
  const clip = (p: Point): Point => ({
    x: Math.min(doc.width, Math.max(0, p.x)),
    y: Math.min(doc.height, Math.max(0, p.y)),
  })
  const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height
  const redraw = () => setRevision((v) => v + 1)
  const beginText = (layer: Layer) => {
    if (isLayerLocked(doc, layer.id)) {
      onToast('Слой или его группа заблокированы')
      return
    }
    onSelect(layer.id)
    onEditText()
    setTool('move')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLTextAreaElement>('[aria-label="Текст слоя"]')
        field?.focus()
        field?.select()
      }),
    )
  }
  const finishPolygon = () => {
    const next = polygonSelection(polygon.current, settings.feather || 0)
    if (next) setSelection(next)
    polygon.current = []
    setOutline([])
    magnetic.current = null
  }
  const snapMagnet = (p: Point) =>
    magnetic.current
      ? magneticPoint(
          p,
          magnetic.current,
          canvas.current!.width / doc.width,
          canvas.current!.height / doc.height,
          10,
        )
      : p
  const paintSegment = (d: Extract<Drag, { type: 'paint' }>, p: Point) => {
    const raw = localPoint(d.layer, p),
      local = d.mask
        ? {
            x: d.layer.flipX ? d.layer.width - raw.x : raw.x,
            y: d.layer.flipY ? d.layer.height - raw.y : raw.y,
          }
        : raw
    const next = d.mask
      ? {
          x: ((local.x + d.layer.x - d.mask.x) * d.canvas.width) / d.mask.width,
          y: ((local.y + d.layer.y - d.mask.y) * d.canvas.height) / d.mask.height,
        }
      : {
          x: (local.x * d.canvas.width) / d.layer.width,
          y: (local.y * d.canvas.height) / d.layer.height,
        }
    strokeStamps(
      d.canvas.getContext('2d')!,
      d.last,
      next,
      d.stamp,
      settings,
      d.tool === 'eraser',
      d.selection,
      d.clone,
    )
    d.last = next
    paintScheduler.current.request(() => {
      if (drag.current !== d) return
      if (d.mask) {
        const src = `mask-preview:${d.layer.id}`
        cacheImage(src, d.canvas)
        editor.patchLayer(d.layer.id, { mask: { ...d.mask, src } }, '', true)
      }
      redraw()
    })
  }
  const pointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy || isInput(e.target) || (e.target as HTMLElement).closest('button')) return
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    if (document.activeElement instanceof HTMLElement && isInput(document.activeElement))
      document.activeElement.blur()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    activePointer.current = e.pointerId
    const p = pointFrom(e)
    if (spaceDown || tool === 'hand' || e.button === 1) {
      drag.current = { type: 'pan', client: { x: e.clientX, y: e.clientY }, pan }
      return
    }
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle')
    if (handle && selected && !isLayerLocked(doc, selected.id) && tool === 'move') {
      drag.current = {
        type: handle === 'rotate' ? 'rotate' : e.ctrlKey || e.metaKey ? 'distort' : 'resize',
        start: p,
        layer: { ...selected },
        handle,
        before: doc,
      }
      return
    }
    if (!inside(p)) {
      if (tool === 'move') onSelect(null)
      return
    }
    if (tool === 'move') {
      const selectedGroup =
        selected?.kind === 'group' &&
        effectiveLayers(doc).some((l) => subtree(doc, selected.id).has(l.id) && hitTest(l, p))
          ? selected
          : undefined
      const hit =
        selectedGroup ||
        (settings.autoSelect
          ? [...effectiveLayers(doc)].reverse().find((l) => hitTest(l, p))
          : selected)
      onSelect(hit?.id || null)
      if (hit && !isLayerLocked(doc, hit.id) && hit.visible) {
        if (e.altKey) {
          if (doc.layers.length >= MAX_LAYERS) {
            onToast('В одном проекте доступно до 100 слоёв')
            return
          }
          try {
            const result = duplicateLayers(doc, hit.id, 0),
              copy = result.document.layers.find((l) => l.id === result.selectedId)!
            editor.change(() => result.document, '', true)
            onSelect(copy.id)
            drag.current = {
              type: 'move',
              start: p,
              layer: copy,
              before: doc,
              duplicatedFrom: hit.id,
            }
          } catch (error) {
            onToast(error instanceof Error ? error.message : 'Не удалось дублировать')
          }
        } else drag.current = { type: 'move', start: p, layer: { ...hit }, before: doc }
      }
    } else if (tool === 'lasso' || tool === 'repair') {
      setSelection(null)
      drag.current = { type: 'lasso', points: [p], repair: tool === 'repair' }
      setOutline([p])
    } else if (tool === 'polygon-lasso' || tool === 'magnetic-lasso') {
      if (!polygon.current.length) {
        setSelection(null)
        if (tool === 'magnetic-lasso')
          magnetic.current = canvas
            .current!.getContext('2d', { willReadFrequently: true })!
            .getImageData(0, 0, canvas.current!.width, canvas.current!.height)
      }
      if (
        polygon.current.length > 2 &&
        Math.hypot(p.x - polygon.current[0].x, p.y - polygon.current[0].y) < 8 / scale
      ) {
        finishPolygon()
        return
      }
      polygon.current.push(tool === 'magnetic-lasso' ? snapMagnet(p) : p)
      setOutline([...polygon.current])
    } else if (tool === 'gradient') {
      if (doc.layers.length >= MAX_LAYERS) return onToast('Достигнут лимит слоёв')
      const buffer = document.createElement('canvas')
      buffer.width = doc.width
      buffer.height = doc.height
      const layer = makeLayer({
        kind: 'image',
        name: 'Градиент',
        width: doc.width,
        height: doc.height,
      })
      editor.change((d) => ({ ...d, layers: [...d.layers, layer] }), '', true)
      onSelect(layer.id)
      overrides.current.set(layer.id, buffer)
      drag.current = { type: 'gradient', start: p, id: layer.id, canvas: buffer, before: doc }
    } else if (
      tool === 'crop' ||
      tool === 'select' ||
      tool === 'ellipse-select' ||
      tool === 'repair-box' ||
      tool === 'text-frame'
    ) {
      setSelection({ ...p, width: 0, height: 0 })
      drag.current = {
        type: 'region',
        start: p,
        repair: tool === 'repair-box',
        textFrame: tool === 'text-frame',
      }
    } else if (tool === 'text') {
      const hit = [...doc.layers].reverse().find((l) => l.kind === 'text' && hitTest(l, p))
      if (hit) {
        beginText(hit)
        return
      }
      if (doc.layers.length >= MAX_LAYERS) {
        onToast('В одном проекте доступно до 100 слоёв')
        return
      }
      const layer = makeLayer({
        kind: 'text',
        name: 'Ваш текст',
        text: 'Ваш текст',
        x: p.x,
        y: p.y,
        width: Math.min(700, doc.width * 0.65),
        height: 110,
        fontFamily: 'Manrope',
        fontSize: 72,
        fontWeight: 600,
        color: settings.color,
        lineHeight: 1.2,
      })
      editor.change((d) => ({ ...d, layers: [...d.layers, layer] }), 'Добавление текста')
      beginText(layer)
    } else if (shapeTools.some((s) => s === tool)) {
      if (doc.layers.length >= MAX_LAYERS) {
        onToast('В одном проекте доступно до 100 слоёв')
        return
      }
      const layer = makeLayer({
        name: shapeNames[tool as keyof typeof shapeNames],
        shape: tool as Layer['shape'],
        shapeFill: tool !== 'line' && settings.shapeFill,
        strokeColor: tool === 'line' || !settings.shapeFill ? settings.color : undefined,
        strokeWidth: tool === 'line' || !settings.shapeFill ? 2 : 0,
        x: p.x,
        y: p.y,
        width: 1,
        height: 1,
        color: settings.color,
        radius: tool === 'rectangle' ? 8 : 0,
      })
      editor.change((d) => ({ ...d, layers: [...d.layers, layer] }), 'Добавление фигуры', true)
      onSelect(layer.id)
      drag.current = { type: 'shape', start: p, id: layer.id, before: doc }
    } else if (tool === 'eyedropper') {
      const c = canvas.current!,
        ctx = c.getContext('2d')!
      const rgba = ctx.getImageData(
        Math.min(c.width - 1, Math.floor((p.x / doc.width) * c.width)),
        Math.min(c.height - 1, Math.floor((p.y / doc.height) * c.height)),
        1,
        1,
      ).data
      const color = '#' + [...rgba.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
      setColor(color)
      onToast(`Цвет ${color.toUpperCase()} выбран`)
    } else if (tool === 'wand' || tool === 'bucket') onPixelAction(tool, p)
    else if (tool === 'brush' || tool === 'eraser' || tool === 'clone') {
      const maskMode = settings.editMask && !!selected?.mask
      if ((selected?.smart || selected?.kind === 'group') && !maskMode)
        return onToast('Открой содержимое смарт-объекта или выбери растровый слой')
      if (tool === 'clone' && (!selected || selected.kind !== 'image'))
        return onToast('Штамп работает на выбранном растровом слое. Alt+клик задаёт источник.')
      if (selected && !selected.visible) {
        onToast('Слой скрыт. Включи его видимость перед рисованием.')
        return
      }
      if (selected && isLayerLocked(doc, selected.id)) {
        onToast('Слой заблокирован. Сначала снимите замок.')
        return
      }
      if (tool === 'eraser' && !selected) {
        onToast('Выберите слой для ластика')
        return
      }
      if (tool === 'clone' && e.altKey && selected) {
        try {
          const source = await rasterizeLayer(selected)
          if (editor.documentRef.current.id !== doc.id) return
          clone.current = { id: selected.id, point: localPoint(selected, p), canvas: source }
        } catch {
          onToast('Не удалось прочитать источник штампа')
          return
        }
        onToast('Источник штампа выбран. Рисуй без Alt.')
        return
      }
      if (tool === 'clone' && clone.current?.id !== selected?.id)
        return onToast('Сначала Alt+клик по источнику на этом слое')
      const before = editor.documentRef.current
      let layer = selected
      let buffer: HTMLCanvasElement
      if (!layer || (tool === 'brush' && layer.kind !== 'image' && !maskMode)) {
        if (doc.layers.length >= MAX_LAYERS) {
          onToast('В одном проекте доступно до 100 слоёв')
          return
        }
        buffer = document.createElement('canvas')
        buffer.width = doc.width
        buffer.height = doc.height
        layer = makeLayer({
          kind: 'image',
          name: 'Рисунок кистью',
          width: doc.width,
          height: doc.height,
        })
        editor.change((d) => ({ ...d, layers: [...d.layers, layer!] }), 'Новый рисунок', true)
        onSelect(layer.id)
      } else {
        try {
          buffer = maskMode ? document.createElement('canvas') : await rasterizeLayer(layer)
        } catch {
          onToast('Не удалось подготовить слой')
          return
        }
        if (activePointer.current !== e.pointerId) return
        if (layer.kind !== 'image' && !maskMode)
          onToast('Слой растрирован для работы ластиком. Это можно отменить.')
      }
      let targetMask: Layer['mask']
      if (settings.editMask && layer.mask) {
        targetMask = layer.mask
        const image = await loadImage(targetMask.src)
        buffer = document.createElement('canvas')
        buffer.width = Math.max(1, Math.min(4096, Math.round(targetMask.width)))
        buffer.height = Math.max(1, Math.min(4096, Math.round(targetMask.height)))
        buffer.getContext('2d')!.drawImage(image, 0, 0, buffer.width, buffer.height)
      }
      if (activePointer.current !== e.pointerId) return
      const raw = localPoint(layer, p),
        local = targetMask
          ? {
              x: layer.flipX ? layer.width - raw.x : raw.x,
              y: layer.flipY ? layer.height - raw.y : raw.y,
            }
          : raw,
        sx = buffer.width / (targetMask?.width || layer.width)
      const last = targetMask
        ? {
            x: (local.x + layer.x - targetMask.x) * sx,
            y: ((local.y + layer.y - targetMask.y) * buffer.height) / targetMask.height,
          }
        : { x: local.x * sx, y: (local.y * buffer.height) / layer.height }
      if (tool === 'clone' && clone.current && !clone.current.offset)
        clone.current.offset = {
          x: (clone.current.point.x - local.x) * sx,
          y: ((clone.current.point.y - local.y) * buffer.height) / layer.height,
        }
      const d: Extract<Drag, { type: 'paint' }> = {
        type: 'paint',
        layer,
        canvas: buffer,
        before,
        tool,
        last,
        mask: targetMask,
        stamp: brushStamp(settings.brushSize * sx, settings.color, settings.brushHardness ?? 100),
        selection:
          selection && !targetMask
            ? selectionMask(selection, buffer.width, buffer.height, layer)
            : undefined,
        clone:
          tool === 'clone' && clone.current
            ? { canvas: clone.current.canvas, offset: clone.current.offset! }
            : undefined,
      }
      drag.current = d
      if (!targetMask) overrides.current.set(layer.id, buffer)
      paintSegment(d, p)
    }
  }
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointFrom(e)
    if (tool === 'brush' || tool === 'eraser' || tool === 'clone') setCursor(p)
    if (polygon.current.length && !drag.current) {
      if (tool === 'magnetic-lasso' && inside(p)) {
        const next = snapMagnet(p),
          last = polygon.current.at(-1)!
        if (
          Math.hypot(next.x - last.x, next.y - last.y) > 2 / scale &&
          polygon.current.length < 4096
        )
          polygon.current.push(next)
      }
      setOutline([...polygon.current, p])
    }
    const d = drag.current
    if (!d || busy) return
    if (d.type === 'pan') {
      setPan({ x: d.pan.x + e.clientX - d.client.x, y: d.pan.y + e.clientY - d.client.y })
      return
    }
    if (d.type === 'paint') {
      paintSegment(d, p)
      return
    }
    if (d.type === 'lasso') {
      const last = d.points.at(-1)!
      if (Math.hypot(p.x - last.x, p.y - last.y) > 2 / scale && d.points.length < 4096)
        d.points.push(clip(p))
      setOutline([...d.points])
      return
    }
    if (d.type === 'region') {
      setSelection({
        ...getRect(d.start, clip(p)),
        ellipse: tool === 'ellipse-select',
        feather: settings.feather || 0,
      })
      return
    }
    if (d.type === 'gradient') {
      const ctx = d.canvas.getContext('2d')!,
        length = Math.max(1, Math.hypot(p.x - d.start.x, p.y - d.start.y))
      ctx.clearRect(0, 0, doc.width, doc.height)
      const g =
        settings.gradientType === 'radial'
          ? ctx.createRadialGradient(d.start.x, d.start.y, 0, d.start.x, d.start.y, length)
          : ctx.createLinearGradient(d.start.x, d.start.y, p.x, p.y)
      g.addColorStop(0, settings.color)
      g.addColorStop(1, settings.secondaryColor)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, doc.width, doc.height)
      if (selection) {
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(selectionMask(selection, doc.width, doc.height), 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      }
      redraw()
      return
    }
    if (d.type === 'shape') {
      if (tool === 'line') {
        const length = Math.max(1, Math.hypot(p.x - d.start.x, p.y - d.start.y))
        let angle = Math.atan2(p.y - d.start.y, p.x - d.start.x)
        if (e.shiftKey) angle = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4
        editor.patchLayer(
          d.id,
          {
            x: d.start.x + (Math.cos(angle) * length) / 2 - length / 2,
            y: d.start.y + (Math.sin(angle) * length) / 2 - 0.5,
            width: length,
            height: 1,
            rotation: (angle * 180) / Math.PI,
          },
          '',
          true,
        )
        return
      }
      let end = p
      if (e.shiftKey) {
        const m = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y))
        end = {
          x: d.start.x + m * Math.sign(p.x - d.start.x || 1),
          y: d.start.y + m * Math.sign(p.y - d.start.y || 1),
        }
      }
      const rect = getRect(d.start, end)
      editor.patchLayer(
        d.id,
        { ...rect, width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
        '',
        true,
      )
      return
    }
    if (d.type === 'move') {
      let dx = p.x - d.start.x,
        dy = p.y - d.start.y
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      let x = d.layer.x + dx,
        y = d.layer.y + dy
      const snap = 5 / scale
      let gx = false,
        gy = false
      if (settings.showGuides && !e.altKey) {
        if (Math.abs(x + d.layer.width / 2 - doc.width / 2) < snap) {
          x = (doc.width - d.layer.width) / 2
          gx = true
        }
        if (Math.abs(y + d.layer.height / 2 - doc.height / 2) < snap) {
          y = (doc.height - d.layer.height) / 2
          gy = true
        }
        if (Math.abs(x) < snap) x = 0
        if (Math.abs(y) < snap) y = 0
      }
      setGuides({ x: gx, y: gy })
      editor.patchLayer(d.layer.id, { x, y }, '', true)
    } else if (d.type === 'rotate') {
      const angle = (q: Point) =>
        Math.atan2(q.y - d.layer.y - d.layer.height / 2, q.x - d.layer.x - d.layer.width / 2)
      let rotation = d.layer.rotation + ((angle(p) - angle(d.start)) * 180) / Math.PI
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
      editor.patchLayer(d.layer.id, { rotation: (rotation + 360) % 360 }, '', true)
    } else if (d.type === 'distort') {
      const current = localPoint(d.layer, p, false),
        start = localPoint(d.layer, d.start, false)
      const dx = (current.x - start.x) / d.layer.width,
        dy = (current.y - start.y) / d.layer.height
      const quad = (d.layer.warp || rectangleQuad()).map((v) => ({ ...v })) as Quad
      const indices: Record<string, number[]> = {
        nw: [0],
        ne: [1],
        se: [2],
        sw: [3],
        n: [0, 1],
        e: [1, 2],
        s: [2, 3],
        w: [3, 0],
      }
      for (const i of indices[d.handle!] || []) {
        quad[i].x += dx
        quad[i].y += dy
      }
      if (validQuad(quad)) editor.patchLayer(d.layer.id, { warp: quad }, '', true)
    } else if (d.type === 'resize') {
      let local = localPoint(d.layer, p, false)
      const h = d.handle!
      if (d.layer.warp) {
        const start = localPoint(d.layer, d.start, false)
        local = {
          x:
            (h.includes('w') ? 0 : h.includes('e') ? d.layer.width : d.layer.width / 2) +
            local.x -
            start.x,
          y:
            (h.includes('n') ? 0 : h.includes('s') ? d.layer.height : d.layer.height / 2) +
            local.y -
            start.y,
        }
      }
      let x1 = h.includes('w') ? Math.min(local.x, d.layer.width - 8) : 0
      let y1 = h.includes('n') ? Math.min(local.y, d.layer.height - 8) : 0
      let x2 = h.includes('e') ? Math.max(local.x, 8) : d.layer.width
      let y2 = h.includes('s') ? Math.max(local.y, 8) : d.layer.height
      const keepRatio = h.length === 2 && !e.shiftKey
      if (keepRatio) {
        const ratio = Math.max((x2 - x1) / d.layer.width, (y2 - y1) / d.layer.height)
        if (h.includes('w')) x1 = x2 - d.layer.width * ratio
        else x2 = x1 + d.layer.width * ratio
        if (h.includes('n')) y1 = y2 - d.layer.height * ratio
        else y2 = y1 + d.layer.height * ratio
      }
      const width = Math.min(16384, x2 - x1),
        height = Math.min(16384, y2 - y1)
      const cx = (x1 + x2 - d.layer.width) / 2,
        cy = (y1 + y2 - d.layer.height) / 2,
        a = (d.layer.rotation * Math.PI) / 180
      editor.patchLayer(
        d.layer.id,
        {
          width,
          height,
          x: d.layer.x + d.layer.width / 2 + cx * Math.cos(a) - cy * Math.sin(a) - width / 2,
          y: d.layer.y + d.layer.height / 2 + cx * Math.sin(a) + cy * Math.cos(a) - height / 2,
          ...(d.layer.kind === 'text' && !d.layer.textFrame
            ? {
                fontSize: Math.max(
                  4,
                  Math.min(1000, ((d.layer.fontSize || 48) * height) / d.layer.height),
                ),
                textScaleX: Math.max(
                  0.01,
                  Math.min(
                    100,
                    ((d.layer.textScaleX || 1) * (width / d.layer.width)) /
                      (height / d.layer.height),
                  ),
                ),
                letterSpacing: ((d.layer.letterSpacing || 0) * height) / d.layer.height,
              }
            : {}),
        },
        '',
        true,
      )
    }
  }
  const pointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    paintScheduler.current.cancel()
    activePointer.current = null
    const d = drag.current
    drag.current = null
    setGuides({ x: false, y: false })
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.type === 'lasso') {
      const selected = polygonSelection(d.points, settings.feather || 0)
      setSelection(selected)
      if (d.repair && selected) onRepair(selected)
      setOutline([])
      return
    }
    if (d.type === 'region' && d.textFrame) {
      const rect = getRect(d.start, clip(pointFrom(e)))
      setSelection(null)
      if (rect.width < 20 || rect.height < 20) {
        onToast('Протяни рамку от 20 × 20 px')
        return
      }
      if (editor.documentRef.current.layers.length >= MAX_LAYERS) {
        onToast('До 100 слоёв в проекте')
        return
      }
      const layer = makeLayer({
        ...rect,
        kind: 'text',
        name: 'Реплика',
        text: 'Текст реплики',
        fontFamily: 'Manrope',
        fontSize: Math.min(48, Math.max(12, rect.height / 4)),
        fontWeight: 600,
        textAlign: 'center',
        lineHeight: 1.15,
        color: '#151515',
        textFrame: defaultTextFrame(),
      })
      editor.change(
        (doc) => ({ ...doc, layers: [...doc.layers, layer] }),
        'Добавление текстовой рамки',
      )
      beginText(layer)
      return
    }
    if (d.type === 'region' && d.repair) {
      const selected = getRect(d.start, clip(pointFrom(e)))
      if (selected.width > 1 && selected.height > 1) {
        setSelection(selected)
        onRepair(selected)
      }
      return
    }
    if (d.type === 'gradient') {
      onBusy('Фиксируем градиент…')
      try {
        const layer = editor.documentRef.current.layers.find((l) => l.id === d.id)!
        const next = await encodeBitmap(layer, d.canvas)
        validateRasterBudget({
          ...editor.documentRef.current,
          layers: editor.documentRef.current.layers.map((l) => (l.id === d.id ? next : l)),
        })
        editor.patchLayer(d.id, next, '', true)
        editor.finish('Градиент')
        setTool('move')
      } catch (error) {
        editor.change(() => d.before, '', true)
        onToast(error instanceof Error ? error.message : 'Ошибка градиента')
      } finally {
        overrides.current.delete(d.id)
        onBusy(null)
        redraw()
      }
      return
    }
    if (d.type === 'paint') {
      if (d.mask) {
        onBusy('Сохраняем маску…')
        try {
          const bitmap = await encodeBitmap(d.layer, d.canvas)
          editor.patchLayer(d.layer.id, { mask: { ...d.mask, src: bitmap.src! } }, '', true)
          editor.finish('Рисование по маске')
        } catch {
          editor.change(() => d.before, '', true)
          onToast('Не удалось сохранить маску')
        } finally {
          onBusy(null)
        }
        return
      }
      onBusy('Фиксируем мазок…')
      const next = await encodeBitmap(d.layer, d.canvas).catch(() => null)
      onBusy(null)
      if (!next) {
        editor.change(() => d.before, '', true)
        overrides.current.clear()
        redraw()
        onToast('Не удалось сохранить мазок')
        return
      }
      try {
        validateRasterBudget({
          ...editor.documentRef.current,
          layers: editor.documentRef.current.layers.map((l) => (l.id === d.layer.id ? next : l)),
        })
      } catch (error) {
        editor.change(() => d.before, '', true)
        overrides.current.clear()
        redraw()
        onToast(error instanceof Error ? error.message : 'Превышен лимит растров')
        return
      }
      editor.patchLayer(d.layer.id, next, '', true)
      overrides.current.delete(d.layer.id)
      editor.finish(
        d.tool === 'eraser' ? 'Ластик' : d.tool === 'clone' ? 'Штамп' : 'Рисование кистью',
      )
      redraw()
    } else if (d.type === 'shape') {
      const layer = editor.documentRef.current.layers.find((l) => l.id === d.id)!
      if (layer.width < 4 && layer.height < 4)
        editor.patchLayer(d.id, { width: 240, height: 160 }, '', true)
      editor.finish('Добавление фигуры')
      setTool('move')
    } else if (d.type !== 'pan' && d.type !== 'region')
      editor.finish(
        d.type === 'move'
          ? d.duplicatedFrom
            ? 'Копия перетягиванием (Alt)'
            : 'Перемещение слоя'
          : d.type === 'rotate'
            ? 'Поворот слоя'
            : d.type === 'distort'
              ? 'Перспектива слоя'
              : 'Размер слоя',
      )
  }
  const cancelPointer = () => {
    paintScheduler.current.cancel()
    const d = drag.current
    if (d && 'before' in d) editor.change(() => d.before, '', true)
    if (d && 'duplicatedFrom' in d && d.duplicatedFrom) onSelect(d.duplicatedFrom)
    else if (d && 'before' in d && !d.before.layers.some((l) => l.id === selectedId))
      onSelect(d.before.layers.at(-1)?.id || null)
    drag.current = null
    activePointer.current = null
    polygon.current = []
    setOutline([])
    overrides.current.clear()
    redraw()
    setGuides({ x: false, y: false })
  }
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (isInput(e.target)) return
      if (e.key === 'Enter' && polygon.current.length) {
        e.preventDefault()
        finishPolygon()
      }
      if (drag.current && e.key !== 'Escape' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Escape' && (drag.current || polygon.current.length)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancelPointer()
      }
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  })
  const quad = selected
    ? (selected.warp || rectangleQuad()).map((p) => ({
        x: p.x * selected.width,
        y: p.y * selected.height,
      }))
    : []
  const handles: [string, number, number][] = quad.length
    ? [
        ['nw', quad[0].x, quad[0].y],
        ['n', (quad[0].x + quad[1].x) / 2, (quad[0].y + quad[1].y) / 2],
        ['ne', quad[1].x, quad[1].y],
        ['e', (quad[1].x + quad[2].x) / 2, (quad[1].y + quad[2].y) / 2],
        ['se', quad[2].x, quad[2].y],
        ['s', (quad[2].x + quad[3].x) / 2, (quad[2].y + quad[3].y) / 2],
        ['sw', quad[3].x, quad[3].y],
        ['w', (quad[3].x + quad[0].x) / 2, (quad[3].y + quad[0].y) / 2],
      ]
    : []
  const step = scale < 0.35 ? 500 : scale < 0.8 ? 200 : 100
  const xTicks = Array.from(
    { length: Math.ceil(size.width / scale / step) + 3 },
    (_, i) => (Math.floor(-left / scale / step) + i) * step,
  )
  const yTicks = Array.from(
    { length: Math.ceil(size.height / scale / step) + 3 },
    (_, i) => (Math.floor(-top / scale / step) + i) * step,
  )

  return (
    <div
      ref={viewport}
      className={`canvas-viewport tool-${spaceDown ? 'hand' : tool} ${busy ? 'is-busy' : ''}`}
      data-testid="canvas-viewport"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={cancelPointer}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={(e) => {
        if (tool === 'polygon-lasso' || tool === 'magnetic-lasso') {
          finishPolygon()
          return
        }
        if (tool !== 'move') return
        const p = pointFrom(e)
        const hit = [...effectiveLayers(doc)].reverse().find((l) => hitTest(l, p))
        if (hit?.kind === 'text') beginText(hit)
        else if (hit?.smart) onOpenSmart(hit.id)
      }}
    >
      {rulers && (
        <>
          <div className="ruler-corner">
            <Crosshair size={10} />
          </div>
          <div className="ruler ruler-x">
            {xTicks.map((t) => (
              <span key={t} style={{ left: left + t * scale }}>
                {t}
              </span>
            ))}
          </div>
          <div className="ruler ruler-y">
            {yTicks.map((t) => (
              <span key={t} style={{ top: top + t * scale }}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}
      <div
        ref={artboard}
        className="artboard checkerboard"
        style={{ width: doc.width * scale, height: doc.height * scale, left, top }}
      >
        <div className="artboard-label">
          <span>Холст 1</span>
          <span>
            {doc.width} × {doc.height}
          </span>
        </div>
        <canvas
          ref={canvas}
          data-testid="editor-canvas"
          aria-label={`Холст ${doc.name}, ${doc.width} на ${doc.height} пикселей`}
        />
        <svg
          className="canvas-overlay"
          width="100%"
          height="100%"
          viewBox={`0 0 ${doc.width} ${doc.height}`}
        >
          {guides.x && (
            <line
              x1={doc.width / 2}
              y1={0}
              x2={doc.width / 2}
              y2={doc.height}
              stroke="#d99cff"
              strokeWidth={1 / scale}
            />
          )}
          {guides.y && (
            <line
              x1={0}
              y1={doc.height / 2}
              x2={doc.width}
              y2={doc.height / 2}
              stroke="#d99cff"
              strokeWidth={1 / scale}
            />
          )}
          {showTransform && (
            <g
              transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation}) translate(${-selected.width / 2} ${-selected.height / 2})`}
            >
              <polygon
                points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#b3a0ff"
                strokeWidth={1 / scale}
              />
              <line
                x1={selected.width / 2}
                y1={0}
                x2={selected.width / 2}
                y2={-24 / scale}
                stroke="#b3a0ff"
                strokeWidth={1 / scale}
              />
              <circle
                data-handle="rotate"
                cx={selected.width / 2}
                cy={-24 / scale}
                r={4 / scale}
                fill="#25212e"
                stroke="#b3a0ff"
                strokeWidth={1.2 / scale}
                style={{ pointerEvents: 'all', cursor: 'grab' }}
              />
              {handles.map(([h, x, y]) => (
                <rect
                  key={h}
                  data-handle={h}
                  x={x - 3 / scale}
                  y={y - 3 / scale}
                  width={6 / scale}
                  height={6 / scale}
                  fill="#e3dbff"
                  stroke="#a38be7"
                  strokeWidth={1 / scale}
                  style={{ pointerEvents: 'all', cursor: `${h}-resize` }}
                />
              ))}
            </g>
          )}
          {outline.length > 0 && (
            <polyline
              points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
              stroke="#fff"
              strokeWidth={1.2 / scale}
              fill="none"
            />
          )}
          {selection && (
            <>
              {tool === 'crop' && (
                <path
                  d={`M0 0H${doc.width}V${doc.height}H0Z M${selection.x} ${selection.y}h${selection.width}v${selection.height}h-${selection.width}Z`}
                  fillRule="evenodd"
                  fill="#0009"
                />
              )}
              <path
                d={selectionPath(selection)}
                fill="none"
                stroke="#fff"
                strokeWidth={1 / scale}
              />
              <path
                d={selectionPath(selection)}
                fill="none"
                stroke="#342741"
                strokeWidth={1 / scale}
                strokeDasharray={`${4 / scale} ${4 / scale}`}
                className="marching-ants"
              />
              {tool === 'crop' &&
                [1, 2].map((i) => (
                  <g key={i} stroke="#ffffff65" strokeWidth={1 / scale}>
                    <line
                      x1={selection.x + (selection.width * i) / 3}
                      y1={selection.y}
                      x2={selection.x + (selection.width * i) / 3}
                      y2={selection.y + selection.height}
                    />
                    <line
                      x1={selection.x}
                      y1={selection.y + (selection.height * i) / 3}
                      x2={selection.x + selection.width}
                      y2={selection.y + (selection.height * i) / 3}
                    />
                  </g>
                ))}
            </>
          )}
          {cursor && (tool === 'brush' || tool === 'eraser' || tool === 'clone') && (
            <>
              <circle
                cx={cursor.x}
                cy={cursor.y}
                r={settings.brushSize / 2}
                fill="none"
                stroke="#0009"
                strokeWidth={3 / scale}
              />
              <circle
                cx={cursor.x}
                cy={cursor.y}
                r={settings.brushSize / 2}
                fill="none"
                stroke="#fffd"
                strokeWidth={1 / scale}
              />
            </>
          )}
        </svg>
      </div>
      {selection &&
      selection.width > 2 &&
      selection.height > 2 &&
      (tool === 'crop' || selectionTools.includes(tool)) ? (
        <div className="selection-actions">
          <span>
            <ScanLine size={15} />
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
          <div className="vertical-divider" />
          {tool === 'crop' ? (
            <button className="compact-button accent" onClick={onCrop}>
              <Check size={14} />
              Кадрировать
            </button>
          ) : (
            <>
              <button className="compact-button" onClick={() => onPixelAction('erase')}>
                <Eraser size={14} />
                Стереть
              </button>
              <button
                className="compact-button accent"
                onClick={() => onRepair(selection)}
                title="Восстановить по локальным образцам на новом слое"
              >
                <Sparkles size={14} />
                Восстановить · J
              </button>
            </>
          )}
          <button
            className="icon-button"
            onClick={() => setSelection(null)}
            aria-label="Снять выделение"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="workspace-hint">
          <span className="hint-key">Alt</span> + перетаскивание — копия <i />{' '}
          <span className="hint-key">Пробел</span> рука <i /> <span className="hint-key">Ctrl</span>{' '}
          + колесо — масштаб
        </div>
      )}
      {showPerformance && (
        <div className="performance-hud">
          Canvas 2D · {frameTime.toFixed(1)} мс / кадр · кэш слоёв
        </div>
      )}
    </div>
  )
}
