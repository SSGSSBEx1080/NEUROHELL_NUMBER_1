import { useEffect, useRef, useState } from 'react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
} from 'lucide-react'
import type { EditorDocument } from '../types'
import { isLayerLocked } from '../engine/document'
import {
  arrangeLayers,
  arrangeNames,
  type ArrangeMode,
  type ArrangeTarget,
} from '../engine/arrange'
import { prepareDocument } from '../engine/render'
import { Modal, Select } from './ui'
export function ArrangeDialog({
  doc,
  ids,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  ids: string[]
  onApply: (next: EditorDocument, label: string) => void
  onClose: () => void
}) {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [selected, setSelected] = useState(
      ids.filter((id) =>
        doc.layers.some((l) => l.id === id && l.kind !== 'adjustment' && !isLayerLocked(doc, id)),
      ),
    ),
    [target, setTarget] = useState<ArrangeTarget>(ids.length > 1 ? 'selection' : 'canvas'),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false)
  const execute = async (mode: ArrangeMode) => {
    setWorking(true)
    setError('')
    try {
      await prepareDocument(doc)
      if (!alive.current) return
      onApply(arrangeLayers(doc, selected, mode, target), arrangeNames[mode])
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Ошибка компоновки')
    } finally {
      if (alive.current) setWorking(false)
    }
  }
  const icons = [
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignStartHorizontal,
    AlignCenterHorizontal,
    AlignEndHorizontal,
  ]
  return (
    <Modal
      title="Выравнивание и интервалы"
      subtitle="Редактируемые слои и связанные маски перемещаются, не растрируются. Одно действие истории."
      onClose={onClose}
      wide
    >
      <fieldset disabled={working} className="properties-fieldset">
        <div className="arrange-toolbar">
          <Select
            aria-label="Относительно чего выравнивать"
            value={target}
            onChange={(e) => setTarget(e.target.value as ArrangeTarget)}
          >
            <option value="selection">Границы выбранных слоёв</option>
            <option value="canvas">Холст</option>
          </Select>
          <button
            className="text-button"
            onClick={() =>
              setSelected(
                doc.layers
                  .filter(
                    (l) =>
                      l.kind !== 'group' && l.kind !== 'adjustment' && !isLayerLocked(doc, l.id),
                  )
                  .map((l) => l.id),
              )
            }
          >
            Выбрать незаблокированные
          </button>
        </div>
        <div className="arrange-layer-list">
          {[...doc.layers].reverse().map((l) => (
            <label className="arrange-layer" key={l.id}>
              <input
                type="checkbox"
                aria-label={`Компоновка: ${l.name}`}
                checked={selected.includes(l.id)}
                disabled={l.kind === 'adjustment' || isLayerLocked(doc, l.id)}
                onChange={(e) =>
                  setSelected((a) =>
                    e.target.checked ? [...a, l.id] : a.filter((id) => id !== l.id),
                  )
                }
              />
              <span>
                {l.kind === 'group'
                  ? '▤'
                  : l.kind === 'text'
                    ? 'T'
                    : l.kind === 'adjustment'
                      ? '◐'
                      : '◇'}
              </span>
              {l.name}
              {isLayerLocked(doc, l.id) && <small>заблокирован</small>}
            </label>
          ))}
        </div>
        <h3 className="report-title">Выровнять · {selected.length} выбрано</h3>
        <div className="arrange-align-grid">
          {(['left', 'center-x', 'right', 'top', 'center-y', 'bottom'] as const).map((mode, i) => {
            const Icon = icons[i]
            return (
              <button
                key={mode}
                className="action-button"
                disabled={!selected.length}
                onClick={() => void execute(mode)}
              >
                <Icon size={16} />
                {arrangeNames[mode]}
              </button>
            )
          })}
        </div>
        <h3 className="report-title">Распределить между крайними слоями</h3>
        <div className="arrange-distribute-grid">
          {(['distribute-x', 'distribute-y', 'gaps-x', 'gaps-y'] as const).map((mode) => (
            <button
              key={mode}
              className="action-button"
              disabled={selected.length < 3}
              onClick={() => void execute(mode)}
            >
              {arrangeNames[mode]}
            </button>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      <p className="panel-note">
        Текст выравнивается по измеренным границам букв/рамки, повёрнутые слои — по габариту
        геометрии. Родитель и выбранный потомок перемещаются только один раз. Распределение требует
        трёх независимых объектов; крайние задают диапазон. Коррекции без собственных пикселей и
        заблокированные слои недоступны. Свободная трансформация всего мультивыбора пока не
        добавлена.
      </p>
      <footer className="dialog-footer">
        <button className="secondary-button" disabled={working} onClick={onClose}>
          {working ? 'Подготовка шрифтов…' : 'Отмена'}
        </button>
      </footer>
    </Modal>
  )
}
