import { useEffect, useMemo, useRef, useState } from 'react'
import type { Selection } from '../types'
import { selectionCoverage } from '../engine/selection'
import { rasterSelection, type SelectionModify } from '../engine/selectionPixels'
import { runSelection } from '../engine/selectionJob'
import { Field, Modal, Select } from './ui'
export const selectionModifyNames: Record<SelectionModify, string> = {
  expand: 'Расширить',
  contract: 'Сузить',
  border: 'Граница',
  smooth: 'Сгладить',
  feather: 'Растушевать',
}
export function SelectionModifyDialog({
  selection,
  width,
  height,
  initial,
  onApply,
  onClose,
}: {
  selection: Selection
  width: number
  height: number
  initial: SelectionModify
  onApply: (selection: Selection, kind: SelectionModify) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState(initial),
    [radius, setRadius] = useState(5),
    [result, setResult] = useState<Uint8ClampedArray | null>(null),
    [working, setWorking] = useState(true),
    [error, setError] = useState('')
  const input = useMemo(
      () => selectionCoverage(selection, width, height),
      [selection, width, height],
    ),
    preview = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setWorking(true)
    setResult(null)
    setError('')
    const timer = setTimeout(() => {
      void runSelection(
        { operation: 'modify', coverage: input, width, height, kind, radius },
        controller.signal,
      )
        .then(setResult)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setWorking(false)
        })
    }, 100)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [input, width, height, kind, radius])
  useEffect(() => {
    const c = preview.current!,
      w = c.width,
      h = c.height,
      x = c.getContext('2d')!,
      image = x.createImageData(w, h),
      data = result || input
    for (let y = 0; y < h; y++)
      for (let xx = 0; xx < w; xx++) {
        const index = (y * w + xx) * 4,
          value =
            data[
              Math.min(height - 1, Math.floor((y * height) / h)) * width +
                Math.min(width - 1, Math.floor((xx * width) / w))
            ]
        image.data[index] = image.data[index + 1] = image.data[index + 2] = value
        image.data[index + 3] = 255
      }
    x.putImageData(image, 0, 0)
  }, [result, input, width, height])
  const scale = Math.min(1, 420 / width, 280 / height)
  return (
    <Modal
      title="Изменить выделение"
      subtitle="Предпросмотр покрытия. Документ и пиксели остаются нетронутыми."
      onClose={onClose}
    >
      <div className="selection-mask-preview">
        <canvas
          ref={preview}
          width={Math.max(1, Math.round(width * scale))}
          height={Math.max(1, Math.round(height * scale))}
          aria-label="Предпросмотр изменения выделения"
        />
      </div>
      <div className="selection-dialog-fields">
        <Select
          aria-label="Изменение выделения"
          value={kind}
          onChange={(e) => setKind(e.target.value as SelectionModify)}
        >
          {Object.entries(selectionModifyNames).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </Select>
        <Field
          label="Радиус выделения"
          value={radius}
          min={0}
          max={100}
          suffix="px"
          onChange={(v) => setRadius(Math.round(v))}
        />
      </div>
      <p className="panel-note">
        Расширение/сужение используют евклидово расстояние до 50%-границы; граница — полоса с обеих
        сторон. Сглаживание убирает мелкие детали. Растушёвка — приближение Гаусса. Белое выделено,
        чёрное исключено.
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
          disabled={working || !result || !!error}
          onClick={() => result && onApply(rasterSelection(result, width, height), kind)}
        >
          {working ? 'Считаем…' : 'Применить выделение'}
        </button>
      </footer>
    </Modal>
  )
}
