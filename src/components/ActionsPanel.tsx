import { useState } from 'react'
import { AlertTriangle, Circle, Play, Settings2, Zap } from 'lucide-react'
import { actionBlockers, type StudioAction } from '../engine/actions'
export function ActionsPanel({
  actions,
  onRun,
  onManage,
  onRecord,
  canRun,
  recording,
}: {
  actions: StudioAction[]
  onRun: (action: StudioAction) => void
  onManage: () => void
  onRecord: (name: string) => void
  canRun: boolean
  recording: boolean
}) {
  const [id, setId] = useState(actions.at(-1)?.id),
    [name, setName] = useState('Моя операция')
  const selected = actions.find((a) => a.id === id) || actions.at(-1),
    blockers = selected ? actionBlockers(selected) : []
  return (
    <section className="quick-actions-panel" aria-label="Операции слоя">
      <header>
        <strong>Операции</strong>
        <button className="compact-button" onClick={onManage}>
          <Settings2 size={12} />
          Редактор
        </button>
      </header>
      <div className="quick-action-list">
        {actions.map((a) => (
          <button
            key={a.id}
            className={selected?.id === a.id ? 'selected' : ''}
            onClick={() => setId(a.id)}
          >
            <Zap size={13} />
            <span>
              {a.name}
              <small>{a.steps.filter((s) => s.enabled).length} включённых шагов</small>
            </span>
            {!!actionBlockers(a).length && <AlertTriangle size={12} />}
          </button>
        ))}
      </div>
      <div className="quick-action-footer">
        {selected && (
          <button
            className="action-button primary-action"
            disabled={
              !canRun || recording || !!blockers.length || !selected.steps.some((s) => s.enabled)
            }
            onClick={() => onRun(selected)}
          >
            <Play size={13} />
            Выполнить
          </button>
        )}
        {!!blockers.length && (
          <p className="panel-note">Есть неподдерживаемые шаги. Открой редактор операций.</p>
        )}
        <input
          aria-label="Имя записи из панели"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="action-button"
          disabled={!canRun || recording || actions.length >= 100}
          onClick={() => onRecord(name)}
        >
          <Circle size={12} />
          Записать действия
        </button>
        <p className="panel-note">
          Операция действует на выбранный слой. Запись видна над холстом; undo/redo во время записи
          становятся блокирующим шагом.
        </p>
      </div>
    </section>
  )
}
