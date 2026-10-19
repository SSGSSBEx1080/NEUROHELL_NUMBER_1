import { correctionNames, type CorrectionKind } from '../engine/adjustmentTypes'
import { Modal } from './ui'
const hints: Record<CorrectionKind, string> = {
  'brightness/contrast': 'Общая яркость и контраст',
  levels: 'Чёрная/белая точки и гамма RGB',
  curves: 'До 16 точек · RGB и отдельные каналы',
  exposure: 'EV, смещение и гамма',
  'hue/saturation': 'Тон, насыщенность, светлота',
  vibrance: 'Усиление менее насыщенных цветов',
  'color balance': 'Тени, средние тона, света',
  'black & white': 'Шесть цветовых диапазонов',
  'channel mixer': 'Матрица RGB и монохромный режим',
  invert: 'Цветовой негатив',
  posterize: 'От 2 до 256 уровней',
  threshold: 'Чёрный/белый по порогу',
}
export function CorrectionDialog({
  onAdd,
  onClose,
}: {
  onAdd: (type: CorrectionKind) => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Новый корректирующий слой"
      subtitle="Параметры остаются редактируемыми. Исходные пиксели не изменяются."
      onClose={onClose}
      wide
    >
      <div className="correction-picker">
        {Object.entries(correctionNames).map(([type, name]) => (
          <button key={type} onClick={() => onAdd(type as CorrectionKind)}>
            <span className="correction-symbol">◐</span>
            <strong>{name}</strong>
            <small>{hints[type as CorrectionKind]}</small>
          </button>
        ))}
      </div>
      <p className="panel-note">
        Слой добавится над выбранным, внутри той же группы. Активное выделение станет маской.
        Дальнейшая правка — справа, непрозрачность и режим наложения — в слоях.
      </p>
    </Modal>
  )
}
