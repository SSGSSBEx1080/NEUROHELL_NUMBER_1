import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Crosshair, Eraser, ScanLine, Sparkles, X } from 'lucide-react'
import type { Editor } from '../hooks/useEditor'
import { type EditorDocument, type Layer, type Point, type Rect, type Tool, type ToolSettings, MAX_LAYERS } from '../types'
import { hitTest, localPoint, makeLayer } from '../engine/document'
import { bitmapLayer, prepareDocument, rasterizeLayer, renderDocument } from '../engine/render'

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
  selection: Rect | null
  setSelection: (r: Rect | null) => void
  onCrop: () => void
  onPixelAction: (operation: 'wand' | 'erase' | 'fill', point?: Point) => void
  onToast: (message: string) => void
  rulers: boolean
  busy: boolean
}
type Drag =
  | { type: 'pan'; client: Point; pan: Point }
  | { type: 'move' | 'resize' | 'rotate'; start: Point; layer: Layer; handle?: string; before: EditorDocument }
  | { type: 'region'; start: Point }
  | { type: 'shape'; start: Point; id: string; before: EditorDocument }
  | { type: 'paint'; layer: Layer; canvas: HTMLCanvasElement; last: Point; before: EditorDocument; tool: Tool }

const getRect = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })
const isInput = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')

