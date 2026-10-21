import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, Layer, Selection } from '../types'
import {
  defaultRasterFilter,
  parseRasterFilter,
  rasterFilterNames,
  type RasterFilter,
  type RasterFilterKind,
} from '../engine/rasterFilters'
import { runRasterFilter } from '../engine/filterJob'
import { prepareFilterSource, filteredCopy, type FilterSource } from '../engine/filterLayers'
import { Field, Modal, Select } from './ui'
export function RasterFilterDialog({
  doc,
  id,
  selection,
  initial,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  id: string
  selection: Selection | null
  initial: RasterFilter
  onApply: (copy: Layer, filter: RasterFilter, hideOriginal: boolean) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState(initial),
    [source, setSource] = useState<FilterSource | null>(null),
    [result, setResult] = useState<{ key: string; pixels: Uint8ClampedArray } | null>(null),
    [working, setWorking] = useState(true),
    [applying, setApplying] = useState(false),
    [hideOriginal, setHideOriginal] = useState(true),
    [split, setSplit] = useState(50),
    [error, setError] = useState('')
  const before = useRef<HTMLCanvasElement>(null),
    after = useRef<HTMLCanvasElement>(null),
    alive = useRef(true),
    applyingRef = useRef(false),
    key = JSON.stringify(filter)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let valid = true
    void prepareFilterSource(doc, id, selection)
      .then((v) => {
        if (valid) setSource(v)
      })
      .catch((e) => {
        if (valid) {
          setError(e.message)
          setWorking(false)
        }
      })
    return () => {
      valid = false
    }
  }, [doc, id, selection])
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    setWorking(true)
    setError('')
    const timer = setTimeout(
      () =>
        void runRasterFilter(
          {
            width: source.canvas.width,
            height: source.canvas.height,
            pixels: source.pixels,
            mask: source.mask,
            filter,
          },
          controller.signal,
        )
          .then((pixels) => setResult({ key, pixels }))
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message)
          })
          .finally(() => {
            if (!controller.signal.aborted) setWorking(false)
          }),
      150,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, key])
  const scale = source ? Math.min(1, 520 / source.canvas.width, 300 / source.canvas.height) : 1,
    w = source ? Math.max(1, Math.round(source.canvas.width * scale)) : 320,
    h = source ? Math.max(1, Math.round(source.canvas.height * scale)) : 200
  useEffect(() => {
    if (source && before.current) {
      const x = before.current.getContext('2d')!
      x.clearRect(0, 0, w, h)
      x.drawImage(source.canvas, 0, 0, w, h)
    }
  }, [source, w, h])
  useEffect(() => {
    if (!source || !result) return
    const c = document.createElement('canvas')
    c.width = source.canvas.width
    c.height = source.canvas.height
    c.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(result.pixels), c.width, c.height),
      0,
      0,
    )
    const target = after.current?.getContext('2d')
    if (target) {
      target.clearRect(0, 0, w, h)
      target.drawImage(c, 0, 0, w, h)
    }
  }, [source, result, w, h])
  const patch = (values: Record<string, unknown>) => {
    setError('')
    setFilter(parseRasterFilter({ ...filter, ...values }))
  }
  const control = (field: string, label: string, min: number, max: number, step = 1) => (
    <Field
      key={field}
      label={label}
      value={(filter as unknown as Record<string, number>)[field]}
      min={min}
      max={max}
      step={step}
      onChange={(v) => patch({ [field]: v })}
    />
  )
  const apply = async () => {
    if (!source || !result || result.key !== key || applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    try {
      const copy = await filteredCopy(source, result.pixels, filter)
      if (alive.current) onApply(copy, filter, hideOriginal)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось создать копию')
    } finally {
      applyingRef.current = false
      if (alive.current) setApplying(false)
    }
  }
  return (
    <Modal
      title="Растровые фильтры на копии"
      subtitle="Оригинал сохраняется отдельным слоем. Результат — растровая копия, не фиктивный Smart Filter."
      onClose={onClose}
      wide
    >
      <div className="filter-preview-wrap">
        <div className="filter-comparison checkerboard" style={{ width: w, height: h }}>
          <canvas ref={before} data-testid="filter-before" width={w} height={h} />
          <canvas
            ref={after}
            data-testid="filter-after"
            width={w}
            height={h}
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <span className="filter-comparison-line" style={{ left: `${split}%` }} />
        </div>
      </div>
      <label className="filter-compare-slider">
        До / после
        <input
          type="range"
          aria-label="Сравнение фильтра"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(+e.target.value)}
        />
      </label>
      <p className="panel-note">
        Локальные пиксели до текущих коррекций, стилей и маски ·{' '}
        {source ? `${source.canvas.width} × ${source.canvas.height}` : 'Подготовка…'} ·{' '}
        {selection ? 'выделение ограничивает фильтр' : 'весь слой'} ·{' '}
        {working ? 'вычисление…' : 'полный размер рассчитан'}
      </p>
      <fieldset disabled={applying} className="properties-fieldset">
        <Select
          aria-label="Растровый фильтр"
          value={filter.type}
          onChange={(e) => setFilter(defaultRasterFilter(e.target.value as RasterFilterKind))}
        >
          {Object.entries(rasterFilterNames).map(([type, name]) => (
            <option key={type} value={type}>
              {name}
            </option>
          ))}
        </Select>
        <div className="filter-parameters">
          {(filter.type === 'unsharp' || filter.type === 'highpass') &&
            control('radius', 'Радиус фильтра', 0.1, 30, 0.1)}
          {filter.type === 'unsharp' && (
            <>
              {control('amount', 'Эффект резкости, %', 0, 500)}
              {control('threshold', 'Порог резкости', 0, 255)}
            </>
          )}
          {filter.type === 'median' && control('radius', 'Радиус медианы', 1, 5)}
          {filter.type === 'mosaic' && control('size', 'Размер ячейки', 1, 128)}
          {filter.type === 'edges' && control('strength', 'Сила контуров', 0, 5, 0.1)}
          {filter.type === 'gaussian' && control('radius', 'Радиус размытия', 0.1, 100, 0.1)}
          {filter.type === 'motion' && (
            <>
              {control('angle', 'Угол движения, °', -180, 180)}
              {control('distance', 'Дистанция, px', 1, 200)}
            </>
          )}
          {filter.type === 'threshold' && control('level', 'Уровень порога', 1, 255)}
          {filter.type === 'emboss' && (
            <>
              {control('angle', 'Угол света, °', -180, 180)}
              {control('amount', 'Глубина тиснения, %', 0, 500)}
            </>
          )}
          {filter.type === 'noise' && (
            <>
              {control('amount', 'Количество шума, %', 0, 100, 0.1)}
              {control('seed', 'Зерно генератора', 1, 2147483647)}
              <Select
                aria-label="Распределение шума"
                value={filter.distribution}
                onChange={(e) => patch({ distribution: e.target.value })}
              >
                <option value="uniform">Равномерное</option>
                <option value="gaussian">Гауссово</option>
              </Select>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={filter.monochrome}
                  onChange={(e) => patch({ monochrome: e.target.checked })}
                />
                Монохромный шум
              </label>
              <button
                className="compact-button"
                onClick={() => patch({ seed: Math.max(1, Math.floor(Math.random() * 2147483647)) })}
              >
                Новое зерно
              </button>
            </>
          )}
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideOriginal}
            onChange={(e) => setHideOriginal(e.target.checked)}
          />
          Скрыть оригинал, чтобы не удваивать полупрозрачность
        </label>
      </fieldset>
      <p className="panel-note">
        До 8 Мп / 4096 px на слой, до 20 секунд на расчёт. Алгоритмы RGB/8 независимы от Adobe.
        Прозрачные RGB не загрязняют сглаживание; alpha остаётся исходной. Исходный smart object
        сохраняется, но копия не выдаётся за редактируемый smart filter. Для High Pass поверх
        оригинала включи исходник и выбери «Перекрытие» на копии.
      </p>
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
          disabled={applying || working || !result || result.key !== key || !!error}
          onClick={() => void apply()}
        >
          {applying ? 'Создаём копию…' : 'Применить на копии'}
        </button>
      </footer>
    </Modal>
  )
}
