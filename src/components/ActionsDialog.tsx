import { useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Download,
  ListPlus,
  Play,
  Search,
  Settings2,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { actionBlockers, parseActionCommand, type StudioAction } from '../engine/actions'
import { downloadBlob } from '../engine/render'
import { IconButton, Modal, Select } from './ui'
export function ActionsDialog({
  actions,
  onClose,
  onImport,
  onRun,
  onCapture,
  onDelete,
  canRun,
  onRecord,
  onUpdate,
  recording,
  storageError,
}: {
  actions: StudioAction[]
  onClose: () => void
  onImport: () => void
  onRun: (action: StudioAction) => void
  onCapture: () => void
  onDelete: (id: string) => void
  canRun: boolean
  onRecord: (name: string) => void
  onUpdate: (action: StudioAction) => void
  recording: boolean
  storageError: string
}) {
  const [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [id, setId] = useState(actions.at(-1)?.id)
  const [recordName, setRecordName] = useState('Моя операция'),
    [editIndex, setEditIndex] = useState<number | null>(null),
    [json, setJson] = useState('')
  const active = actions.find((a) => a.id === id) || actions.at(-1),
    filtered = actions.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
  const blockers = active ? actionBlockers(active) : []
  const updateSteps = (steps: StudioAction['steps']) => {
    if (active) {
      onUpdate({ ...active, steps })
      setEditIndex(null)
      setError('')
    }
  }
  const updateShortcut = (shortcut: StudioAction['shortcut']) => {
    if (!active) return
    if (
      shortcut &&
      actions.some(
        (a) =>
          a.id !== active.id &&
          a.shortcut?.key === shortcut.key &&
          a.shortcut.ctrl === shortcut.ctrl &&
          a.shortcut.shift === shortcut.shift,
      )
    ) {
      setError('Эта комбинация уже занята другой операцией')
      return
    }
    onUpdate({ ...active, shortcut })
    setError('')
  }
  return (
    <Modal
      title="Меньше повторов. Больше идей."
      subtitle="Операции · настоящая запись и атомарное воспроизведение"
      onClose={onClose}
      wide
    >
      <div className="action-record-start">
        <span className="record-dot" />
        <input
          aria-label="Название новой записи"
          value={recordName}
          maxLength={100}
          onChange={(e) => setRecordName(e.target.value)}
        />
        <button
          className="secondary-button"
          disabled={!canRun || recording || actions.length >= 100}
          onClick={() => onRecord(recordName)}
        >
          <Circle size={13} />
          Начать запись
        </button>
      </div>
      <div className="actions-top">
        <label className="action-search">
          <Search size={15} />
          <input
            aria-label="Поиск операций"
            placeholder="Найти свой сценарий…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="secondary-button" onClick={onImport}>
          <Upload size={14} />
          Импорт .atn / .json
        </button>
      </div>
      <div className="actions-layout">
        <div className="actions-list">
          {filtered.map((a, i) => (
            <button
              key={a.id}
              className={active?.id === a.id ? 'selected' : ''}
              onClick={() => {
                setId(a.id)
                setEditIndex(null)
                setError('')
              }}
            >
              <span className={`action-mark mark-${i % 5}`}>
                <Zap size={15} />
              </span>
              <span>
                <strong>{a.name}</strong>
                <small>{a.source}</small>
              </span>
              {a.shortcut && (
                <kbd>
                  {a.shortcut.ctrl ? 'Ctrl+' : ''}
                  {a.shortcut.shift ? '⇧' : ''}
                  {a.shortcut.key}
                </kbd>
              )}
              {actionBlockers(a).length ? <AlertTriangle size={12} /> : <ChevronRight size={12} />}
            </button>
          ))}
          {!filtered.length && <p className="panel-note">По этому запросу ничего нет.</p>}
        </div>
        <div className="action-detail">
          {active ? (
            <>
              <div className="action-name-edit">
                <input
                  key={active.id}
                  aria-label="Название операции"
                  defaultValue={active.name}
                  maxLength={100}
                  onBlur={(e) =>
                    onUpdate({ ...active, name: e.target.value.trim() || active.name })
                  }
                />
                <IconButton
                  icon={Trash2}
                  label="Удалить операцию"
                  onClick={() => onDelete(active.id)}
                />
              </div>
              <div className="action-shortcut">
                <Select
                  aria-label="Клавиша операции"
                  value={active.shortcut?.key || ''}
                  onChange={(e) =>
                    updateShortcut(
                      e.target.value
                        ? { key: e.target.value, ctrl: false, shift: true }
                        : undefined,
                    )
                  }
                >
                  <option value="">Без клавиши</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i}>{`F${i + 1}`}</option>
                  ))}
                </Select>
                {active.shortcut && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={active.shortcut.ctrl}
                        onChange={(e) =>
                          updateShortcut({ ...active.shortcut!, ctrl: e.target.checked })
                        }
                      />
                      Ctrl
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={active.shortcut.shift}
                        onChange={(e) =>
                          updateShortcut({ ...active.shortcut!, shift: e.target.checked })
                        }
                      />
                      Shift
                    </label>
                  </>
                )}
              </div>
              <div className="section-heading">
                {active.steps.length} шагов<span>Выполняются сверху вниз</span>
              </div>
              {active.steps.map((s, i) => (
                <div
                  key={i}
                  className={`action-step action-step-editable ${!s.enabled ? 'disabled-step' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Включить шаг ${i + 1}`}
                    checked={s.enabled}
                    onChange={(e) =>
                      updateSteps(
                        active.steps.map((v, j) =>
                          j === i ? { ...v, enabled: e.target.checked } : v,
                        ),
                      )
                    }
                  />
                  <span>{s.command ? <Check size={13} /> : <AlertTriangle size={13} />}</span>
                  <div>
                    <strong>{s.name}</strong>
                    {s.unsupported && <small>{s.unsupported}</small>}
                    {!s.enabled && <small>Выключен явно · не будет выполнен</small>}
                  </div>
                  <div className="step-controls">
                    <IconButton
                      icon={Settings2}
                      label={`Параметры шага ${i + 1}`}
                      disabled={!s.command}
                      onClick={() => {
                        setEditIndex(i)
                        setJson(JSON.stringify(s.command, null, 2))
                        setError('')
                      }}
                    />
                    {[-1, 1].map((d) => (
                      <IconButton
                        key={d}
                        icon={d < 0 ? ArrowUp : ArrowDown}
                        label={`${d < 0 ? 'Выше' : 'Ниже'} шаг ${i + 1}`}
                        disabled={i + d < 0 || i + d >= active.steps.length}
                        onClick={() => {
                          const steps = [...active.steps]
                          ;[steps[i], steps[i + d]] = [steps[i + d], steps[i]]
                          updateSteps(steps)
                        }}
                      />
                    ))}
                    <IconButton
                      icon={Trash2}
                      label={`Удалить шаг ${i + 1}`}
                      onClick={() => updateSteps(active.steps.filter((_, j) => j !== i))}
                    />
                  </div>
                </div>
              ))}
              {editIndex !== null && active.steps[editIndex]?.command && (
                <div className="step-parameter-editor">
                  <label>
                    Параметры шага {editIndex + 1}
                    <textarea
                      aria-label="Данные шага JSON"
                      value={json}
                      maxLength={50000}
                      rows={8}
                      spellCheck={false}
                      onChange={(e) => setJson(e.target.value)}
                    />
                  </label>
                  <p className="panel-note">
                    Строго проверяемые данные, не JavaScript. dx/dy — относительное смещение;
                    scaleX/scaleY — множители. properties/adjust — абсолютные значения.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      try {
                        const command = parseActionCommand(JSON.parse(json))
                        if (!command) throw new Error('Этот тип команды не поддерживается')
                        updateSteps(
                          active.steps.map((s, i) =>
                            i === editIndex ? { ...s, command, unsupported: undefined } : s,
                          ),
                        )
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Ошибка параметров')
                      }
                    }}
                  >
                    Применить параметры
                  </button>
                </div>
              )}
              {!!blockers.length && (
                <div className="action-warning">
                  Есть неподдерживаемые шаги. Запуск всей операции заблокирован — ничего не будет
                  молча пропущено. Выключать или удалять шаги можно только явно.
                </div>
              )}
            </>
          ) : (
            <p>Запиши или импортируй операцию, чтобы начать.</p>
          )}
        </div>
      </div>
      {(error || storageError) && (
        <p role="alert" className="error-text">
          {error || storageError}
        </p>
      )}
      <div className="actions-secondary">
        <button className="text-button" disabled={!canRun} onClick={onCapture}>
          <ListPlus size={14} />
          Сохранить цветокоррекцию слоя
        </button>
        <button
          className="text-button"
          onClick={() =>
            void downloadBlob(
              new Blob([JSON.stringify({ version: 2, actions }, null, 2)], {
                type: 'application/json',
              }),
              'Мои операции.777actions.json',
            ).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка сохранения'))
          }
        >
          <Download size={14} />
          Скачать набор
        </button>
      </div>
      <p className="help-footnote">
        Запись: свойства, типографика, стили, коррекции, относительные трансформации/выбор слоя,
        копии и удаление. Растровые мазки, J, маски, группы, смена документа и история отмечаются
        как неподдерживаемые; выбор считается по полному стеку слоёв. После удаления активного слоя
        сценарий должен завершиться. Во время паузы изменения не записываются.
      </p>
      <p className="help-footnote">
        ATN v16 — только прежний безопасный поднабор, не любые операции Photoshop. Скрипты и плагины
        не исполняются. Наборы JSON v1/v2, до 100 операций × 200 шагов. Ошибка любого шага отменяет
        весь запуск; успешный запуск — одна отмена Ctrl+Z.
      </p>
      <footer className="dialog-footer">
        <span>
          {recording
            ? 'Сначала заверши текущую запись'
            : !canRun
              ? 'Выбери незаблокированный слой'
              : 'Ctrl+Alt+R — запись / завершение'}
        </span>
        <button
          className="primary-button"
          disabled={
            recording ||
            !canRun ||
            !active ||
            !!blockers.length ||
            !active.steps.some((s) => s.enabled)
          }
          onClick={() => active && onRun(active)}
        >
          <Play size={14} />
          Выполнить операцию
        </button>
      </footer>
    </Modal>
  )
}
