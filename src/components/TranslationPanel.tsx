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
import type { Selection, TranslationEntry } from '../types'
import { uid } from '../engine/document'
import {
  MAX_SCRIPT_ENTRIES,
  MAX_SCRIPT_TEXT,
  parseScriptFile,
  scriptFile,
} from '../engine/scriptFormat'
import { typesetEntry } from '../engine/script'
import { downloadBlob } from '../engine/render'
import { IconButton, Select } from './ui'
export function TranslationPanel({
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
    entries = doc.script || []
  const [activeId, setActiveId] = useState(entries[0]?.id),
    [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const entry = entries.find((e) => e.id === activeId) || entries[0],
    index = entry ? entries.indexOf(entry) : -1
  const selected = doc.layers.find((l) => l.id === editor.selectedId)
  const linked = doc.layers.find((l) => l.id === entry?.layerId)
  const filtered = entries.filter((e) =>
    `${e.source} ${e.translation} ${e.speaker}`.toLowerCase().includes(query.toLowerCase()),
  )
  const finish = () => editor.finish('Редактирование сценария')
  const patch = (values: Partial<TranslationEntry>, temporary = true) => {
    if (entry)
      editor.change(
        (d) => ({
          ...d,
          script: d.script!.map((s) => (s.id === entry.id ? { ...s, ...values } : s)),
        }),
        'Редактирование сценария',
        temporary,
      )
  }
  const add = (source = '') => {
    if (entries.length >= MAX_SCRIPT_ENTRIES) return onToast('До 200 реплик на страницу')
    if (source.length > MAX_SCRIPT_TEXT)
      return onToast('Раздели исходный текст на реплики до 5000 символов')
    const next: TranslationEntry = {
      id: uid(),
      source,
      translation: '',
      speaker: '',
      note: '',
      status: 'draft',
    }
    editor.change((d) => ({ ...d, script: [...(d.script || []), next] }), 'Новая реплика сценария')
    setActiveId(next.id)
  }
  const apply = (targetId?: string) => {
    if (!entry) return
    try {
      const result = typesetEntry(editor.documentRef.current, entry.id, selection, targetId)
      editor.change(() => result.document, 'Размещение перевода')
      editor.setSelectedId(result.selectedId)
      onToast('Перевод помещён в редактируемый текст. Ctrl+Z отменит текст и связь вместе.')
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Ошибка тайпсета')
    }
  }
  return (
    <section className="translation-panel" aria-label="Сценарий перевода">
      <header className="translation-header">
        <div>
          <strong>Сценарий страницы</strong>
          <small>
            {entries.filter((e) => e.status === 'proofread').length} / {entries.length} проверено
          </small>
        </div>
        <IconButton icon={Plus} label="Добавить реплику" disabled={busy} onClick={() => add()} />
      </header>
      <fieldset disabled={busy} className="properties-fieldset script-fields">
        <div className="script-tools">
          <button className="compact-button" onClick={() => input.current?.click()}>
            <Upload size={12} />
            Импорт
          </button>
          <button
            className="compact-button"
            disabled={!entries.length}
            onClick={() =>
              void downloadBlob(
                new Blob([scriptFile(doc.name, entries)], { type: 'application/json' }),
                `${doc.name}.777script.json`,
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
            Из текста
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          aria-label="Импорт сценария"
          accept=".777script.json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              if (file.size > 8 * 1024 * 1024) throw new Error('Сценарий должен быть до 8 МиБ')
              const imported = parseScriptFile(JSON.parse(await file.text()))
              if (
                (editor.documentRef.current.script?.length || 0) + imported.length >
                MAX_SCRIPT_ENTRIES
              )
                throw new Error('После импорта будет больше 200 реплик')
              if (editor.documentRef.current.id !== doc.id)
                throw new Error('Страница изменилась — импортируй сценарий ещё раз')
              editor.change(
                (d) => ({ ...d, script: [...(d.script || []), ...imported] }),
                'Импорт сценария',
              )
              setActiveId(imported[0].id)
              onToast('Реплики добавлены в конец. Свяжи их со слоями этой страницы.')
            } catch (e) {
              onToast(e instanceof Error ? e.message : 'Ошибка сценария')
            }
          }}
        />
        {!!entries.length && (
          <input
            className="script-search"
            aria-label="Поиск реплики"
            placeholder="Найти реплику или персонажа…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="script-list">
          {filtered.map((e) => (
            <button
              key={e.id}
              className={entry?.id === e.id ? 'selected' : ''}
              onClick={() => setActiveId(e.id)}
              title={e.source || e.translation}
            >
              <span>{String(entries.indexOf(e) + 1).padStart(2, '0')}</span>
              <span>{e.translation || e.source || 'Новая реплика'}</span>
              {e.status === 'proofread' ? (
                <Check size={12} />
              ) : e.layerId && doc.layers.some((l) => l.id === e.layerId) ? (
                <Link2 size={12} />
              ) : null}
            </button>
          ))}
        </div>
        {entry ? (
          <div className="script-editor" key={entry.id}>
            <div className="script-navigation">
              <IconButton
                icon={ChevronLeft}
                label="Предыдущая реплика"
                disabled={index <= 0}
                onClick={() => setActiveId(entries[index - 1].id)}
              />
              <strong>Реплика {index + 1}</strong>
              <IconButton
                icon={ChevronRight}
                label="Следующая реплика"
                disabled={index >= entries.length - 1}
                onClick={() => setActiveId(entries[index + 1].id)}
              />
              <span className="spacer" />
              {[-1, 1].map((direction) => (
                <IconButton
                  key={direction}
                  icon={direction < 0 ? ArrowUp : ArrowDown}
                  label={direction < 0 ? 'Реплика раньше' : 'Реплика позже'}
                  disabled={index + direction < 0 || index + direction >= entries.length}
                  onClick={() =>
                    editor.change((d) => {
                      const script = [...d.script!]
                      ;[script[index], script[index + direction]] = [
                        script[index + direction],
                        script[index],
                      ]
                      return { ...d, script }
                    }, 'Порядок реплик')
                  }
                />
              ))}
              <IconButton
                icon={Trash2}
                label="Удалить запись реплики"
                title="Удаляет запись; текстовый слой остаётся и действие можно отменить"
                onClick={() =>
                  editor.change(
                    (d) => ({ ...d, script: d.script!.filter((s) => s.id !== entry.id) }),
                    'Удаление записи реплики',
                  )
                }
              />
            </div>
            <label className="script-label">
              Персонаж
              <input
                aria-label="Персонаж"
                value={entry.speaker}
                maxLength={100}
                onChange={(e) => patch({ speaker: e.target.value })}
                onBlur={finish}
              />
            </label>
            <label className="script-label">
              Оригинал
              <textarea
                aria-label="Оригинал реплики"
                value={entry.source}
                rows={3}
                maxLength={MAX_SCRIPT_TEXT}
                onChange={(e) => patch({ source: e.target.value })}
                onBlur={finish}
              />
            </label>
            <label className="script-label">
              Перевод
              <textarea
                aria-label="Перевод реплики"
                value={entry.translation}
                rows={4}
                maxLength={MAX_SCRIPT_TEXT}
                onChange={(e) => patch({ translation: e.target.value })}
                onBlur={finish}
              />
            </label>
            <Select
              aria-label="Статус перевода"
              value={entry.status}
              onChange={(e) =>
                patch({ status: e.target.value as TranslationEntry['status'] }, false)
              }
            >
              <option value="draft">Черновик</option>
              <option value="translated">Переведено</option>
              <option value="proofread">Проверено</option>
            </Select>
            <label className="script-label">
              Примечание
              <textarea
                aria-label="Примечание к переводу"
                value={entry.note}
                rows={2}
                maxLength={2000}
                onChange={(e) => patch({ note: e.target.value })}
                onBlur={finish}
              />
            </label>
            {linked && (
              <button className="script-linked" onClick={() => editor.setSelectedId(linked.id)}>
                <Link2 size={12} />
                {linked.name}
              </button>
            )}
            {linked && linked.text !== entry.translation && (
              <p className="panel-note">
                Перевод и текст слоя различаются. Обновление — только по кнопке ниже.
              </p>
            )}
            <button
              className="action-button primary-action"
              disabled={!entry.translation.trim()}
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
                disabled={!entry.translation.trim() || selected?.kind !== 'text'}
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
          <div className="script-empty">
            <strong>От исходника к реплике</strong>
            <p>
              Добавь оригинал и свой перевод, затем размести текст в пузыре. Введённый сценарий
              сохранится внутри PSD и в автокопии.
            </p>
            <button className="secondary-button" onClick={() => add()}>
              <Plus size={14} />
              Первая реплика
            </button>
          </div>
        )}
        <p className="panel-note script-privacy">
          Локальный сценарий, не OCR и не автоперевод. Ничего не отправляется в сеть. До 200 реплик,
          до 5000 символов в поле. Импорт добавляет записи без привязок к чужим слоям.
        </p>
      </fieldset>
    </section>
  )
}
