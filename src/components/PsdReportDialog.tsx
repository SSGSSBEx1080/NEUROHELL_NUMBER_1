import { Check, FileCheck2 } from 'lucide-react'
import type { PsdExportReport } from '../engine/psdReport'
import { Modal } from './ui'
export function PsdReportDialog({
  report,
  filename,
  onClose,
}: {
  report: PsdExportReport
  filename: string
  onClose: () => void
}) {
  return (
    <Modal title="Структура сохранённого PSD" subtitle={filename} onClose={onClose} wide>
      {report.original ? (
        <p className="info-note">
          <FileCheck2 size={20} />
          Неизменённый исходный файл сохранён побайтно. Его неизвестные блоки и исходные структуры
          не переписывались.
        </p>
      ) : (
        <>
          <p className="info-note">
            <Check size={20} />
            Это структуры записанного PSD, а не количество объектов во внутреннем проекте. Растровые
            кеши и объединённый предпросмотр записываются дополнительно.
          </p>
          <dl className="psd-report-grid">
            {(
              [
                ['Текстовые слои', report.text],
                ['Векторные фигуры', report.shapes],
                ['Корректирующие слои', report.adjustments],
                ['Направляющие', report.guides],
                ['Смарт-объекты', report.smart],
                ['Группы', report.groups],
                ['Растровые слои', report.images],
                ['Растровые маски', report.masks],
                ['Векторные маски', report.vectorMasks],
                ['Обтравочные слои', report.clipping],
              ] as const
            ).map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          {!!report.editableContents && (
            <p className="panel-note">
              В {report.editableContents} смарт-объектах находится вложенный PSD с редактируемым
              текстом или вектором для сложных преобразований.
            </p>
          )}
        </>
      )}
      {!!report.fonts.length && (
        <p className="panel-note">Шрифты PostScript: {report.fonts.join(', ')}.</p>
      )}
      {!!report.warnings.length && (
        <>
          <h3 className="report-title">Преобразования и ограничения</h3>
          <ul className="compatibility-list">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <p className="panel-note">
        Отчёт относится к последнему сохранению этого документа. Это не подтверждение полной
        совместимости или тестирования в Photoshop.
      </p>
      <footer className="dialog-footer">
        <button className="primary-button" onClick={onClose}>
          Понятно
        </button>
      </footer>
    </Modal>
  )
}
