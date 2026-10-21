import type { PathController } from '../hooks/usePathTool'
import { PathOverlay, PathToolbar } from './PathOverlay'
import { arrangementBounds } from '../engine/arrange'
import { layoutOf, layoutTargets, snapBounds, snapPoint } from '../engine/layout'
import { QuickMaskOverlay } from './QuickMaskOverlay'
import { rasterSelection } from '../engine/selectionPixels'
import { rasterOutline } from '../engine/selectionOutline'
import {
  distortVisual,
  localBounds,
  worldBounds,
  resizePointText,
  rotateVisual,
  selectionQuad,
  visualCenter,
} from '../engine/layerGeometry'
import { shapeNames, shapeTools } from '../engine/shapeGeometry'
import { defaultTextFrame } from '../engine/textLayout'
import { duplicateLayers, subtree } from '../engine/layerOperations'
import { FrameScheduler, SceneRenderer } from '../engine/scene'
import {
  magneticPoint,
  polygonSelection,
  selectionMask,
  selectionPath,
  combineSelection,
  gestureSelectionMode,
  selectionCoverage,
} from '../engine/selection'
import {
  brushStamp,
  createBrushStrokeState,
  retouchStroke,
  sampledBrushStamp,
  strokeStamps,
  type BrushShapeDynamics,
  type BrushStrokeState,
} from '../engine/brush'
import { isRetouchTool, retouchNames } from '../engine/retouch'
import {
  applyGradientStops,
  gradientRgbaCss,
  reflectPosition,
  solidGradient,
  type GradientDefinition,
} from '../engine/gradientRamp'
import { selectionTools } from './ToolRail'
import { validQuad } from '../engine/projection'
import { useEffect, useLayoutEffect, useMemo, useId, useRef, useState } from 'react'
import { Check, Crosshair, Eraser, ScanLine, Sparkles, X } from 'lucide-react'
import type { Editor } from '../hooks/useEditor'
import {
  type EditorDocument,
  type Layer,
  type Point,
  type Rect,
  type Selection,
  type SelectionMode,
  type Tool,
  type ToolSettings,
  MAX_LAYERS,
} from '../types'
import {
  hitTest,
  localPoint,
  makeLayer,
  effectiveLayers,
  isLayerLocked,
  uid,
} from '../engine/document'
import {
  encodeBitmap,
  bitmapLayer,
  prepareDocument,
  isPrepared,
  rasterizeLayer,
  loadImage,
  getImage,
  clearRenderCaches,
  cacheImage,
  validateRasterBudget,
} from '../engine/render'

