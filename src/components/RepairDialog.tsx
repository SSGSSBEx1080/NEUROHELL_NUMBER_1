import { repairPlacement } from '../engine/repairPlacement'
import { RepairPreview } from '../engine/repairPreview'
import { useEffect, useRef, useState } from 'react'
import { Bandage, LoaderCircle, Shield, SplitSquareHorizontal } from 'lucide-react'
import type { EditorDocument, Layer, Rect, Selection } from '../types'
import { makeLayer } from '../engine/document'
import { prepareDocument, renderDocument, bitmapLayer } from '../engine/render'
import { selectionMask } from '../engine/selection'
import type { RepairMode, RepairRequest, RepairResult } from '../engine/repair'
import { runRepair } from '../engine/repairJob'
import { Field, Modal, Select } from './ui'
interface Source extends Rect {
  pixels: Uint8ClampedArray
  mask: Uint8Array
  donors: Uint8Array
}
export function RepairDialog({
  doc,
  selection,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  selection: Selection
  onApply: (layer: Layer, belowText: boolean) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<Source | null>(null),
    [result, setResult] = useState<RepairResult | null>(null),
    [error, setError] = useState(''),
    [working, setWorking] = useState(true)
  const [belowText, setBelowText] = useState(false)
  const [mode, setMode] = useState<RepairMode>('auto'),
    [radius, setRadius] = useState(4),
    [expand, setExpand] = useState(2),
    [feather, setFeather] = useState(1),
    [search, setSearch] = useState(96),
    [split, setSplit] = useState(40),
    [progress, setProgress] = useState(0),
    [protect, setProtect] = useState(false),
    [revision, setRevision] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null),
    controller = useRef<AbortController | null>(null),
    drawing = useRef(false)
  const preview = useRef<RepairPreview | null>(null),
    drawFrame = useRef(0),
    lastDonor = useRef<{ x: number; y: number } | null>(null)
  useEffect(
    () => () => {
      cancelAnimationFrame(drawFrame.current)
      preview.current?.dispose()
      preview.current = null
    },
    [],
  )
  useEffect(() => {
    let cancelled = false
    setWorking(true)
    setResult(null)
    setSource(null)
    controller.current?.abort()
    ;(async () => {
      try {
        if (selection.inverted)
          throw new Error('Для восстановления используй обычное, не инвертированное выделение')
        const x = Math.max(0, Math.floor(selection.x - 174)),
          y = Math.max(0, Math.floor(selection.y - 174)),
          width = Math.min(doc.width - x, Math.ceil(selection.x + selection.width + 174) - x),
          height = Math.min(doc.height - y, Math.ceil(selection.y + selection.height + 174) - y)
        if (width < 3 || height < 3 || width * height > 1048576)
          throw new Error('Фрагмент с окружением больше 1 Мп. Обведи меньшую область.')
        await prepareDocument(doc)
        if (cancelled) return
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.translate(-x, -y)
        renderDocument(ctx, repairPlacement(doc, belowText).source)
        const local = {
          ...selection,
          x: selection.x - x,
          y: selection.y - y,
          raster: selection.raster
            ? { ...selection.raster, x: selection.raster.x - x, y: selection.raster.y - y }
            : undefined,
          points: selection.points?.map((p) => ({ x: p.x - x, y: p.y - y })),
          feather: 0,
        }
        const rgba = selectionMask(local, width, height)
            .getContext('2d')!
            .getImageData(0, 0, width, height).data,
          mask = new Uint8Array(width * height)
        for (let p = 0; p < mask.length; p++) mask[p] = rgba[p * 4 + 3]
        const value = {
          x,
          y,
          width,
          height,
          pixels: ctx.getImageData(0, 0, width, height).data,
          mask,
          donors: new Uint8Array(mask.length).fill(255),
        }
        c.width = c.height = 1
        if (!cancelled) setSource(value)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось подготовить фрагмент')
          setWorking(false)
        }
      }
    })()
    return () => {
      cancelled = true
      controller.current?.abort()
    }
  }, [doc, selection, belowText])
  useEffect(() => {
    if (!source) return
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    setWorking(true)
    setResult(null)
    setError('')
    setProgress(0)
    const timer = setTimeout(() => {
      const request: RepairRequest = { ...source, mode, radius, expand, feather, search }
      void runRepair(request, abort.signal, setProgress)
        .then((value) => {
          if (!abort.signal.aborted) {
            setResult(value)
            setWorking(false)
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) {
            setError(e.message)
            setWorking(false)
          }
        })
    }, 140)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [source, mode, radius, expand, feather, search, revision])
  const draw = () => {
    if (!canvas.current) return
    if (!source) {
      preview.current?.dispose()
      preview.current = null
      canvas.current.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height)
      return
    }
    if (preview.current?.source !== source) {
      preview.current?.dispose()
      preview.current = new RepairPreview(source)
    }
    preview.current.draw(canvas.current, result, split, protect)
  }
  const latestDraw = useRef(draw)
  latestDraw.current = draw
  useEffect(draw, [source, result, split, protect, revision])
  const paintDonor = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!source || !drawing.current || !protect) return
    const bounds = e.currentTarget.getBoundingClientRect(),
      x = ((e.clientX - bounds.left) * source.width) / bounds.width,
      y = ((e.clientY - bounds.top) * source.height) / bounds.height,
      r = Math.ceil((15 * source.width) / bounds.width)
    const from = lastDonor.current || { x, y },
      steps = Math.min(
        512,
        Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / Math.max(1, r * 0.5))),
      )
    for (let i = 1; i <= steps; i++) {
      const cx = from.x + ((x - from.x) * i) / steps,
        cy = from.y + ((y - from.y) * i) / steps
      for (
        let yy = Math.max(0, Math.floor(cy - r));
        yy <= Math.min(source.height - 1, Math.ceil(cy + r));
        yy++
      )
        for (
          let xx = Math.max(0, Math.floor(cx - r));
          xx <= Math.min(source.width - 1, Math.ceil(cx + r));
          xx++
        )
          if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r)
            source.donors[yy * source.width + xx] = e.shiftKey ? 255 : 0
      preview.current?.invalidate(cx - r - 1, cy - r - 1, r * 2 + 3, r * 2 + 3)
    }
    lastDonor.current = { x, y }
    if (!drawFrame.current)
      drawFrame.current = requestAnimationFrame(() => {
        drawFrame.current = 0
        latestDraw.current()
      })
  }
  const apply = () => {
    if (!source || !result || working || drawing.current) return
    try {
      const c = document.createElement('canvas')
      c.width = source.width
      c.height = source.height
      const pixels = result.pixels.slice()
      for (let p = 0; p < result.mask.length; p++) pixels[p * 4 + 3] = result.mask[p]
      c.getContext('2d')!.putImageData(new ImageData(pixels, c.width, c.height), 0, 0)
      const layer = bitmapLayer(
        makeLayer({
          kind: 'image',
          name: result.mode === 'smooth' ? 'Клин · гладкий фон' : 'Клин · фактура',
          x: source.x,
          y: source.y,
          width: source.width,
          height: source.height,
        }),
        c,
      )
      onApply(layer, belowText)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка применения')
    }
  }
  return (
    <Modal
      title="Восстановление области"
      subtitle="J · локальное восстановление по образцам. Исходник не изменяется."
      onClose={onClose}
      wide
    >
      <div className="repair-layout">
        <section className="repair-view">
          <div className="repair-view-labels">
            <span>Оригинал</span>
            <span>Результат · новый слой</span>
          </div>
          <div className={`repair-canvas-wrap checkerboard ${protect ? 'painting-donors' : ''}`}>
            <canvas
              ref={canvas}
              data-testid="repair-preview"
              aria-label="Предпросмотр восстановления"
              onPointerDown={(e) => {
                if (!protect || !source) return
                e.currentTarget.setPointerCapture(e.pointerId)
                drawing.current = true
                lastDonor.current = null
                controller.current?.abort()
                setWorking(true)
                setResult(null)
                paintDonor(e)
              }}
              onPointerMove={paintDonor}
              onPointerUp={(e) => {
                if (!drawing.current) return
                paintDonor(e)
                drawing.current = false
                lastDonor.current = null
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId)
                setRevision((n) => n + 1)
              }}
              onPointerCancel={() => {
                drawing.current = false
                lastDonor.current = null
                setRevision((n) => n + 1)
              }}
            />
          </div>
          <label className="repair-split">
            <SplitSquareHorizontal size={15} />
            До / после
            <input
              aria-label="Сравнение до и после"
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(+e.target.value)}
              disabled={protect}
            />
          </label>
          {protect && (
            <p className="panel-note">
              Зелёный — разрешённые образцы. Закрась красным то, что нельзя копировать. Shift
              возвращает образцы. Фиолетовый — исходная обводка.
            </p>
          )}
        </section>
        <aside className="repair-controls">
          <label className="dialog-label">
            Метод
            <Select
              aria-label="Метод восстановления"
              value={mode}
              onChange={(e) => setMode(e.target.value as RepairMode)}
            >
              <option value="auto">Авто · по окружению</option>
              <option value="smooth">Плавный фон</option>
              <option value="texture">Повторяющаяся текстура</option>
            </Select>
          </label>
          <Field
            label="Радиус заплатки"
            value={radius}
            min={2}
            max={8}
            suffix="px"
            onChange={setRadius}
          />
          <Field
            label="Поиск образцов"
            value={search}
            min={12}
            max={160}
            suffix="px"
            onChange={setSearch}
          />
          <Field
            label="Расширить область"
            value={expand}
            min={0}
            max={6}
            suffix="px"
            onChange={setExpand}
          />
          <Field
            label="Смягчить край"
            value={feather}
            min={0}
            max={4}
            suffix="px"
            onChange={setFeather}
          />
          <button
            className={`action-button ${protect ? 'primary-action' : ''}`}
            aria-pressed={protect}
            onClick={() => setProtect((v) => !v)}
          >
            <Shield size={16} />
            Зона образцов
          </button>
          <button
            className="text-button"
            onClick={() => {
              source?.donors.fill(255)
              preview.current?.invalidate()
              setRevision((n) => n + 1)
            }}
          >
            Сбросить запреты образцов
          </button>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={belowText}
              onChange={(e) => setBelowText(e.target.checked)}
            />
            Под верхними текстовыми слоями
          </label>
          {belowText && (
            <p className="panel-note">
              {repairPlacement(doc, true).index === doc.layers.length
                ? 'Нет отделимого верхнего текста: клин будет над документом. Группы и обтравочные цепочки не разрываются.'
                : 'Отделимый верхний стек текста исключён из образцов и останется над клином. Группы и обтравочные цепочки не разрываются.'}
            </p>
          )}
          <div className="repair-progress" role="status">
            {working ? (
              <>
                <LoaderCircle className="spin" size={16} />
                {source ? `Восстанавливаем · ${Math.round(progress * 100)}%` : 'Готовим фрагмент…'}
              </>
            ) : result ? (
              <>
                <Bandage size={16} />
                {result.mode === 'smooth'
                  ? 'Восстановлен гладкий фон'
                  : `${result.patches} локальных заплаток`}
              </>
            ) : (
              'Результат не готов'
            )}
          </div>
          <p className="panel-note">
            Поиск задаёт локальный радиус; резервные образцы берутся из всего фрагмента, кроме
            запрещённых зон. Не генеративный ИИ. Чистая бумага и повторяющиеся фактуры
            восстанавливаются лучше уникальных деталей рисунка. Всегда оцени результат.
          </p>
        </aside>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <span>Отдельный слой · одна отмена Ctrl+Z</span>
        <button className="secondary-button" onClick={onClose}>
          {working ? 'Остановить и закрыть' : 'Отмена'}
        </button>
        <button className="primary-button" disabled={!result || working} onClick={apply}>
          Применить на новый слой
        </button>
      </footer>
    </Modal>
  )
}