export function CanvasStage({ editor, selectedId, onSelect, tool, setTool, settings, setColor, zoom, setZoom, onEffectiveZoom, pan, setPan, selection, setSelection, onCrop, onPixelAction, onToast, rulers, busy }: Props) {
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [textValue, setTextValue] = useState('')
  const textInput = useRef<HTMLTextAreaElement>(null)
  const fit = Math.max(0.05, Math.min((size.width - (size.width < 600 ? 56 : 112)) / doc.width, (size.height - 138) / doc.height, 1))
  const scale = zoom ?? fit
  const left = (size.width - doc.width * scale) / 2 + pan.x
  const top = (size.height - doc.height * scale) / 2 + pan.y - 6
  const selected = doc.layers.find(l => l.id === selectedId)
  const editing = doc.layers.find(l => l.id === editingId)
  const showTransform = selected && selected.visible && !selected.locked && tool === 'move' && !editing

  useLayoutEffect(() => {
    if (!viewport.current) return
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(viewport.current)
    return () => resize.disconnect()
  }, [])
  useEffect(() => onEffectiveZoom(scale), [scale, onEffectiveZoom])
  useEffect(() => { setEditingId(null); overrides.current.clear() }, [doc.id])
  useEffect(() => {
    let disposed = false
    const paint = () => {
      const el = canvas.current
      if (!el || disposed) return
      const resolution = Math.min(scale * Math.min(window.devicePixelRatio || 1, 2), 2, 4096 / doc.width, 4096 / doc.height)
      const width = Math.max(1, Math.round(doc.width * resolution)), height = Math.max(1, Math.round(doc.height * resolution))
      if (el.width !== width || el.height !== height) { el.width = width; el.height = height }
      const ctx = el.getContext('2d')!
      ctx.setTransform(width / doc.width, 0, 0, height / doc.height, 0, 0)
      renderDocument(ctx, doc, overrides.current, editingId || undefined)
    }
    const raf = requestAnimationFrame(paint)
    prepareDocument(doc).then(paint).catch(() => { if (!disposed) onToast('Не удалось загрузить один из слоёв') })
    return () => { disposed = true; cancelAnimationFrame(raf) }
  }, [doc, scale, revision, editingId, onToast])
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isInput(e.target)) { e.preventDefault(); setSpaceDown(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    const blur = () => setSpaceDown(false)
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    const el = viewport.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const next = Math.min(4, Math.max(0.05, scale * Math.exp(-e.deltaY * 0.003)))
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left - size.width / 2, my = e.clientY - rect.top - size.height / 2 + 6
        setPan({ x: mx - (mx - pan.x) * next / scale, y: my - (my - pan.y) * next / scale }); setZoom(next)
      } else setPan({ x: pan.x - e.deltaX - (e.shiftKey ? e.deltaY : 0), y: pan.y - (e.shiftKey ? 0 : e.deltaY) })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [scale, setZoom, pan, setPan, size])

  const pointFrom = (e: { clientX: number; clientY: number }): Point => {
    const rect = artboard.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
  }
  const clip = (p: Point): Point => ({ x: Math.min(doc.width, Math.max(0, p.x)), y: Math.min(doc.height, Math.max(0, p.y)) })
  const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height
  const redraw = () => setRevision(v => v + 1)
  const beginText = (layer: Layer) => {
    if (layer.locked) return
    onSelect(layer.id); setTool('move'); setEditingId(layer.id); setTextValue(layer.text || '')
    setTimeout(() => { textInput.current?.focus(); textInput.current?.select() }, 0)
  }
  const commitText = useCallback(() => {
    if (editingId) {
      const layer = editor.documentRef.current.layers.find(l => l.id === editingId)
      if (layer && layer.text !== textValue) editor.patchLayer(editingId, { text: textValue, height: Math.max(layer.height, textValue.split('\n').length * (layer.fontSize || 48) * (layer.lineHeight || 1.2)) }, 'Редактирование текста')
      setEditingId(null)
    }
  }, [editingId, editor, textValue])
  const paintSegment = (d: Extract<Drag, { type: 'paint' }>, p: Point) => {
    const local = localPoint(d.layer, p)
    const next = { x: local.x * d.canvas.width / d.layer.width, y: local.y * d.canvas.height / d.layer.height }
    const ctx = d.canvas.getContext('2d')!
    ctx.save()
    ctx.globalCompositeOperation = d.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.globalAlpha = settings.brushOpacity / 100
    ctx.strokeStyle = settings.color; ctx.fillStyle = settings.color
    ctx.lineWidth = settings.brushSize * d.canvas.width / d.layer.width
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(d.last.x, d.last.y); ctx.lineTo(next.x, next.y); ctx.stroke()
    if (Math.hypot(next.x - d.last.x, next.y - d.last.y) < 0.1) {
      ctx.beginPath(); ctx.arc(next.x, next.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore(); d.last = next; redraw()
  }
  const pointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy || isInput(e.target) || (e.target as HTMLElement).closest('button')) return
    if (e.button !== 0 && e.button !== 1) return
    if (editingId) { commitText(); return }
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId); activePointer.current = e.pointerId
    const p = pointFrom(e)
    if (spaceDown || tool === 'hand' || e.button === 1) { drag.current = { type: 'pan', client: { x: e.clientX, y: e.clientY }, pan }; return }
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle')
    if (handle && selected && !selected.locked && tool === 'move') {
      drag.current = { type: handle === 'rotate' ? 'rotate' : 'resize', start: p, layer: { ...selected }, handle, before: doc }; return
    }
    if (!inside(p)) { if (tool === 'move') onSelect(null); return }
    if (tool === 'move') {
      const hit = settings.autoSelect ? [...doc.layers].reverse().find(l => hitTest(l, p)) : selected
      onSelect(hit?.id || null)
      if (hit && !hit.locked && hit.visible) drag.current = { type: 'move', start: p, layer: { ...hit }, before: doc }
    } else if (tool === 'crop' || tool === 'select') {
      setSelection({ ...p, width: 0, height: 0 }); drag.current = { type: 'region', start: p }
    } else if (tool === 'text') {
      const hit = [...doc.layers].reverse().find(l => l.kind === 'text' && hitTest(l, p))
      if (hit) { beginText(hit); return }
      if (doc.layers.length >= MAX_LAYERS) { onToast('В одном проекте доступно до 100 слоёв'); return }
      const layer = makeLayer({ kind: 'text', name: 'Ваш текст', text: 'Ваш текст', x: p.x, y: p.y, width: Math.min(700, doc.width * 0.65), height: 110, fontFamily: 'Manrope', fontSize: 72, fontWeight: 600, color: settings.color, lineHeight: 1.2 })
      editor.change(d => ({ ...d, layers: [...d.layers, layer] }), 'Добавление текста'); beginText(layer)
    } else if (tool === 'rectangle' || tool === 'ellipse') {
      if (doc.layers.length >= MAX_LAYERS) { onToast('В одном проекте доступно до 100 слоёв'); return }
      const layer = makeLayer({ name: tool === 'rectangle' ? 'Прямоугольник' : 'Эллипс', shape: tool, x: p.x, y: p.y, width: 1, height: 1, color: settings.color, radius: tool === 'rectangle' ? 8 : 0 })
      editor.change(d => ({ ...d, layers: [...d.layers, layer] }), 'Добавление фигуры', true)
      onSelect(layer.id); drag.current = { type: 'shape', start: p, id: layer.id, before: doc }
    } else if (tool === 'eyedropper') {
      const c = canvas.current!, ctx = c.getContext('2d')!
      const rgba = ctx.getImageData(Math.min(c.width - 1, Math.floor(p.x / doc.width * c.width)), Math.min(c.height - 1, Math.floor(p.y / doc.height * c.height)), 1, 1).data
      const color = '#' + [...rgba.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('')
      setColor(color); onToast(`Цвет ${color.toUpperCase()} выбран`)
    } else if (tool === 'wand') onPixelAction('wand', p)
    else if (tool === 'brush' || tool === 'eraser') {
      if (selected?.locked) { onToast('Слой заблокирован. Сначала снимите замок.'); return }
      if (tool === 'eraser' && !selected) { onToast('Выберите слой для ластика'); return }
      const before = editor.documentRef.current
      let layer = selected
      let buffer: HTMLCanvasElement
      if (!layer || (tool === 'brush' && layer.kind !== 'image')) {
        if (doc.layers.length >= MAX_LAYERS) { onToast('В одном проекте доступно до 100 слоёв'); return }
        buffer = document.createElement('canvas'); buffer.width = doc.width; buffer.height = doc.height
        layer = makeLayer({ kind: 'image', name: 'Рисунок кистью', width: doc.width, height: doc.height })
        editor.change(d => ({ ...d, layers: [...d.layers, layer!] }), 'Новый рисунок', true)
        onSelect(layer.id)
      } else {
        try { buffer = await rasterizeLayer(layer) } catch { onToast('Не удалось подготовить слой'); return }
        if (activePointer.current !== e.pointerId) return
        if (layer.kind !== 'image') onToast('Слой растрирован для работы ластиком. Это можно отменить.')
      }
      const local = localPoint(layer, p)
      const d: Extract<Drag, { type: 'paint' }> = { type: 'paint', layer, canvas: buffer, before, tool, last: { x: local.x * buffer.width / layer.width, y: local.y * buffer.height / layer.height } }
      drag.current = d; overrides.current.set(layer.id, buffer); paintSegment(d, p)
    }
  }
  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointFrom(e)
    if (tool === 'brush' || tool === 'eraser') setCursor(p)
    const d = drag.current
    if (!d || busy) return
    if (d.type === 'pan') { setPan({ x: d.pan.x + e.clientX - d.client.x, y: d.pan.y + e.clientY - d.client.y }); return }
    if (d.type === 'paint') { paintSegment(d, p); return }
    if (d.type === 'region') { setSelection(getRect(d.start, clip(p))); return }
    if (d.type === 'shape') {
      let end = p
      if (e.shiftKey) { const m = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y)); end = { x: d.start.x + m * Math.sign(p.x - d.start.x || 1), y: d.start.y + m * Math.sign(p.y - d.start.y || 1) } }
      const rect = getRect(d.start, end)
      editor.patchLayer(d.id, { ...rect, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }, '', true); return
    }
    if (d.type === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      let x = d.layer.x + dx, y = d.layer.y + dy
      const snap = 5 / scale
      let gx = false, gy = false
      if (settings.showGuides && !e.altKey) {
        if (Math.abs(x + d.layer.width / 2 - doc.width / 2) < snap) { x = (doc.width - d.layer.width) / 2; gx = true }
        if (Math.abs(y + d.layer.height / 2 - doc.height / 2) < snap) { y = (doc.height - d.layer.height) / 2; gy = true }
        if (Math.abs(x) < snap) x = 0
        if (Math.abs(y) < snap) y = 0
      }
      setGuides({ x: gx, y: gy }); editor.patchLayer(d.layer.id, { x, y }, '', true)
    } else if (d.type === 'rotate') {
      const angle = (q: Point) => Math.atan2(q.y - d.layer.y - d.layer.height / 2, q.x - d.layer.x - d.layer.width / 2)
      let rotation = d.layer.rotation + (angle(p) - angle(d.start)) * 180 / Math.PI
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
      editor.patchLayer(d.layer.id, { rotation: (rotation + 360) % 360 }, '', true)
    } else if (d.type === 'resize') {
      const local = localPoint(d.layer, p), h = d.handle!
      let x1 = h.includes('w') ? Math.min(local.x, d.layer.width - 8) : 0
      let y1 = h.includes('n') ? Math.min(local.y, d.layer.height - 8) : 0
      let x2 = h.includes('e') ? Math.max(local.x, 8) : d.layer.width
      let y2 = h.includes('s') ? Math.max(local.y, 8) : d.layer.height
      const keepRatio = e.shiftKey || (d.layer.kind === 'text' && h.length === 2)
      if (keepRatio) {
        const ratio = Math.max((x2 - x1) / d.layer.width, (y2 - y1) / d.layer.height)
        if (h.includes('w')) x1 = x2 - d.layer.width * ratio; else x2 = x1 + d.layer.width * ratio
        if (h.includes('n')) y1 = y2 - d.layer.height * ratio; else y2 = y1 + d.layer.height * ratio
      }
      const width = Math.min(16384, x2 - x1), height = Math.min(16384, y2 - y1)
      const cx = (x1 + x2 - d.layer.width) / 2, cy = (y1 + y2 - d.layer.height) / 2, a = d.layer.rotation * Math.PI / 180
      editor.patchLayer(d.layer.id, { width, height, x: d.layer.x + d.layer.width / 2 + cx * Math.cos(a) - cy * Math.sin(a) - width / 2, y: d.layer.y + d.layer.height / 2 + cx * Math.sin(a) + cy * Math.cos(a) - height / 2, ...(d.layer.kind === 'text' && keepRatio ? { fontSize: Math.max(4, Math.min(1000, (d.layer.fontSize || 48) * width / d.layer.width)) } : {}) }, '', true)
    }
  }
  const pointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointer.current = null
    const d = drag.current; drag.current = null; setGuides({ x: false, y: false })
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.type === 'paint') {
      const next = bitmapLayer(d.layer, d.canvas)
      editor.patchLayer(d.layer.id, next, '', true)
      overrides.current.delete(d.layer.id); editor.finish(d.tool === 'eraser' ? 'Ластик' : 'Рисование кистью'); redraw()
    } else if (d.type === 'shape') {
      const layer = editor.documentRef.current.layers.find(l => l.id === d.id)!
      if (layer.width < 4 && layer.height < 4) editor.patchLayer(d.id, { width: 240, height: 160 }, '', true)
      editor.finish('Добавление фигуры'); setTool('move')
    } else if (d.type !== 'pan' && d.type !== 'region') editor.finish(d.type === 'move' ? 'Перемещение слоя' : d.type === 'rotate' ? 'Поворот слоя' : 'Размер слоя')
  }
  const cancelPointer = () => {
    const d = drag.current
    if (d && 'before' in d) editor.change(() => d.before, '', true)
    drag.current = null; activePointer.current = null; overrides.current.clear(); redraw(); setGuides({ x: false, y: false })
  }
  const step = scale < 0.35 ? 500 : scale < 0.8 ? 200 : 100
  const xTicks = Array.from({ length: Math.ceil(size.width / scale / step) + 3 }, (_, i) => (Math.floor(-left / scale / step) + i) * step)
  const yTicks = Array.from({ length: Math.ceil(size.height / scale / step) + 3 }, (_, i) => (Math.floor(-top / scale / step) + i) * step)

  return <div ref={viewport} className={`canvas-viewport tool-${spaceDown ? 'hand' : tool} ${busy ? 'is-busy' : ''}`} data-testid="canvas-viewport"
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} onPointerLeave={() => setCursor(null)}
    onDoubleClick={e => { if (tool !== 'move') return; const p = pointFrom(e); const hit = [...doc.layers].reverse().find(l => hitTest(l, p)); if (hit?.kind === 'text') beginText(hit) }}>
    {rulers && <><div className="ruler-corner"><Crosshair size={10} /></div><div className="ruler ruler-x">{xTicks.map(t => <span key={t} style={{ left: left + t * scale }}>{t}</span>)}</div><div className="ruler ruler-y">{yTicks.map(t => <span key={t} style={{ top: top + t * scale }}>{t}</span>)}</div></>}
    <div ref={artboard} className="artboard checkerboard" style={{ width: doc.width * scale, height: doc.height * scale, left, top }}>
      <div className="artboard-label"><span>Холст 1</span><span>{doc.width} × {doc.height}</span></div>
      <canvas ref={canvas} data-testid="editor-canvas" aria-label={`Холст ${doc.name}, ${doc.width} на ${doc.height} пикселей`} />
      <svg className="canvas-overlay" width="100%" height="100%" viewBox={`0 0 ${doc.width} ${doc.height}`}>
        {guides.x && <line x1={doc.width / 2} y1={0} x2={doc.width / 2} y2={doc.height} stroke="#d99cff" strokeWidth={1 / scale} />}
        {guides.y && <line x1={0} y1={doc.height / 2} x2={doc.width} y2={doc.height / 2} stroke="#d99cff" strokeWidth={1 / scale} />}
        {showTransform && <g transform={`translate(${selected.x + selected.width / 2} ${selected.y + selected.height / 2}) rotate(${selected.rotation}) translate(${-selected.width / 2} ${-selected.height / 2})`}>
          <rect width={selected.width} height={selected.height} fill="none" stroke="#b3a0ff" strokeWidth={1 / scale} />
          <line x1={selected.width / 2} y1={0} x2={selected.width / 2} y2={-24 / scale} stroke="#b3a0ff" strokeWidth={1 / scale} />
          <circle data-handle="rotate" cx={selected.width / 2} cy={-24 / scale} r={4 / scale} fill="#25212e" stroke="#b3a0ff" strokeWidth={1.2 / scale} style={{ pointerEvents: 'all', cursor: 'grab' }} />
          {([['nw', 0, 0], ['n', selected.width / 2, 0], ['ne', selected.width, 0], ['e', selected.width, selected.height / 2], ['se', selected.width, selected.height], ['s', selected.width / 2, selected.height], ['sw', 0, selected.height], ['w', 0, selected.height / 2]] as [string, number, number][]).map(([h, x, y]) => <rect key={h} data-handle={h} x={x - 3 / scale} y={y - 3 / scale} width={6 / scale} height={6 / scale} fill="#e3dbff" stroke="#a38be7" strokeWidth={1 / scale} style={{ pointerEvents: 'all', cursor: `${h}-resize` }} />)}
        </g>}
        {selection && (tool === 'crop' || tool === 'select') && <>
          {tool === 'crop' && <path d={`M0 0H${doc.width}V${doc.height}H0Z M${selection.x} ${selection.y}h${selection.width}v${selection.height}h-${selection.width}Z`} fillRule="evenodd" fill="#0009" />}
          <rect {...selection} fill="none" stroke="#fff" strokeWidth={1 / scale} />
          <rect {...selection} fill="none" stroke="#342741" strokeWidth={1 / scale} strokeDasharray={`${4 / scale} ${4 / scale}`} className="marching-ants" />
          {tool === 'crop' && [1, 2].map(i => <g key={i} stroke="#ffffff65" strokeWidth={1 / scale}><line x1={selection.x + selection.width * i / 3} y1={selection.y} x2={selection.x + selection.width * i / 3} y2={selection.y + selection.height} /><line x1={selection.x} y1={selection.y + selection.height * i / 3} x2={selection.x + selection.width} y2={selection.y + selection.height * i / 3} /></g>)}
        </>}
        {cursor && (tool === 'brush' || tool === 'eraser') && <><circle cx={cursor.x} cy={cursor.y} r={settings.brushSize / 2} fill="none" stroke="#0009" strokeWidth={3 / scale} /><circle cx={cursor.x} cy={cursor.y} r={settings.brushSize / 2} fill="none" stroke="#fffd" strokeWidth={1 / scale} /></>}
      </svg>
      {editing && <textarea ref={textInput} className="inline-text-editor" aria-label="Редактировать текст на холсте" value={textValue} onChange={e => setTextValue(e.target.value)} onBlur={commitText} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setEditingId(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText() }} style={{ left: editing.x * scale, top: editing.y * scale, width: editing.width * scale, height: Math.max(editing.height, textValue.split('\n').length * (editing.fontSize || 48) * (editing.lineHeight || 1.2)) * scale + 12, fontFamily: editing.fontFamily, fontSize: (editing.fontSize || 48) * scale, fontWeight: editing.fontWeight, color: editing.color, lineHeight: editing.lineHeight || 1.2, letterSpacing: (editing.letterSpacing || 0) * scale, textAlign: editing.textAlign, transform: `rotate(${editing.rotation}deg)`, fontStyle: editing.italic ? 'italic' : 'normal' }} />}
    </div>
    {selection && selection.width > 2 && selection.height > 2 && (tool === 'crop' || tool === 'select') ? <div className="selection-actions">
      <span><ScanLine size={15} />{Math.round(selection.width)} × {Math.round(selection.height)}</span><div className="vertical-divider" />
      {tool === 'crop' ? <button className="compact-button accent" onClick={onCrop}><Check size={14} />Кадрировать</button> : <><button className="compact-button" onClick={() => onPixelAction('erase')}><Eraser size={14} />Стереть</button><button className="compact-button accent" onClick={() => onPixelAction('fill')} title="Диффузная заливка цветами вокруг выделения"><Sparkles size={14} />Залить окружением</button></>}
      <button className="icon-button" onClick={() => setSelection(null)} aria-label="Снять выделение"><X size={15} /></button>
    </div> : <div className="workspace-hint"><span className="hint-key">Пробел</span> перемещение <i /> <span className="hint-key">Ctrl</span> + колесо — масштаб</div>}
  </div>
}
