import { useState } from 'react'
import { Link2 } from 'lucide-react'
import type { EditorDocument, Point } from '../types'
import { Modal } from './ui'
export function ImageSizeDialog({
  doc,
  resize,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  resize: boolean
  onApply: (width: number, height: number, dpi: number, anchor: Point) => void
  onClose: () => void
}) {
  const [width, setWidth] = useState(String(doc.width)),
    [height, setHeight] = useState(String(doc.height)),
    [dpi, setDpi] = useState(String(doc.dpi || 72)),
    [linked, setLinked] = useState(true),
    [anchor, setAnchor] = useState<Point>({ x: 0.5, y: 0.5 })
  const valid =
    Number.isInteger(+width) &&
    Number.isInteger(+height) &&
    +width > 0 &&
    +height > 0 &&
    +width <= 4096 &&
    +height <= 4096 &&
    +dpi >= 1 &&
    +dpi <= 1200
  const dimension = (value: string, horizontal: boolean) => {
    if (horizontal) setWidth(value)
    else setHeight(value)
    if (resize && linked && Number.isFinite(+value) && +value > 0) {
      if (horizontal) setHeight(String(Math.max(1, Math.round((+value * doc.height) / doc.width))))
      else setWidth(String(Math.max(1, Math.round((+value * doc.width) / doc.height))))
    }
  }
  return (
    <Modal
      title={resize ? 'Размер изображения' : 'Размер холста'}
      subtitle={
        resize
          ? 'Масштабируются геометрия, маски и редактируемый текст. Исходные растры не перезаписываются.'
          : 'Меняются границы холста. Содержимое за краем не удаляется.'
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onApply(+width, +height, +dpi, anchor)
        }}
      >
        <div className="dialog-grid">
          <label className="dialog-label">
            Ширина, px
            <input
              className="dialog-input"
              aria-label="Новая ширина"
              type="number"
              min={1}
              max={4096}
              value={width}
              onChange={(e) => dimension(e.target.value, true)}
            />
          </label>
          <span className="dimension-times">×</span>
          <label className="dialog-label">
            Высота, px
            <input
              className="dialog-input"
              aria-label="Новая высота"
              type="number"
              min={1}
              max={4096}
              value={height}
              onChange={(e) => dimension(e.target.value, false)}
            />
          </label>
        </div>
        {resize ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
            <Link2 size={13} />
            Сохранять пропорции
          </label>
        ) : (
          <div className="canvas-anchor-controls">
            <span>Опорная точка содержимого</span>
            <div className="canvas-anchor-grid" role="group" aria-label="Опорная точка холста">
              {[
                'Верхний левый',
                'Верхний центр',
                'Верхний правый',
                'Средний левый',
                'Центр',
                'Средний правый',
                'Нижний левый',
                'Нижний центр',
                'Нижний правый',
              ].map((name, i) => {
                const x = (i % 3) / 2,
                  y = Math.floor(i / 3) / 2,
                  active = anchor.x === x && anchor.y === y
                return (
                  <button
                    type="button"
                    key={name}
                    aria-label={name}
                    aria-pressed={active}
                    className={active ? 'active' : ''}
                    onClick={() => setAnchor({ x, y })}
                  >
                    {active ? '●' : ['↖', '↑', '↗', '←', '·', '→', '↙', '↓', '↘'][i]}
                  </button>
                )
              })}
            </div>
            <p className="panel-note">
              Слои, связанные маски и направляющие смещаются вместе. Содержимое за новым краем не
              удаляется.
            </p>
          </div>
        )}
        <label className="dialog-label" style={{ marginTop: 20 }}>
          Разрешение печати, ppi
          <input
            className="dialog-input"
            aria-label="Разрешение документа"
            type="number"
            min={1}
            max={1200}
            value={dpi}
            onChange={(e) => setDpi(e.target.value)}
          />
        </label>
        <p className="panel-note">
          PPI — метаданные размера печати. Сам по себе этот параметр не добавляет деталей и не
          меняет число пикселей.
        </p>
        {!valid && (
          <p role="alert" className="error-text">
            Размеры: 1–4096 px. Разрешение: 1–1200 ppi.
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" disabled={!valid}>
            Применить размер
          </button>
        </footer>
      </form>
    </Modal>
  )
}
