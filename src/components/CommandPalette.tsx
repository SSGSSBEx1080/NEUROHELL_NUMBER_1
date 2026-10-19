import { useEffect, useId, useRef, useState } from 'react'
import { Search, ArrowUpRight } from 'lucide-react'
import {
  readRecentCommands,
  rememberCommand,
  searchCommands,
  type SearchCommand,
} from '../engine/commandSearch'
import { Modal } from './ui'
export interface EditorCommand extends SearchCommand {
  run: () => void
}
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: EditorCommand[]
  onClose: () => void
}) {
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    [recent] = useState(readRecentCommands),
    list = useRef<HTMLDivElement>(null),
    id = useId()
  const results = searchCommands(commands, query, recent).slice(0, 100)
  const index = Math.min(active, Math.max(0, results.length - 1))
  useEffect(() => {
    list.current
      ?.querySelector(`[data-command-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [index, query])
  const run = (command: EditorCommand) => {
    if (command.disabled) return
    rememberCommand(command.id)
    onClose()
    command.run()
  }
  return (
    <Modal
      title="Поиск команд"
      subtitle="Настоящие команды редактора, инструменты и твои операции. Русские и английские названия."
      onClose={onClose}
      wide
    >
      <div className="command-search-field">
        <Search size={20} />
        <input
          autoFocus
          data-autofocus
          role="combobox"
          aria-label="Найти команду"
          aria-controls={`${id}-results`}
          aria-expanded="true"
          aria-activedescendant={results.length ? `${id}-${index}` : undefined}
          placeholder="Например: кривые, mask, направляющие…"
          value={query}
          maxLength={120}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              e.stopPropagation()
              setActive(
                (i) =>
                  (i + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, results.length)) %
                  Math.max(1, results.length),
              )
            }
            if (e.key === 'Enter' && results[index]) {
              e.preventDefault()
              e.stopPropagation()
              run(results[index])
            }
          }}
        />
        <kbd>Ctrl F</kbd>
      </div>
      <div
        className="command-results"
        ref={list}
        id={`${id}-results`}
        role="listbox"
        aria-label="Результаты поиска команд"
      >
        {results.map((command, i) => (
          <button
            key={command.id}
            id={`${id}-${i}`}
            data-command-index={i}
            role="option"
            aria-selected={i === index}
            aria-disabled={!!command.disabled}
            disabled={command.disabled}
            className={i === index ? 'active' : ''}
            onMouseEnter={() => setActive(i)}
            onClick={() => run(command)}
          >
            <span className="command-result-name">
              <small>{command.group}</small>
              <strong>{command.label}</strong>
              {command.disabled && <em>Нужен подходящий документ, слой или выделение</em>}
            </span>
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : <ArrowUpRight size={15} />}
          </button>
        ))}
        {!results.length && (
          <p className="command-empty">
            Команда не найдена. Попробуй часть названия или другое слово.
          </p>
        )}
      </div>
      <div className="command-footer">
        <span>{commands.length} доступных в каталоге команд · неактивные отмечены</span>
        <span>↑ ↓ выбрать · Enter выполнить · Esc закрыть</span>
      </div>
    </Modal>
  )
}
