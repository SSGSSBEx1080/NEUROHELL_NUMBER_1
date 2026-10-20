import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, Selection, SelectionMode } from '../types'
import { exportCanvas } from '../engine/render'
import { runSelection } from '../engine/selectionJob'
import { rasterSelection, type ColorRangeMode } from '../engine/selectionPixels'
import { ColorField, Field, Modal, Select } from './ui'
export { selectionModeNames } from './selection-labels'
import { selectionModeNames } from './selection-labels'
export function ColorRangeDialog({
  doc,
  initialMode,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  initialMode: SelectionMode
  onApply: (selection: Selection, mode: SelectionMode) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<{
      canvas: HTMLCanvasElement
      pixels: Uint8ClampedArray
    } | null>(null),
    [colors, setColors] = useState(['#ffffff']),
    [mode, setMode] = useState<ColorRangeMode>('sampled'),
    [operation, setOperation] = useState(initialMode),
    [fuzziness, setFuzziness] = useState(40),
    [range, setRange] = useState(128),
    [invert, setInvert] = useState(false),
    [result, setResult] = useState<Uint8ClampedArray | null>(null),
    [working, setWorking] = useState(true),
    [error, setError] = useState('')
  const image = useRef<HTMLCanvasElement>(null),
    mask = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let active = true
    void exportCanvas(doc)
      .then((canvas) => {
        if (active)
          setSource({
            canvas,
            pixels: canvas.getContext('2d')!.getImageData(0, 0, doc.width, doc.height).data,
          })
      })
      .catch((e) => {
        if (active) {
          setError(e.message)
          setWorking(false)
        }
      })
    return () => {
      active = false
    }
  }, [doc])
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    setWorking(true)
    setResult(null)
    setError('')
    const timer = setTimeout(
      () =>
        void runSelection(
          {
            operation: 'range',
            pixels: source.pixels,
            width: doc.width,
            height: doc.height,
            colors: colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))),
            fuzziness,
            range,
            mode,
            invert,
          },
          controller.signal,
        )
          .then(setResult)
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message)
          })
          .finally(() => {
            if (!controller.signal.aborted) setWorking(false)
          }),
      120,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, colors, fuzziness, range, mode, invert, doc.width, doc.height])
  const scale = Math.min(1, 340 / doc.width, 280 / doc.height),
    w = Math.max(1, Math.round(doc.width * scale)),
    h = Math.max(1, Math.round(doc.height * scale))
  useEffect(() => {
    if (!source) return
    image.current?.getContext('2d')!.drawImage(source.canvas, 0, 0, w, h)
  }, [source, w, h])
  useEffect(() => {
    const c = mask.current!,
      x = c.getContext('2d')!,
      pixels = x.createImageData(w, h)
    if (result)
      for (let y = 0; y < h; y++)
        for (let xx = 0; xx < w; xx++) {
          const i = (y * w + xx) * 4,
            coverage =
              result[
                Math.min(doc.height - 1, Math.floor((y * doc.height) / h)) * doc.width +
                  Math.min(doc.width - 1, Math.floor((xx * doc.width) / w))
              ]
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = coverage
          pixels.data[i + 3] = 255
        }
    x.putImageData(pixels, 0, 0)
  }, [result, w, h, doc.width, doc.height])
  return (
    <Modal
      title="Цветовой диапазон"
      subtitle="Выделение по цвету или яркости. Исходное изображение не изменяется."
      onClose={onClose}
      wide
    >
      <div className="range-previews">
        <figure>
          <div className="selection-mask-preview checkerboard">
            <canvas
              ref={image}
              data-testid="color-range-source"
              width={w}
              height={h}
              aria-label="Образец цвета: клик заменяет, Shift-клик добавляет"
              onClick={(e) => {
                if (!source) return
                const rect = e.currentTarget.getBoundingClientRect(),
                  x = Math.min(
                    doc.width - 1,
                    Math.max(0, Math.floor(((e.clientX - rect.left) * doc.width) / rect.width)),
                  ),
                  y = Math.min(
                    doc.height - 1,
                    Math.max(0, Math.floor(((e.clientY - rect.top) * doc.height) / rect.height)),
                  ),
                  i = (y * doc.width + x) * 4
                const color =
                  '#' +
                  [...source.pixels.slice(i, i + 3)]
                    .map((v) => v.toString(16).padStart(2, '0'))
                    .join('')
                setColors(e.shiftKey ? [...new Set([...colors, color])].slice(-8) : [color])
                setMode('sampled')
              }}
            />
          </div>
          <figcaption>Клик — образец · Shift+клик — добавить</figcaption>
        </figure>
        <figure>
          <div className="selection-mask-preview">
            <canvas ref={mask} width={w} height={h} aria-label="Маска цветового диапазона" />
          </div>
          <figcaption>
            {working ? 'Расчёт…' : 'Белое выделено · прозрачность учитывается'}
          </figcaption>
        </figure>
      </div>
      <div className="selection-dialog-fields">
        <Select
          aria-label="Тип цветового диапазона"
          value={mode}
          onChange={(e) => setMode(e.target.value as ColorRangeMode)}
        >
          <option value="sampled">По образцам цвета</option>
          <option value="shadows">Тени</option>
          <option value="midtones">Средние тона</option>
          <option value="highlights">Света</option>
        </Select>
        <Select
          aria-label="Операция с выделением"
          value={operation}
          onChange={(e) => setOperation(e.target.value as SelectionMode)}
        >
          {Object.entries(selectionModeNames).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <div className="selection-dialog-fields">
        <Field
          label="Разброс цвета"
          value={fuzziness}
          min={0}
          max={255}
          onChange={(v) => setFuzziness(Math.round(v))}
        />
        {mode !== 'sampled' && (
          <Field
            label="Тональный уровень"
            value={range}
            min={0}
            max={255}
            onChange={(v) => setRange(Math.round(v))}
          />
        )}
        <label className="checkbox-row">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          Инвертировать результат
        </label>
      </div>
      {mode === 'sampled' && (
        <div className="range-swatches">
          {colors.map((color, i) => (
            <ColorField
              key={i}
              label={`Образец ${i + 1}`}
              value={color}
              onChange={(v) => setColors((a) => a.map((c, j) => (i === j ? v : c)))}
            />
          ))}
        </div>
      )}
      <p className="panel-note">
        До 8 образцов. Локальная RGB-модель, не распознавание объектов/лиц и не Adobe Color Range
        engine. Отмена действительно останавливает worker.
      </p>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={!result || working || !!error}
          onClick={() =>
            result && onApply(rasterSelection(result, doc.width, doc.height), operation)
          }
        >
          Применить диапазон
        </button>
      </footer>
    </Modal>
  )
}
