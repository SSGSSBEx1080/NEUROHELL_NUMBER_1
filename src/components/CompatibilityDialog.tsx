import { CheckCircle2, FileWarning, Layers3, Palette } from 'lucide-react'
import type { CompatibilityReport } from '../engine/psd'
import { Modal } from './ui'

const colorStatusNames: Record<CompatibilityReport['color']['status'], string> = {
  own: 'профиль документа ФШ777',
  matching: 'профиль совпадает с рабочим',
  missing: 'профиль отсутствует',
  mismatch: 'профиль отличался от рабочего',
  unsupported: 'профиль распознан, преобразование ограничено',
  'mode-mismatch': 'профиль не соответствует режиму файла',
}

export function ImportReportDialog({
  report,
  onClose,
}: {
  report: CompatibilityReport
  onClose: () => void
}) {
  return (
    <Modal
      title="Сведения об импорте PSD"
      subtitle="Документ уже открыт. Это необязательный отчёт, а не очередной барьер перед работой."
      onClose={onClose}
    >
      <div className="compatibility-summary">
        <span>
          <FileWarning size={17} />
          <strong>{report.format}</strong>
          формат
        </span>
        <span>
          <Layers3 size={17} />
          <strong>{report.layerCount}</strong>
          слоёв и групп
        </span>
        <span>
          <Palette size={17} />
          <strong>{report.color.embeddedName || 'sRGB / без ICC'}</strong>
          {colorStatusNames[report.color.status]}
        </span>
        <span>
          <CheckCircle2 size={17} />
          <strong>Локально</strong>
          исходный файл на диске не изменён
        </span>
      </div>
      {report.warnings.length ? (
        <ul className="compatibility-list">
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">Импорт не сообщил о потерях или ограничениях.</p>
      )}
      <footer className="dialog-footer">
        <span />
        <button className="primary-button" onClick={onClose}>
          Закрыть
        </button>
      </footer>
    </Modal>
  )
}

export const CompatibilityDialog = ImportReportDialog
