import { Pause, Play, Square, X } from 'lucide-react'
import type { Recording } from '../engine/actionRecorder'
export function RecordingBar({
  recording,
  storageError,
  onPause,
  onResume,
  onStop,
  onCancel,
}: {
  recording: Recording
  storageError: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onCancel: () => void
}) {
  const blockers = recording.steps.filter((s) => s.enabled && !s.command).length
  return (
    <div
      className={`recording-bar ${recording.paused ? 'paused' : ''}`}
      role="region"
      aria-label="Запись операции"
    >
      <i />
      <strong>{recording.paused ? 'ПАУЗА' : 'ЗАПИСЬ'}</strong>
      <span>{recording.name}</span>
      <b data-testid="recorded-step-count">{recording.steps.length} шагов</b>
      <span className="recording-warning" role="status" title={recording.warning}>
        {storageError
          ? 'Черновик не сохранён — экспортируй набор'
          : blockers
            ? `${blockers} неподдерживаемых · запуск будет заблокирован`
            : 'Свойства · цвет · стили · геометрия · копии'}
      </span>
      <button className="compact-button" onClick={recording.paused ? onResume : onPause}>
        {recording.paused ? <Play size={12} /> : <Pause size={12} />}
        {recording.paused ? 'Продолжить' : 'Пауза'}
      </button>
      <button className="compact-button stop-recording" onClick={onStop}>
        <Square size={11} />
        Сохранить запись
      </button>
      <button
        className="icon-button"
        aria-label="Отменить запись"
        title="Удаляет только запись операции, не изменения документа"
        onClick={onCancel}
      >
        <X size={14} />
      </button>
    </div>
  )
}
