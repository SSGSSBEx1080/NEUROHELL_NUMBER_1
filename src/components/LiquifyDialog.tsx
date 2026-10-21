import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, Layer, Selection } from '../types'
import {
  applyLiquify,
  applyLiquifyBrush,
  createLiquifyField,
  displacementMax,
  liquifyBrushNames,
  MAX_LIQUIFY_PIXELS,
  type LiquifyBrush,
  type LiquifyField,
} from '../engine/liquify'
import { prepareFilterSource, processedCopy, type FilterSource } from '../engine/filterLayers'
import { Modal, SliderField } from './ui'

const BRUSHES = Object.keys(liquifyBrushNames) as LiquifyBrush[]

export function LiquifyDialog({
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
    [brush, setBrush] = useState<LiquifyBrush>('push'),
    [size, setSize] = useState(120),
    [strength, setStrength] = useState(60),
    [showOriginal, setShowOriginal] = useState(false),
    [hideOriginal, setHideOriginal] = useState(true),
    [dirty, setDirty] = useState(false),
    [applying, setApplying] = useState(false),
    [error, setError] = useState(''),
    [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const view = useRef<HTMLCanvasElement>(null),
    field = useRef<LiquifyField | null>(null),
    full = useRef<HTMLCanvasElement | null>(null),
    drawing = useRef(false),
    last = useRef<{ x: number; y: number } | null>(null),
    frame = useRef(0),
    repeat = useRef<number | undefined>(undefined),
    alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      cancelAnimationFrame(frame.current)
      window.clearInterval(repeat.current)
    }
  }, [])
  useEffect(() => {
    let valid = true
    void prepareFilterSource(doc, id, selection)
      .then((v) => {
        if (!valid) return
        if (v.canvas.width * v.canvas.height > MAX_LIQUIFY_PIXELS) {
          setError('Пластика поддерживает до 4 Мп на слой.')
          return
        }
        field.current = createLiquifyField(v.canvas.width, v.canvas.height)
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
    h = source ? Math.max(1, Math.round(source.canvas.height * scale)) : 240

  const redraw = () => {
    if (!source || !field.current || !view.current) return
    if (!full.current) {
      full.current = document.createElement('canvas')
      full.current.width = source.canvas.width
      full.current.height = source.canvas.height
    }
    const pixels = showOriginal
      ? source.pixels
      : applyLiquify(source.pixels, field.current, source.mask)
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
  useEffect(schedule, [source, showOriginal, w, h])

  const natural = (e: React.PointerEvent) => {
    const rect = view.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * (source?.canvas.width || 1),
      y: ((e.clientY - rect.top) / rect.height) * (source?.canvas.height || 1),
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    }
  }
  const stamp = (x: number, y: number, moveX: number, moveY: number) => {
    if (!field.current) return
    applyLiquifyBrush(field.current, brush, x, y, size / 2, moveX, moveY, strength / 100)
    setDirty(displacementMax(field.current) > 0.01)
    schedule()
  }
  const stopRepeat = () => window.clearInterval(repeat.current)
  const pointerDown = (e: React.PointerEvent) => {
    if (!source || applying) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = natural(e)
    drawing.current = true
    last.current = p
    if (brush !== 'push') {
      stamp(p.x, p.y, 0, 0)
      stopRepeat()
      repeat.current = window.setInterval(() => {
        if (last.current) stamp(last.current.x, last.current.y, 0, 0)
      }, 60)
    }
  }
  const pointerMove = (e: React.PointerEvent) => {
    if (!source) return
    const p = natural(e)
    setCursor({ x: p.cx, y: p.cy })
    if (!drawing.current || !last.current) return
    if (brush === 'push') stamp(p.x, p.y, p.x - last.current.x, p.y - last.current.y)
    else stamp(p.x, p.y, 0, 0)
    last.current = p
  }
  const pointerUp = () => {
    drawing.current = false
    last.current = null
    stopRepeat()
  }
  const reset = () => {
    if (!source) return
    field.current = createLiquifyField(source.canvas.width, source.canvas.height)
    setDirty(false)
    schedule()
  }
  const apply = async () => {
    if (!source || !field.current || !dirty || applying) return
    setApplying(true)
    setError('')
    try {
      const pixels = applyLiquify(source.pixels, field.current, source.mask)
      const copy = await processedCopy(source, pixels, 'Пластика')
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
      title="Пластика на копии"
      subtitle="Деформация, стягивание, вздутие, скручивание и реконструкция по полю смещений. Оригинал сохраняется слоем; это не Smart-фильтр и не Face-Aware."
      onClose={onClose}
      wide
    >
      <div className="filter-preview-wrap">
        <div className="liquify-stage checkerboard" style={{ width: w, height: h }}>
          <canvas
            ref={view}
            data-testid="liquify-canvas"
            width={w}
            height={h}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onPointerLeave={() => setCursor(null)}
          />
          {cursor && source && (
            <span
              className="liquify-brush-ring"
              style={{
                left: cursor.x - (size * scale) / 2,
                top: cursor.y - (size * scale) / 2,
                width: size * scale,
                height: size * scale,
              }}
            />
          )}
        </div>
      </div>
      <p className="panel-note">
        {source ? `${source.canvas.width} × ${source.canvas.height}` : 'Подготовка…'} ·{' '}
        {selection ? 'выделение ограничивает деформацию' : 'весь слой'} · локальные пиксели до
        коррекций, стилей и маски
      </p>
      <fieldset disabled={!source || applying} className="properties-fieldset">
        <div className="liquify-tools" role="group" aria-label="Инструмент пластики">
          {BRUSHES.map((b) => (
            <button
              key={b}
              type="button"
              className={brush === b ? 'active' : ''}
              aria-pressed={brush === b}
              onClick={() => setBrush(b)}
            >
              {liquifyBrushNames[b]}
            </button>
          ))}
        </div>
        <SliderField
          label="Размер кисти"
          suffix=" px"
          value={size}
          min={8}
          max={1000}
          onChange={setSize}
        />
        <SliderField
          label="Плотность"
          suffix="%"
          value={strength}
          min={1}
          max={100}
          onChange={setStrength}
        />
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
        <button type="button" className="secondary-button" disabled={!dirty} onClick={reset}>
          Сбросить деформацию
        </button>
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
