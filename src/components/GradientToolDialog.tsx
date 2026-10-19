import { Blend, RotateCcw } from 'lucide-react'
import { solidGradient, type GradientDefinition } from '../engine/gradientRamp'
import { GradientDefinitionEditor } from './GradientDefinitionEditor'
import { Modal } from './ui'

export function GradientToolDialog({
  gradient,
  color,
  secondaryColor,
  onChange,
  onClose,
}: {
  gradient?: GradientDefinition
  color: string
  secondaryColor: string
  onChange: (gradient: GradientDefinition | undefined) => void
  onClose: () => void
}) {
  const effective =
    gradient ||
    solidGradient(
      [
        { position: 0, color },
        { position: 1, color: secondaryColor },
      ],
      undefined,
      'Основной → фон',
    )
  return (
    <Modal title="Градиент инструмента" subtitle="Градиент · G" onClose={onClose}>
      <GradientDefinitionEditor
        definition={effective}
        onChange={(next) => onChange(next)}
        onFinish={() => {}}
      />
      <footer className="dialog-footer">
        <button className="text-button" onClick={() => onChange(undefined)}>
          <RotateCcw size={14} />
          Основной → фон
        </button>
        <button className="primary-button" onClick={onClose}>
          <Blend size={15} />
          Готово
        </button>
      </footer>
    </Modal>
  )
}
