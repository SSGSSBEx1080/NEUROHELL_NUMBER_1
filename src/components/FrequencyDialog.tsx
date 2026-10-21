import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ADJUSTMENTS, type EditorDocument, type Layer, type Selection } from '../types'
import { frequencyDetail } from '../engine/rasterFilters'
import { runRasterFilter } from '../engine/filterJob'
import { prepareFilterSource, processedCopy, type FilterSource } from '../engine/filterLayers'
import { Modal, SliderField } from './ui'

export function FrequencyDialog({
  doc,
  id,
  selection,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  id: string
  selection: Selection | null
  onApply: (low: Layer, high: Layer, hideOriginal: boolean) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<FilterSource | null>(null),
    [radius, setRadius] = useState(8),
    [hideOriginal, setHideOriginal] = useState(true),
    [applying, setApplying] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
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
        if (valid) setError(e instanceof Error ? e.message : 'Не удалось подготовить слой')
      })
    return () => {
      valid = false
    }
  }, [doc, id, selection])

  const apply = async () => {
    if (!source || applying) return
    setApplying(true)
    setError('')
    try {
      const low = await runRasterFilter({
        width: source.canvas.width,
        height: source.canvas.height,
        pixels: source.pixels,
        mask: source.mask,
        filter: { type: 'gaussian', radius },
      })
      // Exact reconstruction needs plain full-opacity copies: inherited
      // opacity, live corrections or FX would be applied twice (once per
      // layer) and break the Linear Light identity.
      const clean = (copy: Layer): Layer => ({
        ...copy,
        opacity: 1,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        styles: undefined,
        blendIf: undefined,
      })
      const lowCopy = clean(await processedCopy(source, low, 'Низкие частоты'))
      const highCopy = clean(
        await processedCopy(source, frequencyDetail(source.pixels, low), 'Высокие частоты'),
      )
      if (alive.current) onApply(lowCopy, { ...highCopy, blendMode: 'linear-light' }, hideOriginal)
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : 'Не удалось создать слои')
        setApplying(false)
      }
    }
  }

  return (
    <Modal
      title="Частотное разложение"
      subtitle="Два слоя: размытые «Низкие частоты» и детали «Высокие частоты» в режиме «Линейный свет». Вместе они точно восстанавливают пиксели оригинала; правь тон на низких, текстуру на высоких. Живые коррекции, стили и непрозрачность оригинала на копии не переносятся — сначала растрируй слой, если их нужно запечь."
      onClose={onClose}
    >
      <p className="panel-note">
        {source ? `${source.canvas.width} × ${source.canvas.height}` : 'Подготовка…'} · локальные
        пиксели до коррекций, стилей и маски · нужны два свободных слоя из 100
      </p>
      <fieldset disabled={!source || applying} className="properties-fieldset">
        <SliderField
          label="Радиус разделения"
          suffix=" px"
          value={radius}
          min={1}
          max={100}
          step={0.5}
          onChange={setRadius}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideOriginal}
            onChange={(e) => setHideOriginal(e.target.checked)}
          />
          Скрыть исходный слой
        </label>
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
          disabled={!source || applying}
          onClick={() => void apply()}
        >
          {applying ? 'Разложение…' : 'Создать два слоя'}
        </button>
      </footer>
    </Modal>
  )
}