interface Props {
  pathController: PathController
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
  setSelection: (r: Selection | null, temporary?: boolean, label?: string) => void
  onWand: (point: Point, mode: SelectionMode) => void
  onGuideSettings: () => void
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
  | { type: 'sample-color' }
  | { type: 'guide'; id: string; axis: 'x' | 'y'; before: EditorDocument; fresh: boolean }
  | {
      type: 'quick-mask'
      canvas: HTMLCanvasElement
      last: Point
      stamp: HTMLCanvasElement
      beforeSelection: Selection | null
    }
  | {
      type: 'repair-brush'
      canvas: HTMLCanvasElement
      last: Point
      stamp: HTMLCanvasElement
      beforeSelection: Selection | null
      bbox: { left: number; top: number; right: number; bottom: number }
    }
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
      selectionAlpha?: Uint8ClampedArray
      clone?: { canvas: HTMLCanvasElement; offset: Point }
      mask?: Layer['mask']
      /** Pen state: pressure dynamics apply only to real pen input. */
      pen?: boolean
      pressure?: number
      prevPressure?: number
      /** Pulled-string smoothing state in canvas-grid coordinates. */
      smoothed?: Point
      lastRaw?: Point
      /** Deterministic within one stroke so segments share one dynamics sequence. */
      brushState?: BrushStrokeState
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
  pathController,
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
  onWand,
  onGuideSettings,
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
  const layout = layoutOf(doc)
  const gridId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  // Non-printing guide/view changes must not recomposite a large pixel stack on every pointermove.
  const visualDoc = useMemo(
    () => ({ ...doc, layout: undefined }),
    [doc.id, doc.layers, doc.width, doc.height, doc.background, doc.sourceId],
  )
  const viewport = useRef<HTMLDivElement>(null)
  const artboard = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const repairMask = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const activePointer = useRef<number | null>(null)
  const pointerGesture = useRef(0)
  const activeGesture = useRef(0)
  const releasedGesture = useRef<number | null>(null)
  const selectionGesture = useRef<{ base: Selection | null; mode: SelectionMode } | null>(null)
  const overrides = useRef(new Map<string, HTMLCanvasElement>())
  const [size, setSize] = useState({ width: 900, height: 700 })
  const [revision, setRevision] = useState(0)
  const [spaceDown, setSpaceDown] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [altSampling, setAltSampling] = useState(false)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const paintScheduler = useRef(new FrameScheduler()),
    scheduler = useRef(new FrameScheduler()),
    cursorScheduler = useRef(new FrameScheduler()),
    cursorPoint = useRef<Point | null>(null),
    // Stroke bitmaps encode in the background; the next canvas gesture waits for
    // this chain instead of flashing a blocking overlay after every stroke.
    paintCommit = useRef<Promise<void>>(Promise.resolve()),
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
    !settings.quickMask &&
    selected.kind !== 'group' &&
    selected.kind !== 'adjustment'

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
    setAltSampling(false)
    if (selectionGesture.current) {
      setSelection(selectionGesture.current.base, true)
      selectionGesture.current = null
    }
  }, [tool])
  useEffect(() => onEffectiveZoom(scale), [scale, onEffectiveZoom])
  useEffect(() => {
    overrides.current.clear()
    renderer.current.clear()
    polygon.current = []
    setOutline([])
    clone.current = null
    selectionGesture.current = null
    drag.current = null
  }, [doc.id])
  useEffect(() => {
    let disposed = false
    const paint = () => {
      const el = canvas.current
      if (!el || disposed) return
      const resolution = Math.min(
        scale * Math.min(window.devicePixelRatio || 1, 2),
        2,
        4096 / visualDoc.width,
        4096 / visualDoc.height,
      )
      const width = Math.max(1, Math.round(visualDoc.width * resolution)),
        height = Math.max(1, Math.round(visualDoc.height * resolution))
      if (el.width !== width || el.height !== height) {
        el.width = width
        el.height = height
      }
      const ctx = el.getContext('2d')!
      ctx.setTransform(width / visualDoc.width, 0, 0, height / visualDoc.height, 0, 0)
      ctx.imageSmoothingEnabled = smooth
      ctx.imageSmoothingQuality = 'high'
      const start = performance.now()
      try {
        renderer.current.draw(ctx, visualDoc, overrides.current, selectedId || undefined)
        renderError.current = ''
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка отрисовки'
        if (renderError.current !== message) onToast(message)
        renderError.current = message
        return
      }
      if (showPerformance) setFrameTime(performance.now() - start)
    }
    if (isPrepared(visualDoc)) scheduler.current.request(paint)
    else
      prepareDocument(visualDoc)
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
  }, [visualDoc, scale, revision, selectedId, onToast, smooth, showPerformance])
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
  const targets = (moving?: Layer, excludedGuide?: string) => {
    const result = layoutTargets(doc, layout, excludedGuide)
    if (layout.snapLayers) {
      const excluded = moving ? subtree(doc, moving.id) : new Set<string>()
      for (const l of effectiveLayers(doc))
        if (!excluded.has(l.id) && l.kind !== 'group' && l.kind !== 'adjustment') {
          const b = worldBounds(l)
          result.x.push(b.x, b.x + b.width / 2, b.x + b.width)
          result.y.push(b.y, b.y + b.height / 2, b.y + b.height)
        }
    }
    return result
  }
  const gridSnap =
    layout.showGrid && layout.snapGrid
      ? { x: layout.gridSize / layout.subdivisions, y: layout.gridSizeY / layout.subdivisions }
      : undefined
  const guideKey = (event: React.KeyboardEvent<SVGGElement>, id: string, axis: 'x' | 'y') => {
    if (
      layout.locked ||
      busy ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Enter'].includes(
        event.key,
      )
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') {
      onGuideSettings()
      return
    }
    const step = event.shiftKey ? 10 : 1
    editor.change(
      (d) => ({
        ...d,
        layout: {
          ...layoutOf(d),
          guides:
            event.key === 'Delete' || event.key === 'Backspace'
              ? layoutOf(d).guides.filter((g) => g.id !== id)
              : layoutOf(d).guides.map((g) =>
                  g.id === id
                    ? {
                        ...g,
                        position: Math.min(
                          16384,
                          Math.max(
                            0,
                            g.position +
                              (axis === 'x'
                                ? event.key === 'ArrowRight'
                                  ? step
                                  : event.key === 'ArrowLeft'
                                    ? -step
                                    : 0
                                : event.key === 'ArrowDown'
                                  ? step
                                  : event.key === 'ArrowUp'
                                    ? -step
                                    : 0),
                          ),
                        ),
                      }
                    : g,
                ),
        },
      }),
      'Изменение направляющей',
    )
  }
  const redraw = () => setRevision((v) => v + 1)
  const queuePaintCommit = (job: () => Promise<void>) => {
    const run = paintCommit.current.then(job, job)
    paintCommit.current = run.catch(() => {})
    return run
  }
  /** Sample the visible composite at a document point into the foreground colour. */
  const sampleColorAt = (p: Point, announce = false) => {
    const c = canvas.current
    if (!c || p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return false
    const x = Math.max(0, Math.min(c.width - 1, Math.floor((p.x / doc.width) * c.width))),
      y = Math.max(0, Math.min(c.height - 1, Math.floor((p.y / doc.height) * c.height)))
    const rgba = c.getContext('2d')!.getImageData(x, y, 1, 1).data
    if (!rgba[3]) {
      if (announce) onToast('Здесь прозрачно — цвета нет')
      return false
    }
    const color = '#' + [...rgba.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
    setColor(color)
    if (announce) onToast(`Цвет ${color.toUpperCase()} выбран`)
    return true
  }
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
  const finishSelection = (next: Selection | null) => {
    const gesture = selectionGesture.current
    selectionGesture.current = null
    if (!next) {
      setSelection(gesture?.base || null, true)
      return
    }
    try {
      const result = combineSelection(
        gesture?.base || null,
        next,
        gesture?.mode || 'replace',
        doc.width,
        doc.height,
      )
      setSelection(result, false, 'Выделение пикселей')
      if (!result.width || !result.height)
        onToast('Выделение пустое. Ctrl+Z отменит его, Ctrl+D снимет ограничение.')
    } catch (error) {
      setSelection(gesture?.base || null, true)
      onToast(error instanceof Error ? error.message : 'Ошибка выделения')
    }
  }
  const quickSelection = (c: HTMLCanvasElement) => {
    const rgba = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data,
      alpha = new Uint8ClampedArray(c.width * c.height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4]
    return rasterSelection(alpha, c.width, c.height)
  }
  /** Convert only the painted repair-mask bounds, never the whole document. */
  const repairSelectionFromMask = (
    c: HTMLCanvasElement,
    bbox: { left: number; top: number; right: number; bottom: number },
  ): Selection | null => {
    const left = Math.max(0, Math.floor(bbox.left)),
      top = Math.max(0, Math.floor(bbox.top)),
      width = Math.min(c.width - left, Math.ceil(bbox.right) - left),
      height = Math.min(c.height - top, Math.ceil(bbox.bottom) - top)
    if (width < 1 || height < 1) return null
    const rgba = c.getContext('2d')!.getImageData(left, top, width, height).data,
      alpha = new Uint8ClampedArray(width * height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
    const result = rasterSelection(alpha, width, height, left, top)
    return result.width && result.height ? result : null
  }
  const finishPolygon = () => {
    const next = polygonSelection(polygon.current, settings.feather || 0)
    finishSelection(next)
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
  const drawPaintSegment = (d: Extract<Drag, { type: 'paint' }>, from: Point, to: Point) => {
    if (isRetouchTool(d.tool)) {
      retouchStroke(
        d.canvas.getContext('2d', { willReadFrequently: true })!,
        from,
        to,
        settings.brushSize * (d.canvas.width / d.layer.width),
        d.tool,
        settings,
        d.selectionAlpha,
      )
      return
    }
    // Pen pressure scales stamp size (default) and/or alpha across the
    // segment. Mouse input reports no pen flag, so its behaviour is fixed.
    const minimumDiameter = Math.min(1, Math.max(0, (settings.brushMinimumDiameter ?? 0) / 100)),
      scaleFor = (pr: number) =>
        settings.pressureSize === false
          ? 1
          : Math.max(0.05, minimumDiameter + Math.min(1, Math.max(0, pr)) * (1 - minimumDiameter)),
      alphaFor = (pr: number) => (settings.pressureOpacity ? Math.max(0.05, Math.min(1, pr)) : 1),
      dynamics =
        d.pen && (d.tool === 'brush' || d.tool === 'eraser')
          ? {
              fromScale: scaleFor(d.prevPressure ?? d.pressure ?? 1),
              toScale: scaleFor(d.pressure ?? 1),
              fromAlpha: alphaFor(d.prevPressure ?? d.pressure ?? 1),
              toAlpha: alphaFor(d.pressure ?? 1),
            }
          : undefined,
      needsShape =
        (d.tool === 'brush' || d.tool === 'eraser') &&
        (!!settings.brushTip ||
          !!settings.brushAngle ||
          (settings.brushRoundness ?? 100) !== 100 ||
          !!settings.brushFlipX ||
          !!settings.brushFlipY ||
          !!settings.brushSizeJitter ||
          !!settings.brushOpacityJitter ||
          !!settings.brushAngleJitter ||
          !!settings.brushRoundnessJitter ||
          !!settings.brushFlipXJitter ||
          !!settings.brushFlipYJitter ||
          !!settings.brushScatter ||
          (settings.brushScatterCount ?? 1) > 1 ||
          !!settings.brushCountJitter ||
          (settings.brushAngleControl && settings.brushAngleControl !== 'off')),
      shape: BrushShapeDynamics | undefined = needsShape
        ? {
            angle: settings.brushAngle ?? 0,
            roundness: (settings.brushRoundness ?? 100) / 100,
            flipX: !!settings.brushFlipX,
            flipY: !!settings.brushFlipY,
            sizeJitter: (settings.brushSizeJitter ?? 0) / 100,
            opacityJitter: (settings.brushOpacityJitter ?? 0) / 100,
            angleJitter: (settings.brushAngleJitter ?? 0) / 100,
            roundnessJitter: (settings.brushRoundnessJitter ?? 0) / 100,
            minimumDiameter,
            minimumRoundness: (settings.brushMinimumRoundness ?? 25) / 100,
            minimumOpacity: (settings.brushMinimumOpacity ?? 0) / 100,
            angleControl: settings.brushAngleControl ?? 'off',
            flipXJitter: !!settings.brushFlipXJitter,
            flipYJitter: !!settings.brushFlipYJitter,
            scatter: (settings.brushScatter ?? 0) / 100,
            bothAxes: !!settings.brushScatterBothAxes,
            count: settings.brushScatterCount ?? 1,
            countJitter: (settings.brushCountJitter ?? 0) / 100,
            state: d.brushState,
          }
        : undefined
    strokeStamps(
      d.canvas.getContext('2d')!,
      from,
      to,
      d.stamp,
      settings,
      d.tool === 'eraser',
      d.selection,
      d.clone,
      dynamics,
      shape,
    )
  }
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
    // Pulled-string smoothing: the painted point chases the pointer with a
    // catch-up factor; pointerUp flushes the remainder to the raw end point.
    let target = next
    const smoothing = Math.min(100, Math.max(0, settings.brushSmoothing ?? 0))
    if (smoothing > 0) {
      const prev = d.smoothed || d.last,
        k = 1 - (smoothing / 100) * 0.92
      target = { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k }
      d.smoothed = target
      d.lastRaw = next
    }
    drawPaintSegment(d, d.last, target)
    d.last = target
    d.prevPressure = d.pressure
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
  const finishPaintDrag = (d: Extract<Drag, { type: 'paint' }>) => {
    // Smoothing catch-up: finish the stroke at the real pointer position.
    if (d.smoothed && d.lastRaw && (d.lastRaw.x !== d.last.x || d.lastRaw.y !== d.last.y)) {
      drawPaintSegment(d, d.last, d.lastRaw)
      d.last = d.lastRaw
      d.smoothed = d.lastRaw
    }
    // No busy overlay for a routine stroke: the live canvas stays on screen
    // via the override while PNG encoding finishes in the background. The
    // next pointer gesture silently waits for this commit (see pointerDown).
    void queuePaintCommit(async () => {
      if (d.mask) {
        try {
          const bitmap = await encodeBitmap(d.layer, d.canvas)
          validateRasterBudget({
            ...editor.documentRef.current,
            layers: editor.documentRef.current.layers.map((l) =>
              l.id === d.layer.id ? { ...l, mask: { ...d.mask!, src: bitmap.src! } } : l,
            ),
          })
          editor.patchLayer(d.layer.id, { mask: { ...d.mask, src: bitmap.src! } }, '', true)
          editor.finish('Рисование по маске')
        } catch {
          editor.change(() => d.before, '', true)
          onToast('Не удалось сохранить маску')
        }
        return
      }
      const next = await encodeBitmap(d.layer, d.canvas).catch(() => null)
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
        d.tool === 'eraser'
          ? 'Ластик'
          : d.tool === 'clone'
            ? 'Штамп'
            : isRetouchTool(d.tool)
              ? retouchNames[d.tool]
              : 'Рисование кистью',
      )
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
    const gesture = ++pointerGesture.current
    activeGesture.current = gesture
    releasedGesture.current = null
    const gestureUsable = () =>
      activeGesture.current === gesture &&
      (activePointer.current === e.pointerId || releasedGesture.current === gesture)
    // A previous stroke may still be encoding in the background. Never start a
    // new gesture from the pre-stroke document: wait silently for its commit.
    await paintCommit.current
    if (activePointer.current !== e.pointerId) return
    let p = pointFrom(e)
    if (spaceDown || tool === 'hand' || e.button === 1) {
      drag.current = { type: 'pan', client: { x: e.clientX, y: e.clientY }, pan }
      return
    }
    const guideId = (e.target as Element).closest('[data-guide-id]')?.getAttribute('data-guide-id')
    const ruler = (e.target as Element).closest('.ruler-x,.ruler-y')
    if (!settings.quickMask && (ruler || (tool === 'move' && guideId))) {
      if (layout.locked) return onToast('Направляющие заблокированы. Разблокируй их в меню «Вид».')
      if (ruler && layout.guides.length >= 200) return onToast('До 200 направляющих на документ.')
      const existing = layout.guides.find((g) => g.id === guideId),
        axis = existing?.axis || (ruler?.classList.contains('ruler-x') ? 'y' : 'x'),
        id = existing?.id || uid()
      if (!existing)
        editor.change(
          (d) => ({
            ...d,
            layout: {
              ...layoutOf(d),
              showGuides: true,
              guides: [...layoutOf(d).guides, { id, axis, position: Math.max(0, p[axis]) }],
            },
          }),
          '',
          true,
        )
      drag.current = { type: 'guide', id, axis, before: doc, fresh: !existing }
      setTool('move')
      ;(e.target as SVGElement).closest<SVGElement>('[data-guide-id]')?.focus()
      return
    }
    if (
      settings.quickMask &&
      !['brush', 'eraser', 'hand', 'eyedropper', ...selectionTools].includes(tool)
    )
      return onToast(
        'Быстрая маска: используй B/E и инструменты выделения. Q возвращает обычное редактирование.',
      )
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
    if (
      layout.snap &&
      !e.ctrlKey &&
      !e.metaKey &&
      (tool === 'pen' ||
        tool === 'select' ||
        tool === 'ellipse-select' ||
        tool === 'crop' ||
        shapeTools.some((s) => s === tool))
    )
      p = clip(snapPoint(p, targets(), 8 / scale, gridSnap))
    if (!inside(p)) {
      if (tool === 'move') onSelect(null)
      return
    }
    if (tool === 'brush' && e.altKey && !settings.quickMask && !settings.editMask) {
      // Temporary eyedropper: sample while Alt is held, then keep painting with
      // the same brush — no tool switch. Dragging updates the colour live.
      setAltSampling(true)
      sampleColorAt(p)
      drag.current = { type: 'sample-color' }
      return
    }
    if (pathController.active) {
      // `el`, not e.currentTarget: after the paintCommit await above, React has
      // finished dispatching and currentTarget is null.
      el.focus({ preventScroll: true })
      if (pathController.down(p, e, scale)) return
    }
    if (settings.quickMask && (tool === 'brush' || tool === 'eraser')) {
      const buffer = document.createElement('canvas')
      buffer.width = doc.width
      buffer.height = doc.height
      const x = buffer.getContext('2d')!,
        image = x.createImageData(doc.width, doc.height),
        alpha = selectionCoverage(selection, doc.width, doc.height, 255)
      for (let i = 0; i < alpha.length; i++) {
        image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = alpha[i]
        image.data[i * 4 + 3] = 255
      }
      x.putImageData(image, 0, 0)
      const rgb = [1, 3, 5].map((i) => parseInt(settings.color.slice(i, i + 2), 16)),
        grey = tool === 'eraser' ? 255 : Math.round(rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11)
      const stamp = brushStamp(
        settings.brushSize,
        '#' + grey.toString(16).padStart(2, '0').repeat(3),
        settings.brushHardness ?? 100,
      )
      drag.current = {
        type: 'quick-mask',
        canvas: buffer,
        last: p,
        stamp,
        beforeSelection: selection,
      }
      strokeStamps(x, p, p, stamp, settings, false)
      setSelection(quickSelection(buffer), true)
      return
    }
    if (tool === 'repair-brush') {
      const buffer = repairMask.current
      if (!buffer) return
      const x = buffer.getContext('2d')!
      x.clearRect(0, 0, buffer.width, buffer.height)
      const stamp = brushStamp(settings.brushSize, '#b7a2ff', settings.brushHardness ?? 100),
        radius = stamp.width / 2 + 1,
        d: Extract<Drag, { type: 'repair-brush' }> = {
          type: 'repair-brush',
          canvas: buffer,
          last: p,
          stamp,
          beforeSelection: selection,
          bbox: {
            left: p.x - radius,
            top: p.y - radius,
            right: p.x + radius,
            bottom: p.y + radius,
          },
        }
      drag.current = d
      setSelection(null, true)
      strokeStamps(x, p, p, stamp, { ...settings, brushOpacity: 100 }, e.altKey)
      return
    }
    if (tool === 'magic-wand') {
      onWand(p, gestureSelectionMode(e, settings.selectionMode))
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
      if (hit && hit.kind !== 'adjustment' && !isLayerLocked(doc, hit.id) && hit.visible) {
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
      selectionGesture.current = {
        base: selection,
        mode: tool === 'repair' ? 'replace' : gestureSelectionMode(e, settings.selectionMode),
      }
      setSelection(null, true)
      drag.current = { type: 'lasso', points: [p], repair: tool === 'repair' }
      setOutline([p])
    } else if (tool === 'polygon-lasso' || tool === 'magnetic-lasso') {
      if (!polygon.current.length) {
        selectionGesture.current = {
          base: selection,
          mode: gestureSelectionMode(e, settings.selectionMode),
        }
        setSelection(null, true)
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
      selectionGesture.current = {
        base: selection,
        mode: selectionTools.includes(tool)
          ? gestureSelectionMode(e, settings.selectionMode)
          : 'replace',
      }
      setSelection({ ...p, width: 0, height: 0 }, true)
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
      sampleColorAt(p, true)
      drag.current = { type: 'sample-color' }
    } else if (tool === 'wand' || tool === 'bucket') onPixelAction(tool, p)
    else if (tool === 'brush' || tool === 'eraser' || tool === 'clone' || isRetouchTool(tool)) {
      const maskMode = settings.editMask && !!selected?.mask
      if (
        (selected?.smart || selected?.kind === 'group' || selected?.kind === 'adjustment') &&
        !maskMode
      )
        return onToast('Открой содержимое смарт-объекта или выбери растровый слой')
      if (tool === 'clone' && (!selected || selected.kind !== 'image'))
        return onToast('Штамп работает на выбранном растровом слое. Alt+клик задаёт источник.')
      if (isRetouchTool(tool) && (!selected || selected.kind !== 'image' || maskMode))
        return onToast('Ретушь работает по пикселям выбранного растрового слоя, а не по маске.')
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
        if (!gestureUsable()) return
        if (layer.kind !== 'image' && !maskMode) {
          layer = bitmapLayer(layer, buffer)
          editor.patchLayer(layer.id, layer, '', true)
          onToast('Слой растрирован для работы ластиком. Это можно отменить.')
        }
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
      if (!gestureUsable()) return
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
      const selectionCanvas = selection
        ? selectionMask(selection, buffer.width, buffer.height, layer, targetMask)
        : undefined
      let selectionAlpha: Uint8ClampedArray | undefined
      if (selectionCanvas && isRetouchTool(tool)) {
        const rgba = selectionCanvas
          .getContext('2d')!
          .getImageData(0, 0, buffer.width, buffer.height).data
        selectionAlpha = new Uint8ClampedArray(buffer.width * buffer.height)
        for (let i = 0; i < selectionAlpha.length; i++) selectionAlpha[i] = rgba[i * 4 + 3]
      }
      let stamp = brushStamp(settings.brushSize * sx, settings.color, settings.brushHardness ?? 100)
      if (settings.brushTip && tool !== 'clone') {
        const cachedTip = getImage(settings.brushTip.src)
        if (cachedTip) stamp = sampledBrushStamp(cachedTip, settings.brushSize * sx, settings.color)
        else {
          try {
            const tipImage = await loadImage(settings.brushTip.src)
            if (!gestureUsable()) return
            stamp = sampledBrushStamp(tipImage, settings.brushSize * sx, settings.color)
          } catch {
            onToast('Наконечник кисти не загрузился — использована круглая кисть.')
          }
        }
      }
      if (!gestureUsable()) return
      const d: Extract<Drag, { type: 'paint' }> = {
        type: 'paint',
        layer,
        canvas: buffer,
        before,
        tool,
        last,
        mask: targetMask,
        stamp,
        brushState: createBrushStrokeState(),
        selection: selectionCanvas,
        selectionAlpha,
        pen: e.pointerType === 'pen',
        pressure: e.pointerType === 'pen' ? Math.min(1, Math.max(0, e.pressure)) : 1,
        clone:
          tool === 'clone' && clone.current
            ? { canvas: clone.current.canvas, offset: clone.current.offset! }
            : undefined,
      }
      drag.current = d
      if (!targetMask) overrides.current.set(layer.id, buffer)
      paintSegment(d, p)
      if (releasedGesture.current === gesture) {
        // A very short click can release before async layer/tip preparation
        // creates the drag. It is still one intentional dab: commit it now
        // instead of leaving a phantom drag for the next pointer-up.
        drag.current = null
        releasedGesture.current = null
        finishPaintDrag(d)
      }
    }
  }
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointFrom(e)
    if (!drag.current && pathController.move(p, e)) return
    if (
      tool === 'brush' ||
      tool === 'eraser' ||
      tool === 'clone' ||
      tool === 'repair-brush' ||
      isRetouchTool(tool)
    ) {
      // Cursor state at frame rate, not per pointer event: fast strokes must
      // not re-render the whole stage for every hardware sample.
      cursorPoint.current = p
      cursorScheduler.current.request(() => setCursor(cursorPoint.current))
      const sampling = tool === 'brush' && e.altKey && !settings.quickMask && !settings.editMask
      setAltSampling((prev) => (prev === sampling ? prev : sampling))
    }
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
    if (d.type === 'sample-color') {
      if (tool === 'eyedropper' || e.altKey) sampleColorAt(p)
      return
    }
    if (d.type === 'quick-mask') {
      const events = e.nativeEvent.getCoalescedEvents?.() || []
      for (const event of events.length ? events : [e.nativeEvent]) {
        const point = pointFrom(event)
        strokeStamps(d.canvas.getContext('2d')!, d.last, point, d.stamp, settings, false)
        d.last = point
      }
      paintScheduler.current.request(() => {
        if (drag.current === d) setSelection(quickSelection(d.canvas), true)
      })
      return
    }
    if (d.type === 'repair-brush') {
      const events = e.nativeEvent.getCoalescedEvents?.() || [],
        radius = d.stamp.width / 2 + 1
      for (const event of events.length ? events : [e.nativeEvent]) {
        const point = pointFrom(event)
        strokeStamps(
          d.canvas.getContext('2d')!,
          d.last,
          point,
          d.stamp,
          { ...settings, brushOpacity: 100 },
          e.altKey,
        )
        d.last = point
        d.bbox.left = Math.min(d.bbox.left, point.x - radius)
        d.bbox.top = Math.min(d.bbox.top, point.y - radius)
        d.bbox.right = Math.max(d.bbox.right, point.x + radius)
        d.bbox.bottom = Math.max(d.bbox.bottom, point.y + radius)
      }
      return
    }
    if (d.type === 'paint') {
      // Hardware samples between animation frames keep fast strokes curved
      // instead of straight chords between frame-rate points.
      const events = e.nativeEvent.getCoalescedEvents?.() || []
      for (const event of events.length ? events : [e.nativeEvent]) {
        if (event.pointerType === 'pen') {
          d.pen = true
          d.pressure = Math.min(1, Math.max(0, event.pressure))
        }
        paintSegment(d, pointFrom(event))
      }
      return
    }
    if (d.type === 'lasso') {
      const last = d.points.at(-1)!
      if (Math.hypot(p.x - last.x, p.y - last.y) > 2 / scale && d.points.length < 4096)
        d.points.push(clip(p))
      setOutline([...d.points])
      return
    }
    if (d.type === 'guide') {
      let position = p[d.axis]
      if (e.shiftKey) {
        const step = (d.axis === 'x' ? layout.gridSize : layout.gridSizeY) / layout.subdivisions
        position = Math.round(position / step) * step
      } else if (layout.snap && !e.ctrlKey && !e.metaKey)
        position = snapPoint(p, targets(undefined, d.id), 8 / scale, gridSnap)[d.axis]
      position = Math.round(position * 32) / 32
      editor.change(
        (current) => ({
          ...current,
          layout: {
            ...layoutOf(current),
            guides: layoutOf(current).guides.map((g) => (g.id === d.id ? { ...g, position } : g)),
          },
        }),
        '',
        true,
      )
      return
    }
    if (d.type === 'region') {
      const end =
        layout.snap && !e.ctrlKey && !e.metaKey && !d.repair && !d.textFrame
          ? clip(snapPoint(p, targets(), 8 / scale, gridSnap))
          : clip(p)
      setSelection(
        {
          ...getRect(d.start, end),
          ellipse: tool === 'ellipse-select',
          feather: settings.feather || 0,
        },
        true,
      )
      return
    }
    if (d.type === 'gradient') {
      const ctx = d.canvas.getContext('2d')!,
        length = Math.max(1, Math.hypot(p.x - d.start.x, p.y - d.start.y))
      ctx.clearRect(0, 0, doc.width, doc.height)
      const definition: GradientDefinition =
        settings.gradient ||
        solidGradient([
          { position: 0, color: settings.color },
          { position: 1, color: settings.secondaryColor },
        ])
      const type = settings.gradientType || 'linear'
      let g: CanvasGradient
      if (type === 'radial') {
        g = ctx.createRadialGradient(d.start.x, d.start.y, 0, d.start.x, d.start.y, length)
        applyGradientStops(g, definition)
      } else if (type === 'angle' && typeof ctx.createConicGradient === 'function') {
        g = ctx.createConicGradient(
          Math.atan2(p.y - d.start.y, p.x - d.start.x),
          d.start.x,
          d.start.y,
        )
        applyGradientStops(g, definition)
      } else if (type === 'reflected') {
        g = ctx.createLinearGradient(d.start.x, d.start.y, p.x, p.y)
        for (let i = 0; i <= 64; i++)
          g.addColorStop(i / 64, gradientRgbaCss(definition, reflectPosition(i / 64)))
      } else {
        g = ctx.createLinearGradient(d.start.x, d.start.y, p.x, p.y)
        applyGradientStops(g, definition)
      }
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
      const shapePoint =
        layout.snap && !e.ctrlKey && !e.metaKey
          ? snapPoint(p, targets(d.before.layers.find((l) => l.id === d.id)), 8 / scale, gridSnap)
          : p
      if (tool === 'line') {
        const length = Math.max(1, Math.hypot(shapePoint.x - d.start.x, shapePoint.y - d.start.y))
        let angle = Math.atan2(shapePoint.y - d.start.y, shapePoint.x - d.start.x)
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
      let end = shapePoint
      if (e.shiftKey) {
        const m = Math.max(Math.abs(shapePoint.x - d.start.x), Math.abs(shapePoint.y - d.start.y))
        end = {
          x: d.start.x + m * Math.sign(shapePoint.x - d.start.x || 1),
          y: d.start.y + m * Math.sign(shapePoint.y - d.start.y || 1),
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
      let guideX: number | null = null,
        guideY: number | null = null
      if (layout.snap && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const delta = snapBounds(
          d.layer.kind === 'group'
            ? (() => {
                const b = (() => {
                  try {
                    return arrangementBounds(d.before, d.layer)
                  } catch {
                    return worldBounds(d.layer)
                  }
                })()
                return { ...b, x: b.x + x - d.layer.x, y: b.y + y - d.layer.y }
              })()
            : worldBounds({ ...d.layer, x, y }),
          targets(d.layer),
          8 / scale,
          gridSnap,
        )
        x += delta.dx
        y += delta.dy
        guideX = delta.x
        guideY = delta.y
      }
      setGuides({ x: settings.showGuides ? guideX : null, y: settings.showGuides ? guideY : null })
      editor.patchLayer(d.layer.id, { x, y }, '', true)
    } else if (d.type === 'rotate') {
      const center = visualCenter(d.layer)
      const angle = (q: Point) => Math.atan2(q.y - center.y, q.x - center.x)
      let rotation = d.layer.rotation + ((angle(p) - angle(d.start)) * 180) / Math.PI
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
      editor.patchLayer(d.layer.id, rotateVisual(d.layer, (rotation + 360) % 360), '', true)
    } else if (d.type === 'distort') {
      const current = localPoint(d.layer, p, false),
        start = localPoint(d.layer, d.start, false)
      const quad = distortVisual(d.layer, d.handle!, current.x - start.x, current.y - start.y)
      if (validQuad(quad)) editor.patchLayer(d.layer.id, { warp: quad }, '', true)
    } else if (d.type === 'resize') {
      if (d.layer.kind === 'text' && !d.layer.textFrame) {
        const b = localBounds(d.layer, true),
          pLocal = localPoint(d.layer, p),
          h = d.handle!
        const startLocal = localPoint(d.layer, d.start)
        pLocal.x =
          (h.includes('w') ? b.x : h.includes('e') ? b.x + b.width : b.x + b.width / 2) +
          pLocal.x -
          startLocal.x
        pLocal.y =
          (h.includes('n') ? b.y : h.includes('s') ? b.y + b.height : b.y + b.height / 2) +
          pLocal.y -
          startLocal.y
        let x1 = h.includes('w') ? Math.min(pLocal.x, b.x + b.width - 4) : b.x
        let y1 = h.includes('n') ? Math.min(pLocal.y, b.y + b.height - 4) : b.y
        let x2 = h.includes('e') ? Math.max(pLocal.x, b.x + 4) : b.x + b.width
        let y2 = h.includes('s') ? Math.max(pLocal.y, b.y + 4) : b.y + b.height
        if (h.length === 2 && !e.shiftKey) {
          const ratio = Math.max((x2 - x1) / b.width, (y2 - y1) / b.height)
          if (h.includes('w')) x1 = x2 - b.width * ratio
          else x2 = x1 + b.width * ratio
          if (h.includes('n')) y1 = y2 - b.height * ratio
          else y2 = y1 + b.height * ratio
        }
        editor.patchLayer(
          d.layer.id,
          resizePointText(
            d.layer,
            { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
            {
              x: h.includes('w') ? 1 : h.includes('e') ? 0 : 0.5,
              y: h.includes('n') ? 1 : h.includes('s') ? 0 : 0.5,
            },
          ),
          '',
          true,
        )
        return
      }
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
                ...(d.layer.textBaselineShift
                  ? {
                      textBaselineShift: Math.max(
                        -1000,
                        Math.min(1000, (d.layer.textBaselineShift * height) / d.layer.height),
                      ),
                    }
                  : {}),
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
    const pointerWasActive = activePointer.current === e.pointerId
    activePointer.current = null
    const d = drag.current
    drag.current = null
    setGuides({ x: null, y: null })
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (pathController.up()) return
    if (!d) {
      if (pointerWasActive) releasedGesture.current = activeGesture.current
      return
    }
    if (d.type === 'sample-color') {
      setAltSampling(false)
      return
    }
    if (d.type === 'guide') {
      if (editor.documentRef.current === d.before) return
      const position = pointFrom(e)[d.axis],
        outside = position < 0 || position > (d.axis === 'x' ? doc.width : doc.height)
      if (outside && d.fresh) {
        editor.change(() => d.before, '', true)
        return
      }
      if (outside)
        editor.change(
          (current) => ({
            ...current,
            layout: {
              ...layoutOf(current),
              guides: layoutOf(current).guides.filter((g) => g.id !== d.id),
            },
          }),
          '',
          true,
        )
      editor.finish(
        outside
          ? 'Удаление направляющей'
          : d.fresh
            ? 'Новая направляющая'
            : 'Перемещение направляющей',
      )
      return
    }
    if (d.type === 'quick-mask') {
      setSelection(quickSelection(d.canvas), false, 'Рисование быстрой маски')
      return
    }
    if (d.type === 'repair-brush') {
      const result = repairSelectionFromMask(d.canvas, d.bbox)
      d.canvas.getContext('2d')!.clearRect(0, 0, d.canvas.width, d.canvas.height)
      if (!result) {
        setSelection(d.beforeSelection, true)
        onToast('Закрась объект, который нужно убрать')
        return
      }
      setSelection(result, false, 'Область удаления')
      onRepair(result)
      return
    }
    if (d.type === 'lasso') {
      const selected = polygonSelection(d.points, settings.feather || 0)
      finishSelection(selected)
      if (d.repair && selected) onRepair(selected)
      setOutline([])
      return
    }
    if (d.type === 'region' && d.textFrame) {
      const rect = getRect(d.start, clip(pointFrom(e))),
        previous = selectionGesture.current?.base || null
      selectionGesture.current = null
      setSelection(null, true)
      if (rect.width < 20 || rect.height < 20) {
        setSelection(previous, true)
        onToast('Протяни рамку от 20 × 20 px')
        return
      }
      if (editor.documentRef.current.layers.length >= MAX_LAYERS) {
        setSelection(previous, true)
        onToast('До 100 слоёв в проекте')
        return
      }
      const layer = makeLayer({
        ...rect,
        kind: 'text',
        name: 'Текстовая рамка',
        text: 'Новый текст',
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
        finishSelection(selected)
        onRepair(selected)
      } else finishSelection(null)
      return
    }
    if (d.type === 'region') {
      finishSelection({
        ...getRect(
          d.start,
          layout.snap && !e.ctrlKey && !e.metaKey
            ? clip(snapPoint(pointFrom(e), targets(), 8 / scale, gridSnap))
            : clip(pointFrom(e)),
        ),
        ellipse: tool === 'ellipse-select',
        feather: settings.feather || 0,
      })
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
      finishPaintDrag(d)
    } else if (d.type === 'shape') {
      const layer = editor.documentRef.current.layers.find((l) => l.id === d.id)!
      if (layer.width < 4 && layer.height < 4)
        editor.patchLayer(d.id, { width: 240, height: 160 }, '', true)
      editor.finish('Добавление фигуры')
      setTool('move')
    } else if (d.type !== 'pan')
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
    activeGesture.current = ++pointerGesture.current
    releasedGesture.current = null
    pathController.cancelGesture()
    paintScheduler.current.cancel()
    setAltSampling(false)
    const d = drag.current
    if (selectionGesture.current) {
      setSelection(selectionGesture.current.base, true)
      selectionGesture.current = null
    }
    if (d?.type === 'quick-mask') setSelection(d.beforeSelection, true)
    if (d?.type === 'repair-brush') {
      d.canvas.getContext('2d')!.clearRect(0, 0, d.canvas.width, d.canvas.height)
      setSelection(d.beforeSelection, true)
    }
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
    setGuides({ x: null, y: null })
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
  const quad = selected ? selectionQuad(selected) : []
  const rotationHandle = quad.length
    ? { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 }
    : { x: 0, y: 0 }
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
      className={`canvas-viewport tool-${spaceDown ? 'hand' : tool} ${busy ? 'is-busy' : ''} ${altSampling ? 'alt-sampling' : ''}`}
      data-testid="canvas-viewport"
      tabIndex={-1}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={cancelPointer}
      onPointerLeave={() => {
        cursorScheduler.current.cancel()
        cursorPoint.current = null
        setCursor(null)
        setAltSampling(false)
      }}
      onDoubleClick={(e) => {
        if (tool === 'pen' && pathController.draft?.knots.length) {
          pathController.finishDraft(false)
          return
        }
        if ((e.target as Element).closest('[data-guide-id]')) {
          onGuideSettings()
          return
        }
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
          <div className="ruler ruler-x" title="Потяни вниз — горизонтальная направляющая">
            {xTicks.map((t) => (
              <span key={t} style={{ left: left + t * scale }}>
                {t}
              </span>
            ))}
          </div>
          <div className="ruler ruler-y" title="Потяни вправо — вертикальная направляющая">
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
        {settings.quickMask && (
          <QuickMaskOverlay selection={selection} width={doc.width} height={doc.height} />
        )}
        {tool === 'repair-brush' && (
          <canvas
            ref={repairMask}
            className="repair-mask-overlay"
            data-testid="repair-mask-overlay"
            aria-label="Закрашенная область удаления"
            width={doc.width}
            height={doc.height}
          />
        )}
        <svg
          className="canvas-overlay"
          width="100%"
          height="100%"
          viewBox={`0 0 ${doc.width} ${doc.height}`}
        >
          {layout.showGrid && (
            <>
              <defs>
                <pattern
                  id={`${gridId}-minor`}
                  patternUnits="userSpaceOnUse"
                  width={layout.gridSize / layout.subdivisions}
                  height={layout.gridSizeY / layout.subdivisions}
                >
                  <path
                    d={`M${layout.gridSize / layout.subdivisions} 0H0V${layout.gridSizeY / layout.subdivisions}`}
                    fill="none"
                    stroke="#b5abc5"
                    strokeOpacity=".19"
                    strokeWidth={0.5 / scale}
                  />
                </pattern>
                <pattern
                  id={`${gridId}-major`}
                  patternUnits="userSpaceOnUse"
                  width={layout.gridSize * Math.max(1, Math.ceil(8 / (layout.gridSize * scale)))}
                  height={layout.gridSizeY * Math.max(1, Math.ceil(8 / (layout.gridSizeY * scale)))}
                >
                  <path
                    d={`M${layout.gridSize * Math.max(1, Math.ceil(8 / (layout.gridSize * scale)))} 0H0V${layout.gridSizeY * Math.max(1, Math.ceil(8 / (layout.gridSizeY * scale)))}`}
                    fill="none"
                    stroke="#b5abc5"
                    strokeOpacity=".38"
                    strokeWidth={0.7 / scale}
                  />
                </pattern>
              </defs>
              {(Math.min(layout.gridSize, layout.gridSizeY) * scale) / layout.subdivisions >= 6 && (
                <rect width={doc.width} height={doc.height} fill={`url(#${gridId}-minor)`} />
              )}
              <rect
                data-testid="document-grid"
                width={doc.width}
                height={doc.height}
                fill={`url(#${gridId}-major)`}
              />
            </>
          )}
          {layout.showGuides &&
            layout.guides.map((g) => (
              <g
                key={g.id}
                data-guide-id={g.id}
                data-testid="document-guide"
                role="button"
                aria-label={`${g.axis === 'x' ? 'Вертикальная' : 'Горизонтальная'} направляющая ${g.position} px`}
                tabIndex={!layout.locked && tool === 'move' ? 0 : -1}
                onKeyDown={(e) => guideKey(e, g.id, g.axis)}
              >
                <line
                  x1={g.axis === 'x' ? g.position : -left / scale}
                  x2={g.axis === 'x' ? g.position : (size.width - left) / scale}
                  y1={g.axis === 'y' ? g.position : -top / scale}
                  y2={g.axis === 'y' ? g.position : (size.height - top) / scale}
                  stroke={layout.guideColor}
                  strokeWidth={1 / scale}
                />
                <rect
                  className="guide-hit"
                  x={g.axis === 'x' ? g.position - 4 / scale : -left / scale}
                  y={g.axis === 'y' ? g.position - 4 / scale : -top / scale}
                  width={g.axis === 'x' ? 8 / scale : size.width / scale}
                  height={g.axis === 'y' ? 8 / scale : size.height / scale}
                  fill="transparent"
                  style={{
                    pointerEvents:
                      !layout.locked && tool === 'move' && !settings.quickMask ? 'all' : 'none',
                    cursor: g.axis === 'x' ? 'col-resize' : 'row-resize',
                  }}
                />
              </g>
            ))}
          {guides.x !== null && (
            <line
              x1={guides.x}
              y1={0}
              x2={guides.x}
              y2={doc.height}
              stroke="#d99cff"
              strokeWidth={1 / scale}
            />
          )}
          {guides.y !== null && (
            <line
              x1={0}
              y1={guides.y}
              x2={doc.width}
              y2={guides.y}
              stroke="#d99cff"
              strokeWidth={1 / scale}
            />
          )}
          {showTransform && (
            <g
              transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation}) translate(${-selected.width / 2} ${-selected.height / 2})`}
            >
              <polygon
                data-testid="transform-outline"
                points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#b3a0ff"
                strokeWidth={1 / scale}
              />
              <line
                x1={rotationHandle.x}
                y1={rotationHandle.y}
                x2={rotationHandle.x}
                y2={rotationHandle.y - 24 / scale}
                stroke="#b3a0ff"
                strokeWidth={1 / scale}
              />
              <circle
                data-handle="rotate"
                cx={rotationHandle.x}
                cy={rotationHandle.y - 24 / scale}
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
          <PathOverlay controller={pathController} scale={scale} color={settings.color} />
          {outline.length > 0 && (
            <polyline
              points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
              stroke="#fff"
              strokeWidth={1.2 / scale}
              fill="none"
            />
          )}
          {selectionGesture.current?.base &&
            selectionGesture.current.mode !== 'replace' &&
            !settings.quickMask && (
              <path
                d={selectionPath(selectionGesture.current.base)}
                fill="none"
                stroke="#bda6ff"
                strokeDasharray={`${3 / scale} ${3 / scale}`}
                strokeWidth={1 / scale}
              />
            )}
          {selection && !settings.quickMask && (
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
          {cursor &&
            (tool === 'brush' ||
              tool === 'eraser' ||
              tool === 'clone' ||
              tool === 'repair-brush' ||
              isRetouchTool(tool)) && (
              <>
                {altSampling && tool === 'brush' ? (
                  <g stroke="#fffd" strokeWidth={1 / scale}>
                    <circle
                      cx={cursor.x}
                      cy={cursor.y}
                      r={7 / scale}
                      fill="none"
                      stroke="#0009"
                      strokeWidth={3 / scale}
                    />
                    <circle cx={cursor.x} cy={cursor.y} r={7 / scale} fill="none" />
                    <line
                      x1={cursor.x - 11 / scale}
                      y1={cursor.y}
                      x2={cursor.x + 11 / scale}
                      y2={cursor.y}
                    />
                    <line
                      x1={cursor.x}
                      y1={cursor.y - 11 / scale}
                      x2={cursor.x}
                      y2={cursor.y + 11 / scale}
                    />
                  </g>
                ) : (
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
              </>
            )}
        </svg>
      </div>
      {settings.quickMask ? (
        <div className="quick-mask-hint">
          Быстрая маска · B: чёрный убирает / белый добавляет · E: проявить · Q: закончить
        </div>
      ) : pathController.active ? (
        <PathToolbar controller={pathController} />
      ) : selection &&
        selection.width > 2 &&
        selection.height > 2 &&
        (tool === 'crop' || selectionTools.includes(tool)) ? (
        <div className="selection-actions">
          <span>
            <ScanLine size={15} />
            {Math.round(selection.width)} × {Math.round(selection.height)}
            {selection.raster && rasterOutline(selection.raster).simplified && (
              <small title="Для скорости упрощён только видимый контур. Покрытие сохраняется попиксельно; Q показывает точную маску.">
                {' '}
                · контур ≈
              </small>
            )}
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
