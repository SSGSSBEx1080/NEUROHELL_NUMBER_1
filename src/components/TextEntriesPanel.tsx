import { useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Link2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Editor } from '../hooks/useEditor'
import type { Selection, TextEntry } from '../types'
import { uid } from '../engine/document'
import {
  MAX_TEXT_ENTRIES,
  MAX_TEXT_ENTRY_LENGTH,
  parseTextEntriesFile,
  textEntriesFile,
} from '../engine/textEntriesFormat'
import { placeTextEntry } from '../engine/textEntries'
import { downloadBlob } from '../engine/render'
import { IconButton, Select } from './ui'
export function TextEntriesPanel({
  editor,
  selection,
  onToast,
  onDraw,
  busy,
}: {
  editor: Editor
  selection: Selection | null
  onToast: (message: string) => void
  onDraw: () => void
  busy: boolean
}) {
  const doc = editor.document,
    entries = doc.textEntries || []
  const [activeId, setActiveId] = useState(
      entries.find((e) => e.layerId === editor.selectedId)?.id || entries[0]?.id,
    ),
    [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const entry = entries.find((e) => e.id === activeId) || entries[0],
    index = entry ? entries.indexOf(entry) : -1
  const selected = doc.layers.find((l) => l.id === editor.selectedId)
  const linked = doc.layers.find((l) => l.id === entry?.layerId)
  const filtered = entries.filter((e) =>
    `${e.source} ${e.text} ${e.label}`.toLowerCase().includes(query.toLowerCase()),
  )
  const finish = () => editor.finish('Изменение текстового блока')
  const patch = (values: Partial<TextEntry>, temporary = true) => {
    if (entry)
      editor.change(
        (d) => ({
          ...d,
          textEntries: d.textEntries!.map((s) => (s.id === entry.id ? { ...s, ...values } : s)),
        }),
        'Изменение текстового блока',
        temporary,
      )
  }
  const add = (source = '') => {
    if (entries.length >= MAX_TEXT_ENTRIES) return onToast('До 200 текстовых блоков на документ')
    if (source.length > MAX_TEXT_ENTRY_LENGTH)
      return onToast('Раздели исходный текст на блоки до 5000 символов')
    const next: TextEntry = {
      id: uid(),
      source,
      text: source,
      label: '',
      note: '',
      status: 'draft',
    }
    editor.change(
      (d) => ({ ...d, textEntries: [...(d.textEntries || []), next] }),
      'Новый текстовый блок',
    )
    setActiveId(next.id)
  }
  const apply = (targetId?: string) => {
    if (!entry) return
    try {
      const result = placeTextEntry(editor.documentRef.current, entry.id, selection, targetId)
      editor.change(() => result.document, 'Размещение текстового блока')
      editor.setSelectedId(result.selectedId)
      onToast('Текстовый слой обновлён. Ctrl+Z отменит изменение и связь вместе.')
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Не удалось разместить текст')
    }
  }
  return (
    <section className="text-entries-panel" aria-label="Текстовые блоки">
      <header className="text-entries-header">
        <div>
          <strong>Текстовые блоки</strong>
          <small>
            {entries.filter((e) => e.status === 'checked').length} / {entries.length} проверено
          </small>
        </div>
        <IconButton
          icon={Plus}
          label="Добавить текстовый блок"
          disabled={busy}
          onClick={() => add()}
        />
      </header>
      <fieldset disabled={busy} className="properties-fieldset text-entry-fields">
        <div className="text-entry-tools">
          <button className="compact-button" onClick={() => input.current?.click()}>
            <Upload size={12} />
            Импорт
          </button>
          <button
            className="compact-button"
            aria-label="Экспорт текстовых блоков"
            disabled={!entries.length}
            onClick={() =>
              void downloadBlob(
                new Blob([textEntriesFile(doc.name, entries)], { type: 'application/json' }),
                `${doc.name}.777texts.json`,
              ).catch((e) => onToast(e.message))
            }
          >
            <Download size={12} />
            Экспорт
          </button>
          <button
            className="compact-button"
            disabled={!selected?.sourceText && selected?.kind !== 'text'}
            onClick={() => add(selected?.sourceText || selected?.text || '')}
          >
            Из слоя
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          aria-label="Импорт текстовых блоков"
          accept=".777texts.json,.777script.json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              if (file.size > 8 * 1024 * 1024) throw new Error('Файл текстов должен быть до 8 МиБ')
              const imported = parseTextEntriesFile(JSON.parse(await file.text()))
              if (
                (editor.documentRef.current.textEntries?.length || 0) + imported.length >
                MAX_TEXT_ENTRIES
              )
                throw new Error('После импорта будет больше 200 текстовых блоков')
              if (editor.documentRef.current.id !== doc.id)
                throw new Error('Документ изменился — повтори импорт текстовых блоков')
              editor.change(
                (d) => ({ ...d, textEntries: [...(d.textEntries || []), ...imported] }),
                'Импорт текстовых блоков',
              )
              setActiveId(imported[0].id)
              onToast('Текстовые блоки добавлены. Связи со слоями можно назначить отдельно.')
            } catch (e) {
              onToast(e instanceof Error ? e.message : 'Ошибка файла текстовых блоков')
            }
          }}
        />
        {!!entries.length && (
          <input
            className="text-entry-search"
            aria-label="Поиск текстовых блоков"
            placeholder="Найти текст или метку…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="text-entry-list">
          {filtered.map((e) => (
            <button
              key={e.id}
              className={entry?.id === e.id ? 'selected' : ''}
              onClick={() => setActiveId(e.id)}
              title={e.source || e.text}
            >
              <span>{String(entries.indexOf(e) + 1).padStart(2, '0')}</span>
              <span>{e.text || e.source || 'Новый текстовый блок'}</span>
              {e.status === 'checked' ? (
                <Check size={12} />
              ) : e.layerId && doc.layers.some((l) => l.id === e.layerId) ? (
                <Link2 size={12} />
              ) : null}
            </button>
          ))}
        </div>
        {entry ? (
          <div className="text-entry-editor" key={entry.id}>
            <div className="text-entry-navigation">
              <IconButton
                icon={ChevronLeft}
                label="Предыдущий текстовый блок"
                disabled={index <= 0}
                onClick={() => setActiveId(entries[index - 1].id)}
              />
              <strong>Блок {index + 1}</strong>
              <IconButton
                icon={ChevronRight}
                label="Следующий текстовый блок"
                disabled={index >= entries.length - 1}
                onClick={() => setActiveId(entries[index + 1].id)}
              />
              <span className="spacer" />
              {[-1, 1].map((direction) => (
                <IconButton
                  key={direction}
                  icon={direction < 0 ? ArrowUp : ArrowDown}
                  label={
                    direction < 0
                      ? 'Переместить текстовый блок выше'
                      : 'Переместить текстовый блок ниже'
                  }
                  disabled={index + direction < 0 || index + direction >= entries.length}
                  onClick={() =>
                    editor.change((d) => {
                      const textEntries = [...d.textEntries!]
                      ;[textEntries[index], textEntries[index + direction]] = [
                        textEntries[index + direction],
                        textEntries[index],
                      ]
                      return { ...d, textEntries }
                    }, 'Порядок текстовых блоков')
                  }
                />
              ))}
              <IconButton
                icon={Trash2}
                label="Удалить текстовый блок"
                title="Удаляет запись; текстовый слой остаётся и действие можно отменить"
                onClick={() =>
                  editor.change(
                    (d) => ({ ...d, textEntries: d.textEntries!.filter((s) => s.id !== entry.id) }),
                    'Удаление текстового блока',
                  )
                }
              />
            </div>
            <label className="text-entry-label">
              Метка
              <input
                aria-label="Метка"
                value={entry.label}
                maxLength={100}
                onChange={(e) => patch({ label: e.target.value })}
                onBlur={finish}
              />
            </label>
            <label className="text-entry-label">
              Текст
              <textarea
                aria-label="Содержимое текстового блока"
                value={entry.text}
                rows={4}
                maxLength={MAX_TEXT_ENTRY_LENGTH}
                onChange={(e) => patch({ text: e.target.value })}
                onBlur={finish}
              />
            </label>
            <Select
              aria-label="Статус текстового блока"
              value={entry.status}
              onChange={(e) => patch({ status: e.target.value as TextEntry['status'] }, false)}
            >
              <option value="draft">Черновик</option>
              <option value="ready">Готово</option>
              <option value="checked">Проверено</option>
            </Select>
            <details className="text-entry-details">
              <summary>Дополнительные поля</summary>
              <label className="text-entry-label">
                Исходный текст
                <textarea
                  aria-label="Исходный текст блока"
                  value={entry.source}
                  rows={3}
                  maxLength={MAX_TEXT_ENTRY_LENGTH}
                  onChange={(e) => patch({ source: e.target.value })}
                  onBlur={finish}
                />
              </label>
              <label className="text-entry-label">
                Примечание
                <textarea
                  aria-label="Заметка к текстовому блоку"
                  value={entry.note}
                  rows={2}
                  maxLength={2000}
                  onChange={(e) => patch({ note: e.target.value })}
                  onBlur={finish}
                />
              </label>
            </details>
            {linked && (
              <button className="text-entry-linked" onClick={() => editor.setSelectedId(linked.id)}>
                <Link2 size={12} />
                {linked.name}
              </button>
            )}
            {linked && linked.text !== entry.text && (
              <p className="panel-note">
                Содержимое блока отличается от слоя. Изменения переносятся только по кнопке ниже.
              </p>
            )}
            <button
              className="action-button primary-action"
              disabled={!entry.text.trim()}
              onClick={() => apply()}
            >
              {linked
                ? 'Обновить связанный текст'
                : selection
                  ? 'Разместить в выделении'
                  : 'Создать текстовый слой'}
            </button>
            {!linked && (
              <button
                className="action-button"
                disabled={!entry.text.trim() || selected?.kind !== 'text'}
                onClick={() => apply(selected?.id)}
              >
                Вставить в выбранный текст
              </button>
            )}
            {linked && (
              <button className="text-button" onClick={() => patch({ layerId: undefined }, false)}>
                Отвязать текст
              </button>
            )}
            <button className="text-button" onClick={onDraw}>
              Нарисовать текстовую рамку · Shift+T
            </button>
          </div>
        ) : (
          <div className="text-entry-empty">
            <strong>Текстовые блоки документа</strong>
            <p>
              Храни тексты и заметки, создавай текстовые слои или связывай записи с существующими.
              Список сохраняется вместе с документом.
            </p>
            <button className="secondary-button" onClick={() => add()}>
              <Plus size={14} />
              Добавить первый текстовый блок
            </button>
          </div>
        )}
        <p className="panel-note text-entry-privacy">
          До 200 текстовых блоков, до 5000 символов в поле. Данные остаются на устройстве. Импорт не
          переносит связи с чужими слоями.
        </p>
      </fieldset>
    </section>
  )
}
