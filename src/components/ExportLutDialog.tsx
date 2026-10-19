import { useState } from 'react'
import type { EditorDocument } from '../types'
import { exportableColorStack, sampleColorStack } from '../engine/lutExport'
import { serializeCube } from '../engine/colorLut'
import { downloadBlob } from '../engine/render'
import { Modal, Select } from './ui'
export function ExportLutDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: EditorDocument
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [size, setSize] = useState(17),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false)
  let stack: ReturnType<typeof exportableColorStack> = [],
    reason = ''
  try {
    stack = exportableColorStack(doc)
  } catch (e) {
    reason = e instanceof Error ? e.message : 'Стек недоступен'
  }
  const save = async () => {
    setWorking(true)
    setError('')
    try {
      const lut = sampleColorStack(doc, size),
        blob = new Blob([serializeCube(lut)], { type: 'text/plain;charset=utf-8' }),
        name = await downloadBlob(blob, `${doc.name.replace(/[<>:"/\\|?*]/g, '_')}-look.cube`)
      onSaved(name)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сформировать LUT')
    } finally {
      setWorking(false)
    }
  }
  return (
    <Modal
      title="Экспорт цветового стека в CUBE"
      subtitle="Цветовая таблица из верхних глобальных коррекций"
      onClose={() => {
        if (!working) onClose()
      }}
    >
      {reason ? (
        <p className="error-text" role="alert">
          {reason}
        </p>
      ) : (
        <>
          <p className="panel-note">
            Включены следующие видимые коррекции, снизу вверх. Их порядок, режим наложения и
            непрозрачность учитываются.
          </p>
          <ol className="lut-stack-list">
            {stack.map((l) => (
              <li key={l.id}>
                {l.name} <span>{Math.round(l.opacity * 100)}%</span>
              </li>
            ))}
          </ol>
          <Select
            aria-label="Сетка экспортируемой LUT"
            value={size}
            onChange={(e) => setSize(+e.target.value)}
            disabled={working}
          >
            <option value="17">17³ · компактно</option>
            <option value="33">33³ · точнее</option>
          </Select>
        </>
      )}
      <p className="panel-note">
        Берётся только непрерывный верхний стек глобальных корректирующих слоёв. Маски, обтравка и
        стили блокируют экспорт, а не теряются молча. Слои внутри групп/пиксельные фильтры не входят
        в этот стек. Сохрани PSD для полного документа.
      </p>
      <p className="panel-note">
        Это сэмплированная таблица RGB/8: резкие пороги и сложные кривые могут отличаться между
        узлами. Большая сетка уменьшает, но не устраняет эту погрешность. LUT не является
        ICC-профилем.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="secondary-button" disabled={working} onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={working || !!reason}
          onClick={() => void save()}
        >
          {working ? 'Экспортируем…' : 'Сохранить цветовой стек .cube'}
        </button>
      </footer>
    </Modal>
  )
}
