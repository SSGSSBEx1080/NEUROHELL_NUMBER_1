import { AlertTriangle, ArrowUpRight, Check, FileJson, Layers } from 'lucide-react'
import type { CompatibilityReport } from '../engine/psd'
import { Modal } from './ui'
export function CompatibilityDialog({
  report,
  onClose,
  onConfirm,
  onSave,
}: {
  report: CompatibilityReport
  onClose: () => void
  onConfirm: () => void
  onSave: () => void
}) {
  return (
    <Modal
      title="Твоя работа — в новой студии"
      subtitle={`${report.format} · ${report.title}`}
      onClose={onClose}
      wide
    >
      <div className="compatibility-summary">
        <span>
          <Layers size={18} />
          <strong>{report.layerCount}</strong> слоёв
        </span>
        <span>
          <Check size={15} />
          RGB / 8 бит
        </span>
        <span>
          <Check size={15} />
          Обработка на устройстве
        </span>
      </div>
      <div className="info-note">
        <AlertTriangle size={19} />
        <span>
          Это импорт рабочей копии, а не полная совместимость с Photoshop. Исходный файл не
          изменяется. Рабочая копия откроется в новой вкладке.
        </span>
      </div>
      <h3 className="report-title">Что важно знать</h3>
      <ul className="compatibility-list">
        {report.warnings.length ? (
          report.warnings.map((w, i) => <li key={i}>{w}</li>)
        ) : (
          <li>Поддерживаемые растровые слои прочитаны. Проверь документ после открытия.</li>
        )}
      </ul>
      <footer className="dialog-footer">
        <button className="text-button" onClick={onSave}>
          <FileJson size={14} />
          Сохранить текущий PSD
        </button>
        <button className="primary-button" onClick={onConfirm}>
          Открыть рабочую копию
          <ArrowUpRight size={15} />
        </button>
      </footer>
    </Modal>
  )
}
