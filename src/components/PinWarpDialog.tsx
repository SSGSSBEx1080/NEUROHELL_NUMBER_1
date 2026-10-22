import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, Layer, Selection } from '../types'
import { uid } from '../engine/document'
import { applyLiquify } from '../engine/liquify'
import {
  buildPinWarpField,
  hasPinWarpMotion,
  MAX_PIN_WARP_PIXELS,
  MAX_WARP_PINS,
  type WarpPin,
} from '../engine/pinWarp'
import { prepareFilterSource, processedCopy, type FilterSource } from '../engine/filterLayers'
import { Modal, SliderField } from './ui'

type Pin = WarpPin & { id: string }

export function PinWarpDialog({
  doc,
  id,
  selection,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  id: string
  selection: Selection | null
  onApply: (copy: Layer, hideOriginal: boolean) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<FilterSource | null>(null),
    [pins, setPins] = useState<Pin[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [radius, setRadius] = useState(220),
    [showOriginal, setShowOriginal] = useState(false),
    [hideOriginal, setHideOriginal] = useState(true),
    [applying, setApplying] = useState(false),
    [error, setError] = useState('')
  const view = useRef<HTMLCanvasElement>(null),
    full = useRef<HTMLCanvasElement | null>(null),
    drag = useRef<string | null>(null),
    frame = useRef(0),
    alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      cancelAnimationFrame(frame.current)
    }
  }, [])
  useEffect(() => {
    let valid = true
    void prepareFilterSource(doc, id, selection)
      .then((v) => {
        if (!valid) return
        if (v.canvas.width * v.canvas.height > MAX_PIN_WARP_PIXELS) {
          setError('Деформация по точкам поддерживает до 4 Мп на слой.')
          return
        }
        setRadius(
          Math.max(24, Math.min(1000, Math.round(Math.max(v.canvas.width, v.canvas.height) / 3))),
        )
        setSource(v)
      })
      .catch((e) => {
        if (valid) setError(e instanceof Error ? e.message : 'Не удалось подготовить слой')
      })
    return () => {
      valid = false
    }
  }, [doc, id, selection])

  const scale = source ? Math.min(1, 680 / source.canvas.width, 430 / source.canvas.height) : 1,
    w = source ? Math.max(1, Math.round(source.canvas.width * scale)) : 360,
    h = source ? Math.max(1, Math.round(source.canvas.height * scale)) : 240,
    selected = pins.find((p) => p.id === selectedId) || null,
    dirty = hasPinWarpMotion(pins)

  const redraw = () => {
    if (!source || !view.current) return
    if (!full.current) {
      full.current = document.createElement('canvas')
      full.current.width = source.canvas.width
      full.current.height = source.canvas.height
    }
    const field = buildPinWarpField(source.canvas.width, source.canvas.height, pins, radius),
      pixels = showOriginal ? source.pixels : applyLiquify(source.pixels, field, source.mask)
    full.current
      .getContext('2d')!
      .putImageData(
        new ImageData(new Uint8ClampedArray(pixels), full.current.width, full.current.height),
        0,
        0,
      )
    const ctx = view.current.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(full.current, 0, 0, w, h)
  }
  const schedule = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(redraw)
  }
  useEffect(schedule, [source, pins, radius, showOriginal, w, h])

  const natural = (e: React.PointerEvent) => {
    const rect = view.current!.getBoundingClientRect()
    return {
      x: Math.min(
        (source?.canvas.width || 1) - 1,
        Math.max(0, ((e.clientX - rect.left) / rect.width) * (source?.canvas.width || 1)),
      ),
      y: Math.min(
        (source?.canvas.height || 1) - 1,
        Math.max(0, ((e.clientY - rect.top) / rect.height) * (source?.canvas.height || 1)),
      ),
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    }
  }
  const hitPin = (cx: number, cy: number) => {
    // Hit-test in screen pixels: displaced handle first, then source anchor.
    for (const pin of [...pins].reverse()) {
      const hx = (pin.x + pin.dx) * scale,
        hy = (pin.y + pin.dy) * scale
      if (Math.hypot(cx - hx, cy - hy) <= 11) return pin
    }
    for (const pin of [...pins].reverse()) {
      if (Math.hypot(cx - pin.x * scale, cy - pin.y * scale) <= 11) return pin
    }
    return null
  }
  const pointerDown = (e: React.PointerEvent) => {
    if (!source || applying) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = natural(e),
      hit = hitPin(p.cx, p.cy)
    setError('')
    if (hit) {
      setSelectedId(hit.id)
      if (!hit.locked) drag.current = hit.id
      return
    }
    if (pins.length >= MAX_WARP_PINS) {
      setError(`До ${MAX_WARP_PINS} точек на деформацию.`)
      return
    }
    const pin: Pin = { id: uid(), x: p.x, y: p.y, dx: 0, dy: 0, rotation: 0, locked: false }
    setPins((prev) => [...prev, pin])
    setSelectedId(pin.id)
    drag.current = pin.id
  }
  const pointerMove = (e: React.PointerEvent) => {
    if (!source || !drag.current) return
    const p = natural(e),
      targetId = drag.current
    setPins((prev) =>
      prev.map((pin) => (pin.id === targetId ? { ...pin, dx: p.x - pin.x, dy: p.y - pin.y } : pin)),
    )
  }
  const endDrag = () => {
    drag.current = null
  }
  const patchSelected = (patch: Partial<Pin>) => {
    if (!selected) return
    setPins((prev) => prev.map((pin) => (pin.id === selected.id ? { ...pin, ...patch } : pin)))
  }
  const removeSelected = () => {
    if (!selected) return
    setPins((prev) => prev.filter((pin) => pin.id !== selected.id))
    setSelectedId(null)
  }
  const reset = () => {
    setPins([])
    setSelectedId(null)
  }
  const apply = async () => {
    if (!source || !dirty || applying) return
    setApplying(true)
    setError('')
    try {
      const field = buildPinWarpField(source.canvas.width, source.canvas.height, pins, radius),
        pixels = applyLiquify(source.pixels, field, source.mask),
        copy = await processedCopy(source, pixels, 'Деформация по точкам')
      if (alive.current) onApply(copy, hideOriginal)
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : 'Не удалось создать копию')
        setApplying(false)
      }
    }
  }

  return (
    <Modal
      title="Деформация по точкам на копии"
      subtitle="Клик ставит точку, перетаскивание двигает её вместе с окрестностью; закреплённые точки держат место, у выбранной точки есть локальный поворот. Это гладкое поле по точкам, а не сеточный Puppet Warp Adobe со Smart-фильтром."
      onClose={onClose}
      wide
    >
      <div className="filter-preview-wrap">
        <div className="liquify-stage pin-warp-stage checkerboard" style={{ width: w, height: h }}>
          <canvas
            ref={view}
            data-testid="pin-warp-canvas"
            width={w}
            height={h}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <svg className="pin-warp-overlay" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            {pins.map((pin) => {
              const active = pin.id === selectedId,
                color = pin.locked ? '#ffd166' : active ? '#ffffff' : '#c1a9e3'
              return (
                <g key={pin.id}>
                  <line
                    x1={pin.x * scale}
                    y1={pin.y * scale}
                    x2={(pin.x + pin.dx) * scale}
                    y2={(pin.y + pin.dy) * scale}
                    stroke={color}
                    strokeWidth={active ? 2 : 1}
                  />
                  <circle cx={pin.x * scale} cy={pin.y * scale} r={4} fill="none" stroke={color} />
                  <circle
                    cx={(pin.x + pin.dx) * scale}
                    cy={(pin.y + pin.dy) * scale}
                    r={active ? 7 : 5}
                    fill={color}
                    fillOpacity={0.85}
                    stroke="#1d1526"
                  />
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <p className="panel-note">
        {source ? `${source.canvas.width} × ${source.canvas.height}` : 'Подготовка…'} · точек:{' '}
        {pins.length}/{MAX_WARP_PINS} ·{' '}
        {selection ? 'выделение ограничивает деформацию' : 'весь слой'} · локальные пиксели до
        коррекций, стилей и маски
      </p>
      <fieldset disabled={!source || applying} className="properties-fieldset">
        <SliderField
          label="Радиус влияния"
          suffix=" px"
          value={radius}
          min={16}
          max={1000}
          onChange={setRadius}
        />
        <SliderField
          label="Поворот точки"
          suffix="°"
          value={selected?.rotation || 0}
          min={-180}
          max={180}
          disabled={!selected || !!selected.locked}
          onChange={(rotation) => patchSelected({ rotation })}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!selected?.locked}
            disabled={!selected}
            onChange={(e) => patchSelected({ locked: e.target.checked, dx: 0, dy: 0, rotation: 0 })}
          />
          Закрепить выбранную точку
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e) => setShowOriginal(e.target.checked)}
          />
          Показать оригинал
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideOriginal}
            onChange={(e) => setHideOriginal(e.target.checked)}
          />
          Скрыть исходный слой после применения
        </label>
        <div className="pin-warp-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!selected}
            onClick={removeSelected}
          >
            Удалить точку
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!pins.length}
            onClick={reset}
          >
            Сбросить все точки
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={!source || !dirty || applying}
          onClick={() => void apply()}
        >
          {applying ? 'Применение…' : 'Применить копию'}
        </button>
      </footer>
    </Modal>
  )
}
